using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.AspNetCore.RateLimiting;
using ParksComputing.Engine.Identity;
namespace ParksComputing.Engine.Pages.Account;
[EnableRateLimiting(AdminAuthController.RateLimitPolicy)]
public sealed class LinkModel : PageModel {
    private readonly AccountLinks _links; private readonly AccountWorkflow _workflow;
    private readonly MemberSessions _sessions; private readonly UserManager<IdentityUser> _users;
    public LinkModel(AccountLinks links, AccountWorkflow workflow, MemberSessions sessions, UserManager<IdentityUser> users) {
        _links = links; _workflow = workflow; _sessions = sessions; _users = users;
    }
    [BindProperty(SupportsGet = true)] public string Uid { get; set; } = "";
    [BindProperty(SupportsGet = true)] public string Token { get; set; } = "";
    [BindProperty(SupportsGet = true)] public AccountLinkPurpose Purpose { get; set; }
    public bool Valid { get; private set; }
    public async Task OnGetAsync() { Valid = Purpose is AccountLinkPurpose.VerifyEmail or AccountLinkPurpose.SignIn && await _links.ValidAsync(Uid, Purpose, Token); }
    public async Task<IActionResult> OnPostAsync() {
        var redeemed = await _workflow.RedeemAsync(Uid, Purpose, Token);
        if (redeemed is null) { return Page(); }
        var user = await _users.FindByIdAsync(redeemed.Value.UserId);
        if (user is null || !await _sessions.EligibleAsync(user)) { return Page(); }
        await _sessions.SignInAsync(user, AdminSessions.EmailLink, redeemed.Value.SessionId);
        return Redirect("/account");
    }
}
