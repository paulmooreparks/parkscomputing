using System.Threading.Tasks;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.AspNetCore.RateLimiting;

using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.Pages.Admin;

/// <summary>
/// A server-issued enrollment link (Identity/AdminCommand.cs): registers a
/// passkey and signs in. The ceremony itself is js/admin.js against
/// AdminAuthController, which checks the link again and spends it.
/// </summary>
[AllowAnonymous]
[EnableRateLimiting(AdminAuthController.RateLimitPolicy)]
public sealed class EnrollModel : PageModel {
    private readonly UserManager<IdentityUser> _users;
    private readonly AdminSessions _sessions;

    public EnrollModel(UserManager<IdentityUser> users, AdminSessions sessions) {
        _users = users; _sessions = sessions;
    }

    [BindProperty(SupportsGet = true)] public string? Uid { get; set; }
    [BindProperty(SupportsGet = true)] public string? Token { get; set; }

    public bool Valid { get; private set; }
    public string? Email { get; private set; }

    public async Task<IActionResult> OnGetAsync() {
        if (!string.IsNullOrEmpty(Uid) && !string.IsNullOrEmpty(Token)) {
            var user = await _users.FindByIdAsync(Uid);
            Valid = user is not null && await _sessions.MaySignInAsync(user)
                && await _users.VerifyUserTokenAsync(user, EmailLinkTokenProvider<IdentityUser>.ProviderName, EmailLinkTokenProvider<IdentityUser>.EnrollPurpose, Token);
            Email = Valid ? user!.Email : null;
        }
        return Page();
    }
}
