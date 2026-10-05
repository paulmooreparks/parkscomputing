using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.AspNetCore.RateLimiting;
using ParksComputing.Engine.Identity;
namespace ParksComputing.Engine.Pages.Account;

/// <summary>The page the deletion email opens (Identity/AccountLifecycle.cs).
/// Opening it changes nothing; the button deletes the account, spending the
/// link in the same transaction, and signs this browser out.</summary>
[EnableRateLimiting(AdminAuthController.RateLimitPolicy)]
public sealed class DeleteModel : PageModel {
    private readonly AccountLifecycle _lifecycle; private readonly SignInManager<IdentityUser> _signIn;
    public DeleteModel(AccountLifecycle lifecycle, SignInManager<IdentityUser> signIn) { _lifecycle = lifecycle; _signIn = signIn; }
    [BindProperty(SupportsGet = true)] public string Uid { get; set; } = "";
    [BindProperty(SupportsGet = true)] public string Token { get; set; } = "";
    public bool Valid { get; private set; }
    public bool Deleted { get; private set; }
    public async Task OnGetAsync() { Response.Headers.CacheControl = "no-cache, no-store"; Valid = await _lifecycle.DeletionLinkValidAsync(Uid, Token); }
    public async Task<IActionResult> OnPostAsync() {
        Response.Headers.CacheControl = "no-cache, no-store";
        Deleted = await _lifecycle.ConfirmDeletionAsync(Uid, Token);
        if (Deleted && _signIn.UserManager.GetUserId(User) == Uid) { await _signIn.SignOutAsync(); }
        return Page();
    }
}
