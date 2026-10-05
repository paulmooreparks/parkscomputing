using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.Pages;

/// <summary>The privacy policy at /privacy and the terms of use at /terms
/// (Identity/PolicyDocuments.cs). The window view shows the same document
/// in a window of the same name (Pages/Services/ArticleContentService.cs).</summary>
public sealed class PolicyModel : PageModel {
    private readonly PolicyDocuments _documents;
    public PolicyModel(PolicyDocuments documents) { _documents = documents; }
    public PolicyDocument Document { get; private set; } = default!;

    public IActionResult OnGet(string doc) {
        if (_documents.Get(doc) is not { } found) { return NotFound(); }
        Document = found;
        ViewData["Title"] = found.Title;
        return Page();
    }
}
