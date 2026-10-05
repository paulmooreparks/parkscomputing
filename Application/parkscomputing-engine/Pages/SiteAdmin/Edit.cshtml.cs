using System.Text.RegularExpressions;
using System.Threading.Tasks;
using HtmlAgilityPack;
using Markdig;
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
    public EditModel(SiteEditor editor, StaffAccess staff, IOptions<AccountOptions> accounts, IOptions<SiteOptions> site)
        : base(editor, staff, accounts, site) { }

    public EditableFile? FileInfo { get; private set; }
    [BindProperty(SupportsGet = true, Name = "file")] public string? FilePath { get; set; }
    [BindProperty] public string Text { get; set; } = "";
    [BindProperty] public string Version { get; set; } = "";
    public string? PreviewHtml { get; private set; }
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
        if (IsPage) { PreviewHtml = Render(FileInfo!.Path, Text); }
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

    /// <summary>A page's body as readers see it: an HTML file's body, or a
    /// Markdown file rendered after its front matter.</summary>
    private static string Render(string path, string text) {
        if (path.EndsWith(".md")) {
            var body = text.StartsWith("---") && text.IndexOf("\n---", 3) is var end and > -1 ? text[(end + 4)..] : text;
            return Markdown.ToHtml(body, new MarkdownPipelineBuilder().UseAdvancedExtensions().Build());
        }
        var doc = new HtmlDocument();
        doc.LoadHtml(text);
        var html = (doc.DocumentNode.SelectSingleNode("//body") ?? doc.DocumentNode).InnerHtml;
        // A preview runs nothing.
        return Regex.Replace(html, @"<script\b[\s\S]*?</script>", "", RegexOptions.IgnoreCase);
    }
}
