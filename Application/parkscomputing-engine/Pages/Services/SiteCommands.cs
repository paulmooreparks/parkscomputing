using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ParksComputing.Engine.Pages.Services;

/// <summary>
/// The commands the site menu can carry out, named in sitenav.xfer's menu
/// with their parameters (Architecture/site-menu-design.md):
///
///   { title "Dark" command "theme" args { value "dark" } }
///
/// Each command says how it stands in the page. Where what it does has an
/// address it is a link, which works without script and which PUDL's menu
/// bar follows as a click would; js/commands.js may still carry it out in
/// place, as "open" does in the window view. Where it has no address it is
/// a button that js/commands.js carries out. A command the server does not
/// know is a button too, with its name and parameters, so a script of the
/// site's may define it; js/commands.js warns of any it can't carry out.
/// </summary>
public static class SiteCommands {
    /// <summary>A command as it stands in the page: an element, its
    /// attributes, and whether it is ticked, when the server can tell.</summary>
    public sealed record Rendered(string Tag, IReadOnlyList<KeyValuePair<string, string?>> Attributes) {
        /// <summary>The opening tag, with a class and a title when they are
        /// given; a button that names no type of its own is type="button".</summary>
        public string Open(string? cls = null, string? title = null) =>
            "<" + Tag + (cls == null ? "" : " class=\"" + WebUtility.HtmlEncode(cls) + "\"") +
            (string.IsNullOrEmpty(title) ? "" : " title=\"" + WebUtility.HtmlEncode(title) + "\"") +
            string.Concat(Attributes.Select(a => a.Value == null
                ? " " + a.Key
                : " " + a.Key + "=\"" + WebUtility.HtmlEncode(a.Value) + "\"")) +
            (Tag == "button" && !Attributes.Any(a => a.Key == "type") ? " type=\"button\"" : "") + ">";
        public string Close() => "</" + Tag + ">";
    }

    private static readonly Regex Slug = new("^[A-Za-z0-9_-]+$", RegexOptions.Compiled);

    public static Rendered Render(string command, IReadOnlyDictionary<string, string>? args, bool desktop) {
        args ??= new Dictionary<string, string>();
        string? Arg(string name) => args.TryGetValue(name, out var v) && !string.IsNullOrWhiteSpace(v) ? v : null;
        var attrs = new List<KeyValuePair<string, string?>>();
        void Add(string k, string? v) => attrs.Add(new(k, v));
        void Data() {
            Add("data-command", command);
            if (args.Count > 0) { Add("data-args", JsonSerializer.Serialize(args)); }
        }

        switch (command) {
            // The two views are addresses; the one in use is ticked.
            case "view": {
                var window = Arg("value") != "classic";
                Add("href", window ? "/?view=window" : "/home");
                Add("aria-checked", window == desktop ? "true" : "false");
                return new("a", attrs);
            }
            // PUDL keeps these links' addresses and aria-disabled current,
            // as it does the window bar's; js/window-bar.js closes every
            // window for Close all.
            case "windows.minimize-all":
                Add("href", "?"); Add("data-win-back", null);
                return new("a", attrs);
            case "windows.restore-all":
                Add("href", "?"); Add("data-win-restore", null);
                return new("a", attrs);
            case "windows.close-all":
                Add("href", "?open="); Add("data-close-all", null);
                return new("a", attrs);
            // An applet, in a given state: its page with the state in the
            // query, or in the window view a window, which js/commands.js
            // hands the state to.
            case "open": {
                var applet = Arg("applet");
                if (applet != null && Slug.IsMatch(applet)) {
                    var state = Arg("state");
                    Add("href", desktop ? $"/?open={applet}&top={applet}" : $"/page/{applet}" + (state != null ? "?" + state.TrimStart('?') : ""));
                    Data();
                    return new("a", attrs);
                }
                break;
            }
            // One of the terminal's scripts, run in a terminal: the
            // terminal's page with the script in its query, or in the window
            // view the request the terminal answers, which js/commands.js
            // makes.
            case "run": {
                var script = Arg("script");
                if (script != null) {
                    var query = string.Join("&", new[] { ("cwd", Arg("cwd")), ("run", script) }
                        .Where(p => p.Item2 != null).Select(p => p.Item1 + "=" + Uri.EscapeDataString(p.Item2!)));
                    Add("href", desktop ? "/?open=terminal&top=terminal" : "/page/terminal?" + query);
                    Data();
                    return new("a", attrs);
                }
                break;
            }
        }
        // theme, find, and any command a script of the site's defines.
        Data();
        if (command == "theme") { Add("aria-checked", "false"); }
        return new("button", attrs);
    }
}
