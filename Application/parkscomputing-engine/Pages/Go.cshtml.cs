using System;
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

        return nav == "1"
            ? Redirect($"/page/{s}")
            : Redirect($"/?open={s}&top={s}");
    }
}
