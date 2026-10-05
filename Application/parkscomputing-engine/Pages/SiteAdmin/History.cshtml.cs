using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using ParksComputing.Engine.Identity;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Pages.SiteAdmin;

/// <summary>
/// /admin/pages/history?file=…: the versions a file's saves have kept,
/// newest first, each to look at (&amp;v=…) and to put back. Putting one back
/// keeps the current text first, so it can be undone in turn.
/// </summary>
public sealed class HistoryModel : SiteAdminModel {
    public HistoryModel(SiteEditor editor, StaffAccess staff, IOptions<AccountOptions> accounts, IOptions<SiteOptions> site)
        : base(editor, staff, accounts, site) { }

    public EditableFile? FileInfo { get; private set; }
    [BindProperty(SupportsGet = true, Name = "file")] public string? FilePath { get; set; }
    [BindProperty(SupportsGet = true, Name = "v")] public string? VersionId { get; set; }
    public IReadOnlyList<(string Id, DateTime Time, long Size)> Versions { get; private set; } = Array.Empty<(string, DateTime, long)>();
    public string? Shown { get; private set; }
    public DateTime? ShownTime { get; private set; }
    public string? Message { get; private set; }

    private async Task<IActionResult?> LoadAsync() {
        if (await GateAsync() is { } away) { return away; }
        FileInfo = Editor.Find(FilePath, Superuser);
        if (FileInfo is null) { return NotFound(); }
        ViewData["Crumb"] = FileInfo.Title + ": history";
        Versions = Editor.Versions(FileInfo);
        return null;
    }

    public async Task<IActionResult> OnGetAsync() {
        if (await LoadAsync() is { } away) { return away; }
        if (VersionId is not null) {
            Shown = Editor.ReadVersion(FileInfo!, VersionId);
            if (Shown is null) { return NotFound(); }
            foreach (var v in Versions) { if (v.Id == VersionId) { ShownTime = v.Time; } }
        }
        if (Request.Query.ContainsKey("restored")) {
            Message = "That version is back on the site. The text it replaced is now the newest in this list, should you want it again.";
        }
        return Page();
    }

    public async Task<IActionResult> OnPostRestoreAsync() {
        if (await LoadAsync() is { } away) { return away; }
        if (!Confirmed || VersionId is null) { Message = "Confirm with your passkey first (above), then restore."; return Page(); }
        if (!await Editor.RestoreAsync(FileInfo!, VersionId, Who, ClientIp)) { return NotFound(); }
        return Redirect("/admin/pages/history?file=" + Uri.EscapeDataString(FileInfo!.Path) + "&restored=1");
    }
}
