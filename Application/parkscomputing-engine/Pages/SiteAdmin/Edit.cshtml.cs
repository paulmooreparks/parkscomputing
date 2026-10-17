using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using ParksComputing.Engine.Identity;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Pages.SiteAdmin;

/// <summary>
/// /admin/pages/edit?file=…: one file's text in a plain text box, with
/// Preview, which shows a page as readers will see it without saving it,
/// and Save. The form works without script. A save names the version it
/// started from, and is refused, keeping the text, if the file has changed
/// since (Pages/Services/SiteEditor.cs).
/// </summary>
public sealed class EditModel : SiteAdminModel {
    private readonly PreviewDrafts _drafts;

    public EditModel(SiteEditor editor, StaffAccess staff, IOptions<AccountOptions> accounts, IOptions<SiteOptions> site, PreviewDrafts drafts)
        : base(editor, staff, accounts, site) { _drafts = drafts; }

    public EditableFile? FileInfo { get; private set; }
    [BindProperty(SupportsGet = true, Name = "file")] public string? FilePath { get; set; }
    [BindProperty] public string Text { get; set; } = "";
    [BindProperty] public string Version { get; set; } = "";
    /// <summary>Where the unsaved text shows as its page: /preview/{token},
    /// which the readers' own page code renders (Identity/PreviewDrafts.cs),
    /// so the preview cannot differ from what they will see.</summary>
    public string? PreviewUrl { get; private set; }
    public string? Message { get; private set; }
    public bool Conflict { get; private set; }

    /// <summary>Whether the file is a page, which Preview can show; the
    /// site's own files are not.</summary>
    public bool IsPage => FileInfo is { SuperOnly: false };

    private async Task<IActionResult?> LoadAsync() {
        if (await GateAsync() is { } away) { return away; }
        FileInfo = Editor.Find(FilePath, Superuser);
        if (FileInfo is null) { return NotFound(); }
        ViewData["Crumb"] = FileInfo.Title;
        return null;
    }

    public async Task<IActionResult> OnGetAsync() {
        if (await LoadAsync() is { } away) { return away; }
        var current = Editor.Read(FileInfo!);
        Text = current.Text; Version = current.Version;
        // The address says what just happened (?saved=1), rather than a
        // cookie, which a site that asks no consent does not set.
        if (Request.Query.ContainsKey("saved")) { Message = "Saved. The page shows the change now."; }
        return Page();
    }

    public async Task<IActionResult> OnPostPreviewAsync() {
        if (await LoadAsync() is { } away) { return away; }
        if (IsPage) {
            var token = _drafts.Keep(FileInfo!.Path, Text);
            if (token is null) { Message = "This page can't be previewed; save it to see it."; }
            else { PreviewUrl = "/preview/" + token; }
        }
        return Page();
    }

    public async Task<IActionResult> OnPostSaveAsync() {
        if (await LoadAsync() is { } away) { return away; }
        if (!Confirmed) { Message = "Confirm with your passkey first (above); your text is still here."; return Page(); }
        var (saved, version) = await Editor.SaveAsync(FileInfo!, Text, Version, Who, ClientIp);
        if (!saved) {
            Conflict = true;
            Message = "Someone saved this file after you opened it, so your text was not saved. It is still in the box below: copy it, open the latest version, and put your change into that.";
            return Page();
        }
        return Redirect("/admin/pages/edit?file=" + System.Uri.EscapeDataString(FileInfo!.Path) + "&saved=1");
    }
}
