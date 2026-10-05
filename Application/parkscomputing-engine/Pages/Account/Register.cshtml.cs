using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using ParksComputing.Engine.Identity;
namespace ParksComputing.Engine.Pages.Account;
/// <summary>Create account, which exists only while registration is open
/// (AccountOptions.Registration); closed, the page and its request answer 404.</summary>
[EnableRateLimiting(AdminAuthController.RateLimitPolicy)]
public sealed class RegisterModel : PageModel {
    private readonly AccountWorkflow _workflow; private readonly AccountOptions _options;
    public RegisterModel(AccountWorkflow workflow, IOptions<AccountOptions> options) { _workflow = workflow; _options = options.Value; }
    [BindProperty] public string Email { get; set; } = "";
    [BindProperty] public string DisplayName { get; set; } = "";
    [BindProperty(SupportsGet = true)] public string? ReturnUrl { get; set; }
    public string Back => AccountReturn.Of(ReturnUrl, Url);
    public bool Sent { get; private set; }
    public IActionResult OnGet() => !_options.Registration ? NotFound() : User.Identity?.IsAuthenticated == true ? LocalRedirect(Back) : Page();
    public async Task<IActionResult> OnPostAsync() {
        if (!_options.Registration) { return NotFound(); }
        try { await _workflow.RequestAsync(Email, DisplayName, AdminOptions.ClientIp(HttpContext)); Sent = true; }
        catch (ArgumentException ex) { ModelState.AddModelError(ex.Message.StartsWith("Use a display") ? "DisplayName" : "Email", ex.Message); }
        return Page();
    }
}
