using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

using ParksComputing.Engine.Pages.Services;
using ParksComputing.Xfer.Lang;

namespace ParksComputing.Engine.Identity;

/// <summary>One row of the admin menu, resolved: what it says and what it does.</summary>
public sealed record AdminMenuItem(string Title, string Href, string? Description, string? Icon,
    string? Window = null, string? Request = null, bool External = false, bool NewTab = false, bool SignOut = false);

/// <summary>A labelled group of rows, or, with no label, rows at the top level.</summary>
public sealed record AdminMenuGroup(string? Label, IReadOnlyList<AdminMenuItem> Items);

/// <summary>
/// The admin site's menu, the logo's menu at its top left
/// (Architecture/admin-and-identity-design.md, A15). It is written in the
/// shape of sitenav.xfer's menu, in /etc/admin-menu.xfer, which every admin
/// shares; an admin's own ~/.config/admin-menu.xfer, when there is one,
/// replaces it for that admin. An entry naming only a slug takes the rest
/// from the admin site's own list below; an entry with a url is a link; an
/// entry with a nav is a labelled group. A file that doesn't parse leaves
/// the menu /etc started with, so a mistake can't lock the admin out of it.
/// </summary>
public sealed class AdminMenu {
    private readonly AdminOptions _options;
    private readonly ILogger<AdminMenu> _logger;

    public AdminMenu(IOptions<AdminOptions> options, ILogger<AdminMenu> logger) {
        _options = options.Value; _logger = logger;
    }

    /* What each slug means on the admin site. The tools open as windows on
       the desktop; the terminal makes a new one each time. */
    private AdminMenuItem? Builtin(string slug) => slug switch {
        "terminal" => new("New terminal", "/admin/terminal", "A terminal over the site, /wwwroot, /home and /etc", null, Request: "shell"),
        "editor" => new("Editor", "/admin/editor", "The text editor", null, Window: "editor"),
        "files" => new("Files", "/admin/files", "The files, as folders", null, Window: "files"),
        "settings" => new("Settings", "/admin/settings", "The desktop's settings and your timeouts", null, Window: "settings"),
        "account" => new("Account and passkeys", "/admin/account", "Your passkeys and recovery codes", null, NewTab: true),
        "site" => new("View the site", _options.PublicOrigin, "The public site, in a tab of its own", null, External: true),
        "signout" => new("Sign out", "/admin/signout", null, null, SignOut: true),
        _ => null
    };

    /// <summary>The menu for an admin whose home directory is named <paramref name="homeName"/>.</summary>
    public IReadOnlyList<AdminMenuGroup> For(string homeName) {
        var own = Path.Combine(_options.HomeRoot, homeName, ".config", "admin-menu.xfer");
        var shared = Path.Combine(_options.EtcRoot, "admin-menu.xfer");
        var entries = Read(own) ?? Read(shared) ?? Parse(ServerFiles.DefaultAdminMenu, "the default") ?? Array.Empty<NavNode>();
        var groups = new List<AdminMenuGroup>();
        var loose = new List<AdminMenuItem>();
        void FlushLoose() { if (loose.Count > 0) { groups.Add(new AdminMenuGroup(null, loose.ToList())); loose.Clear(); } }
        foreach (var entry in entries) {
            if (entry.Nav is { Length: > 0 }) {
                FlushLoose();
                var items = entry.Nav.Select(Resolve).Where(i => i is not null).Select(i => i!).ToList();
                if (items.Count > 0) { groups.Add(new AdminMenuGroup(entry.Title ?? entry.Slug, items)); }
            } else if (Resolve(entry) is { } item) {
                loose.Add(item);
            }
        }
        FlushLoose();
        return groups;
    }

    private AdminMenuItem? Resolve(NavNode entry) {
        var builtin = string.IsNullOrWhiteSpace(entry.Slug) ? null : Builtin(entry.Slug.Trim().ToLowerInvariant());
        if (builtin is not null) {
            return builtin with {
                Title = entry.Title ?? builtin.Title,
                Description = entry.Description ?? builtin.Description,
                Icon = entry.Icon ?? builtin.Icon
            };
        }
        if (string.IsNullOrWhiteSpace(entry.Url)) { return null; }
        bool external = Uri.TryCreate(entry.Url, UriKind.Absolute, out var abs) && (abs.Scheme == Uri.UriSchemeHttp || abs.Scheme == Uri.UriSchemeHttps);
        return new AdminMenuItem(entry.Title ?? entry.Slug ?? entry.Url, entry.Url, entry.Description, entry.Icon, External: external);
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
            return XferConvert.Deserialize<NavNode>(text)?.Menu;
        } catch (Exception ex) {
            _logger.LogWarning(ex, "The admin menu {Source} does not parse; using the next one", source);
            return null;
        }
    }
}
