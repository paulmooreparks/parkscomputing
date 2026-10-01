using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;

using YamlDotNet.Core;
using YamlDotNet.RepresentationModel;

namespace ParksComputing.Engine.Pages.Services;

/// <summary>
/// An article's own menu (Architecture/menu-bar-design.md). A Markdown
/// article declares it in its front matter, as a list of titles, each with
/// the commands under it, and a command is a link:
///
///   menu:
///     - title: Coincidences
///       items:
///         - label: The A380 incident
///           href: "#a380"
///         - "-"
///         - heading: Elsewhere
///         - label: Qantas
///           href: https://en.wikipedia.org/wiki/Qantas
///
/// This renders it as the markup an HTML article writes for itself: a
/// hidden <c>nav data-page-menu</c> of nested lists, which the site's menu
/// bar reads into the article's menu. The links stay ordinary links, so a
/// window turns a link to another article into a window opener as it does
/// any link in the article.
/// </summary>
public static class PageMenu {
    private static readonly Regex MenuKey = new(@"^menu\s*:\s*$", RegexOptions.IgnoreCase);
    private static readonly Regex SafeHref = new(@"^(#|/|\.|https?://|mailto:)|^[A-Za-z0-9_-]+(/|$|\?|#)", RegexOptions.IgnoreCase);

    /// <summary>The menu the front matter declares, as markup, or the empty
    /// string when it declares none. A menu that can't be read is left out
    /// rather than failing the page.</summary>
    public static string Render(string? frontMatter) {
        var block = MenuBlock(frontMatter);
        if (block is null) { return string.Empty; }
        var yaml = new YamlStream();
        try { yaml.Load(new StringReader(block)); }
        catch (YamlException) { return string.Empty; }
        if (yaml.Documents.Count == 0 || yaml.Documents[0].RootNode is not YamlMappingNode root) { return string.Empty; }
        if (Child(root, "menu") is not YamlSequenceNode menu) { return string.Empty; }

        var html = new StringBuilder();
        foreach (var t in menu.OfType<YamlMappingNode>()) {
            var title = Scalar(t, "title");
            if (string.IsNullOrWhiteSpace(title) || Child(t, "items") is not YamlSequenceNode items) { continue; }
            var rows = new StringBuilder();
            foreach (var it in items) {
                if (it is YamlScalarNode s && s.Value == "-") { rows.Append("<li>-</li>"); continue; }
                if (it is not YamlMappingNode m) { continue; }
                var heading = Scalar(m, "heading");
                if (!string.IsNullOrWhiteSpace(heading)) { rows.Append("<li>").Append(Encode(heading)).Append("</li>"); continue; }
                var label = Scalar(m, "label");
                var href = Scalar(m, "href");
                if (string.IsNullOrWhiteSpace(label) || string.IsNullOrWhiteSpace(href) || !SafeHref.IsMatch(href.Trim())) { continue; }
                rows.Append("<li><a href=\"").Append(Encode(href.Trim())).Append("\">").Append(Encode(label)).Append("</a></li>");
            }
            if (rows.Length == 0) { continue; }
            html.Append("<li>").Append(Encode(title)).Append("<ul>").Append(rows).Append("</ul></li>");
        }
        return html.Length == 0 ? string.Empty : "<nav data-page-menu hidden aria-label=\"Page menu\"><ul>" + html + "</ul></nav>";
    }

    /// <summary>The <c>menu:</c> key and the indented lines under it, alone,
    /// so the rest of the front matter, which the site reads line by line
    /// and need not be valid YAML, can't spoil it.</summary>
    private static string? MenuBlock(string? frontMatter) {
        if (string.IsNullOrWhiteSpace(frontMatter)) { return null; }
        var lines = frontMatter.Replace("\r\n", "\n").Split('\n');
        int start = Array.FindIndex(lines, l => MenuKey.IsMatch(l));
        if (start < 0) { return null; }
        var block = new List<string> { "menu:" };
        for (int i = start + 1; i < lines.Length; i++) {
            var line = lines[i];
            if (line.Length > 0 && !char.IsWhiteSpace(line[0]) && line[0] != '-') { break; }
            block.Add(line);
        }
        return string.Join('\n', block);
    }

    private static YamlNode? Child(YamlMappingNode map, string key) =>
        map.Children.FirstOrDefault(kv => kv.Key is YamlScalarNode k && string.Equals(k.Value, key, StringComparison.OrdinalIgnoreCase)).Value;

    private static string? Scalar(YamlMappingNode map, string key) => (Child(map, key) as YamlScalarNode)?.Value;

    private static string Encode(string text) => WebUtility.HtmlEncode(text.Trim());
}
