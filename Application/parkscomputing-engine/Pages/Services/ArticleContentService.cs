using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

using HtmlAgilityPack;
using Markdig;
using Microsoft.AspNetCore.Hosting;

namespace ParksComputing.Engine.Pages.Services;

/// <summary>RequiresOwnDocument marks content that brings its own scripts
/// or stylesheets (an interactive app, or a page with bespoke CSS): its
/// window hosts the article's page in a frame instead of inlining the body,
/// because scripts in fetched window markup do not run and head assets
/// never arrive. FrameUrl marks an external destination whose window is a
/// frame straight onto that URL.</summary>
public record ArticleWindowContent(string Slug, string Title, string BodyHtml, bool HasCode, bool HasMermaid, bool RequiresOwnDocument = false, string? FrameUrl = null, bool IsApplet = false, string? WindowSize = null);

/// <summary>
/// Loads an article's title and body for rendering inside a PUDL window.
/// This is a slimmer read path than PageLoaderModel (no comments, no
/// audio/video metadata, no meta-tag extraction), because a window shows
/// the article body alone; the full page remains the canonical rendering.
/// Images in a window body are left as they are: the lightbox dialog shows
/// them in both views.
/// </summary>
public class ArticleContentService {
    private static readonly Regex SlugPattern = new(@"^[A-Za-z0-9_-]+$", RegexOptions.Compiled);

    private readonly IWebHostEnvironment _environment;
    private readonly BookService _books;

    public ArticleContentService(IWebHostEnvironment environment, BookService books) {
        _environment = environment;
        _books = books;
    }

    /// <summary>
    /// A book's window (Architecture/books-design.md): the key is the book's
    /// slug, or a numbered copy of it ("maize-2"), and the chapter is the
    /// window's own, from the address's c.{key}, or the main page when it
    /// names no chapter of the book. The chapter is prepared as any window
    /// body is, then set inside the book's contents and pager. Null when the
    /// key names no book.
    /// </summary>
    public ArticleWindowContent? LoadBook(string? key, string? chapter) {
        var baseSlug = BookOf(key);
        var book = baseSlug is null ? null : _books.Load(baseSlug);
        if (book is null) { return null; }
        var path = chapter is not null && book.Find(chapter) is { HasPage: true } ? book.Find(chapter)!.Path : string.Empty;
        var file = _books.FileOf(book, path);
        if (file is null) { return null; }
        var page = LoadMarkdown(file, key!);
        var body = BookService.Render(book, path, PrepareWindowBody(key!, page.BodyHtml), key!);
        var n = key == baseSlug ? null : key!.Substring(baseSlug!.Length + 1);
        return page with { Title = book.Root.Title + (n is null ? string.Empty : " " + n), BodyHtml = body };
    }

    /// <summary>The book a window key shows, the key itself or the book a
    /// numbered copy ("maize-2") is of; null when it shows no book.</summary>
    public string? BookOf(string? key) {
        if (!SlugPattern.IsMatch(key ?? string.Empty)) { return null; }
        if (_books.Load(key!) is not null) { return key; }
        return InstanceBase(key) is { } b && _books.Load(b) is not null ? b : null;
    }

    /// <summary>An article prepared for a window: internal links become
    /// window openers.</summary>
    public ArticleWindowContent? Load(string? slug) {
        var raw = LoadRaw(slug);
        if (raw is null) { return null; }
        return raw with { BodyHtml = PrepareWindowBody(raw.Slug, raw.BodyHtml) };
    }

    private static readonly Regex InstanceKeyPattern = new(@"^(?<slug>[A-Za-z0-9_-]+)-(?<n>[2-9])$", RegexOptions.Compiled);

    /// <summary>The applet page a numbered instance key ("terminal-2")
    /// names, or null when the key is not shaped like one.</summary>
    public static string? InstanceBase(string? key) {
        var m = InstanceKeyPattern.Match(key ?? string.Empty);
        return m.Success ? m.Groups["slug"].Value : null;
    }

    /// <summary>
    /// A numbered instance of an applet ("terminal-2"): the applet's page
    /// again under the instance's key, titled with its number, for the
    /// windows PUDL's requests open beside the first. Any applet page may be
    /// numbered from 2 to 9; which applets the site actually opens more of
    /// is the handler declarations' business. Null when the key is not an
    /// instance key or its base is not an applet page. A page whose own slug
    /// ends in a number is found by Load first and never reaches here.
    /// </summary>
    public ArticleWindowContent? LoadInstance(string? key) {
        var m = InstanceKeyPattern.Match(key ?? string.Empty);
        if (!m.Success) { return null; }
        var applet = Load(m.Groups["slug"].Value);
        if (applet is null || !applet.IsApplet) { return null; }
        return applet with { Slug = key!, Title = $"{applet.Title} {m.Groups["n"].Value}" };
    }

