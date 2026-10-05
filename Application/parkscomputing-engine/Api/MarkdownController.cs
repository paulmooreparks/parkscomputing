using Microsoft.AspNetCore.Mvc;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Api;

/// <summary>
/// The site for AI readers (Pages/Services/MarkdownPages.cs): /llms.txt, and
/// each page's Markdown at its address with .md added, /index.md for the
/// home page. A file of the same name in wwwroot is served instead, so a
/// site can write its own llms.txt.
/// </summary>
[ApiExplorerSettings(IgnoreApi = true)]
public sealed class MarkdownController : Controller {
    private readonly MarkdownPages _pages;
    public MarkdownController(MarkdownPages pages) { _pages = pages; }

    private string Origin => $"{Request.Scheme}://{Request.Host}";

    [HttpGet("/llms.txt")]
    public IActionResult Llms() => Content(_pages.LlmsTxt(Origin), "text/plain; charset=utf-8");

    [HttpGet("/index.md")]
    public IActionResult Home() => Page("index");

    [HttpGet("/{slug:regex(^[[A-Za-z0-9_-]]+$)}.md")]
    public IActionResult Top(string slug) => Page(slug);

    [HttpGet("/page/{slug:regex(^[[A-Za-z0-9_-]]+$)}.md")]
    public IActionResult Prefixed(string slug) => Page(slug);

    private IActionResult Page(string slug) {
        var page = _pages.Load(slug);
        if (page is null) { return NotFound(); }
        // The page's own address is the one search engines should keep.
        Response.Headers["Link"] = $"<{Origin}{_pages.PageUrlOf(slug)}>; rel=\"canonical\"";
        Response.Headers["X-Robots-Tag"] = "noindex";
        return Content(_pages.Render(page, Origin), "text/markdown; charset=utf-8");
    }
}
