using System;
using Ganss.Xss;
using HtmlAgilityPack;
using Markdig;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// Turns a comment's Markdown into the little HTML a comment may have
/// (Architecture/unified-identity-design.md, step 2): paragraphs, line
/// breaks, emphasis, code, quotations, lists and links. Raw HTML in the
/// Markdown is shown as text, an image becomes its description, and a
/// heading keeps its words without its size. Every link is marked as a
/// reader's (ugc nofollow) and opens without the opener. The rendering is
/// never stored; Policy names the rules a comment was shown under.
/// </summary>
public static class CommentRenderer {
    public const string Policy = "comment-v1-htmlsanitizer-9.2.1039";

    private static readonly MarkdownPipeline Markdown = new MarkdownPipelineBuilder()
        .DisableHtml().UseAutoLinks().UseSoftlineBreakAsHardlineBreak().Build();

    public static string Render(string source) {
        var html = Markdig.Markdown.ToHtml(source ?? "", Markdown);
        var doc = new HtmlDocument();
        doc.LoadHtml(html);
        // An image is replaced by its description, so a comment cannot load
        // anything from elsewhere.
        foreach (var img in doc.DocumentNode.SelectNodes("//img") ?? Empty) {
            img.ParentNode.ReplaceChild(doc.CreateTextNode(HtmlEntity.Entitize(img.GetAttributeValue("alt", ""))), img);
        }
        var sanitizer = new HtmlSanitizer { KeepChildNodes = true };
        sanitizer.AllowedTags.Clear();
        sanitizer.AllowedTags.UnionWith(new[] { "p", "br", "em", "strong", "code", "pre", "blockquote", "ul", "ol", "li", "a" });
        sanitizer.AllowedAttributes.Clear();
        sanitizer.AllowedAttributes.Add("href");
        sanitizer.AllowedSchemes.Clear();
        sanitizer.AllowedSchemes.UnionWith(new[] { "http", "https", "mailto" });
        sanitizer.UriAttributes.Clear();
        sanitizer.UriAttributes.Add("href");
        sanitizer.AllowedCssProperties.Clear();
        sanitizer.AllowedAtRules.Clear();
        sanitizer.AllowedClasses.Clear();
        sanitizer.PostProcessNode += (_, e) => {
            if (e.Node is AngleSharp.Dom.IElement el && el.LocalName == "a") {
                el.SetAttribute("rel", "ugc nofollow noopener noreferrer");
            }
        };
        sanitizer.AllowedAttributes.Add("rel");
        return sanitizer.Sanitize(doc.DocumentNode.OuterHtml);
    }

    private static readonly HtmlNodeCollection Empty = new(null);
}
