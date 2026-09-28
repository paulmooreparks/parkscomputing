using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;

using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

using ParksComputing.Engine.Pages.Models;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Pages;

/// <summary>
/// The desktop view: articles in a sidebar, opened as maximized PUDL
/// floating windows over the host, with a taskbar dock along the top.
/// The URL is the whole window state (PUDL's open/top/min/p.* grammar),
/// and this model renders the windows the URL names so the arrangement
/// survives reload, bookmarking and a browser without script.
/// </summary>
public class DesktopModel : PageModel {
    private static readonly Regex KeyPattern = new(@"^[A-Za-z0-9_-]+$", RegexOptions.Compiled);

    private readonly ArticleContentService _content;
    private readonly INavService _navService;

    public DesktopModel(ArticleContentService content, INavService navService) {
        _content = content;
        _navService = navService;
    }

    public NavNode Root { get; private set; } = default!;
    public List<WindowViewModel> Windows { get; } = new();
    public string? TopKey { get; private set; }
    public HashSet<string> OpenKeys { get; } = new(StringComparer.Ordinal);

    /// <summary>Open child windows per parent key, for the sidebar's child rows.</summary>
    public Dictionary<string, List<WindowViewModel>> ChildrenOf { get; } = new(StringComparer.Ordinal);

    /// <summary>True while any window shows, which puts the narrow layout on the detail pane.</summary>
    public bool AnyVisible { get; private set; }

    /// <summary>The selected categories from repeated ?cat= parameters
    /// ("articles" or top-level section slugs). Empty means all. A tab
    /// selects exactly one; the category menu selects several.</summary>
    public List<string> SelectedCats { get; } = new();

    /// <summary>The selected tags from repeated ?tag= parameters, matched
    /// as a union. Empty means no tag filtering.</summary>
    public List<string> SelectedTags { get; } = new();

    /// <summary>Every tag in use, for the tag menu's checklist.</summary>
    public List<string> AllTags { get; private set; } = new();

    /// <summary>The text filter from ?q=. Null when absent or blank.</summary>
    public string? Q { get; private set; }

    /// <summary>The category tabs, in sidebar order. Only sections with
    /// children are categories; a leaf top-level node is a direct tab.</summary>
    public List<(string Slug, string Title)> Categories { get; } = new();

    /// <summary>Leaf top-level nav nodes, rendered as tabs that open their
    /// window directly, as the classic nav links straight to their page.</summary>
    public List<NavNode> DirectTabs { get; } = new();

    /// <summary>The open keys in URL order, for building state URLs.</summary>
    public List<string> OpenOrder { get; } = new();

    public string? CatTitleOf(string slug) => Categories.FirstOrDefault(c => c.Slug == slug).Title ?? slug;

    /// <summary>The welcome card's copy, editable at content/desktop-welcome.md.</summary>
    public string? WelcomeHtml { get; private set; }

    /// <summary>The desktop with the current list state and no windows:
    /// the close-all control's no-script destination.</summary>
    public string ListOnlyUrl {
        get {
            var parts = SelectedCats.Select(c => "cat=" + Uri.EscapeDataString(c))
                .Concat(SelectedTags.Select(t => "tag=" + Uri.EscapeDataString(t)))
                .ToList();
            if (Q is not null) { parts.Add("q=" + Uri.EscapeDataString(Q)); }
            return parts.Count > 0 ? "/?" + string.Join("&", parts) : "/";
        }
    }

    /// <summary>Posts newest first by effective date (Paul, 2026-09-26).</summary>
    public IEnumerable<NavNode> SortedPosts =>
        (Root.Posts ?? Array.Empty<NavNode>())
            .OrderByDescending(p => NavService.EffectiveDate(p) ?? DateTime.MinValue);

