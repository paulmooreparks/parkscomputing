using System;
using System.IO;
using HtmlAgilityPack;
using Microsoft.AspNetCore.Hosting;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Identity;

/// <summary>Whether an article shows comments, and whether it takes new ones.</summary>
public enum ArticleCommentPolicy { Disabled, Open, Closed }

/// <summary>An article's comment state and title, as its file says.</summary>
public sealed record ArticleDiscussionInfo(string Slug, string Title, ArticleCommentPolicy Policy);

/// <summary>
/// Reads an article's comment state from the article itself
/// (Architecture/unified-identity-design.md, step 2), which is where Paul
/// sets it: commentsEnabled and commentsAllowed in a Markdown article's front
/// matter, and the comments-enabled and comments-allowed meta tags in an HTML
/// one. Enabled and allowed is Open, enabled alone is Closed, and anything
/// else is Disabled, as the article import maps them. Only an article of its
/// own in content/ can have comments; a book, its chapters and anything that
/// is not an article file have none.
/// </summary>
public sealed class CommentPolicies {
    private readonly IWebHostEnvironment _environment;
    private readonly BookService _books;
    public CommentPolicies(IWebHostEnvironment environment, BookService books) { _environment = environment; _books = books; }

    /// <summary>The article's state, or null when there is no such article.</summary>
    public ArticleDiscussionInfo? Of(string? slug) {
        if (string.IsNullOrEmpty(slug) || slug.Contains('/') || !BookService.IsSafePath(slug) || slug.Length > 200) { return null; }
        var dir = Path.Combine(_environment.WebRootPath, "content");
        var md = Path.Combine(dir, slug + ".md");
        var html = Path.Combine(dir, slug + ".html");
        bool inBook = _books.Locate(slug) is not null;
        if (File.Exists(md)) {
            var (title, enabled, allowed) = FromMarkdown(File.ReadAllText(md));
            return new(slug, title ?? slug, inBook ? ArticleCommentPolicy.Disabled : PolicyOf(enabled, allowed));
        }
        if (File.Exists(html)) {
            var doc = new HtmlDocument();
            doc.Load(html);
            string? Meta(string name) => doc.DocumentNode.SelectSingleNode($"//meta[@name='{name}']")?.GetAttributeValue("content", null);
            var title = HtmlEntity.DeEntitize(doc.DocumentNode.SelectSingleNode("//title")?.InnerText ?? "").Trim();
            return new(slug, title.Length > 0 ? title : slug,
                inBook ? ArticleCommentPolicy.Disabled : PolicyOf(IsTrue(Meta("comments-enabled")), IsTrue(Meta("comments-allowed"))));
        }
        return null;
    }

    public static ArticleCommentPolicy PolicyOf(bool enabled, bool allowed) =>
        !enabled ? ArticleCommentPolicy.Disabled : allowed ? ArticleCommentPolicy.Open : ArticleCommentPolicy.Closed;

    private static bool IsTrue(string? value) => string.Equals(value?.Trim(), "true", StringComparison.OrdinalIgnoreCase);

    /// <summary>The title and the two comment keys of a Markdown article's
    /// front matter, read as the article's page reads them.</summary>
    internal static (string? Title, bool Enabled, bool Allowed) FromMarkdown(string text) {
        string? title = null; bool enabled = false, allowed = false;
        if (!text.StartsWith("---", StringComparison.Ordinal)) { return (title, enabled, allowed); }
        int end = text.IndexOf("\n---", 3, StringComparison.Ordinal);
        if (end < 0) { return (title, enabled, allowed); }
        using var reader = new StringReader(text[3..end]);
        string? line;
        while ((line = reader.ReadLine()) is not null) {
            if (line.Length > 0 && char.IsWhiteSpace(line[0])) { continue; }
            int colon = line.IndexOf(':');
            if (colon <= 0) { continue; }
            var key = line[..colon].Trim().ToLowerInvariant();
            var val = line[(colon + 1)..].Trim().Trim('"');
            switch (key) {
                case "title": title = val; break;
                case "commentsenabled": enabled = IsTrue(val); break;
                case "commentsallowed": allowed = IsTrue(val); break;
            }
        }
        return (title, enabled, allowed);
    }
}
