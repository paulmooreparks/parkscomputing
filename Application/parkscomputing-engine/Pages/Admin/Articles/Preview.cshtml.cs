using System;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.Extensions.DependencyInjection;
using ParksComputing.Engine.Identity;
using ParksComputing.Engine.Publishing;
namespace ParksComputing.Engine.Pages.Admin.Articles;
[Authorize(Roles = "Admin,SuperAdmin")]
public sealed class PreviewModel : PageModel {
    private readonly StaffAccess _access; private readonly ArticleStore _store; private readonly ArticleRenderer _renderer;
    public PreviewModel(StaffAccess access, IServiceProvider services) { _access = access; _store = services.GetRequiredService<ArticleStore>(); _renderer = services.GetRequiredService<ArticleRenderer>(); }
    public string ArticleTitle { get; private set; } = "";
    public string Body { get; private set; } = "";
    public Guid Id { get; private set; }
    public async Task<IActionResult> OnGetAsync(Guid id, int? revision) {
        if (!await _access.AllowedAsync(User)) { return Forbid(); }
        try {
            var source = await _store.SourceAsync(id, revision, User.FindFirstValue(ClaimTypes.NameIdentifier)!);
            if (source is null) { return NotFound(); }
            Id = id; ArticleTitle = source.Title; Body = _renderer.Render(source.Source, source.Format, ArticleTrust.Restricted).Body; return Page();
        } catch (UnauthorizedAccessException) { return Forbid(); }
    }
}
