using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

using Markdig;
using Markdig.Syntax;

using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Pages.Services;

/// <summary>
/// The site's one Markdown renderer (Architecture/wysiwyg-editor-design.md):
/// the article page, the desktop window, the editor's preview and its visual
/// view all render through it, so an article looks the same in each. It is
/// Markdig with the extensions the site's articles have always used (pipe
/// tables, task lists, auto links, emphasis extras, typographic quotes, media
/// links, GitHub-style heading ids and generic attributes) and the site's
/// shortcodes (SiteShortcodes). Source positions are kept, for the editor,
/// which maps what it shows back to the text.
/// </summary>
public sealed class SiteMarkdown {
    private const int MaxIncludeDepth = 4;

    private readonly INavService _nav;
    private readonly BookService _books;
    private readonly SiteOptions _site;
    private readonly string _webRoot;
    private readonly Lazy<HashSet<string>> _glyphs;

    public SiteMarkdown(INavService nav, BookService books, IOptions<SiteOptions> site, IWebHostEnvironment env, SiteShortcodes shortcodes, EngineAssets? assets = null) {
        _nav = nav; _books = books; _site = site.Value; _webRoot = env.WebRootPath;
        Shortcodes = shortcodes;
        Pipeline = new MarkdownPipelineBuilder()
            .UsePreciseSourceLocation()
            .UsePipeTables()
            .UseTaskLists()
            .UseAutoLinks()
            .UseEmphasisExtras()
            .UseSmartyPants()
            .UseMediaLinks()
            // Headings get ids, as GitHub and mdBook give them, so a link to #section lands there.
            .UseAutoIdentifiers(Markdig.Extensions.AutoIdentifiers.AutoIdentifierOptions.GitHub)
            .UseGenericAttributes() // attribute lists: ![alt](img.png){ width=512 height=512 }
            .Use(new ShortcodeExtension(shortcodes))
            .Build();
        _glyphs = new(() => {
            /* PUDL is the engine's, wherever the site's own tree is. */
            var css = assets?.PathOf("pudl", "pudl.css") ?? Path.Combine(_webRoot, "pudl", "pudl.css");
            var names = File.Exists(css) ? Regex.Matches(File.ReadAllText(css), @"--glyph-([a-z][a-z-]*)\s*:").Select(m => m.Groups[1].Value) : Enumerable.Empty<string>();
            return names.Where(n => n != "size").ToHashSet(StringComparer.Ordinal);
        });
    }

    public MarkdownPipeline Pipeline { get; }
    public SiteShortcodes Shortcodes { get; }

    /* === Rendering ====================================================== */

    public MarkdownDocument Parse(string markdown) => Markdown.Parse(markdown ?? "", Pipeline);

    /// <summary>A Markdown body as HTML, for the page with this slug;
    /// editing renders what only the editor shows, such as notes to self.</summary>
    public string Render(string markdown, string? slug = null, bool editing = false) =>
        Render(Parse(markdown), ShortcodeContext.For(this, slug, editing));

    public string Render(MarkdownDocument doc, ShortcodeContext ctx) {
        using var writer = new StringWriter();
        var renderer = new SiteHtmlRenderer(writer, ctx);
        Pipeline.Setup(renderer);
        renderer.Render(doc);
        writer.Flush();
        return writer.ToString();
    }

    /// <summary>The document rendered once, as the page renders it, and the
    /// HTML of each of its top-level blocks within that, in order. The
    /// editor shows a block it can't edit as rich text by this HTML, so a
    /// heading's id, a contents list or a link to a reference defined
    /// elsewhere is what it is on the page.</summary>
    public IReadOnlyList<string> RenderBlocks(MarkdownDocument doc, ShortcodeContext ctx) {
        using var writer = new StringWriter();
        var renderer = new SiteHtmlRenderer(writer, ctx);
        Pipeline.Setup(renderer);
        var parts = new List<string>();
        foreach (var block in doc) {
            writer.Flush();
            int start = writer.GetStringBuilder().Length;
            renderer.Write(block);
            writer.Flush();
            parts.Add(writer.GetStringBuilder().ToString(start, writer.GetStringBuilder().Length - start));
        }
        return parts;
    }

    /// <summary>A line of Markdown as HTML without its paragraph, for a
    /// title or caption.</summary>
    public string InlineHtml(string markdown, ShortcodeContext ctx) {
        var html = Render(Parse(markdown.Replace('\n', ' ')), ctx).Trim();
        return html.StartsWith("<p>", StringComparison.Ordinal) && html.EndsWith("</p>", StringComparison.Ordinal) ? html[3..^4] : html;
    }

