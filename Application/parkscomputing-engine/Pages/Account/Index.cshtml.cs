using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;
using ParksComputing.Engine.Identity;
namespace ParksComputing.Engine.Pages.Account;

/// <summary>
/// The reader's account: the classic /account page, and the fragment the
/// Account applet loads into its window (?handler=Applet). Someone who is
/// not signed in gets the page's sign-in offer rather than a redirect, so
/// the Account window can say so in place. Every change requires a session.
/// Requests are capped a little above the profile picture limit, the
/// largest thing posted here, so a far larger upload is cut off unread.
/// </summary>
[RequestSizeLimit(AccountAvatars.MaxBytes + 64 * 1024)]
public sealed class IndexModel : PageModel {
    private readonly SiteIdentityDbContext _db; private readonly UserManager<IdentityUser> _users; private readonly StaffBootstrap _bootstrap; private readonly AccountAvatars _avatars;
    public IndexModel(SiteIdentityDbContext db, UserManager<IdentityUser> users, StaffBootstrap bootstrap, AccountAvatars avatars) {
        _db = db; _users = users; _bootstrap = bootstrap; _avatars = avatars;
    }
    public string? AvatarUrl { get; private set; }
    [BindProperty] public string DisplayName { get; set; } = "";
    [BindProperty] public Guid Version { get; set; }
    public bool SignedIn { get; private set; }
    public bool SetupPending { get; private set; }
    public string Email { get; private set; } = "";
    public string Access { get; private set; } = "";
    public string CurrentSession => User.FindFirstValue(AdminSessions.SessionClaim) ?? "";
    public record Session(string Id, DateTime StartedUtc, DateTime LastSeenUtc, string Method);
    public record Key(string Id, string Name);
    public List<Session> Sessions { get; private set; } = new();
    public List<Key> Keys { get; private set; } = new();

    public async Task OnGetAsync() { await LoadAsync(true); }
    public async Task<IActionResult> OnGetAppletAsync() { await LoadAsync(true); return Partial("_AccountContent", this); }

    private async Task LoadAsync(bool profile) {
        var user = User.Identity?.IsAuthenticated == true ? await _users.GetUserAsync(User) : null;
        if (user is null) { return; }
        SignedIn = true;
        Email = user.Email ?? "";
        var roles = await _users.GetRolesAsync(user);
        Access = roles.Contains("SuperAdmin") ? "Super-user" : roles.Contains("Admin") ? "Administrator" :
            roles.Contains("Moderator") ? "Moderator" : roles.Contains("Member") ? "Member" : "Email not yet confirmed";
        SetupPending = await _bootstrap.PendingAsync(user.Id);
        AvatarUrl = await _avatars.VersionAsync(user.Id) is { } v ? AccountAvatars.UrlOf(user.Id, v) : null;
        if (profile) { var p = await _db.AccountProfiles.AsNoTracking().SingleOrDefaultAsync(p => p.UserId == user.Id); DisplayName = p?.DisplayName ?? ""; Version = p?.Version ?? Guid.Empty; }
        Sessions = await _db.SiteSessions.Where(s => s.UserId == user.Id && s.RevokedUtc == null && s.SecurityStamp == user.SecurityStamp)
            .OrderByDescending(s => s.StartedUtc).Select(s => new Session(s.Id, s.StartedUtc, s.LastSeenUtc, s.Method)).ToListAsync();
        Keys = (await _users.GetPasskeysAsync(user)).Select(k => new Key(Microsoft.AspNetCore.WebUtilities.WebEncoders.Base64UrlEncode(k.CredentialId), k.Name ?? "Passkey")).ToList();
    }

    public async Task<IActionResult> OnPostProfileAsync() {
        if (User.Identity?.IsAuthenticated != true) { return Challenge(); }
        try {
            var name = AccountWorkflow.DisplayName(DisplayName); var userId = _users.GetUserId(User);
            var changed = await _db.AccountProfiles.Where(p => p.UserId == userId && p.Version == Version && p.SuspendedUtc == null)
                .ExecuteUpdateAsync(p => p.SetProperty(x => x.DisplayName, name).SetProperty(x => x.Version, Guid.NewGuid()));
            if (changed == 0) { ModelState.AddModelError("", "Your profile changed somewhere else. Reload, then save again."); }
            else { return Redirect("/account"); }
        } catch (ArgumentException ex) { ModelState.AddModelError("DisplayName", ex.Message); }
        await LoadAsync(false); return Page();
    }

    /// <summary>A new profile picture (Identity/AccountAvatars.cs).</summary>
    public async Task<IActionResult> OnPostAvatarAsync(Microsoft.AspNetCore.Http.IFormFile? picture) {
        if (User.Identity?.IsAuthenticated != true) { return Challenge(); }
        try {
            if (picture is null || picture.Length == 0) { throw new ArgumentException(AccountAvatars.Missing); }
            if (picture.Length > AccountAvatars.MaxBytes) { throw new ArgumentException(AccountAvatars.TooLarge); }
            using var buffer = new System.IO.MemoryStream();
            await picture.CopyToAsync(buffer);
            await _avatars.SetAsync(_users.GetUserId(User)!, buffer.ToArray());
            return Redirect("/account");
        } catch (ArgumentException ex) { ModelState.AddModelError("Picture", ex.Message); }
        await LoadAsync(true); return Page();
    }

    public async Task<IActionResult> OnPostRemoveAvatarAsync() {
        if (User.Identity?.IsAuthenticated != true) { return Challenge(); }
        await _avatars.RemoveAsync(_users.GetUserId(User)!);
        return Redirect("/account");
    }

    public async Task<IActionResult> OnPostRevokeAsync(string sessionId) {
        if (User.Identity?.IsAuthenticated != true) { return Challenge(); }
        var userId = _users.GetUserId(User);
        await _db.SiteSessions.Where(s => s.UserId == userId && s.Id == sessionId && s.RevokedUtc == null)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedUtc, (DateTime?)DateTime.UtcNow));
        return Redirect("/account");
    }
}
