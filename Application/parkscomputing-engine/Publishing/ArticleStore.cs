using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.Publishing;

/// <summary>
/// Internal publishing persistence. The host importer is its initial caller.
/// Browser controllers must additionally enforce session elevation and CSRF.
/// Each mutation checks live account roles and commits with its audit receipt.
/// </summary>
internal sealed class ArticleStore {
    private static readonly Regex SlugPattern = new("^[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*$", RegexOptions.Compiled);
    private readonly IDbContextFactory<SiteIdentityDbContext> _contexts;
    private readonly ArticleRenderer _renderer;
    public ArticleStore(IDbContextFactory<SiteIdentityDbContext> contexts, ArticleRenderer renderer) {
        _contexts = contexts; _renderer = renderer;
    }

    internal static string NormalizeSlug(string slug) {
        if (string.IsNullOrEmpty(slug) || slug.Length > 400 || !SlugPattern.IsMatch(slug)) {
            throw new ArgumentException("An article path must contain plain names separated by slashes.");
        }
        return slug.ToLowerInvariant();
    }

    internal static string Hash(string text) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));

    private static void Validate(DraftInput input) {
        if (string.IsNullOrWhiteSpace(input.Title) || input.Title.Length > 300) { throw new ArgumentException("An article title is required and must be at most 300 characters."); }
        if (input.Source is null || Encoding.UTF8.GetByteCount(input.Source) > 2 * 1024 * 1024) { throw new ArgumentException("Article source must be at most 2 MB."); }
        if (!Enum.IsDefined(input.Format) || !Enum.IsDefined(input.CommentPolicy)) { throw new ArgumentException("Invalid article settings."); }
    }

    private static async Task RequireWriterAsync(SiteIdentityDbContext db, string actor, bool trusted, CancellationToken ct) {
        var now = DateTimeOffset.UtcNow;
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == actor, ct);
        bool active = user is not null && user.EmailConfirmed
            && !await db.AccountProfiles.AnyAsync(p => p.UserId == actor && p.SuspendedUtc != null, ct)
            && (!user.LockoutEnabled || user.LockoutEnd is null || user.LockoutEnd <= now);
        bool allowed = await (from ur in db.UserRoles join r in db.Roles on ur.RoleId equals r.Id
                             where ur.UserId == actor && (r.Name == "SuperAdmin" || (!trusted && r.Name == AdminOptions.Role))
                             select ur).AnyAsync(ct);
        if (!active || !allowed) { throw new UnauthorizedAccessException("Article editing is not permitted for this account."); }
    }

    private static async Task<ArticleState> StateAsync(SiteIdentityDbContext db, SiteArticle article, CancellationToken ct) {
        int? published = await db.ArticlePublications.Where(p => p.ArticleId == article.Id)
            .Select(p => (int?)p.RevisionNumber).SingleOrDefaultAsync(ct);
        return new(article.Id, article.Slug, article.Version, article.HeadRevision, published, article.Trust);
    }

    public async Task<ArticleState?> FindAsync(string slug, CancellationToken ct = default) {
        slug = NormalizeSlug(slug);
        await using var db = await _contexts.CreateDbContextAsync(ct);
        var article = await (from alias in db.ArticleAliases join a in db.Articles on alias.ArticleId equals a.Id
                             where alias.Slug == slug select a).AsNoTracking().SingleOrDefaultAsync(ct);
        return article is null ? null : await StateAsync(db, article, ct);
    }

    public async Task<ArticleSource?> SourceAsync(Guid id, int? number, string actor, CancellationToken ct = default) {
        await using var db = await _contexts.CreateDbContextAsync(ct);
        await RequireWriterAsync(db, actor, false, ct);
        var article = await db.Articles.AsNoTracking().SingleOrDefaultAsync(a => a.Id == id, ct);
        if (article is null) { return null; }
        await RequireWriterAsync(db, actor, article.Trust == ArticleTrust.TrustedExecutable, ct);
        int revision = number ?? article.HeadRevision;
        var source = await db.ArticleRevisions.AsNoTracking().SingleOrDefaultAsync(r => r.ArticleId == id && r.Number == revision, ct);
        return source is null ? null : new(await StateAsync(db, article, ct), source.Number, source.Title, source.Source, source.Format, source.CommentPolicy);
    }

    public async Task<PublishedArticle?> PublishedAsync(string slug, CancellationToken ct = default) {
        slug = NormalizeSlug(slug);
        await using var db = await _contexts.CreateDbContextAsync(ct);
        return await (from alias in db.ArticleAliases
                      join a in db.Articles on alias.ArticleId equals a.Id
                      join p in db.ArticlePublications on a.Id equals p.ArticleId
                      join r in db.ArticleRevisions on new { p.ArticleId, Number = p.RevisionNumber } equals new { r.ArticleId, r.Number }
                      where alias.Slug == slug
                      select new PublishedArticle(a.Id, a.Slug, r.Number, r.Title, p.BodyHtml, r.CommentPolicy, a.Trust, p.RenderPolicy))
            .SingleOrDefaultAsync(ct);
    }

    private async Task<T> MutateAsync<T>(string actor, Guid operation, object request,
        Func<SiteIdentityDbContext, Task<T>> change, CancellationToken ct) {
        if (operation == Guid.Empty || string.IsNullOrWhiteSpace(actor)) { throw new ArgumentException("An actor and operation ID are required."); }
        string fingerprint = Hash(JsonSerializer.Serialize(request));
        await using var strategyContext = await _contexts.CreateDbContextAsync(ct);
        var strategy = strategyContext.Database.CreateExecutionStrategy();
        try {
            return await strategy.ExecuteAsync(async () => {
                // Fresh tracking state on every retry. A committed receipt also resolves
                // a lost commit acknowledgement without repeating publication or import.
                await using var db = await _contexts.CreateDbContextAsync(ct);
                await using var transaction = await db.Database.BeginTransactionAsync(ct);
                await RequireWriterAsync(db, actor, false, ct);
                var previous = await db.ArticleOperations.AsNoTracking().SingleOrDefaultAsync(x => x.Id == operation, ct);
                if (previous is not null) {
                    if (previous.ActorId != actor || previous.RequestHash != fingerprint) { throw new ArgumentException("That operation ID was already used for another request."); }
                    return JsonSerializer.Deserialize<T>(previous.ResultJson)!;
                }
                T result = await change(db);
                db.ArticleOperations.Add(new SiteArticleOperation {
                    Id = operation, ActorId = actor, RequestHash = fingerprint,
                    ResultJson = JsonSerializer.Serialize(result), CreatedUtc = DateTimeOffset.UtcNow
                });
                // Claim every existing aggregate version before inserting revisions.
                // Do not depend on EF's ordering of UPDATE and INSERT statements.
                db.ChangeTracker.DetectChanges();
                foreach (var entry in db.ChangeTracker.Entries<SiteArticle>()
                    .Where(e => e.State == EntityState.Modified).OrderBy(e => e.Entity.Id).ToArray()) {
                    var a = entry.Entity;
                    Guid expected = entry.OriginalValues.GetValue<Guid>(nameof(SiteArticle.Version));
                    int affected = await db.Articles.Where(x => x.Id == a.Id && x.Version == expected)
                        .ExecuteUpdateAsync(set => set.SetProperty(x => x.Version, a.Version)
                            .SetProperty(x => x.HeadRevision, a.HeadRevision).SetProperty(x => x.Slug, a.Slug)
                            .SetProperty(x => x.Trust, a.Trust), ct);
                    if (affected != 1) { throw new ConcurrentArticleWrite(a.Id); }
                    entry.State = EntityState.Unchanged;
                }
                await db.SaveChangesAsync(ct);
                await transaction.CommitAsync(ct);
                return result;
            });
        }
        catch (ConcurrentArticleWrite conflict) {
            await using var db = await _contexts.CreateDbContextAsync(ct);
            var article = await db.Articles.AsNoTracking().SingleAsync(a => a.Id == conflict.ArticleId, ct);
            throw new ArticleConflictException(await StateAsync(db, article, ct));
        }
        catch (DbUpdateException) {
            // Two identical requests can reach insertion concurrently. Once the
            // losing transaction rolls back, the winning receipt is authoritative.
            await using var db = await _contexts.CreateDbContextAsync(ct);
            var receipt = await db.ArticleOperations.AsNoTracking().SingleOrDefaultAsync(x => x.Id == operation, ct);
            if (receipt is not null && receipt.ActorId == actor && receipt.RequestHash == fingerprint) {
                return JsonSerializer.Deserialize<T>(receipt.ResultJson)!;
            }
            throw;
        }
    }

    private sealed class ConcurrentArticleWrite : Exception {
        public Guid ArticleId { get; }
        public ConcurrentArticleWrite(Guid articleId) { ArticleId = articleId; }
    }

    private static SiteArticle NewArticle(SiteIdentityDbContext db, string slug) {
        var article = new SiteArticle { Id = Guid.NewGuid(), Slug = slug, Version = Guid.NewGuid(), CreatedUtc = DateTimeOffset.UtcNow };
        db.Articles.Add(article);
        db.ArticleAliases.Add(new SiteArticleAlias { Slug = slug, ArticleId = article.Id });
        return article;
    }

    private static SiteArticleRevision AddRevision(SiteIdentityDbContext db, SiteArticle article, DraftInput input, string actor, string importSources = "[]") {
        article.HeadRevision++;
        var revision = new SiteArticleRevision {
            ArticleId = article.Id, Number = article.HeadRevision, Title = input.Title.Trim(), Source = input.Source,
            SourceHash = Hash(input.Source), ImportSourcesJson = importSources, Format = input.Format, CommentPolicy = input.CommentPolicy,
            ActorId = actor, CreatedUtc = DateTimeOffset.UtcNow
        };
        db.ArticleRevisions.Add(revision);
        return revision;
    }

    private static void Audit(SiteIdentityDbContext db, SiteArticle article, Guid before, string actor, Guid operation, string kind, int? revision = null) {
        article.Version = Guid.NewGuid();
        db.ArticleEvents.Add(new SiteArticleEvent {
            Id = Guid.NewGuid(), ArticleId = article.Id, ActorId = actor, OperationId = operation,
            Kind = kind, RevisionNumber = revision, BeforeVersion = before, AfterVersion = article.Version, CreatedUtc = DateTimeOffset.UtcNow
        });
    }

    private static async Task<SiteArticle> CurrentAsync(SiteIdentityDbContext db, Guid id, Guid expected, string actor, CancellationToken ct) {
        var article = await db.Articles.SingleOrDefaultAsync(a => a.Id == id, ct) ?? throw new KeyNotFoundException("Article not found.");
        await RequireWriterAsync(db, actor, article.Trust == ArticleTrust.TrustedExecutable, ct);
        if (article.Version != expected) { throw new ArticleConflictException(await StateAsync(db, article, ct)); }
        return article;
    }

    public Task<ArticleState> CreateAsync(string slug, DraftInput input, string actor, Guid operation, CancellationToken ct = default) {
        slug = NormalizeSlug(slug); Validate(input);
        return MutateAsync(actor, operation, new { Action = "create", Slug = slug, Input = input }, async db => {
            if (await db.ArticleAliases.AnyAsync(a => a.Slug == slug, ct)) { throw new ArgumentException("That article path is already in use."); }
            var article = NewArticle(db, slug);
            AddRevision(db, article, input, actor);
            Audit(db, article, Guid.Empty, actor, operation, "create", article.HeadRevision);
            return new ArticleState(article.Id, slug, article.Version, article.HeadRevision, null, article.Trust);
        }, ct);
    }

    public Task<ArticleState> SaveAsync(Guid id, Guid expected, DraftInput input, string actor, Guid operation, CancellationToken ct = default) {
        Validate(input);
        return MutateAsync(actor, operation, new { Action = "save", Id = id, Expected = expected, Input = input }, async db => {
            var article = await CurrentAsync(db, id, expected, actor, ct);
            AddRevision(db, article, input, actor);
            Audit(db, article, expected, actor, operation, "save-draft", article.HeadRevision);
            return await StateAsync(db, article, ct);
        }, ct);
    }

    private async Task SelectPublicationAsync(SiteIdentityDbContext db, SiteArticle article, SiteArticleRevision revision, CancellationToken ct) {
        var rendered = _renderer.Render(revision.Source, revision.Format, article.Trust);
        var publication = await db.ArticlePublications.SingleOrDefaultAsync(p => p.ArticleId == article.Id, ct);
        if (publication is null) {
            publication = new SiteArticlePublication { ArticleId = article.Id };
            db.ArticlePublications.Add(publication);
        }
        publication.RevisionNumber = revision.Number;
        publication.BodyHtml = rendered.Body;
        publication.RenderPolicy = rendered.Policy;
        publication.PublishedUtc = DateTimeOffset.UtcNow;
    }

    public Task<ArticleState> PublishAsync(Guid id, Guid expected, int revision, string actor, Guid operation, CancellationToken ct = default) =>
        MutateAsync(actor, operation, new { Action = "publish", Id = id, Expected = expected, Revision = revision }, async db => {
            var article = await CurrentAsync(db, id, expected, actor, ct);
            if (article.HeadRevision != revision) { throw new ArgumentException("Publish the current draft, or restore an older revision first."); }
            var source = await db.ArticleRevisions.SingleAsync(r => r.ArticleId == id && r.Number == revision, ct);
            await SelectPublicationAsync(db, article, source, ct);
            Audit(db, article, expected, actor, operation, "publish", revision);
            return new ArticleState(id, article.Slug, article.Version, article.HeadRevision, revision, article.Trust);
        }, ct);

    public Task<ArticleState> UnpublishAsync(Guid id, Guid expected, string actor, Guid operation, CancellationToken ct = default) =>
        MutateAsync(actor, operation, new { Action = "unpublish", Id = id, Expected = expected }, async db => {
            var article = await CurrentAsync(db, id, expected, actor, ct);
            var publication = await db.ArticlePublications.SingleOrDefaultAsync(p => p.ArticleId == id, ct);
            if (publication is not null) { db.ArticlePublications.Remove(publication); }
            Audit(db, article, expected, actor, operation, "unpublish");
            return new ArticleState(id, article.Slug, article.Version, article.HeadRevision, null, article.Trust);
        }, ct);

    public Task<ArticleState> RestoreAsync(Guid id, Guid expected, int number, string actor, Guid operation, CancellationToken ct = default) =>
        MutateAsync(actor, operation, new { Action = "restore", Id = id, Expected = expected, Number = number }, async db => {
            var article = await CurrentAsync(db, id, expected, actor, ct);
            var old = await db.ArticleRevisions.SingleOrDefaultAsync(r => r.ArticleId == id && r.Number == number, ct)
                ?? throw new KeyNotFoundException("Revision not found.");
            var revision = AddRevision(db, article, new(old.Title, old.Source, old.Format, old.CommentPolicy), actor);
            await SelectPublicationAsync(db, article, revision, ct);
            Audit(db, article, expected, actor, operation, "restore-and-publish", revision.Number);
            return new ArticleState(id, article.Slug, article.Version, article.HeadRevision, revision.Number, article.Trust);
        }, ct);

    public Task<ArticleState> RenameAsync(Guid id, Guid expected, string slug, string actor, Guid operation, CancellationToken ct = default) {
        slug = NormalizeSlug(slug);
        return MutateAsync(actor, operation, new { Action = "rename", Id = id, Expected = expected, Slug = slug }, async db => {
            var article = await CurrentAsync(db, id, expected, actor, ct);
            var alias = await db.ArticleAliases.SingleOrDefaultAsync(a => a.Slug == slug, ct);
            if (alias is not null && alias.ArticleId != id) { throw new ArgumentException("That path belongs to another article."); }
            if (alias is null) { db.ArticleAliases.Add(new SiteArticleAlias { Slug = slug, ArticleId = id }); }
            article.Slug = slug;
            Audit(db, article, expected, actor, operation, "rename");
            return await StateAsync(db, article, ct);
        }, ct);
    }

    public Task<ArticleState> SetTrustAsync(Guid id, Guid expected, ArticleTrust trust, string actor, Guid operation, CancellationToken ct = default) {
        if (!Enum.IsDefined(trust)) { throw new ArgumentException("Invalid trust classification."); }
        return MutateAsync(actor, operation, new { Action = "trust", Id = id, Expected = expected, Trust = trust }, async db => {
            await RequireWriterAsync(db, actor, true, ct);
            var article = await CurrentAsync(db, id, expected, actor, ct);
            article.Trust = trust;
            var publication = await db.ArticlePublications.SingleOrDefaultAsync(p => p.ArticleId == id, ct);
            if (publication is not null) {
                var source = await db.ArticleRevisions.SingleAsync(r => r.ArticleId == id && r.Number == publication.RevisionNumber, ct);
                await SelectPublicationAsync(db, article, source, ct);
            }
            Audit(db, article, expected, actor, operation, "change-trust");
            return await StateAsync(db, article, ct);
        }, ct);
    }

    public Task<ArticleState[]> ImportAsync(ImportInput[] input, string actor, Guid operation, CancellationToken ct = default) {
        foreach (var item in input) {
            NormalizeSlug(item.Slug); Validate(item.Draft);
            if (item.Path.Length > 450 || NormalizeSlug(item.Path[..^Path.GetExtension(item.Path).Length]) != NormalizeSlug(item.Slug)
                || Path.GetExtension(item.Path).ToLowerInvariant() != (item.Draft.Format == ArticleFormat.Markdown ? ".md" : ".html")
                || !Regex.IsMatch(item.FileHash, "^[A-Fa-f0-9]{64}$")) { throw new ArgumentException("Invalid import source or hash."); }
            foreach (var alternate in item.AlternateSources) {
                if (alternate.Path.Length > 450 || !Regex.IsMatch(alternate.Hash, "^[A-Fa-f0-9]{64}$")
                    || Encoding.UTF8.GetByteCount(alternate.Source) > 2 * 1024 * 1024) { throw new ArgumentException("Invalid alternate import source."); }
            }
        }
        if (input.Select(i => NormalizeSlug(i.Slug)).Distinct().Count() != input.Length) { throw new ArgumentException("An import batch cannot contain duplicate article paths."); }
        return MutateAsync(actor, operation, new { Action = "import", Input = input }, async db => {
            var result = new List<ArticleState>();
            foreach (var item in input) {
                var slug = NormalizeSlug(item.Slug);
                var article = await (from alias in db.ArticleAliases join a in db.Articles on alias.ArticleId equals a.Id
                                     where alias.Slug == slug select a).SingleOrDefaultAsync(ct);
                var priorImport = await db.ArticleImports.SingleOrDefaultAsync(x => x.Path == item.Path, ct);
                string alternatives = JsonSerializer.Serialize(item.AlternateSources);
                bool sameSource = priorImport is not null && priorImport.FileHash.Equals(item.FileHash, StringComparison.OrdinalIgnoreCase);
                if (sameSource && priorImport!.AlternateSourcesJson == alternatives) {
                    if (article is null || priorImport.ArticleId != article.Id) { throw new ArgumentException("The import path no longer matches its article."); }
                    result.Add(await StateAsync(db, article, ct));
                    continue;
                }
                if (article is null) {
                    if (item.ExpectedVersion is not null) { throw new ArgumentException("The planned article no longer exists."); }
                    article = NewArticle(db, slug);
                }
                else {
                    await CurrentAsync(db, article.Id, item.ExpectedVersion ?? Guid.Empty, actor, ct);
                }
                if (article.Trust != ArticleTrust.Restricted) { throw new ArgumentException("Import into trusted code requires an explicit change to restricted content first."); }
                Guid before = db.Entry(article).State == EntityState.Added ? Guid.Empty : article.Version;
                DraftInput draft = item.Draft;
                if (sameSource) {
                    // An alternate file changed while the active source stayed the
                    // same. Preserve any newer manual edits in the current draft.
                    var head = await db.ArticleRevisions.SingleAsync(r => r.ArticleId == article.Id && r.Number == article.HeadRevision, ct);
                    draft = new(head.Title, head.Source, head.Format, head.CommentPolicy);
                }
                var revision = AddRevision(db, article, draft, actor, alternatives);
                if (priorImport is null) {
                    priorImport = new SiteArticleImport { Path = item.Path };
                    db.ArticleImports.Add(priorImport);
                }
                priorImport.FileHash = item.FileHash;
                priorImport.ArticleId = article.Id;
                priorImport.RevisionNumber = revision.Number;
                priorImport.AlternateSourcesJson = alternatives;
                Audit(db, article, before, actor, operation, "import-draft", revision.Number);
                result.Add(await StateAsync(db, article, ct));
            }
            return result.ToArray();
        }, ct);
    }
}
