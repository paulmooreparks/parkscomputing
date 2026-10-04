using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;
using ParksComputing.Engine.Identity;
namespace ParksComputing.Engine.Pages.Admin.Articles;
[Authorize(Roles = "Admin,SuperAdmin")]
public sealed class IndexModel : PageModel {
    private readonly StaffAccess _access; private readonly IDbContextFactory<SiteIdentityDbContext> _factory;
    public IndexModel(StaffAccess access, IDbContextFactory<SiteIdentityDbContext> factory) { _access = access; _factory = factory; }
    public bool Confirmed { get; private set; }
    public sealed record Row(Guid Id, string Slug, string Title, int Draft, int? Published);
    public List<Row> Articles { get; private set; } = new();
    public async Task<IActionResult> OnGetAsync() {
        if (!await _access.AllowedAsync(User, false)) { return Forbid(); }
        Confirmed = await _access.AllowedAsync(User);
        if (Confirmed) {
            await using var db = await _factory.CreateDbContextAsync();
            Articles = await (from article in db.Articles join revision in db.ArticleRevisions
                on new { ArticleId = article.Id, Number = article.HeadRevision } equals new { revision.ArticleId, revision.Number }
                orderby article.Slug select new Row(article.Id, article.Slug, revision.Title, article.HeadRevision,
                    db.ArticlePublications.Where(p => p.ArticleId == article.Id).Select(p => (int?)p.RevisionNumber).SingleOrDefault())).ToListAsync();
        }
        return Page();
    }
}
