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
/// never arrive.</summary>
public record ArticleWindowContent(string Slug, string Title, string BodyHtml, bool HasCode, bool HasMermaid, bool RequiresOwnDocument = false);

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

    /// <summary>An article, with its images wrapped as child-window openers.</summary>
    public ArticleWindowContent? Load(string? slug) {
        var raw = LoadRaw(slug);
        if (raw is null) { return null; }
        return raw with { BodyHtml = WrapImages(raw.Slug, raw.BodyHtml) };
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
            return $"<a class=\"icon-btn\" data-win-open=\"{key}\" data-img-nav=\"{dir}\" " +
                   $"href=\"?open={parentSlug},{key}&amp;top={key}\" aria-label=\"{label}\">{glyph}</a>";
        }

        return "<nav class=\"win-img-nav\" aria-label=\"Images in this article\">" +
               (n > 1 ? Link(n - 1, "prev", "❮", "Previous image") : "<span class=\"icon-btn is-disabled\" aria-hidden=\"true\">❮</span>") +
               $"<span class=\"num\">{n} of {count}</span>" +
               (n < count ? Link(n + 1, "next", "❯", "Next image") : "<span class=\"icon-btn is-disabled\" aria-hidden=\"true\">❯</span>") +
               "</nav>";
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

    /// <summary>
    /// Wraps each eligible image in a link that opens it as a child window.
    /// Without script the link opens the image itself.
    /// </summary>
    private static string WrapImages(string slug, string bodyHtml) {
        var doc = new HtmlDocument();
        doc.LoadHtml(bodyHtml);
        var images = doc.DocumentNode.SelectNodes("//img");
        if (images is null) { return bodyHtml; }

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
        return doc.DocumentNode.InnerHtml;
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

        // An applet mount (data-app-src) is inline-safe by contract: the
        // applet runtime loads its assets and it runs in a window or as a
        // page equally. Anything else that brings assets needs the frame.
        bool isApplet = doc.DocumentNode.SelectSingleNode("//*[@data-app-src]") is not null;
        bool ownAssets = !isApplet && (
            doc.DocumentNode.SelectSingleNode("//script") is not null
            || doc.DocumentNode.SelectSingleNode("//head/link[@rel='stylesheet']") is not null
            || doc.DocumentNode.SelectSingleNode("//head/style") is not null);

        return Build(slug, title, body) with { RequiresOwnDocument = ownAssets };
    }

    private static ArticleWindowContent Build(string slug, string? title, string bodyHtml) {
        bool hasCode = bodyHtml.Contains("<pre><code", StringComparison.OrdinalIgnoreCase);
        bool hasMermaid = bodyHtml.Contains("language-mermaid", StringComparison.OrdinalIgnoreCase);
        return new ArticleWindowContent(slug, string.IsNullOrWhiteSpace(title) ? slug : title!, bodyHtml, hasCode, hasMermaid);
    }
}