    private static readonly Regex ExternalKeyPattern = new(@"^ext-(?<slug>[a-z0-9-]+)$", RegexOptions.Compiled);

    /// <summary>The window key for a framed external destination.</summary>
    public static string ExternalKey(NavNode node) => "ext-" + TagSlug(node.Slug ?? string.Empty);

    /// <summary>
    /// A framed external destination's window ("ext-{slug}" keys): a frame
    /// straight onto the URL of a sitenav node marked frame ~true. Null
    /// when the key is not an ext key or nothing frameable matches.
    /// </summary>
    public ArticleWindowContent? LoadExternal(string? key, NavNode root) {
        var m = ExternalKeyPattern.Match(key ?? string.Empty);
        if (!m.Success) { return null; }
        var slug = m.Groups["slug"].Value;

        foreach (var node in NavLeaves(root)) {
            if (node.External && node.Frame && !string.IsNullOrEmpty(node.Url)
                && TagSlug(node.Slug ?? string.Empty) == slug) {
                return new ArticleWindowContent(key!, node.Title ?? node.Slug!, string.Empty,
                    HasCode: false, HasMermaid: false, FrameUrl: node.Url);
            }
        }
        return null;
    }

    private static readonly Regex TagKeyPattern = new(@"^tag-(?<slug>[a-z0-9-]+)$", RegexOptions.Compiled);

