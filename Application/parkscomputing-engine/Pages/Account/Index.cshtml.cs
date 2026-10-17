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
    private readonly Discussions _discussions; private readonly AccountLifecycle _lifecycle; private readonly ModerationNotices _notices;
    private readonly AccessTokens _tokens; private readonly AdminSessions _sessions; private readonly bool _mcp;
    public IndexModel(SiteIdentityDbContext db, UserManager<IdentityUser> users, StaffBootstrap bootstrap, AccountAvatars avatars,
        Discussions discussions, AccountLifecycle lifecycle, ModerationNotices notices, AccessTokens tokens, AdminSessions sessions,
        Microsoft.Extensions.Configuration.IConfiguration configuration) {
        _db = db; _users = users; _bootstrap = bootstrap; _avatars = avatars; _discussions = discussions; _lifecycle = lifecycle; _notices = notices;
        _tokens = tokens; _sessions = sessions; _mcp = ParksComputing.Engine.Mcp.McpSetup.Enabled(configuration);
    }

    /* === Access tokens for /mcp (Identity/AccessTokens.cs) =============== */

    /// <summary>Whether this account may have access tokens: the site has
    /// /mcp, and the account may use the server's tools.</summary>
    public bool TokensOffered { get; private set; }
    public IReadOnlyList<AccessTokenInfo> Tokens { get; private set; } = Array.Empty<AccessTokenInfo>();
    /// <summary>A token just made, whose secret is shown this once.</summary>
    public (string Secret, AccessTokenInfo Token)? NewToken { get; private set; }
    public string? TokenError { get; private set; }
    /* Every form on the page posts to this model, so the token form's fields
       are optional here, and its handler clears what the profile's fields
       would say about a post that never carried them. */
    [BindProperty] public string? TokenName { get; set; }
    [BindProperty] public int TokenDays { get; set; } = 30;
    [BindProperty] public List<string>? TokenCaps { get; set; }

    /// <summary>Makes a token, after a passkey tap within the confirmation
    /// window, and emails the account that it was made.</summary>
    public async Task<IActionResult> OnPostCreateTokenAsync() {
        ModelState.Clear();
        if (User.Identity?.IsAuthenticated != true) { return Challenge(); }
        var user = await _users.GetUserAsync(User);
        if (user is null) { return Challenge(); }
        if (!_mcp || !await _sessions.MaySignInAsync(user)) { return NotFound(); }
        if (!await _sessions.RecentlyConfirmedAsync(User)) {
            TokenError = "Confirm it's you with a passkey first, then make the token again.";
        } else {
            try {
                NewToken = await _tokens.CreateAsync(user.Id, TokenName ?? "", TokenDays, TokenCaps ?? new());
                await _sessions.NotifyAsync(user, "An access token was made for parkscomputing.com",
                    $"An access token named \"{NewToken.Value.Token.Name}\" was made for {user.Email}, lasting until {NewToken.Value.Token.ExpiresUtc:yyyy-MM-dd} UTC, " +
                    $"with {string.Join(", ", NewToken.Value.Token.Capabilities)}. It works with the site's /mcp endpoint. Revoke it in Your account if you didn't make it.", HttpContext);
                TokenName = null; TokenCaps = null;
            } catch (ArgumentException ex) { TokenError = ex.Message; }
        }
        await LoadAsync(true); return Page();
    }

    public async Task<IActionResult> OnPostRevokeTokenAsync(string tokenId) {
        if (User.Identity?.IsAuthenticated != true) { return Challenge(); }
        await _tokens.RevokeAsync(_users.GetUserId(User)!, tokenId ?? "");
        return Redirect("/account#tokens");
    }
    /// <summary>The reader's own comments, newest first, with where each stands.</summary>
    public IReadOnlyList<MyComment> Comments { get; private set; } = Array.Empty<MyComment>();
    public bool Moderates { get; private set; }
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
        Comments = await _discussions.MineAsync(user.Id);
        Moderates = roles.Any(r => r is "Moderator" or "Admin" or "SuperAdmin");
        if (Moderates) { NoticeInterval = await _notices.IntervalAsync(user.Id); }
        TokensOffered = _mcp && await _sessions.MaySignInAsync(user);
        if (TokensOffered) { Tokens = await _tokens.ListAsync(user.Id); }
    }

    /// <summary>How often, in minutes, a moderator is emailed about what is
    /// waiting; 0 is never (Identity/ModerationNotices.cs).</summary>
    public int NoticeInterval { get; private set; } = ModerationNotices.DefaultInterval;

    public async Task<IActionResult> OnPostNoticesAsync(int minutes) {
        if (User.Identity?.IsAuthenticated != true) { return Challenge(); }
        var user = await _users.GetUserAsync(User);
        if (user is null) { return Challenge(); }
        var roles = await _users.GetRolesAsync(user);
        if (roles.Any(r => r is "Moderator" or "Admin" or "SuperAdmin")) { await _notices.SetIntervalAsync(user.Id, minutes); }
        return Redirect("/account#comments");
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

    /// <summary>Everything the site holds about the member, as a JSON file
    /// to keep (Identity/AccountLifecycle.cs).</summary>
    public async Task<IActionResult> OnGetExportAsync() {
        if (User.Identity?.IsAuthenticated != true) { return Challenge(); }
        var data = await _lifecycle.ExportAsync(_users.GetUserId(User)!);
        if (data is null) { return NotFound(); }
        Response.Headers.CacheControl = "no-cache, no-store";
        // A file the member reads, sent as an attachment, so its text is
        // written as it is rather than escaped for embedding in HTML.
        var json = System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(data, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web) {
            WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
        });
        return File(json, "application/json", "parkscomputing-account.json");
    }

    /// <summary>Emails a link that confirms deleting the account; nothing is
    /// deleted until it is followed (Pages/Account/Delete.cshtml).</summary>
    public async Task<IActionResult> OnPostRequestDeletionAsync() {
        // The profile's fields aren't in this form, so what they'd say is cleared.
        ModelState.Clear();
        if (User.Identity?.IsAuthenticated != true) { return Challenge(); }
        var userId = _users.GetUserId(User)!;
        DeletionRefusal = await _lifecycle.DeletionRefusalAsync(userId);
        if (DeletionRefusal is null) {
            DeletionSent = await _lifecycle.RequestDeletionAsync(userId);
            if (!DeletionSent) { DeletionRefusal = "The email could not be sent. Try again in a few minutes."; }
        }
        await LoadAsync(true); return Page();
    }
    public bool DeletionSent { get; private set; }
    public string? DeletionRefusal { get; private set; }

    public async Task<IActionResult> OnPostRevokeAsync(string sessionId) {
        if (User.Identity?.IsAuthenticated != true) { return Challenge(); }
        var userId = _users.GetUserId(User);
        await _db.SiteSessions.Where(s => s.UserId == userId && s.Id == sessionId && s.RevokedUtc == null)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedUtc, (DateTime?)DateTime.UtcNow));
        return Redirect("/account");
    }
}
