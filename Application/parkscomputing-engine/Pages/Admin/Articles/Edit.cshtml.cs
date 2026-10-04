using System;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.AspNetCore.Mvc.ModelBinding.Validation;
using Microsoft.Extensions.DependencyInjection;
using ParksComputing.Engine.Identity;
using ParksComputing.Engine.Publishing;
namespace ParksComputing.Engine.Pages.Admin.Articles;
[Authorize(Roles = "Admin,SuperAdmin")]
public sealed class EditModel : PageModel {
    private readonly StaffAccess _access; private readonly ArticleStore _store;
    public EditModel(StaffAccess access, IServiceProvider services) { _access = access; _store = services.GetRequiredService<ArticleStore>(); }
    [BindProperty(SupportsGet = true)] public Guid? Id { get; set; }
    [BindProperty] public Guid Version { get; set; }
    [BindProperty] public Guid Operation { get; set; }
    [BindProperty] public int Revision { get; set; }
    [BindProperty, ValidateNever] public string? Slug { get; set; } = "";
    [BindProperty, ValidateNever] public string? ArticleTitle { get; set; } = "";
    [BindProperty, ValidateNever] public string? Source { get; set; } = "";
    [BindProperty] public ArticleFormat Format { get; set; }
    [BindProperty] public ArticleCommentPolicy Comments { get; set; }
    public int? Published { get; private set; }
    private string Actor => User.FindFirstValue(ClaimTypes.NameIdentifier)!;
    public async Task<IActionResult> OnGetAsync() {
        if (!await _access.AllowedAsync(User)) { return Redirect("/admin/articles"); }
        Operation = Guid.NewGuid();
        if (Id is { } id) {
            try {
                var source = await _store.SourceAsync(id, null, Actor); if (source is null) { return NotFound(); }
                Version = source.Article.Version; Revision = source.Number; Slug = source.Article.Slug;
                ArticleTitle = source.Title; Source = source.Source; Format = source.Format; Comments = source.CommentPolicy;
                Published = source.Article.PublishedRevision;
            } catch (UnauthorizedAccessException) { return Forbid(); }
        }
        return Page();
    }
    public Task<IActionResult> OnPostSaveAsync() => ChangeAsync("save");
    public Task<IActionResult> OnPostPublishAsync() => ChangeAsync("publish");
    public Task<IActionResult> OnPostUnpublishAsync() => ChangeAsync("unpublish");
    private async Task<IActionResult> ChangeAsync(string action) {
        if (!await _access.AllowedAsync(User)) { return Forbid(); }
        if (!ModelState.IsValid || Operation == Guid.Empty) { ModelState.AddModelError("", "Check the article fields and reload if this form has expired."); return Page(); }
        try {
            ArticleState result;
            if (action == "save") {
                var input = new DraftInput(ArticleTitle ?? "", Source ?? "", Format, Comments);
                result = Id is { } id ? await _store.SaveAsync(id, Version, input, Actor, Operation) : await _store.CreateAsync(Slug ?? "", input, Actor, Operation);
            } else if (Id is { } id) {
                result = action == "publish" ? await _store.PublishAsync(id, Version, Revision, Actor, Operation) : await _store.UnpublishAsync(id, Version, Actor, Operation);
            } else { return BadRequest(); }
            return Redirect("/admin/articles/edit/" + result.Id);
        } catch (ArticleConflictException e) { Response.StatusCode = 409; ModelState.AddModelError("", e.Message); }
        catch (ArgumentException e) { ModelState.AddModelError("", e.Message); }
        catch (UnauthorizedAccessException) { return Forbid(); }
        catch (System.Collections.Generic.KeyNotFoundException) { return NotFound(); }
        return Page();
    }
}
