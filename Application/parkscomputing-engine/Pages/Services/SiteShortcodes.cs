using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;

using Markdig.Renderers;
using Markdig.Renderers.Html;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;

namespace ParksComputing.Engine.Pages.Services;

public enum ShortcodeKind {
    /// <summary>Written in a line of text, rendered in it.</summary>
    Inline,
    /// <summary>Written alone on its line, rendered as a block of its own.</summary>
    Block,
    /// <summary>{{name}} … {{/name}} around Markdown of its own.</summary>
    Container
}

public sealed record ShortcodeParam(string Name, string Description, bool Required = false);

/// <summary>One shortcode: what it is called, how it is written, what it
/// takes, and an example. The editor's insert menu and completion read the
/// same table the renderer does.</summary>
public sealed record ShortcodeDef(string Name, ShortcodeKind Kind, string Title, string Description, string Example, IReadOnlyList<ShortcodeParam> Params) {
    internal Func<ShortcodeCall, ShortcodeContext, MarkdownObject, string>? Render { get; init; }
    internal Func<ShortcodeCall, ShortcodeContext, (string Open, string Close)>? Wrap { get; init; }
    /// <summary>A container whose body divides at this shortcode, alone on its line ({{column}} in {{columns}}).</summary>
    internal string? Separator { get; init; }
    internal string SeparatorHtml { get; init; } = "";
    /// <summary>A container the page leaves out, shown only in the editor.</summary>
    internal bool EditorOnly { get; init; }
}

/// <summary>
/// The site's shortcodes (Architecture/wysiwyg-editor-design.md): GK
/// Companion's, rendered to the site's own HTML, and the site's own. Each
/// renders to PUDL's components where PUDL has one (notices, badges, glyphs)
/// and otherwise to plain HTML that css/pudl-site.css styles in an article
/// (sc-* classes). A shortcode written wrongly renders as itself, marked, with
/// the reason in its title, so a mistake shows on the page instead of
/// vanishing.
/// </summary>
public sealed class SiteShortcodes {
    private readonly Dictionary<string, ShortcodeDef> _defs;

    public SiteShortcodes() {
        _defs = Definitions().ToDictionary(d => d.Name, StringComparer.Ordinal);
    }

    public ShortcodeDef? Find(string name) => _defs.TryGetValue(name, out var d) ? d : null;
    public IEnumerable<ShortcodeDef> All => _defs.Values.OrderBy(d => d.Name, StringComparer.Ordinal);

    /* === Rendering ====================================================== */

    internal string RenderInline(ShortcodeInline sc, ShortcodeContext ctx, HtmlRenderer renderer) {
        if (sc.Closing) {
            return ShortcodeHtml.Problem("{{/" + sc.Call.Name + "}}", "This closes {{" + sc.Call.Name + "}}, which isn't open here. A container's tags each go alone on a line.");
        }
        var def = Find(sc.Call.Name);
        if (def is null) { return ShortcodeHtml.Problem(sc.Call.Source, "There is no shortcode called " + sc.Call.Name + "."); }
        if (def.Kind == ShortcodeKind.Container) {
            return ShortcodeHtml.Problem(sc.Call.Source, sc.Call.Name + " goes around Markdown: put {{" + sc.Call.Name + "}} and {{/" + sc.Call.Name + "}} each alone on a line.");
        }
        if (def.Kind == ShortcodeKind.Block) {
            return ShortcodeHtml.Problem(sc.Call.Source, sc.Call.Name + " goes alone on its line, as a paragraph of its own.");
        }
        return Safe(def, sc.Call, ctx, sc);
    }

    internal string RenderBlock(ShortcodeInline sc, ShortcodeContext ctx, HtmlRenderer renderer) =>
        Safe(Find(sc.Call.Name)!, sc.Call, ctx, sc);

    private static string Safe(ShortcodeDef def, ShortcodeCall call, ShortcodeContext ctx, MarkdownObject at) {
        try { return def.Render!(call, ctx, at); }
        catch (ShortcodeProblem p) { return ShortcodeHtml.Problem(call.Source, p.Message); }
    }

