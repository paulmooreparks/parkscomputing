using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.AspNetCore.RateLimiting;
using ParksComputing.Engine.Identity;
namespace ParksComputing.Engine.Pages.Account;

/// <summary>Where a sign-in or sign-up dialog goes back to: the page of this
/// site the reader came from, such as the account page that sent them to
/// sign in, never another site and never the sign-in pages themselves, or
/// the home page.</summary>
internal static class AccountReturn {
    private static readonly string[] Refused = { "/account/signin", "/account/register", "/account/link", "/account/signout" };
    public static string Of(string? url, IUrlHelper helper) =>
        !string.IsNullOrEmpty(url) && helper.IsLocalUrl(url) &&
        !Refused.Any(r => url.StartsWith(r, StringComparison.OrdinalIgnoreCase)) ? url : "/";
}

[EnableRateLimiting(AdminAuthController.RateLimitPolicy)]
public sealed class SignInModel : PageModel {
    private readonly AccountWorkflow _workflow; private readonly Turnstile _turnstile;
    public SignInModel(AccountWorkflow workflow, Turnstile turnstile) { _workflow = workflow; _turnstile = turnstile; }
    [BindProperty] public string Email { get; set; } = "";
    [BindProperty(SupportsGet = true)] public string? ReturnUrl { get; set; }
    public string Back => AccountReturn.Of(ReturnUrl, Url);
    public bool Sent { get; private set; }
    public IActionResult OnGet() => User.Identity?.IsAuthenticated == true ? LocalRedirect(Back) : Page();
    public async Task<IActionResult> OnPostAsync() {
        if (!await _turnstile.PassesAsync(Request.Form[Turnstile.FieldName], AdminOptions.ClientIp(HttpContext))) {
            ModelState.AddModelError("", Turnstile.Refusal); return Page();
        }
        try { await _workflow.RequestAsync(Email, null, AdminOptions.ClientIp(HttpContext), Back); Sent = true; }
        catch (ArgumentException ex) { ModelState.AddModelError(ex.Message.StartsWith("Use a display") ? "DisplayName" : "Email", ex.Message); }
        return Page();
    }
}
