using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.Pages;

/// <summary>
/// The moderation queue (Architecture/unified-identity-design.md, step 2):
/// comments and edits waiting for review, and open reports. The classic
/// page is /moderation; the moderation applet (js/moderation.js) shows the
/// same panel in a window (?handler=Applet). A moderator confirms with a
/// passkey before the queue shows, and every decision is checked again.
/// Anyone else finds nothing here.
/// </summary>
public sealed class ModerationModel : PageModel {
    private readonly Discussions _discussions; private readonly StaffAccess _staff; private readonly UserManager<IdentityUser> _users;
    public ModerationModel(Discussions discussions, StaffAccess staff, UserManager<IdentityUser> users) {
        _discussions = discussions; _staff = staff; _users = users;
    }

    /// <summary>signin, confirm or ready.</summary>
    public string Stage { get; private set; } = "signin";
    public ModerationQueue Queue { get; private set; } = new(Array.Empty<QueueItem>(), Array.Empty<ReportItem>());
    [BindProperty(SupportsGet = true)] public string? Done { get; set; }
    public string? Error { get; private set; }

    /// <summary>False when the reader is signed in but is not a moderator,
    /// to whom the page does not exist.</summary>
    private async Task<bool> LoadAsync() {
        Response.Headers.CacheControl = "no-store";
        ViewData["Title"] = "Moderation";
        if (User.Identity?.IsAuthenticated != true) { Stage = "signin"; return true; }
        if (!await _staff.ModeratesAsync(User, confirmed: false)) { return false; }
        if (!await _staff.ModeratesAsync(User)) { Stage = "confirm"; return true; }
        Stage = "ready";
        Queue = await _discussions.QueueAsync();
        return true;
    }

    public async Task<IActionResult> OnGetAsync() => await LoadAsync() ? Page() : NotFound();
    public async Task<IActionResult> OnGetAppletAsync() => await LoadAsync() ? Partial("_ModerationContent", this) : NotFound();

    private async Task<IActionResult> DecideAsync(Func<string, Task<CommentOutcome>> act, string done) {
        if (!await LoadAsync()) { return NotFound(); }
        if (Stage != "ready") { Response.StatusCode = Stage == "signin" ? 401 : 403; return Page(); }
        var outcome = await act(_users.GetUserId(User)!);
        if (outcome.Ok) { return Redirect("/moderation?done=" + done); }
        await LoadAsync();
        Response.StatusCode = outcome.Status;
        Error = outcome.Error;
        return Page();
    }

    public Task<IActionResult> OnPostDecideAsync(Guid revisionId, string? kind, string? reason, string? version) =>
        DecideAsync(me => _discussions.DecideAsync(revisionId, me, kind ?? "", reason, version), kind switch { "approve" => "approved", "spam" => "spam", _ => "declined" });

    public Task<IActionResult> OnPostRemoveAsync(Guid commentId, string? reason, string? version) =>
        DecideAsync(me => _discussions.RemoveAsync(commentId, me, reason, version), "removed");

    public Task<IActionResult> OnPostDismissAsync(Guid reportId) =>
        DecideAsync(me => _discussions.DismissReportAsync(reportId, me), "dismissed");
}
