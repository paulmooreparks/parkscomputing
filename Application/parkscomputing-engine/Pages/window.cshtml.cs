using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

using ParksComputing.Engine.Pages.Models;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Pages;

/// <summary>
/// Returns one article as bare PUDL window markup, for the desktop page's
/// data-win-src fetches. The article's own page stays canonical; this
/// endpoint renders the body alone so opening a window costs one small
/// render.
/// </summary>
public class WindowModel : PageModel {
    private readonly ArticleContentService _content;

    public WindowModel(ArticleContentService content) {
        _content = content;
    }

    public WindowViewModel Window { get; private set; } = default!;

    public IActionResult OnGet(string key) {
        // A child key ("{slug}-img-{n}") serves one of the article's images
        // as a child window; anything else is an article window.
        var child = _content.LoadChild(key, out var parentSlug);
        if (child is not null) {
            Window = new WindowViewModel {
                Key = child.Slug,
                Title = child.Title,
                BodyHtml = child.BodyHtml,
                PageUrl = $"/page/{parentSlug}",
                Parent = parentSlug
            };
            return Page();
        }

        var article = _content.Load(key);
        if (article is null) { return NotFound(); }

        Window = new WindowViewModel {
            Key = article.Slug,
            Title = article.Title,
            BodyHtml = article.BodyHtml,
            PageUrl = $"/page/{article.Slug}",
            OwnDocument = article.RequiresOwnDocument
        };
        return Page();
    }
}