    internal void RenderContainer(ShortcodeBlock block, ShortcodeContext ctx, HtmlRenderer renderer) {
        var def = Find(block.Call.Name)!;
        if (!block.Closed) {
            renderer.Write("<p>" + ShortcodeHtml.Problem(block.Call.Source, "This " + def.Name + " has no {{/" + def.Name + "}} after it, so it runs to the end of the page.") + "</p>");
        }
        if (def.EditorOnly && !ctx.Editing) { return; }
        (string open, string close) wrap;
        try { wrap = def.Wrap!(block.Call, ctx); }
        catch (ShortcodeProblem p) {
            renderer.Write("<p>" + ShortcodeHtml.Problem(block.Call.Source, p.Message) + "</p>");
            renderer.WriteChildren(block);
            return;
        }
        renderer.EnsureLine();
        renderer.Write(wrap.open);
        if (def.Separator is null) {
            renderer.WriteChildren(block);
        }
        else {
            foreach (var child in block) {
                if (child is ParagraphBlock p && ShortcodeHtml.Alone(p, this) is { } sep && sep.Call.Name == def.Separator) {
                    renderer.Write(def.SeparatorHtml);
                    continue;
                }
                renderer.Write(child);
            }
        }
        renderer.Write(wrap.close);
        renderer.EnsureLine();
    }

    /* === Helpers ======================================================== */

    private sealed class ShortcodeProblem : Exception { public ShortcodeProblem(string message) : base(message) { } }

    private static string H(string? s) => WebUtility.HtmlEncode(s ?? "");

    private static string Need(ShortcodeCall c, string key, int position, string what) =>
        c.Get(key, position) is { Length: > 0 } v ? v : throw new ShortcodeProblem(c.Name + " needs " + what + ".");

    private static readonly Regex Size = new(@"^\d+(\.\d+)?(%|px|rem|em|ch)$", RegexOptions.Compiled);
    private static readonly Regex Slug = new(@"^[a-z0-9][a-z0-9-]*(/[a-z0-9][a-z0-9-]*)*$", RegexOptions.Compiled);
    private static readonly Regex AppletName = new(@"^[a-z][a-z0-9-]*$", RegexOptions.Compiled);
    private static readonly Regex YouTubeId = new(@"^[A-Za-z0-9_-]{6,20}$", RegexOptions.Compiled);

    /// <summary>A site address, or a path on the site: never a script URL.</summary>
    private static string SafeUrl(string url, string what) {
        url = url.Trim();
        if (url.StartsWith('/') && !url.StartsWith("//", StringComparison.Ordinal)) { return url; }
        if (Uri.TryCreate(url, UriKind.Absolute, out var u) && (u.Scheme == "https" || u.Scheme == "http")) { return u.AbsoluteUri; }
        throw new ShortcodeProblem(what + " must be a path on this site, such as /images/x.png, or an http or https address.");
    }

    private static string Notice(string kind, string fallbackTitle, ShortcodeCall c, ShortcodeContext ctx, out string close) {
        close = "</div></div></div>";
        var title = c.Args.Length > 0 ? c.Args : null;
        return "<div class=\"notice" + (kind.Length > 0 ? " " + kind : "") + " sc-notice\" role=\"note\"><div class=\"notice-content\">" +
            (title is null ? "<span class=\"visually-hidden\">" + H(fallbackTitle) + ": </span>" : "<p class=\"notice-title\">" + ctx.Site.InlineHtml(title, ctx) + "</p>") +
            "<div class=\"notice-body\">";
    }

