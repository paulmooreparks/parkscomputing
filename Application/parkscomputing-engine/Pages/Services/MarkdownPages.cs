using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using HtmlAgilityPack;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Pages.Services;

/// <summary>A page as an AI reader or a search engine gets it: its title,
/// description, when it was written and last changed, its first picture,
/// and its Markdown body.</summary>
public sealed record MarkdownPage(string Slug, string Title, string? Description, DateTime? Date, DateTime Modified, string? Image, string Body) {
    /// <summary>The description, or else the page's opening words, for a
    /// page that gives none.</summary>
    public string Summary {
        get {
            if (!string.IsNullOrWhiteSpace(Description)) { return Description!; }
            var para = Body.Split("\n\n").Select(p => p.Trim())
                .FirstOrDefault(p => p.Length > 0 && !p.StartsWith('#') && !p.StartsWith('!') && !p.StartsWith('|') && !p.StartsWith('>'));
            if (para is null) { return Title; }
            var text = Regex.Replace(para, @"!\[[^\]]*\]\([^)]*\)", "");
            text = Regex.Replace(text, @"\[([^\]]*)\]\([^)]*\)", "$1");
            text = Regex.Replace(text, @"[*_`]+", "").Replace('\n', ' ').Trim();
            return text.Length <= 200 ? text : Regex.Replace(text[..200], @"\s+\S*$", "") + "…";
        }
    }
}

/// <summary>A page in the order the site gives its pages, with the group it
/// belongs to: "Pages" for the top level, a section's title for that
/// section's pages, and "Optional" for content pages the navigation does not
/// list, such as policies.</summary>
public sealed record SitePage(string Slug, string Title, string? Description, string Group);

/// <summary>
/// The site in the forms machines read (Architecture/padmajairam-port-
/// design.md, "Readable by AI" and "Search engines"): each page as Markdown
/// at its own address with .md added, /llms.txt, which lists the pages'
/// Markdown as llmstxt.org proposes, and the page list behind /sitemap.xml.
/// A page written in Markdown is given as it is written; one written in HTML
/// is turned into Markdown. A page that is part of the layout (a "-section"
/// file) or an applet is not a page to read.
/// </summary>
public sealed class MarkdownPages {
    private static readonly Regex SlugPattern = new(@"^[A-Za-z0-9_-]+$", RegexOptions.Compiled);
    private readonly IWebHostEnvironment _env;
    private readonly INavService _nav;
    private readonly SiteOptions _site;

    public MarkdownPages(IWebHostEnvironment env, INavService nav, IOptions<SiteOptions> site) {
        _env = env; _nav = nav; _site = site.Value;
    }

    private string ContentDir => Path.Combine(_env.WebRootPath, "content");

    /// <summary>The site's own origin for whole addresses: Site:Origin when
    /// it is set, since behind a tunnel the request says http and an
    /// internal host, or else the request's.</summary>
    public string OriginOr(string requestOrigin) =>
        string.IsNullOrWhiteSpace(_site.Origin) ? requestOrigin : _site.Origin!.TrimEnd('/');

    /// <summary>Whether a slug is a page someone reads: a content file that
    /// is not part of the layout and is not an applet.</summary>
    public bool IsReadable(string slug) => Load(slug) is not null;

    /// <summary>The address of a page's Markdown: the page's own address
    /// with .md added, and /index.md for the home page.</summary>
    public string MarkdownUrlOf(string slug) =>
        slug == "index" ? "/index.md" : _site.UrlOf(slug).TrimEnd('/') + ".md";

    /// <summary>The page's own address: / for the home page.</summary>
    public string PageUrlOf(string slug) => slug == "index" ? "/" : _site.UrlOf(slug);

    public MarkdownPage? Load(string slug) {
        if (!SlugPattern.IsMatch(slug) || slug.EndsWith("-section", StringComparison.OrdinalIgnoreCase)) { return null; }
        var md = Path.Combine(ContentDir, slug + ".md");
        if (File.Exists(md)) { return FromMarkdown(slug, File.ReadAllText(md), File.GetLastWriteTimeUtc(md)); }
        var html = Path.Combine(ContentDir, slug + ".html");
        if (File.Exists(html)) { return FromHtml(slug, File.ReadAllText(html), File.GetLastWriteTimeUtc(html)); }
        return null;
    }