    /// <summary>A tag's window-key-safe slug: lower case, runs of anything
    /// but letters and digits collapsed to hyphens.</summary>
    public static string TagSlug(string tag) =>
        Regex.Replace(tag.ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-');

    /// <summary>The window key that opens a tag's article list.</summary>
    public static string TagKey(string tag) => "tag-" + TagSlug(tag);

    /// <summary>The entries under a tag, given its slug, in the order
    /// sitenav.xfer gives them, each once, with the tag as it is spelled on
    /// that entry. Empty when nothing carries the tag. The tag window, the
    /// tag page and the tag menu in a window all list from here.</summary>
    public static List<(NavNode Node, string Tag)> TaggedWith(NavNode root, string slug) =>
        TaggableNodes(root)
            .Select(n => (Node: n, Tag: n.Tags!.FirstOrDefault(t => TagSlug(t) == slug)))
            .Where(x => x.Tag is not null)
            .GroupBy(x => x.Node.Slug, StringComparer.OrdinalIgnoreCase)
            .Select(g => (g.First().Node, g.First().Tag!))
            .ToList();

    /// <summary>The classic page listing a tag's articles.</summary>
    public static string TagPageUrl(string tag) => "/tag/" + TagSlug(tag);

    public ArticleWindowContent? LoadTagList(string? key, NavNode root) {
        var m = TagKeyPattern.Match(key ?? string.Empty);
        if (!m.Success) { return null; }
        var slug = m.Groups["slug"].Value;

        var tagged = TaggedWith(root, slug);
        if (tagged.Count == 0) { return null; }

        var tagName = tagged[0].Tag!;
        var rows = string.Join(string.Empty, tagged.Select(x => {
            var nodeSlug = System.Net.WebUtility.HtmlEncode(x.Node.Slug!);
            var title = System.Net.WebUtility.HtmlEncode(x.Node.Title ?? x.Node.Slug!);
            var date = NavService.EffectiveDate(x.Node)?.ToString("d MMMM yyyy");
            var meta = date is null ? string.Empty : $"<span class=\"md-meta\">{date}</span>";
            return $"<div class=\"md-row\"><a class=\"md-item\" href=\"/page/{nodeSlug}\" data-win-open=\"{nodeSlug}\">{title}{meta}</a></div>";
        }));

        string encodedTag = System.Net.WebUtility.HtmlEncode(tagName);
        string body =
            $"<div class=\"tag-window\"><p class=\"card-desc\">Everything tagged <span class=\"chip\">{encodedTag}</span></p>{rows}</div>";

        return new ArticleWindowContent(key!, $"Tag: {tagName}", body, HasCode: false, HasMermaid: false);
    }

    /// <summary>Every tag in use, in alphabetical order, for the tag
    /// filter's checklist.</summary>
    public static List<string> AllTags(NavNode root) =>
        TaggableNodes(root)
            .SelectMany(n => n.Tags!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(t => t, StringComparer.OrdinalIgnoreCase)
            .ToList();

    private static IEnumerable<NavNode> TaggableNodes(NavNode root) {
        foreach (var node in NavLeaves(root)) {
            if (node.Tags is { Length: > 0 } && !string.IsNullOrEmpty(node.Slug) && !node.External) { yield return node; }
        }
    }

    /// <summary>Every sitenav entry that is a destination rather than a
    /// section, at any depth: a top-level leaf such as About as well as the
    /// entries inside sections. A node's Nav is an empty array, never null,
    /// when it has no children, so emptiness is the test.</summary>
    private static IEnumerable<NavNode> NavLeaves(NavNode node) {
        foreach (var child in node.Nav ?? Array.Empty<NavNode>()) {
            if (child.Nav is { Length: > 0 }) {
                foreach (var leaf in NavLeaves(child)) { yield return leaf; }
            }
            else {
                yield return child;
            }
        }
    }

    /// <summary>Renders a Markdown fragment from the content directory
    /// (chrome copy such as the desktop's welcome card), or null when the
    /// file is absent. The fragment sits on the desktop, so its links to
    /// articles open windows, as links inside an article's window do.</summary>
    public string? RenderFragment(string name) {
        if (!SlugPattern.IsMatch(name)) { return null; }
        var path = Path.Combine(_environment.WebRootPath, "content", name + ".md");
        if (!File.Exists(path)) { return null; }
        var doc = new HtmlDocument();
        doc.LoadHtml(Markdown.ToHtml(File.ReadAllText(path), new MarkdownPipelineBuilder().UseAutoLinks().Build()));
        WrapInternalLinks(doc);
        return doc.DocumentNode.InnerHtml;
    }

    private ArticleWindowContent? LoadRaw(string? slug) {
        if (string.IsNullOrWhiteSpace(slug) || !SlugPattern.IsMatch(slug)) { return null; }

        var baseDir = Path.Combine(_environment.WebRootPath, "content");

        var mdPath = Path.Combine(baseDir, slug + ".md");
        if (File.Exists(mdPath)) { return LoadMarkdown(mdPath, slug); }

        var htmlPath = Path.Combine(baseDir, slug + ".html");
        if (File.Exists(htmlPath)) { return LoadHtml(htmlPath, slug); }

        return null;
    }

    private string PrepareWindowBody(string slug, string bodyHtml) {
        var doc = new HtmlDocument();
        doc.LoadHtml(bodyHtml);
        WrapInternalLinks(doc);
        return doc.DocumentNode.InnerHtml;
    }

    /// <summary>
    /// Marks each content link that resolves to a known article as a window
    /// opener, so following it inside a window opens a window (inheriting
    /// the opener's state) instead of navigating the desktop away. The href
    /// is untouched, so classic pages and no-script browsers see no change.
    /// </summary>
    private void WrapInternalLinks(HtmlDocument doc) {
        var anchors = doc.DocumentNode.SelectNodes("//a[@href]");
        if (anchors is null) { return; }
        foreach (var anchor in anchors) {
            if (anchor.GetAttributeValue("data-win-open", null) is not null) { continue; }
            if (anchor.GetAttributeValue("data-win-replace", null) is not null) { continue; }
            if (anchor.GetAttributeValue("data-book-chapter", null) is not null) { continue; }
            // A link to a book's chapter (/page/{book}/{path}) turns a window
            // of that book to it, or opens one there (js/books.js).
            var chapterLink = BookChapterLink.Match(anchor.GetAttributeValue("href", string.Empty));
            if (chapterLink.Success && BookService.IsSafePath(chapterLink.Groups["path"].Value)
                && _books.Load(chapterLink.Groups["book"].Value) is { } linked && linked.Find(chapterLink.Groups["path"].Value) is { HasPage: true }) {
                anchor.SetAttributeValue("data-book-of", linked.Slug);
                anchor.SetAttributeValue("data-book-chapter", chapterLink.Groups["path"].Value);
                continue;
            }
            var slug = InternalSlugOf(anchor.GetAttributeValue("href", string.Empty));
            if (slug is null || !ContentExists(slug)) { continue; }
            anchor.SetAttributeValue("data-win-open", slug);
        }
    }

    private static readonly Regex BookChapterLink = new(@"^(?:https?://(?:www\.)?parkscomputing\.com)?/page/(?<book>[A-Za-z0-9_-]+)/(?<path>[A-Za-z0-9_/-]+?)/?(?:#.*)?$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>The article slug an href resolves to, or null when the href
    /// leaves the site or names nothing slug-shaped. A path of more than
    /// one name under /page/ is a book's chapter, which is not a window of
    /// its own.</summary>
    private static string? InternalSlugOf(string href) {
        if (string.IsNullOrWhiteSpace(href) || href.StartsWith("#")) { return null; }
        string path;
        // A rooted path parses as an absolute file: URI on .NET, so only an
        // explicit http(s) prefix takes the absolute branch.
        if (href.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            || href.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) {
            if (!Uri.TryCreate(href, UriKind.Absolute, out var abs)) { return null; }
            var host = abs.Host.ToLowerInvariant();
            if (host != "parkscomputing.com" && host != "www.parkscomputing.com") { return null; }
            path = abs.AbsolutePath;
        } else {
            if (href.Contains(':')) { return null; }   // mailto:, tel:, and kin
            path = href.Split('#')[0].Split('?')[0];
        }
        var segments = path.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 0) { return null; }
        if (segments.Length > 2 && segments[0].Equals("page", StringComparison.OrdinalIgnoreCase)) { return null; }
        var candidate = segments[^1];
        return SlugPattern.IsMatch(candidate) ? candidate : null;
    }

    private bool ContentExists(string slug) {
        var baseDir = Path.Combine(_environment.WebRootPath, "content");
        return File.Exists(Path.Combine(baseDir, slug + ".md"))
            || File.Exists(Path.Combine(baseDir, slug + ".html"));
    }

    private static ArticleWindowContent LoadMarkdown(string path, string slug) {
        string raw = File.ReadAllText(path);
        string body = raw;
        string? title = null;
        string menu = string.Empty;

        if (raw.StartsWith("---")) {
            int second = raw.IndexOf("\n---", 3, StringComparison.Ordinal);
            if (second > -1) {
                var fm = raw.Substring(3, second - 3);
                body = raw.Substring(second + 4).TrimStart('\r', '\n');
                menu = PageMenu.Render(fm);
                using var reader = new StringReader(fm);
                string? line;
                while ((line = reader.ReadLine()) is not null) {
                    // An indented line belongs to a nested value, such as the
                    // titles of the article's menu, not to a key here.
                    if (line.Length > 0 && char.IsWhiteSpace(line[0])) { continue; }
                    int colon = line.IndexOf(':');
                    if (colon > 0 && line.Substring(0, colon).Trim().Equals("title", StringComparison.OrdinalIgnoreCase)) {
                        title = line.Substring(colon + 1).Trim().Trim('"');
                    }
                }
            }
        }

        var pipeline = new MarkdownPipelineBuilder()
            .UsePipeTables()
            .UseTaskLists()
            .UseAutoLinks()
            .UseEmphasisExtras()
            .UseSmartyPants()
            .UseMediaLinks()
            // Headings get ids, as on the page, so a link to #section lands there.
            .UseAutoIdentifiers(Markdig.Extensions.AutoIdentifiers.AutoIdentifierOptions.GitHub)
            .UseGenericAttributes()
            .Build();
        string html = menu + Markdown.ToHtml(body, pipeline);

        if (string.IsNullOrWhiteSpace(title)) {
            var temp = new HtmlDocument();
            temp.LoadHtml(html);
            title = temp.DocumentNode.SelectSingleNode("//h1")?.InnerText.Trim();
        }

        return Build(slug, System.Net.WebUtility.HtmlDecode(title), html);
    }

    private static ArticleWindowContent LoadHtml(string path, string slug) {
        var doc = new HtmlDocument();
        doc.Load(path);
        var title = System.Net.WebUtility.HtmlDecode(doc.DocumentNode.SelectSingleNode("//title")?.InnerText.Trim());
        var body = doc.DocumentNode.SelectSingleNode("//body")?.InnerHtml ?? doc.DocumentNode.InnerHtml;

        // An applet mount (data-applet, PUDL 0.10.0) is inline-safe by
        // contract: pudl-applets.js loads its assets and it runs in a window
        // or as a page equally. Anything else that brings assets needs the
        // frame. Whether the page IS the applet (and so drops the article
        // chrome) is a separate question the page answers itself, with
        // <meta name="applet-page">; an article that merely embeds an
        // applet keeps its tags and dates.
        var mount = doc.DocumentNode.SelectSingleNode("//*[@data-applet]");
        bool hasMount = mount is not null;
        bool appletPage = doc.DocumentNode.SelectSingleNode("//head/meta[@name='applet-page']") is not null;
        bool ownAssets = !hasMount && (
            doc.DocumentNode.SelectSingleNode("//script") is not null
            || doc.DocumentNode.SelectSingleNode("//head/link[@rel='stylesheet']") is not null
            || doc.DocumentNode.SelectSingleNode("//head/style") is not null);

        // Sizing belongs to the applet document, independent of navigation entries.
        var declaredSize = mount?.GetAttributeValue("data-applet-window-size", "");
        var windowSize = appletPage && string.Equals(declaredSize, "content", StringComparison.OrdinalIgnoreCase)
            ? "content" : null;
        return Build(slug, title, body) with { RequiresOwnDocument = ownAssets, IsApplet = appletPage, WindowSize = windowSize };
    }

    private static ArticleWindowContent Build(string slug, string? title, string bodyHtml) {
        bool hasCode = bodyHtml.Contains("<pre><code", StringComparison.OrdinalIgnoreCase);
        bool hasMermaid = bodyHtml.Contains("language-mermaid", StringComparison.OrdinalIgnoreCase);
        return new ArticleWindowContent(slug, string.IsNullOrWhiteSpace(title) ? slug : title!, bodyHtml, hasCode, hasMermaid);
    }
}
