using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;

using HtmlAgilityPack;

using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;

using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Controllers;

/// <summary>
/// The terminal applet's view of the site (Architecture/terminal-design.md).
/// Both endpoints are read-only and derive everything from sitenav: the
/// tree is the public structure, and text is served only for a slug the
/// tree lists as a page, so no request can name a path on disk.
/// </summary>
[ApiController]
[Route("api/site")]
public class TerminalController : ControllerBase {
    private static readonly Regex SlugPattern = new(@"^[a-z0-9-]+$", RegexOptions.Compiled);

    private readonly INavService _navService;
    private readonly IWebHostEnvironment _environment;

    public TerminalController(INavService navService, IWebHostEnvironment environment) {
        _navService = navService;
        _environment = environment;
    }

    /// <summary>One entry in the terminal's filesystem.</summary>
    public record Entry(
        string Name, string Kind, string? Title, string? Description,
        string[]? Tags, DateTime? Date, string? Url, List<Entry>? Children);

    [HttpGet("tree")]
    public ActionResult<Entry> Tree() {
        Response.Headers.CacheControl = "public, max-age=60";
        return MarkApplets(BuildTree(_navService.GetRoot()));
    }

    /// <summary>A page that is an applet on its own (its HTML carries
    /// &lt;meta name="applet-page"&gt;) is an "app" in the tree.</summary>
    private Entry MarkApplets(Entry e) {
        if (e.Children is not null) {
            return e with { Children = e.Children.Select(MarkApplets).ToList() };
        }
        if (e.Kind != "page") { return e; }
        var htmlPath = Path.Combine(_environment.WebRootPath, "content", e.Name + ".html");
        try {
            if (System.IO.File.Exists(htmlPath)
                && System.IO.File.ReadAllText(htmlPath).Contains("name=\"applet-page\"", StringComparison.OrdinalIgnoreCase)) {
                return e with { Kind = "app" };
            }
        }
        catch (IOException) { }
        return e;
    }

    [HttpGet("text/{slug}")]
    public IActionResult Text(string slug) {
        var listed = ListedPages();
        var text = listed.Contains(slug ?? string.Empty) ? ReadText(slug!) : null;
        if (text is null) { return NotFound(); }
        Response.Headers.CacheControl = "public, max-age=60";
        return Content(text, "text/plain; charset=utf-8");
    }

    /// <summary>Several pages' text in one request, as an object of slug to
    /// text, so a recursive grep costs one request rather than one per
    /// page. Slugs the tree does not list are left out.</summary>
    [HttpGet("texts")]
    public ActionResult<Dictionary<string, string>> Texts([FromQuery] string? slugs) {
        var listed = ListedPages();
        var result = new Dictionary<string, string>();
        foreach (var slug in (slugs ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries).Distinct().Take(500)) {
            if (!listed.Contains(slug)) { continue; }
            var text = ReadText(slug);
            if (text is not null) { result[slug] = text; }
        }
        Response.Headers.CacheControl = "public, max-age=60";
        return result;
    }

    private HashSet<string> ListedPages() =>
        Flatten(BuildTree(_navService.GetRoot()))
            .Where(e => e.Kind == "page" && SlugPattern.IsMatch(e.Name))
            .Select(e => e.Name)
            .ToHashSet(StringComparer.Ordinal);

    /// <summary>A listed page's text, or null when it has no content file.
    /// Callers pass only slugs from the tree.</summary>
    private string? ReadText(string slug) {
        var baseDir = Path.Combine(_environment.WebRootPath, "content");
        var mdPath = Path.Combine(baseDir, slug + ".md");
        var htmlPath = Path.Combine(baseDir, slug + ".html");
        if (System.IO.File.Exists(mdPath)) {
            return StripFrontMatter(System.IO.File.ReadAllText(mdPath));
        }
        if (System.IO.File.Exists(htmlPath)) {
            var doc = new HtmlDocument();
            doc.Load(htmlPath);
            return HtmlToText(doc.DocumentNode.SelectSingleNode("//body") ?? doc.DocumentNode, slug);
        }
        return null;
    }

    /* === The tree ======================================================= */

    private static Entry BuildTree(NavNode root) {
        var children = new List<Entry>();

        var posts = (root.Posts ?? Array.Empty<NavNode>())
            .Where(p => !string.IsNullOrEmpty(p.Slug))
            .OrderByDescending(p => NavService.EffectiveDate(p) ?? DateTime.MinValue)
            .Select(ToEntry)
            .ToList();
        if (posts.Count > 0) {
            children.Add(new Entry("articles", "dir", "Articles", "Every article, newest first", null, null, null, posts));
        }

        foreach (var node in root.Nav ?? Array.Empty<NavNode>()) {
            if (string.IsNullOrEmpty(node.Slug)) { continue; }
            if (node.Nav is { Length: > 0 }) {
                var items = node.Nav.Where(n => !string.IsNullOrEmpty(n.Slug)).Select(ToEntry).ToList();
                children.Add(new Entry(node.Slug!, "dir", node.Title, node.Description, null, null, null, items));
            }
            else {
                children.Add(ToEntry(node));
            }
        }
        return new Entry("", "dir", root.Title, root.Description, null, null, null, children);
    }

