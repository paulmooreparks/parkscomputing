using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace ParksComputing.Engine.Pages;

/// <summary>
/// The go-to-page palette's no-script destination. Takes a slug (or a
/// site-relative path, or a full URL of this site) and redirects to the
/// page: opened as a window on the desktop, or the page itself when nav=1
/// (the classic pages' form says so). An input that does not reduce to a
/// slug lands back on the home page.
/// </summary>
public class GoModel : PageModel {
    private static readonly Regex SlugPattern = new(@"^[A-Za-z0-9_-]+$", RegexOptions.Compiled);

    public IActionResult OnGet(string? slug, string? nav) {
        var s = (slug ?? string.Empty).Trim();

        if (s.StartsWith("http://", System.StringComparison.OrdinalIgnoreCase)
            || s.StartsWith("https://", System.StringComparison.OrdinalIgnoreCase)) {
            if (Uri.TryCreate(s, UriKind.Absolute, out var url)
                && string.Equals(url.Host, Request.Host.Host, System.StringComparison.OrdinalIgnoreCase)) {
                s = url.AbsolutePath;
            }
            else {
                return Redirect("/");
            }
        }

        s = s.TrimStart('/');
        if (s.StartsWith("page/", System.StringComparison.OrdinalIgnoreCase)) { s = s["page/".Length..]; }
        s = s.TrimEnd('/');

        if (!SlugPattern.IsMatch(s)) { return Redirect("/"); }

        if (nav == "1") { return Redirect($"/page/{s}"); }

        // The palette's form carries the desktop's state, so the new window
        // joins what is open instead of replacing it; every other parameter
        // (placements, minimized windows, filters) passes through.
        var parts = new List<string>();
        foreach (var kv in Request.Query) {
            if (kv.Key is "slug" or "nav" or "view" or "open" or "top") { continue; }
            foreach (var value in kv.Value) {
                parts.Add($"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(value ?? string.Empty)}");
            }
        }
        var open = (Request.Query["open"].FirstOrDefault() ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .ToList();
        if (!open.Contains(s)) { open.Add(s); }
        parts.Add("open=" + string.Join(",", open));
        parts.Add("top=" + s);
        return Redirect("/?" + string.Join("&", parts));
    }
}
