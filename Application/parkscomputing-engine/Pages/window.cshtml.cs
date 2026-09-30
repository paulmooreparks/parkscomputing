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

        // A numbered instance ("terminal-2") is its applet's page again,
        // with that page's shape and page link.
        var article = _content.Load(key);
        var slug = key;
        if (article is null) {
            article = _content.LoadInstance(key);
            slug = ArticleContentService.InstanceBase(key) ?? key;
        }
        if (article is null) { return NotFound(); }

        // An applet's window is the app itself: no tag row, no dates. The
        // page's preferred shape (sitenav win="w,h") rides in the markup
        // as the window's default, which a script-side open respects.
        var node = _navService.GetNavNode(slug);
        var shape = WindowViewModel.DefaultPlacement(node?.Win);
        Window = new WindowViewModel {
            Key = article.Slug,
            Title = article.Title,
            BodyHtml = article.BodyHtml,
            PageUrl = $"/page/{slug}",
            OwnDocument = article.RequiresOwnDocument,
            Tags = article.IsApplet ? Array.Empty<string>() : node?.Tags ?? Array.Empty<string>(),
            Created = article.IsApplet ? null : node?.Date,
            Updated = article.IsApplet ? null : node?.Updated,
            X = shape?.X, Y = shape?.Y, W = shape?.W, H = shape?.H,
            SizeMode = WindowViewModel.SizeOf(node?.Size),
            MinSize = WindowViewModel.PixelSize(node?.Min),
            MaxSize = WindowViewModel.PixelSize(node?.Max)
        };
        return Page();
    }
}
