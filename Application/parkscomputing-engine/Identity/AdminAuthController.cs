using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.WebUtilities;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// The passkey ceremonies behind the admin pages (Architecture/admin-and-identity-design.md,
/// A4 and A8). The browser half is js/admin.js. Every call carries the page's
/// antiforgery token, is rate-limited per reader, and answers only on the edit
/// origin (EditOriginGate). Adding or removing a passkey, or making new
/// recovery codes, needs a passkey tap within the confirmation window, except
/// the first passkey of an account, which needs a server-issued enrollment link.
/// </summary>
[ApiController]
[Route("api/admin")]
[Produces("application/json")]
[AutoValidateAntiforgeryToken]
[EnableRateLimiting(AdminAuthController.RateLimitPolicy)]
public sealed class AdminAuthController : ControllerBase {
    public const string RateLimitPolicy = "admin-signin";

    private readonly SignInManager<IdentityUser> _signIn;
    private readonly UserManager<IdentityUser> _users;
    private readonly AdminSessions _sessions;

    public AdminAuthController(SignInManager<IdentityUser> signIn, UserManager<IdentityUser> users, AdminSessions sessions) {
        _signIn = signIn; _users = users; _sessions = sessions;
    }

    public sealed record CeremonyRequest(JsonElement? Credential, string? Uid, string? Token, string? Name, string? Id, string? ReturnUrl = null);

    private static readonly object Refused = new { ok = false, error = "That didn't work. Try again, or use another way to sign in." };
    private static readonly object NeedsConfirm = new { ok = false, confirm = true, error = "Confirm it's you with a passkey first." };

    /* === Signing in ===================================================== */

    /// <summary>Options for signing in with any passkey the device holds for this site.</summary>
    [HttpPost("passkey/request-options")]
    public async Task<IActionResult> RequestOptions() {
        var current = User.IsInRole(AdminOptions.Role) ? await _users.GetUserAsync(User) : null;
        return Content(await _signIn.MakePasskeyRequestOptionsAsync(current), "application/json");
    }

    /// <summary>Signs in with a passkey assertion.</summary>
    [HttpPost("passkey/signin")]
    public async Task<IActionResult> SignIn([FromBody] CeremonyRequest body) {
        if (body.Credential is not { } credential) {
            return BadRequest(Refused);
        }
        var result = await _signIn.PerformPasskeyAssertionAsync(credential.GetRawText());
        if (!result.Succeeded || result.User is not { } user || !await _sessions.MaySignInAsync(user)) {
            return Unauthorized(Refused);
        }
        await _users.AddOrUpdatePasskeyAsync(user, result.Passkey);
        await _sessions.SignInAsync(user, AdminSessions.Passkey, HttpContext);
        return Ok(new { ok = true, redirect = ReturnTo(body.ReturnUrl) });
    }

    /* Back to where sign-in was asked for, if that was an admin page here. */
    private static string ReturnTo(string? url) =>
        !string.IsNullOrEmpty(url) && url.StartsWith("/admin", StringComparison.OrdinalIgnoreCase) && !url.StartsWith("//") && !url.Contains('\\')
            ? url : "/admin";

    /// <summary>A fresh passkey tap for the signed-in admin, for the actions that need one.</summary>
    [HttpPost("passkey/confirm")]
    public async Task<IActionResult> Confirm([FromBody] CeremonyRequest body) {
        var me = await CurrentAdminAsync();
        if (me is null || body.Credential is not { } credential) {
            return Unauthorized(Refused);
        }
        var result = await _signIn.PerformPasskeyAssertionAsync(credential.GetRawText());
        if (!result.Succeeded || result.User?.Id != me.Id) {
            return Unauthorized(Refused);
        }
        await _users.AddOrUpdatePasskeyAsync(me, result.Passkey);
        await _sessions.ConfirmAsync(me, User);
        return Ok(new { ok = true });
    }

    /* === Passkeys ======================================================= */

    /// <summary>Options for making a new passkey, for an enrollment link or a confirmed admin.</summary>
    [HttpPost("passkey/creation-options")]
    public async Task<IActionResult> CreationOptions([FromBody] CeremonyRequest body) {
        var (user, refusal) = await MayAddPasskeyAsync(body);
        if (user is null) {
            return refusal!;
        }
        var entity = new PasskeyUserEntity { Id = user.Id, Name = user.Email ?? user.UserName!, DisplayName = user.Email ?? user.UserName! };
        return Content(await _signIn.MakePasskeyCreationOptionsAsync(entity), "application/json");
    }