    private static MarkdownPage FromMarkdown(string slug, string raw, DateTime written) {
        string body = raw;
        var fields = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (raw.StartsWith("---")) {
            int second = raw.IndexOf("\n---", 3, StringComparison.Ordinal);
            if (second > -1) {
                foreach (var line in raw.Substring(3, second - 3).Split('\n')) {
                    if (line.Length == 0 || char.IsWhiteSpace(line[0])) { continue; }
                    int colon = line.IndexOf(':');
                    if (colon > 0) { fields[line[..colon].Trim()] = line[(colon + 1)..].Trim().Trim('"'); }
                }
                body = raw[(second + 4)..].TrimStart('\r', '\n');
            }
        }
        var title = fields.GetValueOrDefault("title") ?? Regex.Match(body, @"^#\s+(.+)$", RegexOptions.Multiline).Groups[1].Value.Trim();
        // The page's own first heading is its title, which the export puts
        // first itself.
        body = Regex.Replace(body, @"\A\s*#\s+.+\r?\n", "").Trim();
        var date = ParseDate(fields.GetValueOrDefault("date"));
        var modified = ParseDate(fields.GetValueOrDefault("lastmodified")) ?? date ?? written;
        var image = Regex.Match(body, @"!\[[^\]]*\]\(([^)\s]+)").Groups[1].Value;
        return new MarkdownPage(slug, title.Length > 0 ? title : slug, fields.GetValueOrDefault("description"), date, modified,
            image.Length > 0 ? image : null, body);
    }

    private static MarkdownPage? FromHtml(string slug, string raw, DateTime written) {
        var doc = new HtmlDocument();
        doc.LoadHtml(raw);
        if (doc.DocumentNode.SelectSingleNode("//meta[@name='applet-page']") is not null) { return null; }
        var body = doc.DocumentNode.SelectSingleNode("//body") ?? doc.DocumentNode;
        // A page that is only an applet mount has nothing to read.
        if (body.SelectSingleNode(".//*[@data-applet]") is not null && body.InnerText.Trim().Length < 40) { return null; }
        foreach (var n in body.SelectNodes(".//script|.//style|.//noscript|.//iframe|.//nav[@data-page-menu]")?.ToList() ?? new()) { n.Remove(); }
        var title = WebDecode(doc.DocumentNode.SelectSingleNode("//title")?.InnerText);
        var h1 = body.SelectSingleNode(".//h1");
        if (h1 is not null) { title = WebDecode(h1.InnerText) ?? title; h1.Remove(); }
        var description = WebDecode(doc.DocumentNode.SelectSingleNode("//meta[@name='description']")?.GetAttributeValue("content", null));
        var date = ParseDate(Meta(doc, "date"));
        var modified = ParseDate(Meta(doc, "last-modified")) ?? date ?? written;
        var image = body.SelectSingleNode(".//img[@src]")?.GetAttributeValue("src", null);
        var converter = new ReverseMarkdown.Converter(new ReverseMarkdown.Config {
            UnknownTags = ReverseMarkdown.Config.UnknownTagsOption.Bypass,
            GithubFlavored = true,
            RemoveComments = true,
            SmartHrefHandling = true
        });
        var md = converter.Convert(body.InnerHtml);
        md = Regex.Replace(md, @"\n{3,}", "\n\n").Trim();
        return new MarkdownPage(slug, title ?? slug, description, date, modified, image, md);
    }

    /// <summary>A meta element's content by http-equiv or name, either case.</summary>
    private static string? Meta(HtmlDocument doc, string key) =>
        doc.DocumentNode.SelectNodes("//meta")?.FirstOrDefault(m =>
            string.Equals(m.GetAttributeValue("http-equiv", ""), key, StringComparison.OrdinalIgnoreCase)
            || string.Equals(m.GetAttributeValue("name", ""), key, StringComparison.OrdinalIgnoreCase))
        ?.GetAttributeValue("content", null);

    private static string? WebDecode(string? s) => s is null ? null : System.Net.WebUtility.HtmlDecode(s).Trim();

    private static DateTime? ParseDate(string? s) =>
        DateTime.TryParse(s, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal, out var d) ? d : null;

