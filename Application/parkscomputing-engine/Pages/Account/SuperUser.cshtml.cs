using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.RazorPages;
using ParksComputing.Engine.Identity;
namespace ParksComputing.Engine.Pages.Account;

/// <summary>Super-user setup: where the account stands on each step the
/// activation requires (Identity/StaffBootstrap.cs), and the activation
/// itself once the steps before it are done.</summary>
[Authorize]
public sealed class SuperUserModel : PageModel {
    private readonly StaffBootstrap _bootstrap; private readonly UserManager<IdentityUser> _users;
    public SuperUserModel(StaffBootstrap bootstrap, UserManager<IdentityUser> users) { _bootstrap = bootstrap; _users = users; }
    public bool Pending { get; private set; }
    public bool Activated { get; private set; }
    public DateTime? Until { get; private set; }
    public bool EmailConfirmed { get; private set; }
    public int Keys { get; private set; }
    public bool Ready => Pending && EmailConfirmed && Keys >= 2;
    public async Task OnGetAsync() {
        var user = await _users.GetUserAsync(User);
        if (user is null) { return; }
        Until = await _bootstrap.PendingUntilAsync(user.Id);
        Pending = Until is not null;
        Activated = await _users.IsInRoleAsync(user, "SuperAdmin");
        EmailConfirmed = user.EmailConfirmed;
        Keys = (await _users.GetPasskeysAsync(user)).Count;
    }
}
