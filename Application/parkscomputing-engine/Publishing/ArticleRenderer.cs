using System;
using Ganss.Xss;
using HtmlAgilityPack;
using Markdig;

namespace ParksComputing.Engine.Publishing;

internal sealed class ArticleRenderer {
    public const string RestrictedPolicy = "restricted-v1-htmlsanitizer-9.2.1039";
    public const string TrustedPolicy = "trusted-executable-v1";
    private static readonly MarkdownPipeline Markdown = new MarkdownPipelineBuilder()
        .UsePipeTables().UseAutoLinks().UseAutoIdentifiers().Build();

    public (string Body, string Policy) Render(string source, ArticleFormat format, ArticleTrust trust) {
        if (!Enum.IsDefined(format) || !Enum.IsDefined(trust)) { throw new ArgumentException("Invalid content format or trust classification."); }
        var html = format == ArticleFormat.Markdown ? Markdig.Markdown.ToHtml(WithoutFrontMatter(source), Markdown) : source;
        if (trust == ArticleTrust.TrustedExecutable) { return (html, TrustedPolicy); }

        // Create a sanitizer per call. The policy is an explicit allowlist;
        // contributed content cannot introduce forms, SVG, styles or shell IDs.
        var sanitizer = new HtmlSanitizer();
        sanitizer.AllowedTags.Clear();
        sanitizer.AllowedTags.UnionWith(new[] {
            "a", "abbr", "b", "blockquote", "br", "caption", "code", "dd", "del", "details", "div", "dl", "dt",
            "em", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "kbd", "li",
            "ol", "p", "pre", "s", "samp", "small", "span", "strong", "sub", "summary", "sup", "table", "tbody",
            "td", "th", "thead", "tr", "ul"
        });
        sanitizer.AllowedAttributes.Clear();
        sanitizer.AllowedAttributes.UnionWith(new[] { "href", "src", "alt", "title", "width", "height", "colspan", "rowspan" });
        sanitizer.AllowedSchemes.Clear();
        sanitizer.AllowedSchemes.UnionWith(new[] { "http", "https", "mailto" });
        sanitizer.UriAttributes.Clear();
        sanitizer.UriAttributes.UnionWith(new[] { "href", "src" });
        sanitizer.AllowedCssProperties.Clear();
        sanitizer.AllowedAtRules.Clear();
        var doc = new HtmlDocument();
        doc.LoadHtml(html);
        return (sanitizer.Sanitize(doc.DocumentNode.SelectSingleNode("//body")?.InnerHtml ?? html), RestrictedPolicy);
    }

    internal static string WithoutFrontMatter(string source) {
        if (!source.StartsWith("---", StringComparison.Ordinal)) { return source; }
        int end = source.IndexOf("\n---", 3, StringComparison.Ordinal);
        return end < 0 ? source : source[(end + 4)..].TrimStart('\r', '\n');
    }
}
