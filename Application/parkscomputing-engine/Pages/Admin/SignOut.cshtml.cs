using System.Threading.Tasks;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace ParksComputing.Engine.Pages.Admin;

/// <summary>Signing out is a POST, from the bar on every admin page.</summary>
[AllowAnonymous]
public sealed class SignOutModel : PageModel {
    private readonly SignInManager<IdentityUser> _signIn;

    public SignOutModel(SignInManager<IdentityUser> signIn) { _signIn = signIn; }

    public IActionResult OnGet() => Redirect("/admin");

    public async Task<IActionResult> OnPostAsync() {
        await _signIn.SignOutAsync();
        return Redirect("/admin/signin");
    }
}
