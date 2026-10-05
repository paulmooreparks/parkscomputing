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

/// <summary>A page as an AI reader gets it: its title, description, date,
/// address and Markdown body.</summary>
public sealed record MarkdownPage(string Slug, string Title, string? Description, DateTime? Date, string Body);

/// <summary>
/// The site in a form AI readers take best (Architecture/padmajairam-port-
/// design.md, "Readable by AI"): each page as Markdown at its own address
/// with .md added, and /llms.txt, which says what the site is and lists its
/// pages' Markdown, as llmstxt.org proposes. A page written in Markdown is
/// given as it is written; one written in HTML is turned into Markdown. A
/// page that is part of the layout (a "-section" file) or an applet is not
/// a page to read, and has no Markdown.
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
        if (File.Exists(md)) { return FromMarkdown(slug, File.ReadAllText(md)); }
        var html = Path.Combine(ContentDir, slug + ".html");
        if (File.Exists(html)) { return FromHtml(slug, File.ReadAllText(html)); }
        return null;
    }

    private static MarkdownPage FromMarkdown(string slug, string raw) {
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
        body = Regex.Replace(body, @"\A\s*#\s+.+\r?\n", "");
        return new MarkdownPage(slug, title.Length > 0 ? title : slug, fields.GetValueOrDefault("description"), ParseDate(fields.GetValueOrDefault("date")), body.Trim());
    }

    private static MarkdownPage? FromHtml(string slug, string raw) {
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
        var date = ParseDate(doc.DocumentNode.SelectSingleNode("//meta[translate(@http-equiv,'DATE','date')='date' or @name='date']")?.GetAttributeValue("content", null));
        var converter = new ReverseMarkdown.Converter(new ReverseMarkdown.Config {
            UnknownTags = ReverseMarkdown.Config.UnknownTagsOption.Bypass,
            GithubFlavored = true,
            RemoveComments = true,
            SmartHrefHandling = true
        });
        var md = converter.Convert(body.InnerHtml);
        md = Regex.Replace(md, @"\n{3,}", "\n\n").Trim();
        return new MarkdownPage(slug, title ?? slug, description, date, md);
    }

    private static string? WebDecode(string? s) => s is null ? null : System.Net.WebUtility.HtmlDecode(s).Trim();

    private static DateTime? ParseDate(string? s) =>
        DateTime.TryParse(s, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal, out var d) ? d : null;

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
    /// in the order its navigation gives them, each section under its own
    /// heading, and last any other pages, such as policies, under Optional,
    /// which llmstxt.org reserves for what a reader may skip.</summary>
    public string LlmsTxt(string origin) {
        var root = _nav.GetRoot();
        var sb = new StringBuilder();
        sb.Append("# ").AppendLine(root.Title ?? "This site").AppendLine();
        if (!string.IsNullOrWhiteSpace(root.Description)) { sb.Append("> ").AppendLine(root.Description).AppendLine(); }
        sb.AppendLine("Each page below is also available as Markdown at the address listed. The site's pages are the same text in HTML at the same address without .md.").AppendLine();

        var listed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        void Line(string slug, string? title, string? description) {
            var page = Load(slug);
            if (page is null || !listed.Add(slug)) { return; }
            sb.Append("- [").Append(title ?? page.Title).Append("](").Append(origin).Append(MarkdownUrlOf(slug)).Append(')');
            var desc = description ?? page.Description;
            if (!string.IsNullOrWhiteSpace(desc)) { sb.Append(": ").Append(desc); }
            sb.AppendLine();
        }

        sb.AppendLine("## Pages").AppendLine();
        Line("index", "Home", root.Description);
        foreach (var n in (root.Nav ?? Array.Empty<NavNode>()).Where(n => !string.IsNullOrEmpty(n.Slug) && !n.External)) {
            if (n.Nav is { Length: > 0 }) { continue; }
            if (n.Url == "/") { continue; }
            Line(n.Slug!, n.Title, n.Description);
        }
        sb.AppendLine();
        foreach (var section in NavService.Sections(root)) {
            var before = sb.Length;
            sb.Append("## ").AppendLine(section.Title ?? section.Slug).AppendLine();
            var start = sb.Length;
            Line(section.Slug!, section.Title, section.Description);
            foreach (var n in section.Nav!.Where(n => !string.IsNullOrEmpty(n.Slug) && !n.External)) { Line(n.Slug!, n.Title, n.Description); }
            if (sb.Length == start) { sb.Length = before; } else { sb.AppendLine(); }
        }
        // The rest: content pages the navigation does not list.
        var others = Directory.Exists(ContentDir)
            ? Directory.EnumerateFiles(ContentDir).Where(f => f.EndsWith(".md") || f.EndsWith(".html"))
                .Select(Path.GetFileNameWithoutExtension).Where(s => s is not null && !listed.Contains(s!)).Distinct().OrderBy(s => s).ToList()
            : new List<string?>();
        var restStart = sb.Length;
        sb.AppendLine("## Optional").AppendLine();
        var restItems = sb.Length;
        foreach (var slug in others) { Line(slug!, null, null); }
        if (sb.Length == restItems) { sb.Length = restStart; }
        return sb.ToString().TrimEnd() + "\n";
    }
}