    /// <summary>Stores a new passkey. An enrollment link is spent by it and signs the admin in.</summary>
    [HttpPost("passkey/register")]
    public async Task<IActionResult> Register([FromBody] CeremonyRequest body) {
        var (user, refusal) = await MayAddPasskeyAsync(body);
        if (user is null) {
            return refusal!;
        }
        if (body.Credential is not { } credential) {
            return BadRequest(Refused);
        }
        var result = await _signIn.PerformPasskeyAttestationAsync(credential.GetRawText());
        if (!result.Succeeded || result.UserEntity?.Id != user.Id) {
            return BadRequest(Refused);
        }
        var passkey = result.Passkey;
        passkey.Name = string.IsNullOrWhiteSpace(body.Name) ? $"Passkey added {DateTime.UtcNow:d MMM yyyy}" : body.Name.Trim()[..Math.Min(body.Name.Trim().Length, 60)];
        var added = await _users.AddOrUpdatePasskeyAsync(user, passkey);
        if (!added.Succeeded) {
            return BadRequest(Refused);
        }

        // MayAddPasskeyAsync accepted the enrollment link if the request carried one.
        bool enrolling = !string.IsNullOrEmpty(body.Uid) && !string.IsNullOrEmpty(body.Token);
        await _sessions.NotifyAsync(user, "A passkey was added", $"A passkey named \"{passkey.Name}\" was added to {user.Email}.", HttpContext);
        if (enrolling) {
            // The link is spent: renewing the stamp voids it, and any other session.
            await _users.UpdateSecurityStampAsync(user);
            await _sessions.SignInAsync(user, AdminSessions.Passkey, HttpContext);
        }
        // Enrollment lands on the desktop; a passkey added from the account
        // page reloads that page, to show it in the list.
        return Ok(new { ok = true, redirect = enrolling ? "/admin" : null });
    }

    /// <summary>Removes a passkey, never the last one.</summary>
    [HttpPost("passkey/remove")]
    public async Task<IActionResult> Remove([FromBody] CeremonyRequest body) {
        var me = await CurrentAdminAsync();
        if (me is null) {
            return Unauthorized(Refused);
        }
        if (!await _sessions.RecentlyConfirmedAsync(User)) {
            return StatusCode(StatusCodes.Status403Forbidden, NeedsConfirm);
        }
        byte[] id;
        try { id = WebEncoders.Base64UrlDecode(body.Id ?? ""); } catch (FormatException) { return BadRequest(Refused); }
        var keys = await _users.GetPasskeysAsync(me);
        var key = keys.FirstOrDefault(k => k.CredentialId.AsSpan().SequenceEqual(id));
        if (key is null) {
            return NotFound(Refused);
        }
        if (keys.Count <= 1) {
            return Conflict(new { ok = false, error = "This is your only passkey. Add another before removing it." });
        }
        await _users.RemovePasskeyAsync(me, id);
        await _sessions.NotifyAsync(me, "A passkey was removed", $"The passkey named \"{key.Name}\" was removed from {me.Email}.", HttpContext);
        return Ok(new { ok = true });
    }

    /* === Recovery codes ================================================= */

    /// <summary>Makes ten new recovery codes, voiding the old ones, and shows them once.</summary>
    [HttpPost("recovery-codes")]
    public async Task<IActionResult> RecoveryCodes() {
        var me = await CurrentAdminAsync();
        if (me is null) {
            return Unauthorized(Refused);
        }
        if (!await _sessions.RecentlyConfirmedAsync(User)) {
            return StatusCode(StatusCodes.Status403Forbidden, NeedsConfirm);
        }
        var codes = await _users.GenerateNewTwoFactorRecoveryCodesAsync(me, 10);
        await _sessions.NotifyAsync(me, "New recovery codes were made", $"New recovery codes were made for {me.Email}. The old ones no longer work.", HttpContext);
        return Ok(new { ok = true, codes });
    }

    /* === Who is asking ================================================== */

    private async Task<IdentityUser?> CurrentAdminAsync() {
        if (!User.IsInRole(AdminOptions.Role)) {
            return null;
        }
        var me = await _users.GetUserAsync(User);
        return me is not null && await _sessions.MaySignInAsync(me) ? me : null;
    }

    /// <summary>
    /// Who may add a passkey now: the holder of a valid enrollment link for
    /// an admin account, or a signed-in admin with a recent passkey tap.
    /// </summary>
    private async Task<(IdentityUser? user, IActionResult? refusal)> MayAddPasskeyAsync(CeremonyRequest body) {
        if (!string.IsNullOrEmpty(body.Uid) && !string.IsNullOrEmpty(body.Token)) {
            var user = await _users.FindByIdAsync(body.Uid);
            bool valid = user is not null && await _sessions.MaySignInAsync(user)
                && await _users.VerifyUserTokenAsync(user, EmailLinkTokenProvider<IdentityUser>.ProviderName, EmailLinkTokenProvider<IdentityUser>.EnrollPurpose, body.Token);
            return valid ? (user, null) : (null, Unauthorized(new { ok = false, error = "This enrollment link has expired or been used. Ask the server for a new one." }));
        }
        var me = await CurrentAdminAsync();
        if (me is null) {
            return (null, Unauthorized(Refused));
        }
        if (!await _sessions.RecentlyConfirmedAsync(User)) {
            return (null, StatusCode(StatusCodes.Status403Forbidden, NeedsConfirm));
        }
        return (me, null);
    }
}