    /// <summary>A heading's text, escaped for HTML, without its markup.</summary>
    public string PlainText(HeadingBlock heading) {
        using var writer = new StringWriter();
        var renderer = new SiteHtmlRenderer(writer, ShortcodeContext.For(this, null)) { EnableHtmlForInline = false };
        Pipeline.Setup(renderer);
        renderer.WriteLeafInline(heading);
        writer.Flush();
        return writer.ToString();
    }

    /// <summary>A Markdown file's front matter (without its --- lines) and body.</summary>
    public static (string FrontMatter, string Body) SplitFrontMatter(string raw) {
        if (raw.StartsWith("---", StringComparison.Ordinal)) {
            int second = raw.IndexOf("\n---", 3, StringComparison.Ordinal);
            if (second > -1) {
                var fm = raw.Substring(3, second - 3).Trim('\r', '\n');
                var body = raw.Substring(second + 4).TrimStart('\r', '\n');
                return (fm, body);
            }
        }
        return (string.Empty, raw);
    }

    /* === What shortcodes look up ======================================== */

    public string UrlOf(string slug) => _site.UrlOf(slug);

    public IReadOnlySet<string> Glyphs => _glyphs.Value;

    /// <summary>A page in the site's pages, by its slug.</summary>
    public NavNode? FindPage(string slug) {
        NavNode? Walk(IEnumerable<NavNode>? nodes) {
            foreach (var n in nodes ?? Array.Empty<NavNode>()) {
                if (string.Equals(n.Slug, slug, StringComparison.OrdinalIgnoreCase)) { return n; }
                if (Walk(n.Nav) is { } found) { return found; }
            }
            return null;
        }
        return Walk(_nav.GetRoot().Nav);
    }

    private static readonly (string, string, DateTime?, string?)[] None = Array.Empty<(string, string, DateTime?, string?)>();

    /// <summary>The pages under a section, or a book's chapters, as links; null when it has none.</summary>
    public IReadOnlyList<(string Url, string Title, DateTime? Date, string? Description)>? ChildrenOf(string slug) {
        if (FindPage(slug) is { Nav.Length: > 0 } node) {
            return node.Nav!.Where(n => !string.IsNullOrEmpty(n.Slug))
                .Select(n => (n.External && n.Url is not null ? n.Url : UrlOf(n.Slug!), n.Title ?? n.Slug!, NavService.EffectiveDate(n), n.Description ?? n.Excerpt)).ToList();
        }
        if (BookService.IsSafePath(slug) && _books.Load(slug) is { } book && book.Root.Children.Count > 0) {
            return book.Root.Children.Select(c => (UrlOf(slug + "/" + c.Path), c.Title, (DateTime?)null, (string?)null)).ToList();
        }
        return null;
    }

    public IReadOnlyList<(string Url, string Title, DateTime? Date, string? Description)> Tagged(string tag) =>
        ArticleContentService.TaggedWith(_nav.GetRoot(), ArticleContentService.TagSlug(tag))
            .Select(x => (x.Node.External && x.Node.Url is not null ? x.Node.Url : UrlOf(x.Node.Slug!), x.Node.Title ?? x.Node.Slug!, NavService.EffectiveDate(x.Node), x.Node.Description ?? x.Node.Excerpt))
            .ToList();

    public IReadOnlyList<(string Url, string Title, DateTime? Date, string? Description)> Latest(int count) =>
        NavService.Articles(_nav.GetRoot())
            .OrderByDescending(n => NavService.EffectiveDate(n) ?? DateTime.MinValue)
            .Take(count)
            .Select(n => (n.External && n.Url is not null ? n.Url : UrlOf(n.Slug!), n.Title ?? n.Slug!, NavService.EffectiveDate(n), n.Description ?? n.Excerpt))
            .ToList();

    /// <summary>Another Markdown page's body, rendered here; never a page
    /// that is already being included, and never deeper than four.</summary>
    public string Include(string slug, ShortcodeContext ctx, Func<string, Exception> problem) {
        if (!BookService.IsSafePath(slug)) { throw problem(slug + " isn't a page's slug."); }
        if (ctx.Including.Contains(slug, StringComparer.OrdinalIgnoreCase)) { throw problem(slug + " is already being included here, so including it again would never end."); }
        if (ctx.Including.Count >= MaxIncludeDepth) { throw problem("Pages include each other too deeply here."); }
        var file = Path.Combine(_webRoot, "content", slug.Replace('/', Path.DirectorySeparatorChar) + ".md");
        if (!File.Exists(file)) { throw problem("There is no Markdown page " + slug + " to include."); }
        var (_, body) = SplitFrontMatter(File.ReadAllText(file));
        return Render(Parse(body), ctx with { Including = ctx.Including.Append(slug).ToList() });
    }
}
