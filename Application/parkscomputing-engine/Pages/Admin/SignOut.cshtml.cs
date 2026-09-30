using System.Threading.Tasks;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.Pages.Admin;

/// <summary>Signing out is a POST, from the bar on every admin page. It also ends the session's SSH relays (A16).</summary>
[AllowAnonymous]
public sealed class SignOutModel : PageModel {
    private readonly SignInManager<IdentityUser> _signIn;
    private readonly SshRelays _relays;

    public SignOutModel(SignInManager<IdentityUser> signIn, SshRelays relays) { _signIn = signIn; _relays = relays; }

    public IActionResult OnGet() => Redirect("/admin");

    public async Task<IActionResult> OnPostAsync() {
        _relays.EndSession(User.FindFirst(AdminSessions.SessionClaim)?.Value);
        await _signIn.SignOutAsync();
        return Redirect("/admin/signin");
    }
}
