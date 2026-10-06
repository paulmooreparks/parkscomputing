using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.WebUtilities;
namespace ParksComputing.Engine.Identity;
[ApiController, Route("api/account/passkey"), AutoValidateAntiforgeryToken]
[EnableRateLimiting(AdminAuthController.RateLimitPolicy)]
public sealed class AccountAuthController : ControllerBase {
    private readonly SignInManager<IdentityUser> _signIn; private readonly UserManager<IdentityUser> _users;
    private readonly MemberSessions _sessions; private readonly SessionPolicy _policy; private readonly StaffBootstrap _bootstrap;
    public AccountAuthController(SignInManager<IdentityUser> signIn, UserManager<IdentityUser> users, MemberSessions sessions, SessionPolicy policy, StaffBootstrap bootstrap) {
        _signIn = signIn; _users = users; _sessions = sessions; _policy = policy; _bootstrap = bootstrap;
    }
    public sealed record Body(JsonElement? Credential, string? Name, string? Id);
    private static object Refused => new { error = "That did not work. Try again or sign in with email." };
    private async Task<IdentityUser?> CurrentAsync() {
        var user = await _users.GetUserAsync(User);
        return user is not null && await _sessions.EligibleAsync(user) && await _policy.ValidAsync(User) ? user : null;
    }
    private async Task<bool> StaffAsync(IdentityUser user) => (await _users.GetRolesAsync(user)).Any(r => r is "Moderator" or "Admin" or "SuperAdmin");

    /// <summary>Whether adding a passkey needs a tap of an existing one first,
    /// as a staff account's does. Not while the operator's super-user setup
    /// for the account is pending: that host-side authorization is the proof,
    /// and the account may hold no passkey this site can use, such as one
    /// made for the retired edit origin.</summary>
    private async Task<bool> MustConfirmToEnrollAsync(IdentityUser user) =>
        await StaffAsync(user) && !await _policy.ConfirmedAsync(User) && !await _bootstrap.PendingAsync(user.Id);
    /// <summary>A fresh antiforgery token for whoever the reader is now, and
    /// whether they are signed in. A page open across a sign-in or a lapsed
    /// session holds a token for who the reader was, which the next form or
    /// script request would fail with; js/accounts.js asks for a new one.
    /// The account's id says whether a sign-in brought back the account the
    /// page was made for (the layout's pc-account meta tag), in which case
    /// the page can carry on as it is.</summary>
    [HttpGet("/api/account/token")]
    public IActionResult Token([FromServices] Microsoft.AspNetCore.Antiforgery.IAntiforgery antiforgery) {
        Response.Headers.CacheControl = "no-cache, no-store";
        var signedIn = User.Identity?.IsAuthenticated == true;
        return Ok(new {
            token = antiforgery.GetAndStoreTokens(HttpContext).RequestToken, signedIn,
            account = signedIn ? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value : null
        });
    }

    [HttpPost("request-options")]
    public async Task<IActionResult> RequestOptions() => Content(await _signIn.MakePasskeyRequestOptionsAsync(null), "application/json");
    [HttpPost("signin")]
    public async Task<IActionResult> SignIn(Body body) {
        if (body.Credential is not { } credential) { return BadRequest(Refused); }
        var result = await _signIn.PerformPasskeyAssertionAsync(credential.GetRawText());
        if (!result.Succeeded || result.User is not { } user || !await _sessions.EligibleAsync(user)) { return Unauthorized(Refused); }
        if (!(await _users.AddOrUpdatePasskeyAsync(user, result.Passkey)).Succeeded) { return BadRequest(Refused); }
        await _sessions.SignInAsync(user, AdminSessions.Passkey); return Ok(new { redirect = "/account" });
    }
    [HttpPost("confirm")]
    public async Task<IActionResult> Confirm(Body body) {
        var user = await CurrentAsync(); if (user is null || body.Credential is not { } credential) { return Unauthorized(Refused); }
        var result = await _signIn.PerformPasskeyAssertionAsync(credential.GetRawText());
        if (!result.Succeeded || result.User?.Id != user.Id || !(await _users.AddOrUpdatePasskeyAsync(user, result.Passkey)).Succeeded ||
            !await _policy.ConfirmAsync(User)) { return Unauthorized(Refused); }
        return Ok(new { ok = true });
    }
    [HttpPost("creation-options")]
    public async Task<IActionResult> CreationOptions() {
        var user = await CurrentAsync(); if (user is null) { return Unauthorized(Refused); }
        if (await MustConfirmToEnrollAsync(user)) { return StatusCode(403, new { confirm = true, error = "Confirm with an existing passkey first." }); }
        return Content(await _signIn.MakePasskeyCreationOptionsAsync(new PasskeyUserEntity {
            Id = user.Id, Name = user.Email ?? user.UserName!, DisplayName = user.Email ?? user.UserName!
        }), "application/json");
    }
    [HttpPost("register")]
    public async Task<IActionResult> Register(Body body) {
        var user = await CurrentAsync(); if (user is null || body.Credential is not { } credential) { return Unauthorized(Refused); }
        if (await MustConfirmToEnrollAsync(user)) { return StatusCode(403, new { confirm = true }); }
        var result = await _signIn.PerformPasskeyAttestationAsync(credential.GetRawText());
        if (!result.Succeeded || result.UserEntity?.Id != user.Id) { return BadRequest(Refused); }
        result.Passkey.Name = string.IsNullOrWhiteSpace(body.Name) ? "Passkey" : body.Name.Trim()[..Math.Min(60, body.Name.Trim().Length)];
        if (result.Passkey.Name.Any(char.IsControl) || !(await _users.AddOrUpdatePasskeyAsync(user, result.Passkey)).Succeeded) { return BadRequest(Refused); }
        return Ok(new { redirect = "/account" });
    }
    [HttpPost("remove")]
    public async Task<IActionResult> Remove(Body body) {
        var user = await CurrentAsync(); if (user is null) { return Unauthorized(Refused); }
        if (await StaffAsync(user) && !await _policy.ConfirmedAsync(User)) { return StatusCode(403, new { confirm = true }); }
        byte[] id; try { id = WebEncoders.Base64UrlDecode(body.Id ?? ""); } catch (FormatException) { return BadRequest(Refused); }
        var keys = await _users.GetPasskeysAsync(user);
        if (!keys.Any(k => k.CredentialId.AsSpan().SequenceEqual(id))) { return NotFound(Refused); }
        if (await StaffAsync(user) && keys.Count <= 2) { return Conflict(new { error = "Staff accounts must keep two passkeys. Add another before removing this one." }); }
        if (!(await _users.RemovePasskeyAsync(user, id)).Succeeded) { return BadRequest(Refused); }
        return Ok(new { redirect = "/account" });
    }
    [HttpPost("activate-superuser")]
    public async Task<IActionResult> Activate(Body body) {
        var user = await CurrentAsync(); if (user is null || body.Credential is not { } credential) { return Unauthorized(Refused); }
        var result = await _signIn.PerformPasskeyAssertionAsync(credential.GetRawText());
        if (!result.Succeeded || result.User?.Id != user.Id || !(await _users.AddOrUpdatePasskeyAsync(user, result.Passkey)).Succeeded ||
            !await _policy.ConfirmAsync(User) || !await _bootstrap.ActivateAsync(User)) { return BadRequest(new { error = "Setup requires host authorization, verified email and two passkeys." }); }
        var refreshed = await _users.FindByIdAsync(user.Id);
        await _sessions.SignInAsync(refreshed!, AdminSessions.Passkey);
        return Ok(new { redirect = "/" });
    }
}
