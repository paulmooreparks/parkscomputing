using System;
using System.Collections.Generic;
using System.Linq;

namespace ParksComputing.Engine.Pages.Services;

/// <summary>
/// The public site's logo menu, from sitenav.xfer's menu
/// (Architecture/site-menu-design.md). A link is a page of the site, which
/// opens as a window in the window view, or any other address; "sections"
/// stands for a link to each section's list, and a section's slug for that
/// section's entries.
/// </summary>
public static class SiteMenu {
    /// <summary>The titles, with the account's commands (Identity/AccountMenu)
    /// at the end of the logo's own title, after a separator, where PUDL's
    /// menu bar guidance puts them.</summary>
    public static IReadOnlyList<MenuTitle> Build(NavNode root, bool desktop, IReadOnlyList<MenuEntry> account, string? stage = null) {
        var titles = Build(root, desktop, stage);
        if (account.Count == 0) { return titles; }
        var first = titles[0];
        var entries = first.Entries.Count == 0 ? account : first.Entries.Append(new MenuEntry(MenuEntryKind.Separator)).Concat(account).ToList();
        return new[] { first with { Entries = entries } }.Concat(titles.Skip(1)).ToList();
    }

    public static IReadOnlyList<MenuTitle> Build(NavNode root, bool desktop, string? stage = null) {
        var sections = NavService.Sections(root).ToArray();

        MenuEntry Place(NavNode item) {
            bool page = !item.External && !string.IsNullOrEmpty(item.Slug) && item.Url == $"/page/{item.Slug}";
            var attrs = new List<(string, string?)>();
            if (page && desktop) { attrs.Add(("data-win-open", item.Slug)); }
            if (item.External) { attrs.Add(("target", "_blank")); attrs.Add(("rel", "noopener")); }
            var href = page && desktop ? $"/?open={item.Slug}&top={item.Slug}" : (item.Url ?? "/");
            return new(MenuEntryKind.Item, item.Title ?? item.Slug, MenuBuilder.Link(href, attrs.ToArray()), Description: item.Description, Icon: item.Icon);
        }

        IEnumerable<MenuEntry> From(string from) {
            if (from == "sections") {
                return sections.Select(s => new MenuEntry(MenuEntryKind.Item, s.Title ?? s.Slug,
                    MenuBuilder.Link((desktop ? "/" : "/home") + "?cat=" + Uri.EscapeDataString(s.Slug!))));
            }
            var section = sections.FirstOrDefault(s => string.Equals(s.Slug, from, StringComparison.OrdinalIgnoreCase));
            return (section?.Nav ?? Array.Empty<NavNode>()).Select(Place);
        }

        var titles = MenuBuilder.Build(root.Menu, desktop, Place, From, stage);
        return titles.Count > 0 ? titles : new[] {
            new MenuTitle("Parks Computing", "/favicon-32x32.png", false, new[] { new MenuEntry(MenuEntryKind.Item, "Home", MenuBuilder.Link("/")) })
        };
    }
}