    private static Entry ToEntry(NavNode n) {
        bool external = n.External || (n.Url?.StartsWith("http", StringComparison.OrdinalIgnoreCase) ?? false);
        return new Entry(
            n.Slug!, external ? "link" : "page", n.Title ?? n.Slug, n.Description ?? n.Excerpt,
            n.Tags is { Length: > 0 } ? n.Tags : null, NavService.EffectiveDate(n),
            external ? n.Url : null, null);
    }

    private static IEnumerable<Entry> Flatten(Entry e) {
        yield return e;
        foreach (var c in e.Children ?? new List<Entry>()) {
            foreach (var d in Flatten(c)) { yield return d; }
        }
    }

    /* === Text ============================================================ */

    private static string StripFrontMatter(string raw) {
        if (raw.StartsWith("---")) {
            int end = raw.IndexOf("\n---", 3, StringComparison.Ordinal);
            if (end > -1) {
                int after = raw.IndexOf('\n', end + 4);
                return after > -1 ? raw.Substring(after + 1).TrimStart('\r', '\n') : string.Empty;
            }
        }
        return raw;
    }

    private static readonly HashSet<string> Blocks = new(StringComparer.OrdinalIgnoreCase) {
        "p", "div", "section", "article", "header", "footer", "blockquote", "figure", "figcaption",
        "ul", "ol", "table", "tr", "nav", "details", "summary", "dl", "dt", "dd"
    };

    /// <summary>Renders an HTML article as readable plain text: headings get
    /// Markdown-style markers, list items bullets, links their targets, and
    /// preformatted text is kept verbatim. Scripts and styles vanish, and an
    /// applet placeholder becomes a note.</summary>
    private static string HtmlToText(HtmlNode body, string slug) {
        var sb = new StringBuilder();
        Walk(body, sb, false, slug);
        var text = WebUtility.HtmlDecode(sb.ToString());
        text = Regex.Replace(text, "[ \t]+\n", "\n");
        text = Regex.Replace(text, "\n{3,}", "\n\n");
        return text.Trim() + "\n";
    }

    private static void Walk(HtmlNode node, StringBuilder sb, bool pre, string slug) {
        foreach (var child in node.ChildNodes) {
            switch (child.NodeType) {
                case HtmlNodeType.Comment:
                    continue;
                case HtmlNodeType.Text:
                    var t = child.InnerText;
                    if (!pre) {
                        t = Regex.Replace(t, @"\s+", " ");
                        // No line starts with the space a source line break left.
                        if (sb.Length == 0 || sb[^1] == '\n') { t = t.TrimStart(); }
                    }
                    sb.Append(t);
                    continue;
            }
            var name = child.Name.ToLowerInvariant();
            if (name is "script" or "style" or "noscript" or "template") { continue; }
            if (child.GetAttributeValue("data-applet", null) is string applet) {
                sb.Append($"\n\n[The {applet} applet runs here. Type \"open {slug}\" to use it.]\n\n");
                continue;
            }
            switch (name) {
                case "br":
                    sb.Append('\n');
                    break;
                case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
                    sb.Append("\n\n").Append(new string('#', name[1] - '0')).Append(' ');
                    Walk(child, sb, false, slug);
                    sb.Append("\n\n");
                    break;
                case "pre":
                    sb.Append("\n\n");
                    Walk(child, sb, true, slug);
                    sb.Append("\n\n");
                    break;
                case "li":
                    sb.Append("\n- ");
                    Walk(child, sb, pre, slug);
                    break;
                case "a":
                    var href = child.GetAttributeValue("href", string.Empty);
                    int start = sb.Length;
                    Walk(child, sb, pre, slug);
                    var label = sb.ToString(start, sb.Length - start).Trim();
                    if (!string.IsNullOrEmpty(href) && !href.StartsWith("#") && label != href) {
                        sb.Append(" <").Append(href).Append('>');
                    }
                    break;
                case "img":
                    var alt = child.GetAttributeValue("alt", string.Empty);
                    if (!string.IsNullOrWhiteSpace(alt)) { sb.Append("[image: ").Append(alt).Append(']'); }
                    break;
                case "td": case "th":
                    Walk(child, sb, pre, slug);
                    sb.Append("  ");
                    break;
                default:
                    bool block = Blocks.Contains(name);
                    if (block) { sb.Append("\n\n"); }
                    Walk(child, sb, pre, slug);
                    if (block) { sb.Append("\n\n"); }
                    break;
            }
        }
    }
}
