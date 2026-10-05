using Microsoft.AspNetCore.Mvc;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Api;

/// <summary>
/// The site for machines (Pages/Services/MarkdownPages.cs): /llms.txt and
/// each page's Markdown at its address with .md added (/index.md for the
/// home page) for AI readers, and /sitemap.xml and /robots.txt for search
/// engines. A file of the same name in wwwroot is served instead, so a site
/// can write its own.
/// </summary>
[ApiExplorerSettings(IgnoreApi = true)]
public sealed class MarkdownController : Controller {
    private readonly MarkdownPages _pages;
    public MarkdownController(MarkdownPages pages) { _pages = pages; }

    private string Origin => _pages.OriginOr($"{Request.Scheme}://{Request.Host}");

    [HttpGet("/llms.txt")]
    public IActionResult Llms() => Content(_pages.LlmsTxt(Origin), "text/plain; charset=utf-8");

    [HttpGet("/sitemap.xml")]
    public IActionResult Sitemap() => Content(_pages.SitemapXml(Origin), "application/xml; charset=utf-8");

    /// <summary>Every crawler may read everything, and is told where the
    /// sitemap is. The site's private places answer no one who is not
    /// signed in, so there is nothing to hide from crawlers here.</summary>
    [HttpGet("/robots.txt")]
    public IActionResult Robots() =>
        Content($"User-agent: *\nAllow: /\n\nSitemap: {Origin}/sitemap.xml\n", "text/plain; charset=utf-8");

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
