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
/// tap was, as claims in the session cookie; those decide what it may do.
/// </summary>
public sealed class AdminSessions {
    public const string MethodClaim = "pc_method";
    public const string SignedInClaim = "pc_signed_in";
    public const string ConfirmedClaim = "pc_confirmed";

    public const string Passkey = "passkey";
    public const string EmailLink = "email";
    public const string RecoveryCode = "recovery";

    private static readonly string[] Carried = { MethodClaim, SignedInClaim, ConfirmedClaim };

    private readonly SignInManager<IdentityUser> _signIn;
    private readonly UserManager<IdentityUser> _users;
    private readonly ResendMailer _mail;
    private readonly AdminOptions _options;

    public AdminSessions(SignInManager<IdentityUser> signIn, UserManager<IdentityUser> users, ResendMailer mail, IOptions<AdminOptions> options) {
        _signIn = signIn; _users = users; _mail = mail; _options = options.Value;
    }

    private static string Now() => DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);

    /// <summary>Whether this account may use the edit origin at all.</summary>
    public async Task<bool> MaySignInAsync(IdentityUser user) =>
        !await _users.IsLockedOutAsync(user) && await _users.IsInRoleAsync(user, AdminOptions.Role);

    /// <summary>
    /// Starts a session. A passkey sign-in counts as a passkey tap; an email
    /// link or recovery code is a fallback session, which can't change
    /// sign-in methods until it taps a passkey.
    /// </summary>
    public async Task SignInAsync(IdentityUser user, string method, HttpContext ctx) {
        var now = Now();
        await _signIn.SignInWithClaimsAsync(user, isPersistent: false, new[] {
            new Claim(MethodClaim, method),
            new Claim(SignedInClaim, now),
            new Claim(ConfirmedClaim, method == Passkey ? now : "0")
        });
        await NotifyAsync(user, "Signed in to parkscomputing.com",
            $"Someone signed in to edit parkscomputing.com as {user.Email}, with {Describe(method)}.", ctx);
    }

    /// <summary>Records a fresh passkey tap on the current session, keeping how it began.</summary>
    public async Task ConfirmAsync(IdentityUser user, ClaimsPrincipal current) {
        await _signIn.SignInWithClaimsAsync(user, isPersistent: false, new[] {
            new Claim(MethodClaim, current.FindFirstValue(MethodClaim) ?? Passkey),
            new Claim(SignedInClaim, current.FindFirstValue(SignedInClaim) ?? Now()),
            new Claim(ConfirmedClaim, Now())
        });
    }

    /// <summary>Whether the session tapped a passkey within the confirmation window.</summary>
    public bool RecentlyConfirmed(ClaimsPrincipal p) => Within(p, ConfirmedClaim, TimeSpan.FromMinutes(_options.ConfirmMinutes));

    /// <summary>Whether the session tapped a passkey recently enough for a destructive change (A8).</summary>
    public bool ConfirmedForDestructive(ClaimsPrincipal p) => Within(p, ConfirmedClaim, TimeSpan.FromMinutes(_options.DestructiveConfirmMinutes));

    /// <summary>Whether the session has outlived its absolute lifetime.</summary>
    public static bool Expired(ClaimsPrincipal p, AdminOptions options) =>
        !Within(p, SignedInClaim, TimeSpan.FromHours(options.AbsoluteHours));

    private static bool Within(ClaimsPrincipal p, string claim, TimeSpan window) {
        var v = p.FindFirstValue(claim);
        if (!long.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out var secs) || secs <= 0) {
            return false;
        }
        return DateTimeOffset.UtcNow - DateTimeOffset.FromUnixTimeSeconds(secs) <= window;
    }

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
