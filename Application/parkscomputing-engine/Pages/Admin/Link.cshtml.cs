using System.Threading.Tasks;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.AspNetCore.RateLimiting;

using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.Pages.Admin;

/// <summary>
/// An emailed sign-in link. Opening it only shows a button: mail scanners
/// fetch links, so the link is spent by the press, a POST, and never by a GET.
/// </summary>
[AllowAnonymous]
[EnableRateLimiting(AdminAuthController.RateLimitPolicy)]
public sealed class LinkModel : PageModel {
    private readonly UserManager<IdentityUser> _users;
    private readonly AdminSessions _sessions;

    public LinkModel(UserManager<IdentityUser> users, AdminSessions sessions) {
        _users = users; _sessions = sessions;
    }

    [BindProperty(SupportsGet = true)] public string? Uid { get; set; }
    [BindProperty(SupportsGet = true)] public string? Token { get; set; }

    public bool Valid { get; private set; }

    private async Task<IdentityUser?> ValidUserAsync() {
        if (string.IsNullOrEmpty(Uid) || string.IsNullOrEmpty(Token)) {
            return null;
        }
        var user = await _users.FindByIdAsync(Uid);
        return user is not null && await _sessions.MaySignInAsync(user)
            && await _users.VerifyUserTokenAsync(user, EmailLinkTokenProvider<IdentityUser>.ProviderName, EmailLinkTokenProvider<IdentityUser>.SignInPurpose, Token)
            ? user : null;
    }

    public async Task<IActionResult> OnGetAsync() {
        Valid = await ValidUserAsync() is not null;
        return Page();
    }

    public async Task<IActionResult> OnPostAsync() {
        var user = await ValidUserAsync();
        if (user is null) {
            return Page();
        }
        // A new stamp voids this link, and any other session the account had.
        await _users.UpdateSecurityStampAsync(user);
        await _sessions.SignInAsync(user, AdminSessions.EmailLink, HttpContext);
        return Redirect("/admin");
    }
}
