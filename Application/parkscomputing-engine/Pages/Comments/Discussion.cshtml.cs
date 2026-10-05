using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.Extensions.Options;
using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.Pages.Comments;

/// <summary>
/// An article's discussion (Architecture/unified-identity-design.md, step 2),
/// at /comments/{slug}: the whole page for a reader without script or one
/// who follows a comment's link, and the fragment the comments applet
/// (js/comments.js) shows under the article in both views (?handler=Applet).
/// Every change posts here, comes back to the discussion and says what
/// happened; a refused one comes back with the reader's text and why.
/// </summary>
public sealed class DiscussionModel : PageModel {
    private readonly Discussions _discussions; private readonly UserManager<IdentityUser> _users;
    private readonly SessionPolicy _policy; private readonly bool _enabled;
    public DiscussionModel(Discussions discussions, UserManager<IdentityUser> users, SessionPolicy policy,
        IOptions<AccountOptions> options, IOptions<CommentOptions> comments) {
        _discussions = discussions; _users = users; _policy = policy; _enabled = options.Value.Enabled && comments.Value.Enabled;
    }

    public DiscussionView View { get; private set; } = default!;
    /// <summary>What the last change came to, from the address it returned
    /// to: submitted, edited, withdrawn or reported.</summary>
    [BindProperty(SupportsGet = true)] public string? Done { get; set; }
    public string? Error { get; private set; }
    /// <summary>The comment a refused reply or edit was for, and its text,
    /// so its form opens again holding what the reader wrote.</summary>
    public Guid? FailedFor { get; private set; }
    public string? Draft { get; private set; }
    /// <summary>A fresh key for each form that makes a comment, so the same
    /// submission sent twice makes one comment.</summary>
    public static string NewKey() => Guid.NewGuid().ToString("N");

    private async Task<string?> ReaderAsync() {
        var id = _users.GetUserId(User);
        return id is not null && await _policy.ValidAsync(User) ? id : null;
    }

    private async Task<bool> LoadAsync(string slug) {
        if (!_enabled) { return false; }
        var view = await _discussions.ReadAsync(slug, await ReaderAsync(), moderator: false);
        if (view is null || view.Policy == "disabled") { return false; }
        View = view;
        ViewData["Title"] = "Comments on " + view.Title;
        Response.Headers.CacheControl = "no-cache, no-store";
        return true;
    }

    public async Task<IActionResult> OnGetAsync(string slug) => await LoadAsync(slug) ? Page() : NotFound();

    public async Task<IActionResult> OnGetAppletAsync(string slug) => await LoadAsync(slug) ? Partial("_DiscussionContent", this) : NotFound();

    private async Task<IActionResult> AfterAsync(string slug, CommentOutcome outcome, string done, Guid? failedFor, string? draft) {
        if (outcome.Ok) {
            var anchor = outcome.Id is { } id ? "#c-" + id : "";
            return Redirect($"/comments/{Uri.EscapeDataString(slug)}?done={done}{anchor}");
        }
        if (!await LoadAsync(slug)) { return NotFound(); }
        Response.StatusCode = outcome.Status;
        Error = outcome.Error; FailedFor = failedFor; Draft = draft;
        return Page();
    }

    private async Task<IActionResult?> SignedOutAsync(string slug) {
        if (await ReaderAsync() is not null) { return null; }
        if (!await LoadAsync(slug)) { return NotFound(); }
        Response.StatusCode = 401;
        Error = "You're signed out. Sign in again, then send it again.";
        return Page();
    }

    public async Task<IActionResult> OnPostSubmitAsync(string slug, string? source, Guid? parentId, string? key) {
        if (await SignedOutAsync(slug) is { } signedOut) { return signedOut; }
        var outcome = await _discussions.SubmitAsync(slug, (await ReaderAsync())!, parentId, source ?? "", key ?? "");
        return await AfterAsync(slug, outcome, "submitted", parentId, source);
    }

    public async Task<IActionResult> OnPostEditAsync(string slug, Guid id, string? source, string? version) {
        if (await SignedOutAsync(slug) is { } signedOut) { return signedOut; }
        var outcome = await _discussions.EditAsync(id, (await ReaderAsync())!, source ?? "", version);
        return await AfterAsync(slug, outcome, "edited", id, source);
    }

    public async Task<IActionResult> OnPostWithdrawAsync(string slug, Guid id) {
        if (await SignedOutAsync(slug) is { } signedOut) { return signedOut; }
        var outcome = await _discussions.WithdrawAsync(id, (await ReaderAsync())!);
        return await AfterAsync(slug, outcome with { Id = null }, "withdrawn", null, null);
    }

    public async Task<IActionResult> OnPostReportAsync(string slug, Guid id, string? reason) {
        if (await SignedOutAsync(slug) is { } signedOut) { return signedOut; }
        var outcome = await _discussions.ReportAsync(id, (await ReaderAsync())!, reason ?? "");
        return await AfterAsync(slug, outcome, "reported", id, reason);
    }
}
