using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ParksComputing.Engine.Identity;
using ParksComputing.Engine.Publishing;
namespace ParksComputing.Engine.Pages;
public sealed class BetaArticleModel : PageModel {
    private readonly IDbContextFactory<SiteIdentityDbContext> _factory; private readonly AccountOptions _options;
    public BetaArticleModel(IDbContextFactory<SiteIdentityDbContext> factory, IOptions<AccountOptions> options) { _factory = factory; _options = options.Value; }
    public string ArticleTitle { get; private set; } = "";
    public string Body { get; private set; } = "";
    public async Task<IActionResult> OnGetAsync(Guid id) {
        if (!_options.Enabled || !_options.StaffEnabled) { return NotFound(); }
        await using var db = await _factory.CreateDbContextAsync();
        var published = await (from a in db.Articles join p in db.ArticlePublications on a.Id equals p.ArticleId
            join r in db.ArticleRevisions on new { p.ArticleId, Number = p.RevisionNumber } equals new { r.ArticleId, r.Number }
            where a.Id == id && a.Trust == ArticleTrust.Restricted select new { r.Title, p.BodyHtml }).SingleOrDefaultAsync();
        if (published is null) { return NotFound(); }
        ArticleTitle = published.Title; Body = published.BodyHtml; return Page();
    }
}
