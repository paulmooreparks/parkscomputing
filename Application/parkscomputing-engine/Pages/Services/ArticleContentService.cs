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
public record ArticleWindowContent(string Slug, string Title, string BodyHtml, bool HasCode, bool HasMermaid, bool RequiresOwnDocument = false, string? FrameUrl = null, bool IsApplet = false);

public record ArticleImage(string Src, string? Caption);

/// <summary>
/// Loads an article's title and body for rendering inside a PUDL window.
/// This is a slimmer read path than PageLoaderModel (no comments, no
/// audio/video metadata, no meta-tag extraction), because a window shows
/// the article body alone; the full page remains the canonical rendering.
///
/// Images inside a window body are wrapped as child-window openers
/// (PUDL 0.7.0 child windows): key "{slug}-img-{n}", 1-based, in document
/// order. LoadChild serves those keys.
/// </summary>
public class ArticleContentService {
    private static readonly Regex SlugPattern = new(@"^[A-Za-z0-9_-]+$", RegexOptions.Compiled);
    private static readonly Regex ChildImagePattern = new(@"^(?<slug>[A-Za-z0-9_-]+?)-img-(?<n>[1-9][0-9]*)$", RegexOptions.Compiled);

    private readonly IWebHostEnvironment _environment;

    public ArticleContentService(IWebHostEnvironment environment) {
        _environment = environment;
    }

    /// <summary>An article prepared for a window: images wrapped as
    /// child-window openers, and internal links as window openers.</summary>
    public ArticleWindowContent? Load(string? slug) {
        var raw = LoadRaw(slug);
        if (raw is null) { return null; }
        return raw with { BodyHtml = PrepareWindowBody(raw.Slug, raw.BodyHtml) };
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

        foreach (var section in root.Nav ?? Array.Empty<NavNode>()) {
            foreach (var node in section.Nav ?? new[] { section }) {
                if (node.External && node.Frame && !string.IsNullOrEmpty(node.Url)
                    && TagSlug(node.Slug ?? string.Empty) == slug) {
                    return new ArticleWindowContent(key!, node.Title ?? node.Slug!, string.Empty,
                        HasCode: false, HasMermaid: false, FrameUrl: node.Url);
                }
            }
        }
        return null;
    }

    public bool TryParseChildKey(string? key, out string parentSlug, out int imageIndex) {
        parentSlug = string.Empty;
        imageIndex = 0;
        var m = ChildImagePattern.Match(key ?? string.Empty);
        if (!m.Success) { return false; }
        parentSlug = m.Groups["slug"].Value;
        imageIndex = int.Parse(m.Groups["n"].Value);
        return true;
    }

    /// <summary>
    /// A child window's content: one of the parent article's images. The key
    /// is "{parent}-img-{n}". Null when the key does not parse, the parent
    /// does not exist, or it has no such image.
    /// </summary>
    public ArticleWindowContent? LoadChild(string? key, out string parentSlug) {
        parentSlug = string.Empty;
        if (!TryParseChildKey(key, out parentSlug, out int n)) { return null; }

        var parent = LoadRaw(parentSlug);
        if (parent is null) { return null; }

        var images = ExtractImages(parent.BodyHtml);
        if (n > images.Count) { return null; }
        var image = images[n - 1];

        string title = string.IsNullOrWhiteSpace(image.Caption) ? $"Image {n}: {parent.Title}" : image.Caption!;
        string caption = System.Net.WebUtility.HtmlEncode(image.Caption ?? string.Empty);
        string body =
            $"<figure class=\"win-image\"><img src=\"{System.Net.WebUtility.HtmlEncode(image.Src)}\" alt=\"{caption}\" data-no-lightbox />" +
            (string.IsNullOrEmpty(caption) ? string.Empty : $"<figcaption>{caption}</figcaption>") +
            "</figure>" +
            BuildImageNav(parentSlug, n, images.Count);

        return new ArticleWindowContent(key!, title, body, HasCode: false, HasMermaid: false);
    }

    private static readonly Regex TagKeyPattern = new(@"^tag-(?<slug>[a-z0-9-]+)$", RegexOptions.Compiled);

