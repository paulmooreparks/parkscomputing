using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.AspNetCore.RateLimiting;
using ParksComputing.Engine.Identity;
namespace ParksComputing.Engine.Pages.Account;
[EnableRateLimiting(AdminAuthController.RateLimitPolicy)]
public sealed class RegisterModel : PageModel {
    private readonly AccountWorkflow _workflow;
    public RegisterModel(AccountWorkflow workflow) { _workflow = workflow; }
    [BindProperty] public string Email { get; set; } = "";
    [BindProperty] public string DisplayName { get; set; } = "";
    [BindProperty(SupportsGet = true)] public string? ReturnUrl { get; set; }
    public string Back => AccountReturn.Of(ReturnUrl, Url);
    public bool Sent { get; private set; }
    public IActionResult OnGet() => User.Identity?.IsAuthenticated == true ? LocalRedirect(Back) : Page();
    public async Task<IActionResult> OnPostAsync() {
        try { await _workflow.RequestAsync(Email, DisplayName, AdminOptions.ClientIp(HttpContext)); Sent = true; }
        catch (ArgumentException ex) { ModelState.AddModelError(ex.Message.StartsWith("Use a display") ? "DisplayName" : "Email", ex.Message); }
        return Page();
    }
}
