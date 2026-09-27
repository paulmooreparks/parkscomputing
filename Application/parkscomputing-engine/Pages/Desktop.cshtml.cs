using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;

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

    /// <summary>The selected category's slug ("articles" or a top-level nav
    /// section's slug), from ?cat=. Null means all categories.</summary>
    public string? Cat { get; private set; }

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

    public string? CatTitle => Categories.FirstOrDefault(c => c.Slug == Cat).Title;

    /// <summary>Posts newest first by effective date (Paul, 2026-09-26).</summary>
    public IEnumerable<NavNode> SortedPosts =>
        (Root.Posts ?? Array.Empty<NavNode>())
            .OrderByDescending(p => NavService.EffectiveDate(p) ?? DateTime.MinValue);

    public void OnGet() {
        Root = _navService.GetRoot();

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

        var cat = Request.Query["cat"].FirstOrDefault();
        Cat = Categories.Any(c => c.Slug == cat) ? cat : null;

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
            var child = tagList is null ? _content.LoadChild(key, out parentSlug) : null;
            var article = tagList ?? child ?? _content.Load(key);
            if (article is null) { continue; }
            var parent = child is null ? null : parentSlug;

            var placement = ParsePlacement(Request.Query[$"p.{key}"].FirstOrDefault());

            // A child hides with its parent and is never minimised on its own.
            bool minimized = min.Contains(parent ?? key);

            var vm = new WindowViewModel {
                Key = key,
                Title = article.Title,
                BodyHtml = article.BodyHtml,
                // A tag list has no page of its own.
                PageUrl = tagList is null ? $"/page/{parent ?? key}" : string.Empty,
                Parent = parent,
                OwnDocument = article.RequiresOwnDocument,
                Tags = (tagList is null && child is null ? _navService.GetNavNode(key)?.Tags : null) ?? Array.Empty<string>(),
                Mode = placement?.Mode ?? "maximized",
                X = placement?.X, Y = placement?.Y, W = placement?.W, H = placement?.H,
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
    }

    public bool ShowSection(string? slug) => Cat is null || Cat == slug;

    public bool RowMatches(NavNode node) =>
        Q is null
        || (node.Title?.Contains(Q, StringComparison.OrdinalIgnoreCase) ?? false)
        || (node.Description?.Contains(Q, StringComparison.OrdinalIgnoreCase) ?? false);

    /// <summary>A /desktop URL with the given filters and every other current
    /// query parameter kept, so changing a filter never disturbs the window
    /// arrangement.</summary>
    private string BuildUrl(string? cat, string? q) {
        var parts = new List<string>();
        foreach (var kv in Request.Query) {
            if (kv.Key is "cat" or "q") { continue; }
            foreach (var value in kv.Value) {
                parts.Add($"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(value ?? string.Empty)}");
            }
        }
        if (cat is not null) { parts.Add("cat=" + Uri.EscapeDataString(cat)); }
        if (q is not null) { parts.Add("q=" + Uri.EscapeDataString(q)); }
        return parts.Count > 0 ? "/?" + string.Join("&", parts) : "/";
    }

    public string CategoryUrl(string? cat) => BuildUrl(cat, Q);

    /// <summary>The desktop URL with the given window open and on top, and
    /// every other parameter kept: a direct tab's no-script destination.</summary>
    public string OpenWindowUrl(string key) {
        var parts = new List<string>();
        foreach (var kv in Request.Query) {
            if (kv.Key is "open" or "top" or "min") { continue; }
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
    public string RemoveCatUrl => BuildUrl(null, Q);
    public string RemoveQUrl => BuildUrl(Cat, null);
    public string ClearFiltersUrl => BuildUrl(null, null);

    /// <summary>The current query parameters, except q, as hidden inputs for
    /// the filter form, so a no-script submit keeps the category and the
    /// window arrangement.</summary>
    public IEnumerable<KeyValuePair<string, string>> FilterFormParams =>
        Request.Query
            .Where(kv => kv.Key != "q")
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
