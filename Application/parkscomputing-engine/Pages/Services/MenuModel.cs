using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;

namespace ParksComputing.Engine.Pages.Services;

public enum MenuEntryKind { Item, Submenu, Heading, Separator }

/// <summary>An entry of a menu title, resolved: an item (a link or a
/// command, as the element that stands for it), a submenu, a heading over
/// entries, or a separator.</summary>
public sealed record MenuEntry(MenuEntryKind Kind, string? Label = null, SiteCommands.Rendered? Element = null,
    IReadOnlyList<MenuEntry>? Entries = null, string? Description = null, string? Icon = null);

/// <summary>A title of the logo menu, resolved. WindowsOnly asks PUDL to
/// show it only on a page of windows.</summary>
public sealed record MenuTitle(string Label, string? Icon, bool WindowsOnly, IReadOnlyList<MenuEntry> Entries);

/// <summary>
/// The menu bar's host menu, for both sites (Architecture/site-menu-design.md).
/// Each site reads its menu file, sitenav.xfer's menu or the admin site's
/// admin-menu.xfer, as NavNode titles, and this resolves them into
/// MenuTitles: it keeps the entries for the view in use, writes each command
/// through SiteCommands, and asks the site for what only the site knows,
/// what a link entry leads to and what a from stands for. ToHtml writes the
/// titles as the hidden nested list PUDL's menu bar reads.
/// </summary>
public static class MenuBuilder {
    public static IReadOnlyList<MenuTitle> Build(IEnumerable<NavNode>? titles, bool desktop,
        Func<NavNode, MenuEntry?> link, Func<string, IEnumerable<MenuEntry>> from) {
        bool Shows(NavNode n) => n.When == null || (n.When == "window") == desktop;

        List<MenuEntry> Entries(IEnumerable<NavNode>? list) {
            var outList = new List<MenuEntry>();
            foreach (var e in list ?? Array.Empty<NavNode>()) {
                if (!Shows(e)) { continue; }
                if (e.Separator) { outList.Add(new(MenuEntryKind.Separator)); }
                else if (e.From != null) { outList.AddRange(from(e.From)); }
                else if (e.Heading != null) { outList.Add(new(MenuEntryKind.Heading, e.Heading, Entries: Entries(e.Nav))); }
                else if (e.Nav is { Length: > 0 }) { outList.Add(new(MenuEntryKind.Submenu, e.Title ?? e.Slug, Entries: Entries(e.Nav))); }
                else if (e.Command != null) { outList.Add(new(MenuEntryKind.Item, e.Title ?? e.Command, SiteCommands.Render(e.Command, e.Args, desktop), Description: e.Description, Icon: e.Icon)); }
                else if (link(e) is { } item) { outList.Add(item); }
            }
            return outList;
        }

        return (titles ?? Array.Empty<NavNode>()).Where(Shows)
            .Select(t => new MenuTitle(t.Title ?? t.Slug ?? "", t.Icon, t.When == "window", Entries(t.Nav)))
            .ToList();
    }

    /// <summary>The titles as the hidden list in a nav[data-menubar]: each
    /// title an item whose words come before its list, the first with its
    /// icon, which PUDL shows as the brand; in a list, an item holding a
    /// link or button is a command, "-" a separator, plain words a heading,
    /// and an item with a list of its own a submenu.</summary>
    public static string ToHtml(IReadOnlyList<MenuTitle> titles) {
        var html = new StringBuilder("<ul data-menubar-source hidden>");
        for (int i = 0; i < titles.Count; i++) {
            var t = titles[i];
            html.Append(t.WindowsOnly ? "<li data-menubar-if=\"windows\">" : "<li>");
            if (i == 0 && !string.IsNullOrEmpty(t.Icon)) { html.Append("<img src=\"").Append(WebUtility.HtmlEncode(t.Icon)).Append("\" alt=\"\" /> "); }
            html.Append(WebUtility.HtmlEncode(t.Label)).Append("<ul>");
            Write(html, t.Entries);
            html.Append("</ul></li>");
        }
        return html.Append("</ul>").ToString();
    }

    private static void Write(StringBuilder html, IReadOnlyList<MenuEntry> entries) {
        foreach (var e in entries) {
            switch (e.Kind) {
                case MenuEntryKind.Separator:
                    html.Append("<li>-</li>");
                    break;
                case MenuEntryKind.Heading:
                    html.Append("<li>").Append(WebUtility.HtmlEncode(e.Label ?? "")).Append("</li>");
                    Write(html, e.Entries ?? Array.Empty<MenuEntry>());
                    break;
                case MenuEntryKind.Submenu:
                    html.Append("<li>").Append(WebUtility.HtmlEncode(e.Label ?? "")).Append("<ul>");
                    Write(html, e.Entries ?? Array.Empty<MenuEntry>());
                    html.Append("</ul></li>");
                    break;
                default:
                    if (e.Element == null) { break; }
                    html.Append("<li>").Append(e.Element.Open()).Append(WebUtility.HtmlEncode(e.Label ?? "")).Append(e.Element.Close()).Append("</li>");
                    break;
            }
        }
    }

    /// <summary>A link as the menu writes it.</summary>
    public static SiteCommands.Rendered Link(string href, params (string Key, string? Value)[] attrs) =>
        new("a", new[] { new KeyValuePair<string, string?>("href", href) }
            .Concat(attrs.Select(a => new KeyValuePair<string, string?>(a.Key, a.Value))).ToList());
}
