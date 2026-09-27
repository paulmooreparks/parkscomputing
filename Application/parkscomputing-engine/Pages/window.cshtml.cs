using System;

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
    private readonly INavService _navService;

    public WindowModel(ArticleContentService content, INavService navService) {
        _content = content;
        _navService = navService;
    }

    public WindowViewModel Window { get; private set; } = default!;

    public IActionResult OnGet(string key) {
        // A tag key ("tag-{slug}") serves the tag's article list.
        var tagList = _content.LoadTagList(key, _navService.GetRoot());
        if (tagList is not null) {
            // A tag list has no page of its own, so no page button.
            Window = new WindowViewModel {
                Key = tagList.Slug,
                Title = tagList.Title,
                BodyHtml = tagList.BodyHtml,
                PageUrl = string.Empty
            };
            return Page();
        }

        // An ext key serves a framed external destination.
        var external = _content.LoadExternal(key, _navService.GetRoot());
        if (external is not null) {
            Window = new WindowViewModel {
                Key = external.Slug,
                Title = external.Title,
                BodyHtml = string.Empty,
                PageUrl = external.FrameUrl!,
                FrameUrl = external.FrameUrl
            };
            return Page();
        }

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

        var node = _navService.GetNavNode(article.Slug);
        Window = new WindowViewModel {
            Key = article.Slug,
            Title = article.Title,
            BodyHtml = article.BodyHtml,
            PageUrl = $"/page/{article.Slug}",
            OwnDocument = article.RequiresOwnDocument,
            Tags = node?.Tags ?? Array.Empty<string>(),
            Created = node?.Date,
            Updated = node?.Updated
        };
        return Page();
    }
}
