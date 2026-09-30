using System.Collections.Generic;

using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Pages;

/// <summary>
/// A tag's article list in the classic view, at /tag/{slug}: the page a tag
/// link on a classic article leads to. The window view lists the same
/// articles in a menu under the tag instead.
/// </summary>
public class TagModel : PageModel {
    private readonly INavService _navService;

    public TagModel(INavService navService) {
        _navService = navService;
    }

    /// <summary>The tag as the first entry under it spells it.</summary>
    public string TagName { get; private set; } = string.Empty;

    public List<(NavNode Node, string Tag)> Articles { get; private set; } = new();

    public IActionResult OnGet(string slug) {
        Articles = ArticleContentService.TaggedWith(_navService.GetRoot(), slug ?? string.Empty);
        if (Articles.Count == 0) { return NotFound(); }
        TagName = Articles[0].Tag;
        return Page();
    }
}
