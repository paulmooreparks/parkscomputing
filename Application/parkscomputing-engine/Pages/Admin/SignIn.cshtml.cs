using System;
using System.Threading.Tasks;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.Pages.Admin;

/// <summary>
/// Signing in to the edit origin (Architecture/admin-and-identity-design.md, A4):
/// a passkey first (js/admin.js), then an emailed link or a recovery code.
/// Neither fallback says whether an address has an account.
/// </summary>
[AllowAnonymous]
[EnableRateLimiting(AdminAuthController.RateLimitPolicy)]
public sealed class SignInModel : PageModel {
    private readonly UserManager<IdentityUser> _users;
    private readonly AdminSessions _sessions;
    private readonly ResendMailer _mail;
    private readonly AdminOptions _options;

    public SignInModel(UserManager<IdentityUser> users, AdminSessions sessions, ResendMailer mail, IOptions<AdminOptions> options) {
        _users = users; _sessions = sessions; _mail = mail; _options = options.Value;
    }

    [BindProperty] public string? Email { get; set; }
    [BindProperty] public string? Code { get; set; }

    public string? Message { get; private set; }
    public bool IsError { get; private set; }

    public IActionResult OnGet() => User.IsInRole(AdminOptions.Role) ? Redirect("/admin") : Page();

    public async Task<IActionResult> OnPostEmailAsync() {
        var email = (Email ?? "").Trim();
        var user = email.Length > 0 ? await _users.FindByEmailAsync(email) : null;
        if (user is not null && await _sessions.MaySignInAsync(user)) {
            var token = await _users.GenerateUserTokenAsync(user, EmailLinkTokenProvider<IdentityUser>.ProviderName, EmailLinkTokenProvider<IdentityUser>.SignInPurpose);
            var url = $"{_options.EditOrigin.TrimEnd('/')}/admin/link?uid={Uri.EscapeDataString(user.Id)}&token={Uri.EscapeDataString(token)}";
            await _mail.SendAsync(user.Email!, "Your sign-in link for parkscomputing.com",
                "Open this link within 15 minutes to sign in to edit parkscomputing.com:\n\n" + url + "\n\n" +
                "It works once. If you didn't ask for it, ignore this message: nobody can use the link without reading your email.\n\n" +
                $"Asked for from {AdminOptions.ClientIp(HttpContext)}.");
        }
        Message = "If that address belongs to an admin, a sign-in link is on its way. It works once, within 15 minutes.";
        return Page();
    }

    public async Task<IActionResult> OnPostRecoveryAsync() {
        var email = (Email ?? "").Trim();
        var code = (Code ?? "").Trim();
        var user = email.Length > 0 ? await _users.FindByEmailAsync(email) : null;
        if (user is not null && code.Length > 0 && await _sessions.MaySignInAsync(user)) {
            var redeemed = await _users.RedeemTwoFactorRecoveryCodeAsync(user, code);
            if (redeemed.Succeeded) {
                await _users.ResetAccessFailedCountAsync(user);
                await _sessions.SignInAsync(user, AdminSessions.RecoveryCode, HttpContext);
                await _sessions.NotifyAsync(user, "A recovery code was used",
                    $"A recovery code was used to sign in as {user.Email}. {await _users.CountRecoveryCodesAsync(user)} remain.", HttpContext);
                return Redirect("/admin");
            }
            await _users.AccessFailedAsync(user);
        }
        Message = "That address and code don't match. After five wrong codes the account waits fifteen minutes.";
        IsError = true;
        return Page();
    }
}
