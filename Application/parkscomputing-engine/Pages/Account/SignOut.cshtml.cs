using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using ParksComputing.Engine.Identity;
namespace ParksComputing.Engine.Pages.Account;
public sealed class SignOutModel : PageModel {
    private readonly DurableSessions _sessions; private readonly SignInManager<IdentityUser> _signIn;
    public SignOutModel(DurableSessions sessions, SignInManager<IdentityUser> signIn) { _sessions = sessions; _signIn = signIn; }
    public IActionResult OnGet() => Redirect("/account");
    /// <summary>Signs out and returns the reader to the page they were
    /// reading, unless that page was their account's, which they no longer
    /// have open.</summary>
    public async Task<IActionResult> OnPostAsync(string? returnUrl) {
        await _sessions.RevokeAsync(User); await _signIn.SignOutAsync();
        bool back = !string.IsNullOrEmpty(returnUrl) && Url.IsLocalUrl(returnUrl) &&
            !returnUrl.StartsWith("/account", System.StringComparison.OrdinalIgnoreCase) &&
            !returnUrl.StartsWith("/admin", System.StringComparison.OrdinalIgnoreCase);
        return LocalRedirect(back ? returnUrl! : "/");
    }
}