    /// <summary>Every page of the site in order: the home page and the other
    /// top-level pages, then each section's pages, then any other content
    /// page, each once, and only pages there is something to read on.</summary>
    public IReadOnlyList<SitePage> Pages() {
        var root = _nav.GetRoot();
        var list = new List<SitePage>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        void Add(string slug, string? title, string? description, string group) {
            if (seen.Contains(slug)) { return; }
            var page = Load(slug);
            if (page is null) { return; }
            seen.Add(slug);
            list.Add(new SitePage(slug, title ?? page.Title, description ?? page.Description, group));
        }
        Add("index", "Home", root.Description, "Pages");
        foreach (var n in (root.Nav ?? Array.Empty<NavNode>()).Where(n => !string.IsNullOrEmpty(n.Slug) && !n.External && n.Url != "/")) {
            if (n.Nav is { Length: > 0 }) { continue; }
            Add(n.Slug!, n.Title, n.Description, "Pages");
        }
        foreach (var section in NavService.Sections(root)) {
            var group = section.Title ?? section.Slug!;
            Add(section.Slug!, section.Title, section.Description, group);
            foreach (var n in section.Nav!.Where(n => !string.IsNullOrEmpty(n.Slug) && !n.External)) { Add(n.Slug!, n.Title, n.Description, group); }
        }
        if (Directory.Exists(ContentDir)) {
            foreach (var slug in Directory.EnumerateFiles(ContentDir).Where(f => f.EndsWith(".md") || f.EndsWith(".html"))
                         .Select(Path.GetFileNameWithoutExtension).OfType<string>().Distinct().OrderBy(s => s)) {
                Add(slug, null, null, "Optional");
            }
        }
        return list;
    }

    /// <summary>A page's Markdown as it is served: its title, its
    /// description as a quotation, where it lives and when it was written,
    /// then the page, with the site's own links made whole so they still
    /// lead somewhere when the text is read elsewhere.</summary>
    public string Render(MarkdownPage page, string origin) {
        var sb = new StringBuilder();
        sb.Append("# ").AppendLine(page.Title).AppendLine();
        if (!string.IsNullOrWhiteSpace(page.Description)) { sb.Append("> ").AppendLine(page.Description).AppendLine(); }
        sb.Append("Address: ").AppendLine(origin + PageUrlOf(page.Slug));
        if (page.Date is { } d) { sb.Append("Published: ").AppendLine(d.ToString("yyyy-MM-dd")); }
        sb.AppendLine();
        sb.AppendLine(Absolute(page.Body, origin));
        return sb.ToString();
    }

    private static string Absolute(string md, string origin) =>
        Regex.Replace(md, @"\]\((/[^)\s]*)", m => "](" + origin + m.Groups[1].Value);

    /// <summary>/llms.txt: the site's name and description, then its pages
    /// in the order Pages() gives them, each group under its own heading;
    /// Optional is the heading llmstxt.org reserves for what a reader may
    /// skip.</summary>
    public string LlmsTxt(string origin) {
        var root = _nav.GetRoot();
        var sb = new StringBuilder();
        sb.Append("# ").AppendLine(root.Title ?? "This site").AppendLine();
        if (!string.IsNullOrWhiteSpace(root.Description)) { sb.Append("> ").AppendLine(root.Description).AppendLine(); }
        sb.AppendLine("Each page below is also available as Markdown at the address listed. The site's pages are the same text in HTML at the same address without .md.");
        foreach (var group in Pages().GroupBy(p => p.Group)) {
            sb.AppendLine().Append("## ").AppendLine(group.Key).AppendLine();
            foreach (var p in group) {
                sb.Append("- [").Append(p.Title).Append("](").Append(origin).Append(MarkdownUrlOf(p.Slug)).Append(')');
                if (!string.IsNullOrWhiteSpace(p.Description)) { sb.Append(": ").Append(p.Description); }
                sb.AppendLine();
            }
        }
        return sb.ToString();
    }

    /// <summary>/sitemap.xml: every page's address and when it last
    /// changed, as sitemaps.org defines.</summary>
    public string SitemapXml(string origin) {
        var sb = new StringBuilder();
        sb.AppendLine("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
        sb.AppendLine("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">");
        foreach (var p in Pages()) {
            var page = Load(p.Slug)!;
            sb.Append("  <url><loc>").Append(System.Security.SecurityElement.Escape(origin + PageUrlOf(p.Slug))).Append("</loc>")
              .Append("<lastmod>").Append(page.Modified.ToString("yyyy-MM-dd")).AppendLine("</lastmod></url>");
        }
        sb.AppendLine("</urlset>");
        return sb.ToString();
    }
}