    public IActionResult OnGet() {
        // Preference redirects act only on top-level navigations (Fetch
        // Metadata); a region fetch must receive exactly what its address
        // names, or a mid-swap redirect would fight the reader's action.
        bool topLevel = !Request.Headers.TryGetValue("Sec-Fetch-Mode", out var fetchMode)
                        || fetchMode == "navigate";
        bool hasWindowState = Request.Query.Keys.Any(k => k == "open" || k == "top" || k == "min" || k.StartsWith("p."));
        bool bareArrival = topLevel && !hasWindowState;

        // The default-view preference: a reader who chose the classic view
        // lands there from a bare /; ?view=window (the classic pages' pill)
        // bypasses only this.
        if (bareArrival && !Request.Query.ContainsKey("view") && Request.Cookies["pc-view"] == "classic") {
            return Redirect("/home");
        }

        // The remembered list state: a bare arrival resumes the saved
        // categories, tags and filter, by redirect so the URL still names
        // what shows. Only cat, tag and q are honored from the cookie.
        if (bareArrival && !Request.Query.ContainsKey("cat") && !Request.Query.ContainsKey("q") && !Request.Query.ContainsKey("tag")) {
            var savedList = System.Net.WebUtility.UrlDecode(Request.Cookies["pc-list"] ?? string.Empty);
            var parts = savedList.Split('&', StringSplitOptions.RemoveEmptyEntries)
                .Select(p => p.Split('=', 2))
                .Where(kv => kv.Length == 2 && kv[0] is "cat" or "q" or "tag" && !string.IsNullOrEmpty(kv[1]))
                .Select(kv => $"{kv[0]}={Uri.EscapeDataString(Uri.UnescapeDataString(kv[1]))}")
                .ToList();
            if (parts.Count > 0) {
                return Redirect("/?" + string.Join("&", parts));
            }
        }

        Root = _navService.GetRoot();
        WelcomeHtml = _content.RenderFragment("desktop-welcome");

        if (Root.Posts is { Length: > 0 }) { Categories.Add(("articles", "Articles")); }
        foreach (var section in Root.Nav ?? Array.Empty<NavNode>()) {
            if (string.IsNullOrEmpty(section.Slug)) { continue; }
            if (section.Nav is { Length: > 0 }) {
                Categories.Add((section.Slug!, section.Title ?? section.Slug!));
            }
            else {
                DirectTabs.Add(section);
            }
        }

        AllTags = ArticleContentService.AllTags(Root);

        SelectedCats.AddRange(Request.Query["cat"]
            .Where(c => Categories.Any(k => k.Slug == c))
            .Distinct()!);

        SelectedTags.AddRange(Request.Query["tag"]
            .Select(t => AllTags.FirstOrDefault(k => k.Equals(t, StringComparison.OrdinalIgnoreCase)))
            .Where(t => t is not null)
            .Distinct()!);

        var q = Request.Query["q"].FirstOrDefault()?.Trim();
        Q = string.IsNullOrEmpty(q) ? null : q;

        var open = (Request.Query["open"].FirstOrDefault() ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Where(k => KeyPattern.IsMatch(k))
            .Distinct()
            .ToList();

        var min = (Request.Query["min"].FirstOrDefault() ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .ToHashSet(StringComparer.Ordinal);

        var top = Request.Query["top"].FirstOrDefault();
        if (top is null || !open.Contains(top) || min.Contains(top)) {
            top = open.LastOrDefault(k => !min.Contains(k));
        }
        TopKey = top;

        OpenOrder.AddRange(open);

        foreach (var key in open) {
            string parentSlug = string.Empty;
            var tagList = _content.LoadTagList(key, Root);
            var external = tagList is null ? _content.LoadExternal(key, Root) : null;
            var child = tagList is null && external is null ? _content.LoadChild(key, out parentSlug) : null;
            var article = tagList ?? external ?? child ?? _content.Load(key);
            if (article is null) { continue; }
            var parent = child is null ? null : parentSlug;

            var placement = ParsePlacement(Request.Query[$"p.{key}"].FirstOrDefault());

            // A child hides with its parent and is never minimised on its own.
            bool minimized = min.Contains(parent ?? key);

            var node = tagList is null && external is null && child is null ? _navService.GetNavNode(key) : null;

            // A page may prefer a window shape (sitenav win="w,h"); any
            // placement in the URL wins over it.
            var shape = placement is null && parent is null
                ? WindowViewModel.DefaultPlacement(node?.Win)
                : null;

            var vm = new WindowViewModel {
                Key = key,
                Title = article.Title,
                BodyHtml = article.BodyHtml,
                // A tag list has no page of its own; an external's page is
                // the destination itself.
                PageUrl = external?.FrameUrl ?? (tagList is null ? $"/page/{parent ?? key}" : string.Empty),
                FrameUrl = external?.FrameUrl,
                Parent = parent,
                OwnDocument = article.RequiresOwnDocument,
                // An applet's window is the app itself: no tag row, no dates.
                Tags = article.IsApplet ? Array.Empty<string>() : node?.Tags ?? Array.Empty<string>(),
                Created = article.IsApplet ? null : node?.Date,
                Updated = article.IsApplet ? null : node?.Updated,
                Mode = placement?.Mode ?? "floating",
                X = placement?.X ?? shape?.X,
                Y = placement?.Y ?? shape?.Y,
                W = placement?.W ?? shape?.W,
                H = placement?.H ?? shape?.H,
                Minimized = minimized,
                Active = key == top
            };

            OpenKeys.Add(key);
            Windows.Add(vm);
            if (parent is not null) {
                if (!ChildrenOf.TryGetValue(parent, out var list)) { ChildrenOf[parent] = list = new(); }
                list.Add(vm);
            }
        }

        AnyVisible = Windows.Any(w => !w.Minimized);

        // Stacking order: the active window renders last.
        if (top is not null) {
            var active = Windows.FirstOrDefault(w => w.Key == top);
            if (active is not null) {
                Windows.Remove(active);
                Windows.Add(active);
            }
        }

        return Page();
    }

    public bool ShowSection(string? slug) => SelectedCats.Count == 0 || (slug is not null && SelectedCats.Contains(slug));

    public bool RowMatches(NavNode node) => MatchesQuery(node) && MatchesTags(node);

    private bool MatchesQuery(NavNode node) =>
        Q is null
        || (node.Title?.Contains(Q, StringComparison.OrdinalIgnoreCase) ?? false)
        || (node.Description?.Contains(Q, StringComparison.OrdinalIgnoreCase) ?? false)
        || (node.Tags?.Any(t => t.Contains(Q, StringComparison.OrdinalIgnoreCase)) ?? false);

    private bool MatchesTags(NavNode node) =>
        SelectedTags.Count == 0
        || (node.Tags?.Any(t => SelectedTags.Contains(t, StringComparer.OrdinalIgnoreCase)) ?? false);

    /// <summary>A /desktop URL with the given filters and every other current
    /// query parameter kept, so changing a filter never disturbs the window
    /// arrangement.</summary>
    private string BuildUrl(IEnumerable<string> cats, string? q, IEnumerable<string> tags) {
        var parts = new List<string>();
        foreach (var kv in Request.Query) {
            // "view" is consumed on arrival (the default-view escape hatch).
            if (kv.Key is "cat" or "q" or "tag" or "view") { continue; }
            foreach (var value in kv.Value) {
                parts.Add($"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(value ?? string.Empty)}");
            }
        }
        parts.AddRange(cats.Select(c => "cat=" + Uri.EscapeDataString(c)));
        parts.AddRange(tags.Select(t => "tag=" + Uri.EscapeDataString(t)));
        if (q is not null) { parts.Add("q=" + Uri.EscapeDataString(q)); }
        return parts.Count > 0 ? "/?" + string.Join("&", parts) : "/";
    }

    /// <summary>A tab selects exactly this category (null clears them),
    /// keeping the tags, filter and windows.</summary>
    public string CategoryUrl(string? cat) =>
        BuildUrl(cat is null ? Array.Empty<string>() : new[] { cat }, Q, SelectedTags);

    /// <summary>The desktop URL with the given window open and on top, and
    /// every other parameter kept: a direct tab's no-script destination.</summary>
    public string OpenWindowUrl(string key) {
        var parts = new List<string>();
        foreach (var kv in Request.Query) {
            if (kv.Key is "open" or "top" or "min" or "view") { continue; }
            foreach (var value in kv.Value) {
                parts.Add($"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(value ?? string.Empty)}");
            }
        }
        var openList = OpenOrder.Contains(key) ? OpenOrder : OpenOrder.Append(key).ToList();
        parts.Add("open=" + string.Join(",", openList));
        parts.Add("top=" + key);
        var mins = Windows.Where(w => w.Minimized && w.Parent is null && w.Key != key).Select(w => w.Key).ToList();
        if (mins.Count > 0) { parts.Add("min=" + string.Join(",", mins)); }
        return "/?" + string.Join("&", parts);
    }
    public string RemoveCatUrl(string cat) => BuildUrl(SelectedCats.Where(c => c != cat), Q, SelectedTags);
    public string RemoveTagUrl(string tag) => BuildUrl(SelectedCats, Q, SelectedTags.Where(t => t != tag));
    public string RemoveQUrl => BuildUrl(SelectedCats, null, SelectedTags);
    public string ClearFiltersUrl => BuildUrl(Array.Empty<string>(), null, Array.Empty<string>());

    /// <summary>The number of active filters, for the chips row's clear
    /// link and the clear button's disabled state.</summary>
    public int ActiveFilterCount => SelectedCats.Count + SelectedTags.Count + (Q is null ? 0 : 1);

    /// <summary>The current query parameters, except q, as hidden inputs for
    /// the filter form, so a no-script submit keeps the category and the
    /// window arrangement.</summary>
    public IEnumerable<KeyValuePair<string, string>> FilterFormParams =>
        Request.Query
            .Where(kv => kv.Key != "q" && kv.Key != "view")
            .SelectMany(kv => kv.Value, (kv, v) => new KeyValuePair<string, string>(kv.Key, v ?? string.Empty));

    private static (string Mode, double X, double Y, double W, double H)? ParsePlacement(string? value) {
        var m = Regex.Match(value ?? string.Empty, @"^(floating|maximized|left|right):([0-9.]+),([0-9.]+),([0-9.]+),([0-9.]+)$");
        if (!m.Success) { return null; }
        double[] n = new double[4];
        for (int i = 0; i < 4; i++) {
            if (!double.TryParse(m.Groups[i + 2].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out n[i])
                || n[i] < 0 || n[i] > 1) {
                return null;
            }
        }
        return (m.Groups[1].Value, n[0], n[1], n[2], n[3]);
    }
}