    private static string Links(IEnumerable<(string Url, string Title, DateTime? Date, string? Description)> items, string cls, bool dates) {
        var sb = new StringBuilder("<ul class=\"sc-list " + cls + "\">");
        foreach (var (url, title, date, description) in items) {
            sb.Append("<li><a href=\"").Append(H(url)).Append("\">").Append(H(title)).Append("</a>");
            if (dates && date is { } d) {
                sb.Append(" <time class=\"sc-date\" datetime=\"").Append(d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)).Append("\">")
                  .Append(H(d.ToString("d MMMM yyyy", CultureInfo.InvariantCulture))).Append("</time>");
            }
            if (!string.IsNullOrWhiteSpace(description)) { sb.Append("<br /><span class=\"sc-desc\">").Append(H(description)).Append("</span>"); }
            sb.Append("</li>");
        }
        return sb.Append("</ul>").ToString();
    }

    private static MarkdownDocument? DocumentOf(MarkdownObject at) {
        // An inline reaches its block through the root of its inlines.
        Block? b = at as Block;
        if (at is Inline i) {
            var root = i.Parent;
            while (root?.Parent is not null) { root = root.Parent; }
            b = root?.ParentBlock;
        }
        while (b is not null && b is not MarkdownDocument) { b = b.Parent; }
        return b as MarkdownDocument;
    }

    /* === The table ====================================================== */

    private static IEnumerable<ShortcodeDef> Definitions() {
        var title = new ShortcodeParam("title", "A heading for the notice, in Markdown; leave it out for none.");
        foreach (var (name, kind, label, what) in new[] {
            ("info", "", "Information", "A notice of information, blue, with an i."),
            ("note", "warn", "Note", "A notice to take note of, amber, with a warning sign."),
            ("tip", "positive", "Tip", "A helpful tip, green, with a tick."),
            ("warning", "danger", "Warning", "A warning, red, with a stop sign.") }) {
            yield return new ShortcodeDef(name, ShortcodeKind.Container, label, what, "{{" + name + ":An optional title}}\nText of the notice.\n{{/" + name + "}}", new[] { title }) {
                Wrap = (c, ctx) => { var open = Notice(kind, label, c, ctx, out var close); return (open, close); }
            };
        }

        yield return new ShortcodeDef("expand", ShortcodeKind.Container, "Expand", "A section the reader opens and closes, with its title showing while closed.",
            "{{expand:The title}}\nWhat opens.\n{{/expand}}", new[] { new ShortcodeParam("title", "What shows while it's closed, in Markdown.", true) }) {
            Wrap = (c, ctx) => ("<details class=\"sc-expand\"><summary>" + ctx.Site.InlineHtml(c.Args.Length > 0 ? c.Args : "More", ctx) + "</summary>", "</details>")
        };

        yield return new ShortcodeDef("status", ShortcodeKind.Inline, "Status", "A small coloured status label, with a glyph so colour isn't the only sign.",
            "{{status:green Done}}", new[] {
                new ShortcodeParam("colour", "grey, blue, green, yellow or red.", true),
                new ShortcodeParam("text", "The label.", true) }) {
            Render = (c, ctx, at) => {
                var colour = (c.Positional.Count > 0 ? c.Positional[0] : "").ToLowerInvariant();
                var kind = colour switch { "green" => "positive", "yellow" or "amber" => "warn", "red" => "danger", "blue" => "accent", "grey" or "gray" => "", _ => null }
                    ?? throw new ShortcodeProblem("status's colour is grey, blue, green, yellow or red.");
                var text = c.Args.Length > colour.Length ? c.Args[colour.Length..].Trim() : "";
                if (text.Length == 0) { throw new ShortcodeProblem("status needs a label after its colour."); }
                return "<span class=\"badge" + (kind.Length > 0 ? " " + kind : "") + "\">" + H(text) + "</span>";
            }
        };

        yield return new ShortcodeDef("toc", ShortcodeKind.Block, "Contents", "A list of the page's headings, linked, for a long page.",
            "{{toc}}", new[] {
                new ShortcodeParam("min", "The highest heading level listed; 2 unless given."),
                new ShortcodeParam("max", "The lowest heading level listed; 3 unless given.") }) {
            Render = (c, ctx, at) => {
                int min = int.TryParse(c.Get("min"), out var a) ? Math.Clamp(a, 1, 6) : 2, max = int.TryParse(c.Get("max"), out var b) ? Math.Clamp(b, min, 6) : Math.Max(3, min);
                var doc = DocumentOf(at);
                var heads = doc is null ? new List<HeadingBlock>() : doc.Descendants<HeadingBlock>().Where(h => h.Level >= min && h.Level <= max && h.GetAttributes().Id is not null).ToList();
                if (heads.Count == 0) { return ""; }
                var sb = new StringBuilder("<nav class=\"sc-toc\" aria-label=\"Contents\"><ul>");
                int depth = heads[0].Level;
                bool first = true;
                foreach (var h in heads) {
                    var level = Math.Max(h.Level, heads[0].Level);
                    if (!first) {
                        if (level > depth) { for (; depth < level; depth++) { sb.Append("<ul>"); } }
                        else { sb.Append("</li>"); for (; depth > level; depth--) { sb.Append("</ul></li>"); } }
                    }
                    first = false;
                    sb.Append("<li><a href=\"#").Append(H(h.GetAttributes().Id)).Append("\">").Append(ctx.Site.PlainText(h)).Append("</a>");
                }
                sb.Append("</li>");
                for (; depth > heads[0].Level; depth--) { sb.Append("</ul></li>"); }
                return sb.Append("</ul></nav>").ToString();
            }
        };

        yield return new ShortcodeDef("anchor", ShortcodeKind.Inline, "Anchor", "A place in the page a link can go to, as #name.",
            "{{anchor:name}}", new[] { new ShortcodeParam("name", "The anchor's name: letters, digits and dashes.", true) }) {
            Render = (c, ctx, at) => {
                var name = Need(c, "name", 0, "a name");
                if (!Regex.IsMatch(name, "^[A-Za-z][A-Za-z0-9_-]*$")) { throw new ShortcodeProblem("An anchor's name is letters, digits, - and _, starting with a letter."); }
                return "<a id=\"" + H(name) + "\"></a>";
            }
        };

        yield return new ShortcodeDef("page", ShortcodeKind.Inline, "Page link", "A link to one of the site's pages, titled as the site titles it, unless given text of its own.",
            "{{page:about}}", new[] {
                new ShortcodeParam("slug", "The page's slug, as in its address.", true),
                new ShortcodeParam("text", "The link's text, instead of the page's title.") }) {
            Render = (c, ctx, at) => {
                var slug = Need(c, "slug", 0, "a page's slug");
                var node = ctx.Site.FindPage(slug);
                if (node is null) { throw new ShortcodeProblem("There is no page " + slug + " in the site's pages."); }
                var text = c.Positional.Count > 1 ? c.Args[c.Args.IndexOf(slug, StringComparison.Ordinal)..][slug.Length..].Trim() : node.Title ?? slug;
                return "<a href=\"" + H(ctx.Site.UrlOf(slug)) + "\">" + H(text) + "</a>";
            }
        };

        yield return new ShortcodeDef("children", ShortcodeKind.Block, "Pages under this one", "A list of the pages under a section, or the chapters of a book: this page's, unless another is given.",
            "{{children}}", new[] { new ShortcodeParam("slug", "The section or book; this page unless given.") }) {
            Render = (c, ctx, at) => {
                var slug = c.Get("slug", 0) ?? ctx.Slug ?? throw new ShortcodeProblem("children needs a section or book here.");
                var items = ctx.Site.ChildrenOf(slug) ?? throw new ShortcodeProblem(slug + " has no pages under it.");
                return Links(items, "sc-children", false);
            }
        };

        yield return new ShortcodeDef("include", ShortcodeKind.Block, "Include a page", "Another Markdown page's text, here, without its front matter: text kept once and shown in several places.",
            "{{include:shared-intro}}", new[] { new ShortcodeParam("slug", "The page to include.", true) }) {
            Render = (c, ctx, at) => ctx.Site.Include(Need(c, "slug", 0, "a page's slug"), ctx, msg => new ShortcodeProblem(msg))
        };

        yield return new ShortcodeDef("figure", ShortcodeKind.Block, "Figure", "A picture with an optional caption, centred, as the site's other figures.",
            "{{figure:/images/picture.png alt=\"What it shows\" width=80% caption=\"The caption, in Markdown.\"}}", new[] {
                new ShortcodeParam("src", "The picture's address, such as /images/x.png.", true),
                new ShortcodeParam("alt", "What the picture shows, for someone who can't see it.", true),
                new ShortcodeParam("width", "Its largest width, such as 80% or 600px; the column's width unless given."),
                new ShortcodeParam("caption", "A caption under it, in Markdown.") }) {
            Render = (c, ctx, at) => {
                var src = SafeUrl(Need(c, "src", 0, "the picture's address"), "src");
                var alt = c.Get("alt") ?? throw new ShortcodeProblem("figure needs alt, what the picture shows; alt=\"\" for a picture that only decorates.");
                var width = c.Get("width");
                if (width is not null && !Size.IsMatch(width)) { throw new ShortcodeProblem("width is a number with %, px, rem, em or ch, such as 80%."); }
                var caption = c.Get("caption");
                return "<figure class=\"sc-figure\"><img src=\"" + H(src) + "\" alt=\"" + H(alt) + "\"" + (width is null ? "" : " style=\"max-width:" + H(width) + "\"") + " loading=\"lazy\" />" +
                    (string.IsNullOrWhiteSpace(caption) ? "" : "<figcaption>" + ctx.Site.InlineHtml(caption, ctx) + "</figcaption>") + "</figure>";
            }
        };

        yield return new ShortcodeDef("applet", ShortcodeKind.Block, "Applet", "One of the site's applets, running in the page, as an HTML article embeds one.",
            "{{applet:conway fit=flow}}", new[] {
                new ShortcodeParam("name", "The applet's name, as the site's applets are defined.", true),
                new ShortcodeParam("fit", "flow to take the column's width and grow with its content, or fill for a box of its own."),
                new ShortcodeParam("state", "What it opens on, as its state string, such as score=simple/Frere Jacques.musicxml.") }) {
            Render = (c, ctx, at) => Applet(Need(c, "name", 0, "an applet's name"), c.Get("fit"), c.Get("state"))
        };

        yield return new ShortcodeDef("score", ShortcodeKind.Block, "Sight Reader score", "Sight Reader, in the page, on one of the site's sample scores.",
            "{{score:simple/Frere Jacques.musicxml}}", new[] { new ShortcodeParam("path", "The score's path under /content/scores.", true) }) {
            Render = (c, ctx, at) => {
                var path = c.Args;
                if (!Regex.IsMatch(path, @"^[^/.\\][^\\]*\.(mxl|musicxml|xml)$", RegexOptions.IgnoreCase) || path.Split('/').Any(p => p is "" or "." or "..")) {
                    throw new ShortcodeProblem("score needs a score's path under /content/scores, such as simple/Frere Jacques.musicxml.");
                }
                return Applet("sight-reader", "flow", "score=" + path);
            }
        };

        yield return new ShortcodeDef("video", ShortcodeKind.Block, "Video", "A video, played in the page without tracking until it is played (YouTube's privacy-enhanced mode).",
            "{{video:youtube dQw4w9WgXcQ title=\"What it is\"}}", new[] {
                new ShortcodeParam("service", "youtube.", true),
                new ShortcodeParam("id", "The video's id, from its address.", true),
                new ShortcodeParam("title", "What the video is, for a screen reader.") }) {
            Render = (c, ctx, at) => {
                var service = (c.Positional.Count > 0 ? c.Positional[0] : "").ToLowerInvariant();
                if (service != "youtube") { throw new ShortcodeProblem("video plays YouTube videos: {{video:youtube ID}}."); }
                var id = c.Positional.Count > 1 ? c.Positional[1] : c.Get("id") ?? "";
                if (!YouTubeId.IsMatch(id)) { throw new ShortcodeProblem("That isn't a YouTube video's id."); }
                return "<div class=\"sc-video\"><iframe src=\"https://www.youtube-nocookie.com/embed/" + H(id) + "\" title=\"" + H(c.Get("title") ?? "Video") +
                    "\" loading=\"lazy\" allow=\"accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share\" referrerpolicy=\"strict-origin-when-cross-origin\" allowfullscreen></iframe></div>";
            }
        };

        yield return new ShortcodeDef("code", ShortcodeKind.Block, "Code listing", "A file from the site, shown as a highlighted listing with Copy and Download, fetched as the page loads.",
            "{{code:/js/conway.js}}", new[] {
                new ShortcodeParam("src", "The file's path on the site.", true),
                new ShortcodeParam("lang", "Its language for highlighting; taken from its extension unless given.") }) {
            Render = (c, ctx, at) => {
                var src = Need(c, "src", 0, "a file's path");
                if (!src.StartsWith('/') || src.StartsWith("//", StringComparison.Ordinal) || src.Contains("..", StringComparison.Ordinal)) {
                    throw new ShortcodeProblem("code shows a file on this site, by its path from /, such as /js/conway.js.");
                }
                var lang = c.Get("lang") ?? System.IO.Path.GetExtension(src.Split('?')[0]).TrimStart('.') switch {
                    "js" => "javascript", "cs" => "csharp", "ts" => "typescript", "py" => "python", "sh" => "bash", "ps1" => "powershell", "md" => "markdown", var e => e
                };
                return "<pre><code" + (lang.Length > 0 ? " class=\"language-" + H(lang) + "\"" : "") + " data-code-src=\"" + H(src) + "\"></code></pre>";
            }
        };

        yield return new ShortcodeDef("tagged", ShortcodeKind.Block, "Articles under a tag", "A list of the articles under a tag, as the tag's page lists them, kept current as articles are tagged.",
            "{{tagged:travel}}", new[] { new ShortcodeParam("tag", "The tag.", true) }) {
            Render = (c, ctx, at) => {
                var tag = Need(c, "tag", 0, "a tag");
                var items = ctx.Site.Tagged(tag);
                if (items.Count == 0) { throw new ShortcodeProblem("No article has the tag " + tag + "."); }
                return Links(items, "sc-tagged", true);
            }
        };

        yield return new ShortcodeDef("latest", ShortcodeKind.Block, "Newest articles", "A list of the site's newest articles, newest first, kept current as articles are added.",
            "{{latest:5}}", new[] { new ShortcodeParam("count", "How many; 5 unless given.") }) {
            Render = (c, ctx, at) => Links(ctx.Site.Latest(int.TryParse(c.Get("count", 0), out var n) ? Math.Clamp(n, 1, 50) : 5), "sc-latest", true)
        };

        yield return new ShortcodeDef("kbd", ShortcodeKind.Inline, "Keys", "Keys to press, each drawn as a key, joined by +.",
            "{{kbd:Ctrl+Shift+P}}", new[] { new ShortcodeParam("keys", "The keys, joined by +.", true) }) {
            Render = (c, ctx, at) => {
                if (c.Args.Length == 0) { throw new ShortcodeProblem("kbd needs keys, such as Ctrl+C."); }
                var keys = Regex.Split(c.Args, @"(?<=.)\+(?=.)");
                return "<span class=\"sc-keys\">" + string.Join("+", keys.Select(k => "<kbd>" + H(k.Trim()) + "</kbd>")) + "</span>";
            }
        };

        yield return new ShortcodeDef("glyph", ShortcodeKind.Inline, "Glyph", "One of PUDL's glyphs, the small symbols the site's controls use.",
            "{{glyph:check}}", new[] { new ShortcodeParam("name", "The glyph's name, such as check, warning or info.", true) }) {
            Render = (c, ctx, at) => {
                var name = Need(c, "name", 0, "a glyph's name");
                if (!ctx.Site.Glyphs.Contains(name)) { throw new ShortcodeProblem("PUDL has no glyph called " + name + "."); }
                return "<span class=\"glyph sc-glyph\" style=\"--glyph: var(--glyph-" + H(name) + ")\" aria-hidden=\"true\"></span>";
            }
        };

        yield return new ShortcodeDef("columns", ShortcodeKind.Container, "Columns", "Content side by side, divided by {{column}} lines; the columns stack on a narrow screen.",
            "{{columns}}\nThe first column.\n\n{{column}}\n\nThe second.\n{{/columns}}", Array.Empty<ShortcodeParam>()) {
            Wrap = (c, ctx) => ("<div class=\"sc-columns\"><div class=\"sc-column\">", "</div></div>"),
            Separator = "column", SeparatorHtml = "</div><div class=\"sc-column\">"
        };

        yield return new ShortcodeDef("column", ShortcodeKind.Block, "Next column", "Inside {{columns}}, starts the next column.",
            "{{column}}", Array.Empty<ShortcodeParam>()) {
            Render = (c, ctx, at) => throw new ShortcodeProblem("column divides {{columns}} … {{/columns}}; it means nothing outside one.")
        };

        yield return new ShortcodeDef("draft-note", ShortcodeKind.Container, "Note to self", "A note while writing, shown in the editor and never on the page.",
            "{{draft-note}}\nCheck this date.\n{{/draft-note}}", Array.Empty<ShortcodeParam>()) {
            Wrap = (c, ctx) => ("<aside class=\"sc-draft-note\"><p class=\"sc-draft-note-label\">Note to self, not published</p>", "</aside>"),
            EditorOnly = true
        };
    }

    private static string Applet(string name, string? fit, string? state) {
        if (!AppletName.IsMatch(name)) { throw new ShortcodeProblem("That isn't an applet's name."); }
        if (fit is not null && fit is not ("flow" or "fill")) { throw new ShortcodeProblem("fit is flow or fill."); }
        return "<div data-applet=\"" + H(name) + "\" data-applet-fit=\"" + H(fit ?? "flow") + "\"" +
            (string.IsNullOrEmpty(state) ? "" : " data-applet-initial=\"" + H(state) + "\"") + "></div>";
    }
}
