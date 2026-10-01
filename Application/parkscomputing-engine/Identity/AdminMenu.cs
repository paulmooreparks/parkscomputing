using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

using ParksComputing.Engine.Pages.Services;
using ParksComputing.Xfer.Lang;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// The admin site's logo menu, in its menu bar at the top left
/// (Architecture/admin-and-identity-design.md, A15, and
/// site-menu-design.md). It is written in the shape of sitenav.xfer's menu,
/// a list of titles with links, commands, submenus, headings and
/// separators, in /etc/admin-menu.xfer, which every admin shares; an
/// admin's own ~/.config/admin-menu.xfer, when there is one, replaces it for
/// that admin. A link naming only a slug takes the rest from the admin
/// site's own list below. A file that doesn't parse leaves the menu /etc
/// started with, so a mistake can't lock the admin out of it.
///
/// A file in the older shape, the logo's entries alone with a labelled
/// group for each heading, still reads: its entries become the logo's
/// title, and the default's other titles follow.
/// </summary>
public sealed class AdminMenu {
    public const string LogoTitle = "Parks Computing Admin";
    public const string LogoIcon = "/favicon-32x32.png";

    private readonly AdminOptions _options;
    private readonly ILogger<AdminMenu> _logger;

    public AdminMenu(IOptions<AdminOptions> options, ILogger<AdminMenu> logger) {
        _options = options.Value; _logger = logger;
    }

    /* What each slug means on the admin site. The tools open as windows on
       the desktop, and the terminal makes a new one each time; elsewhere
       each is a link to its page. Signing out is a form, since it changes
       state, so its entry is a button naming the form the layout holds. */
    private SiteCommands.Rendered? Builtin(string slug, bool desktop) {
        SiteCommands.Rendered Tool(string href, string? window = null, string? request = null) => desktop && window != null
            ? MenuBuilder.Link(href, ("data-win-open", window))
            : desktop && request != null ? MenuBuilder.Link(href, ("data-win-request", request)) : MenuBuilder.Link(href);
        return slug switch {
            "terminal" => Tool("/admin/terminal", request: "shell"),
            "editor" => Tool("/admin/editor", window: "editor"),
            "files" => Tool("/admin/files", window: "files"),
            "settings" => Tool("/admin/settings", window: "settings"),
            "account" => desktop ? MenuBuilder.Link("/admin/account", ("target", "_blank")) : MenuBuilder.Link("/admin/account"),
            "site" => MenuBuilder.Link(_options.PublicOrigin, ("target", "_blank"), ("rel", "noopener")),
            "signout" => new SiteCommands.Rendered("button", new List<KeyValuePair<string, string?>> { new("type", "submit"), new("form", "admin-signout") }),
            _ => null
        };
    }

    private (string Title, string? Description) BuiltinText(string slug) => slug switch {
        "terminal" => ("New terminal", "A terminal over the site, /wwwroot, /home and /etc"),
        "editor" => ("Editor", "The text editor"),
        "files" => ("Files", "The files, as folders"),
        "settings" => ("Settings", "The desktop's settings and your timeouts"),
        "account" => ("Account and passkeys", "Your passkeys and recovery codes"),
        "site" => ("View the site", "The public site, in a tab of its own"),
        _ => ("Sign out", null)
    };

    /// <summary>The menu for an admin whose home directory is named
    /// <paramref name="homeName"/>, on the desktop or on a page of its own,
    /// where the logo's title starts with a way back to the desktop.</summary>
    public IReadOnlyList<MenuTitle> For(string homeName, bool desktop) {
        var own = Path.Combine(_options.HomeRoot, homeName, ".config", "admin-menu.xfer");
        var shared = Path.Combine(_options.EtcRoot, "admin-menu.xfer");
        var titles = Read(own) ?? Read(shared) ?? Parse(ServerFiles.DefaultAdminMenu, "the default") ?? Array.Empty<NavNode>();

        MenuEntry? Link(NavNode e) {
            var slug = e.Slug?.Trim().ToLowerInvariant();
            if (slug != null && Builtin(slug, desktop) is { } el) {
                var text = BuiltinText(slug);
                return new(MenuEntryKind.Item, e.Title ?? text.Title, el, Description: e.Description ?? text.Description, Icon: e.Icon);
            }
            if (string.IsNullOrWhiteSpace(e.Url)) { return null; }
            bool external = Uri.TryCreate(e.Url, UriKind.Absolute, out var abs) && (abs.Scheme == Uri.UriSchemeHttp || abs.Scheme == Uri.UriSchemeHttps);
            var link = external ? MenuBuilder.Link(e.Url, ("target", "_blank"), ("rel", "noopener")) : MenuBuilder.Link(e.Url);
            return new(MenuEntryKind.Item, e.Title ?? e.Slug ?? e.Url, link, Description: e.Description, Icon: e.Icon);
        }

        var menu = MenuBuilder.Build(titles, desktop, Link, _ => Array.Empty<MenuEntry>()).ToList();
        if (!desktop && menu.Count > 0) {
            var logo = menu[0];
            menu[0] = logo with { Entries = new[] { new MenuEntry(MenuEntryKind.Item, "Desktop", MenuBuilder.Link("/admin")) }.Concat(logo.Entries).ToList() };
        }
        return menu;
    }

    private NavNode[]? Read(string path) {
        try {
            return File.Exists(path) ? Parse(File.ReadAllText(path), path) : null;
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Could not read the admin menu {Path}", path);
            return null;
        }
    }

    private NavNode[]? Parse(string text, string source) {
        try {
            var menu = XferConvert.Deserialize<NavNode>(text)?.Menu;
            return menu == null ? null : Titled(menu);
        } catch (Exception ex) {
            _logger.LogWarning(ex, "The admin menu {Source} does not parse; using the next one", source);
            return null;
        }
    }

    /// <summary>A menu in the titled shape. One in the older shape has an
    /// entry at the top that is not a title, a link with no nav of its own:
    /// its entries become the logo's title, a labelled group becoming a
    /// heading, and the default's other titles follow.</summary>
    private NavNode[] Titled(NavNode[] menu) {
        if (menu.All(e => e.Nav is { Length: > 0 })) { return menu; }
        var logo = new NavNode {
            Title = LogoTitle, Icon = LogoIcon,
            Nav = menu.Select(e => e.Nav is { Length: > 0 } ? new NavNode { Heading = e.Title ?? e.Slug, Nav = e.Nav } : e).ToArray()
        };
        var rest = XferConvert.Deserialize<NavNode>(ServerFiles.DefaultAdminMenu)?.Menu?.Skip(1) ?? Enumerable.Empty<NavNode>();
        return new[] { logo }.Concat(rest).ToArray();
    }
}
