using System;
using System.Collections.Generic;
using System.IO;
using Markdig;
using Microsoft.AspNetCore.Hosting;

namespace ParksComputing.Engine.Identity;

/// <summary>The current versions of the terms of use and the privacy policy.</summary>
public sealed record PolicyVersions(string? Terms, string? Privacy) {
    public bool Any => Terms is not null || Privacy is not null;
}

/// <summary>One legal document, ready to show: its title, the date it was
/// last updated, which is also its version, and its body as HTML.</summary>
public sealed record PolicyDocument(string Slug, string Title, string? Version, string BodyHtml);

/// <summary>
/// The privacy policy and the terms of use (Architecture/privacy-and-terms.md),
/// as YAVCHN keeps its own: part of the application, in Legal/, beside the
/// code whose behaviour they describe, so the two change together and a
/// deploy carries both. The site shows them at /privacy and /terms and as
/// windows of the same names. Each Markdown file's front matter gives its
/// title and its policyVersion, the date it was last updated. Creating an
/// account accepts the terms shown with the form and records both versions;
/// a later change is announced, and continuing to use the site accepts it.
/// </summary>
public sealed class PolicyDocuments {
    public const string TermsSlug = "terms";
    public const string PrivacySlug = "privacy";
    private static readonly MarkdownPipeline Markdown = new MarkdownPipelineBuilder().UsePipeTables().UseAutoIdentifiers().Build();
    private readonly string _dir;
    private readonly Dictionary<string, PolicyDocument?> _loaded = new();

    public PolicyDocuments(IWebHostEnvironment environment) { _dir = Path.Combine(environment.ContentRootPath, "Legal"); }

    public PolicyVersions Current() => new(Get(TermsSlug)?.Version, Get(PrivacySlug)?.Version);

    public static bool IsPolicy(string? slug) => slug is TermsSlug or PrivacySlug;

    /// <summary>The document, read once; null when the application has none
    /// by that name.</summary>
    public PolicyDocument? Get(string slug) {
        if (!IsPolicy(slug)) { return null; }
        lock (_loaded) {
            if (_loaded.TryGetValue(slug, out var known)) { return known; }
            var file = Path.Combine(_dir, slug + ".md");
            PolicyDocument? doc = null;
            if (File.Exists(file)) {
                var text = File.ReadAllText(file);
                var (title, version) = FrontMatter(text);
                var body = Markdig.Markdown.ToHtml(Pages.Services.SiteMarkdown.SplitFrontMatter(text).Body, Markdown);
                doc = new PolicyDocument(slug, title ?? slug, version, body);
            }
            _loaded[slug] = doc;
            return doc;
        }
    }

    internal static (string? Title, string? Version) FrontMatter(string text) {
        string? title = null, version = null;
        if (!text.StartsWith("---", StringComparison.Ordinal)) { return (title, version); }
        int end = text.IndexOf("\n---", 3, StringComparison.Ordinal);
        if (end < 0) { return (title, version); }
        using var reader = new StringReader(text[3..end]);
        string? line;
        while ((line = reader.ReadLine()) is not null) {
            int colon = line.IndexOf(':');
            if (colon <= 0) { continue; }
            var key = line[..colon].Trim().ToLowerInvariant();
            var val = line[(colon + 1)..].Trim().Trim('"');
            if (key == "title") { title = val; }
            else if (key == "policyversion" && val.Length is > 0 and <= 40) { version = val; }
        }
        return (title, version);
    }
}
