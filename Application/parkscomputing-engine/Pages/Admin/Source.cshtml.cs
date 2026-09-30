using System.IO;
using System.Text.RegularExpressions;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.Pages.Admin;

/// <summary>
/// Where a public page's Edit link lands: the page's source under
/// /wwwroot/content, opened in the workspace's Editor. Signed out, the admin
/// signs in first and comes back here. The page is named by ?slug=, since
/// "page" is Razor Pages' own route value.
/// </summary>
[Authorize(Roles = AdminOptions.Role)]
public sealed class SourceModel : PageModel {
    private static readonly Regex Slug = new("^[A-Za-z0-9_-]+$", RegexOptions.Compiled);
    private readonly IWebHostEnvironment _env;

    public SourceModel(IWebHostEnvironment env) { _env = env; }

    public IActionResult OnGet(string? slug) {
        if (string.IsNullOrEmpty(slug) || !Slug.IsMatch(slug)) {
            return Redirect("/admin/editor");
        }
        foreach (var ext in new[] { ".md", ".html" }) {
            if (System.IO.File.Exists(Path.Combine(_env.WebRootPath, "content", slug + ext))) {
                return Redirect("/admin/editor?file=/wwwroot/content/" + slug + ext);
            }
        }
        return Redirect("/admin/files?path=/wwwroot/content");
    }
}