    /// <summary>A tag's window-key-safe slug: lower case, runs of anything
    /// but letters and digits collapsed to hyphens.</summary>
    public static string TagSlug(string tag) =>
        Regex.Replace(tag.ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-');

    /// <summary>The window key that opens a tag's article list.</summary>
    public static string TagKey(string tag) => "tag-" + TagSlug(tag);

    /// <summary>
    /// A tag window's content ("tag-{slug}" keys): the articles categorized
    /// under that tag, newest first, each row opening its article. Null
    /// when the key is not a tag key or no tag matches.
    /// </summary>
    public ArticleWindowContent? LoadTagList(string? key, NavNode root) {
        var m = TagKeyPattern.Match(key ?? string.Empty);
        if (!m.Success) { return null; }
        var slug = m.Groups["slug"].Value;

        var tagged = TaggableNodes(root)
            .Select(n => (Node: n, Tag: n.Tags!.FirstOrDefault(t => TagSlug(t) == slug)))
            .Where(x => x.Tag is not null)
            .GroupBy(x => x.Node.Slug, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .OrderByDescending(x => NavService.EffectiveDate(x.Node) ?? DateTime.MinValue)
            .ToList();
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
        foreach (var post in root.Posts ?? Array.Empty<NavNode>()) {
            if (post.Tags is { Length: > 0 } && !string.IsNullOrEmpty(post.Slug)) { yield return post; }
        }
        foreach (var section in root.Nav ?? Array.Empty<NavNode>()) {
            foreach (var child in section.Nav ?? new[] { section }) {
                if (child.Tags is { Length: > 0 } && !string.IsNullOrEmpty(child.Slug) && !child.External) { yield return child; }
            }
        }
    }

    /// <summary>
    /// Prev/next controls between an article's image windows. Each is a
    /// data-win-open link, so the script opens the sibling as a child of the
    /// same article (desktop.js then closes this one); the href is the same
    /// state as a URL for a browser without script. One image gets no nav.
    /// </summary>
    private static string BuildImageNav(string parentSlug, int n, int count) {
        if (count < 2) { return string.Empty; }

        string Link(int target, string dir, string glyph, string label) {
            var key = $"{parentSlug}-img-{target}";
            // data-win-replace swaps the sibling into this window's place
            // (PUDL 0.10.0); the href is the equivalent state without script.
            return $"<a class=\"icon-btn\" data-win-open=\"{key}\" data-win-replace data-img-nav=\"{dir}\" " +
                   $"href=\"?open={parentSlug},{key}&amp;top={key}\" aria-label=\"{label}\">{glyph}</a>";
        }

        return "<nav class=\"win-img-nav\" aria-label=\"Images in this article\">" +
               (n > 1 ? Link(n - 1, "prev", "❮", "Previous image") : "<span class=\"icon-btn is-disabled\" aria-hidden=\"true\">❮</span>") +
               $"<span class=\"num\">{n} of {count}</span>" +
               (n < count ? Link(n + 1, "next", "❯", "Next image") : "<span class=\"icon-btn is-disabled\" aria-hidden=\"true\">❯</span>") +
               "</nav>";
    }

    /// <summary>Renders a Markdown fragment from the content directory
    /// (chrome copy such as the desktop's welcome card), or null when the
    /// file is absent. No window wrapping applies.</summary>
    public string? RenderFragment(string name) {
        if (!SlugPattern.IsMatch(name)) { return null; }
        var path = Path.Combine(_environment.WebRootPath, "content", name + ".md");
        if (!File.Exists(path)) { return null; }
        return Markdown.ToHtml(File.ReadAllText(path), new MarkdownPipelineBuilder().UseAutoLinks().Build());
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

    private static readonly Regex ImageHrefPattern = new(@"\.(jpe?g|png|gif|webp|avif|svg)([?#].*)?$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>An image is a child-window candidate when it is unlinked, or
    /// its link just points at an image file (the WordPress full-size link).</summary>
    private static bool IsChildImageCandidate(HtmlNode img) {
        if (img.GetAttributeValue("data-no-lightbox", null) is not null) { return false; }
        var anchor = img.Ancestors("a").FirstOrDefault();
        if (anchor is null) { return true; }
        return ImageHrefPattern.IsMatch(anchor.GetAttributeValue("href", string.Empty));
    }

    private static string? CaptionOf(HtmlNode img) {
        var figure = img.Ancestors("figure").FirstOrDefault();
        var figcaption = figure?.SelectSingleNode(".//figcaption");
        var caption = figcaption?.InnerText.Trim();
        if (string.IsNullOrWhiteSpace(caption)) { caption = img.GetAttributeValue("alt", string.Empty).Trim(); }
        return string.IsNullOrWhiteSpace(caption) ? null : System.Net.WebUtility.HtmlDecode(caption);
    }

    public static List<ArticleImage> ExtractImages(string bodyHtml) {
        var doc = new HtmlDocument();
        doc.LoadHtml(bodyHtml);
        var images = doc.DocumentNode.SelectNodes("//img") ?? Enumerable.Empty<HtmlNode>() as IEnumerable<HtmlNode>;
        return images
            .Where(IsChildImageCandidate)
            .Select(img => new ArticleImage(img.GetAttributeValue("src", string.Empty), CaptionOf(img)))
            .Where(i => !string.IsNullOrEmpty(i.Src))
            .ToList();
    }

    private string PrepareWindowBody(string slug, string bodyHtml) {
        var doc = new HtmlDocument();
        doc.LoadHtml(bodyHtml);
        WrapImages(slug, doc);
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
            var slug = InternalSlugOf(anchor.GetAttributeValue("href", string.Empty));
            if (slug is null || !ContentExists(slug)) { continue; }
            anchor.SetAttributeValue("data-win-open", slug);
        }
    }

    /// <summary>The article slug an href resolves to, or null when the href
    /// leaves the site or names nothing slug-shaped.</summary>
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
        var candidate = segments[^1];
        return SlugPattern.IsMatch(candidate) ? candidate : null;
    }

    private bool ContentExists(string slug) {
        var baseDir = Path.Combine(_environment.WebRootPath, "content");
        return File.Exists(Path.Combine(baseDir, slug + ".md"))
            || File.Exists(Path.Combine(baseDir, slug + ".html"));
    }

    /// <summary>
    /// Wraps each eligible image in a link that opens it as a child window.
    /// Without script the link opens the image itself.
    /// </summary>
    private static void WrapImages(string slug, HtmlDocument doc) {
        var images = doc.DocumentNode.SelectNodes("//img");
        if (images is null) { return; }

        int n = 0;
        foreach (var img in images) {
            if (!IsChildImageCandidate(img)) { continue; }
            n++;
            var src = img.GetAttributeValue("src", string.Empty);
            if (string.IsNullOrEmpty(src)) { continue; }

            // A full-size image link already around the image becomes the
            // opener; otherwise the image gains one. Either way the href
            // still reaches the image without script.
            var anchor = img.Ancestors("a").FirstOrDefault();
            if (anchor is null) {
                anchor = doc.CreateElement("a");
                anchor.SetAttributeValue("href", src);
                img.ParentNode.ReplaceChild(anchor, img);
                anchor.AppendChild(img);
            }
            anchor.SetAttributeValue("data-win-open", $"{slug}-img-{n}");
            var cls = anchor.GetAttributeValue("class", string.Empty);
            anchor.SetAttributeValue("class", string.IsNullOrEmpty(cls) ? "win-img-link" : cls + " win-img-link");
        }
    }

    private static ArticleWindowContent LoadMarkdown(string path, string slug) {
        string raw = File.ReadAllText(path);
        string body = raw;
        string? title = null;

        if (raw.StartsWith("---")) {
            int second = raw.IndexOf("\n---", 3, StringComparison.Ordinal);
            if (second > -1) {
                var fm = raw.Substring(3, second - 3);
                body = raw.Substring(second + 4).TrimStart('\r', '\n');
                using var reader = new StringReader(fm);
                string? line;
                while ((line = reader.ReadLine()) is not null) {
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
            .UseGenericAttributes()
            .Build();
        string html = Markdown.ToHtml(body, pipeline);

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
        bool hasMount = doc.DocumentNode.SelectSingleNode("//*[@data-applet]") is not null;
        bool appletPage = doc.DocumentNode.SelectSingleNode("//head/meta[@name='applet-page']") is not null;
        bool ownAssets = !hasMount && (
            doc.DocumentNode.SelectSingleNode("//script") is not null
            || doc.DocumentNode.SelectSingleNode("//head/link[@rel='stylesheet']") is not null
            || doc.DocumentNode.SelectSingleNode("//head/style") is not null);

        return Build(slug, title, body) with { RequiresOwnDocument = ownAssets, IsApplet = appletPage };
    }

    private static ArticleWindowContent Build(string slug, string? title, string bodyHtml) {
        bool hasCode = bodyHtml.Contains("<pre><code", StringComparison.OrdinalIgnoreCase);
        bool hasMermaid = bodyHtml.Contains("language-mermaid", StringComparison.OrdinalIgnoreCase);
        return new ArticleWindowContent(slug, string.IsNullOrWhiteSpace(title) ? slug : title!, bodyHtml, hasCode, hasMermaid);
    }
}
