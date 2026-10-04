using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// Admin sign-in (Architecture/admin-and-identity-design.md, A4, A8, A9).
/// Every session records how it began and when, and when its last passkey
/// tap was. Durable records decide whether the session is valid or elevated.
/// </summary>
public sealed class AdminSessions {
    public const string MethodClaim = "pc_method";
    public const string SignedInClaim = "pc_signed_in";
    public const string ConfirmedClaim = "pc_confirmed";
    /// <summary>A random id for the session, by which its idle time is kept (A14).</summary>
    public const string SessionClaim = "pc_session";

    public const string Passkey = "passkey";
    public const string EmailLink = "email";
    public const string RecoveryCode = "recovery";

    private static readonly string[] Carried = { MethodClaim, SignedInClaim, ConfirmedClaim, SessionClaim };

    private readonly SignInManager<IdentityUser> _signIn;
    private readonly UserManager<IdentityUser> _users;
    private readonly ResendMailer _mail;
    private readonly SessionPolicy _policy;
    private readonly DurableSessions _durable;
    private readonly AccountStatus _status;
    private readonly string _serverRole;

    public AdminSessions(SignInManager<IdentityUser> signIn, UserManager<IdentityUser> users, ResendMailer mail, SessionPolicy policy, DurableSessions durable, AccountStatus status,
        Microsoft.Extensions.Options.IOptions<AccountOptions> accounts) {
        _signIn = signIn; _users = users; _mail = mail; _policy = policy; _durable = durable; _status = status;
        _serverRole = ServerRole(accounts.Value);
    }

    /// <summary>The role the server's own tools (the admin mount, SSH) take.
    /// On the edit origin every admin uses them; on the site with accounts
    /// only the super-user does, because there an Admin edits articles and
    /// nothing more (Architecture/unified-identity-design.md, roles table).</summary>
    public static string ServerRole(AccountOptions accounts) => accounts.Enabled ? "SuperAdmin" : AdminOptions.Role;

    private static string Now() => DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);

    /// <summary>Whether this account may use the server's own tools: the
    /// edit origin, or on the site with accounts its admin mount and SSH.</summary>
    public async Task<bool> MaySignInAsync(IdentityUser user) =>
        user.EmailConfirmed && !await _status.SuspendedAsync(user.Id) && !await _users.IsLockedOutAsync(user) && await _users.IsInRoleAsync(user, _serverRole);

    /// <summary>
    /// Starts a session. A passkey sign-in counts as a passkey tap; an email
    /// link or recovery code is a fallback session, which can't change
    /// sign-in methods until it taps a passkey.
    /// </summary>
    public async Task SignInAsync(IdentityUser user, string method, HttpContext ctx) {
        if (!await MaySignInAsync(user) || !user.EmailConfirmed) { throw new InvalidOperationException("Account cannot sign in."); }
        var sessionId = await _durable.CreateAsync(user, method);
        var now = Now();
        await _signIn.SignInWithClaimsAsync(user, isPersistent: false, new[] {
            new Claim(MethodClaim, method),
            new Claim(SignedInClaim, now),
            new Claim(ConfirmedClaim, method == Passkey ? now : "0"),
            new Claim(SessionClaim, sessionId)
        });
        await NotifyAsync(user, "Signed in to parkscomputing.com",
            $"Someone signed in to edit parkscomputing.com as {user.Email}, with {Describe(method)}.", ctx);
    }

    /// <summary>Records a fresh passkey tap on the current session, keeping how it began.</summary>
    public async Task ConfirmAsync(IdentityUser user, ClaimsPrincipal current) {
        if (current.FindFirstValue(ClaimTypes.NameIdentifier) != user.Id || !await _policy.ConfirmAsync(current)) {
            throw new InvalidOperationException("Session has ended.");
        }
        await _signIn.SignInWithClaimsAsync(user, isPersistent: false, new[] {
            new Claim(MethodClaim, current.FindFirstValue(MethodClaim) ?? Passkey),
            new Claim(SignedInClaim, current.FindFirstValue(SignedInClaim) ?? Now()),
            new Claim(ConfirmedClaim, Now()),
            new Claim(SessionClaim, current.FindFirstValue(SessionClaim)!)
        });
    }

    public Task<bool> RecentlyConfirmedAsync(ClaimsPrincipal p) => _policy.ConfirmedAsync(p);

    public Task<bool> ConfirmedForDestructiveAsync(ClaimsPrincipal p) => _policy.ConfirmedAsync(p, destructive: true);

    public static async Task<bool> ExpiredAsync(ClaimsPrincipal p, SessionPolicy policy) =>
        !await policy.ValidAsync(p, touch: true);

    /// <summary>Checks all durable session limits without extending activity.</summary>
    public static async Task<bool> ExpiredWithoutActivityAsync(ClaimsPrincipal p, SessionPolicy policy) =>
        !await policy.ValidAsync(p);

    /// <summary>
    /// Carries the session's claims across Identity's periodic refresh of the
    /// principal, which would otherwise rebuild it without them.
    /// </summary>
    public static void CarryClaims(ClaimsPrincipal from, ClaimsPrincipal to) {
        if (to.Identity is not ClaimsIdentity id) {
            return;
        }
        foreach (var c in from.Claims.Where(c => Carried.Contains(c.Type))) {
            if (!id.HasClaim(x => x.Type == c.Type)) {
                id.AddClaim(new Claim(c.Type, c.Value));
            }
        }
    }

    public static string Describe(string? method) => method switch {
        Passkey => "a passkey",
        EmailLink => "an emailed sign-in link",
        RecoveryCode => "a recovery code",
        _ => "an unknown method"
    };

    /// <summary>Emails the account about something done with it, with where it came from.</summary>
    public Task NotifyAsync(IdentityUser user, string subject, string what, HttpContext ctx) {
        if (string.IsNullOrWhiteSpace(user.Email)) {
            return Task.CompletedTask;
        }
        var text = string.Join("\n", new List<string> {
            what,
            "",
            $"When: {DateTimeOffset.UtcNow:yyyy-MM-dd HH:mm:ss} UTC",
            $"From: {AdminOptions.ClientIp(ctx)}",
            $"Browser: {ctx.Request.Headers.UserAgent}",
            "",
            "If this wasn't you, sign in with a passkey and remove what you don't recognise, or revoke the account from the server:",
            "  docker exec parkscomputing-dev dotnet ParksComputing.Engine.dll admin revoke " + user.Email
        });
        return _mail.SendAsync(user.Email, subject, text);
    }
}
