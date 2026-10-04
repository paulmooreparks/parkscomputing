using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Identity;
using ParksComputing.Engine.Publishing;

namespace ParksComputing.Engine.UnitTests;

[TestClass]
public class ArticleStoreTests {
    private string _directory;
    private ServiceProvider _services;
    private IDbContextFactory<SiteIdentityDbContext> _factory;
    private ArticleStore _store;
    private const string Admin = "admin";
    private const string Super = "super";
    private static DraftInput Draft(string text = "# Original", ArticleCommentPolicy policy = ArticleCommentPolicy.Open) =>
        new("Example", text, ArticleFormat.Markdown, policy);

    [TestInitialize]
    public async Task Initialize() {
        _directory = Path.Combine(Path.GetTempPath(), "parkscomputing-article-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_directory);
        var services = new ServiceCollection();
        services.Configure<IdentityOptions>(o => o.Stores.SchemaVersion = IdentitySchemaVersions.Version3);
        services.AddDbContextFactory<SiteIdentityDbContext>(options => options.UseSqlite("Data Source=" + Path.Combine(_directory, "articles.db")));
        _services = services.BuildServiceProvider();
        _factory = _services.GetRequiredService<IDbContextFactory<SiteIdentityDbContext>>();
        _store = new ArticleStore(_factory, new ArticleRenderer());
        await using var db = await _factory.CreateDbContextAsync();
        await db.Database.EnsureCreatedAsync();
        db.Users.AddRange(new IdentityUser { Id = Admin, UserName = Admin, EmailConfirmed = true },
            new IdentityUser { Id = Super, UserName = Super, EmailConfirmed = true },
            new IdentityUser { Id = "member", UserName = "member", EmailConfirmed = true });
        db.Roles.AddRange(new IdentityRole { Id = "admin-role", Name = "Admin" }, new IdentityRole { Id = "super-role", Name = "SuperAdmin" });
        db.UserRoles.AddRange(new IdentityUserRole<string> { UserId = Admin, RoleId = "admin-role" },
            new IdentityUserRole<string> { UserId = Super, RoleId = "super-role" });
        await db.SaveChangesAsync();
    }

    [TestCleanup]
    public void Cleanup() {
        _services?.Dispose();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (_directory is not null) { Directory.Delete(_directory, recursive: true); }
    }

    [TestMethod]
    public async Task SuspendedSuperAdminCannotReadSourceOrWriteArticles() {
        var article = await _store.CreateAsync("example", Draft(), Super, Guid.NewGuid());
        await using var db = await _factory.CreateDbContextAsync();
        db.AccountProfiles.Add(new SiteAccountProfile {
            UserId = Super, DisplayName = "Staff", Version = Guid.NewGuid(),
            CreatedUtc = DateTime.UtcNow, SuspendedUtc = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
        await Assert.ThrowsExceptionAsync<UnauthorizedAccessException>(() => _store.SourceAsync(article.Id, null, Super));
        await Assert.ThrowsExceptionAsync<UnauthorizedAccessException>(() => _store.SaveAsync(article.Id, article.Version, Draft("Denied"), Super, Guid.NewGuid()));
        Assert.AreEqual(1, await db.ArticleRevisions.CountAsync());
    }

    [TestMethod]
    public async Task DraftSavingDoesNotCreateOrReplaceAPublication() {
        var article = await _store.CreateAsync("example", Draft(), Admin, Guid.NewGuid());
        Assert.IsNull(await _store.PublishedAsync("example"));
        article = await _store.PublishAsync(article.Id, article.Version, 1, Admin, Guid.NewGuid());
        article = await _store.SaveAsync(article.Id, article.Version, Draft("# Private revision"), Admin, Guid.NewGuid());
        var published = await _store.PublishedAsync("example");
        Assert.AreEqual(1, published.Number);
        Assert.IsFalse(published.BodyHtml.Contains("Private revision"));
        Assert.AreEqual("# Private revision", (await _store.SourceAsync(article.Id, null, Admin)).Source);
    }

    [TestMethod]
    public async Task StaleEditsCannotOverwriteTheWinningRevision() {
        var original = await _store.CreateAsync("example", Draft(), Admin, Guid.NewGuid());
        var winner = await _store.SaveAsync(original.Id, original.Version, Draft("Winner"), Admin, Guid.NewGuid());
        var conflict = await Assert.ThrowsExceptionAsync<ArticleConflictException>(() =>
            _store.SaveAsync(original.Id, original.Version, Draft("Loser"), Admin, Guid.NewGuid()));
        Assert.AreEqual(winner.Version, conflict.Current.Version);
        await using var db = await _factory.CreateDbContextAsync();
        Assert.AreEqual(2, await db.ArticleRevisions.CountAsync());
        Assert.AreEqual(2, await db.ArticleEvents.CountAsync());
        Assert.AreEqual("Winner", (await _store.SourceAsync(original.Id, null, Admin)).Source);
    }

    [TestMethod]
    public async Task ReplayedWritesReturnTheOriginalReceiptWithoutAddingHistory() {
        var operation = Guid.NewGuid();
        var first = await _store.CreateAsync("example", Draft(), Admin, operation);
        var replay = await _store.CreateAsync("example", Draft(), Admin, operation);
        Assert.AreEqual(first, replay);
        await Assert.ThrowsExceptionAsync<ArgumentException>(() => _store.CreateAsync("another", Draft(), Admin, operation));
        await Assert.ThrowsExceptionAsync<ArgumentException>(() => _store.CreateAsync("example", Draft(), Super, operation));
        await using var db = await _factory.CreateDbContextAsync();
        Assert.AreEqual(1, await db.Articles.CountAsync());
        Assert.AreEqual(1, await db.ArticleEvents.CountAsync());
    }

    [TestMethod]
    public async Task RestoringPublishesANewRevisionAndPreservesHistory() {
        var article = await _store.CreateAsync("example", Draft(), Admin, Guid.NewGuid());
        article = await _store.PublishAsync(article.Id, article.Version, 1, Admin, Guid.NewGuid());
        article = await _store.SaveAsync(article.Id, article.Version, Draft("Replacement"), Admin, Guid.NewGuid());
        article = await _store.PublishAsync(article.Id, article.Version, 2, Admin, Guid.NewGuid());
        article = await _store.RestoreAsync(article.Id, article.Version, 1, Admin, Guid.NewGuid());
        Assert.AreEqual(3, article.HeadRevision);
        Assert.AreEqual(3, article.PublishedRevision);
        Assert.AreEqual("# Original", (await _store.SourceAsync(article.Id, 3, Admin)).Source);
        Assert.AreEqual("Replacement", (await _store.SourceAsync(article.Id, 2, Admin)).Source);
    }

    [TestMethod]
    public async Task RenamingRetainsAliasesAndUnpublishingHidesEveryAlias() {
        var article = await _store.CreateAsync("old-name", Draft(), Admin, Guid.NewGuid());
        article = await _store.PublishAsync(article.Id, article.Version, 1, Admin, Guid.NewGuid());
        article = await _store.RenameAsync(article.Id, article.Version, "new-name", Admin, Guid.NewGuid());
        Assert.AreEqual(article.Id, (await _store.PublishedAsync("old-name")).Id);
        Assert.AreEqual("new-name", (await _store.PublishedAsync("old-name")).Slug);
        await _store.UnpublishAsync(article.Id, article.Version, Admin, Guid.NewGuid());
        Assert.IsNull(await _store.PublishedAsync("old-name"));
        Assert.IsNull(await _store.PublishedAsync("new-name"));
        await Assert.ThrowsExceptionAsync<ArgumentException>(() => _store.CreateAsync("old-name", Draft(), Admin, Guid.NewGuid()));
    }

    [TestMethod]
    public async Task RestrictedPublishingRemovesExecutableContentAndTrustRequiresSuperAdmin() {
        var input = new DraftInput("Example", "<script>run()</script><p onclick=\"run()\" style=\"color:red\">Text</p>", ArticleFormat.Html, ArticleCommentPolicy.Disabled);
        var article = await _store.CreateAsync("example", input, Admin, Guid.NewGuid());
        article = await _store.PublishAsync(article.Id, article.Version, 1, Admin, Guid.NewGuid());
        var published = await _store.PublishedAsync("example");
        Assert.IsFalse(published.BodyHtml.Contains("script"));
        Assert.IsFalse(published.BodyHtml.Contains("onclick"));
        await Assert.ThrowsExceptionAsync<UnauthorizedAccessException>(() =>
            _store.SetTrustAsync(article.Id, article.Version, ArticleTrust.TrustedExecutable, Admin, Guid.NewGuid()));
        article = await _store.SetTrustAsync(article.Id, article.Version, ArticleTrust.TrustedExecutable, Super, Guid.NewGuid());
        Assert.IsTrue((await _store.PublishedAsync("example")).BodyHtml.Contains("<script>"));
        await Assert.ThrowsExceptionAsync<UnauthorizedAccessException>(() => _store.SourceAsync(article.Id, null, Admin));
        await Assert.ThrowsExceptionAsync<UnauthorizedAccessException>(() =>
            _store.SaveAsync(article.Id, article.Version, Draft(), Admin, Guid.NewGuid()));
        article = await _store.SetTrustAsync(article.Id, article.Version, ArticleTrust.Restricted, Super, Guid.NewGuid());
        Assert.IsFalse((await _store.PublishedAsync("example")).BodyHtml.Contains("<script>"));
    }

    [TestMethod]
    public async Task RoleRevocationAndLockoutAreCheckedOnEveryOperation() {
        await Assert.ThrowsExceptionAsync<UnauthorizedAccessException>(() => _store.CreateAsync("example", Draft(), "member", Guid.NewGuid()));
        await using (var db = await _factory.CreateDbContextAsync()) {
            var user = await db.Users.SingleAsync(u => u.Id == Admin);
            user.LockoutEnabled = true; user.LockoutEnd = DateTimeOffset.UtcNow.AddHours(1);
            await db.SaveChangesAsync();
        }
        await Assert.ThrowsExceptionAsync<UnauthorizedAccessException>(() => _store.CreateAsync("example", Draft(), Admin, Guid.NewGuid()));
        await using (var db = await _factory.CreateDbContextAsync()) {
            db.UserRoles.Remove(await db.UserRoles.SingleAsync(ur => ur.UserId == Super));
            await db.SaveChangesAsync();
        }
        await Assert.ThrowsExceptionAsync<UnauthorizedAccessException>(() => _store.CreateAsync("example", Draft(), Super, Guid.NewGuid()));
    }

    [TestMethod]
    public async Task RevisionAndAuditMutationIsRejected() {
        await _store.CreateAsync("example", Draft(), Admin, Guid.NewGuid());
        await using (var db = await _factory.CreateDbContextAsync()) {
            (await db.ArticleRevisions.SingleAsync()).Source = "Rewrite history";
            await Assert.ThrowsExceptionAsync<InvalidOperationException>(() => db.SaveChangesAsync());
        }
        await using (var db = await _factory.CreateDbContextAsync()) {
            db.ArticleEvents.Remove(await db.ArticleEvents.SingleAsync());
            await Assert.ThrowsExceptionAsync<InvalidOperationException>(() => db.SaveChangesAsync());
        }
    }

    [TestMethod]
    public async Task PublicationCannotReferenceARevisionFromAnotherArticle() {
        var first = await _store.CreateAsync("first", Draft(), Admin, Guid.NewGuid());
        var second = await _store.CreateAsync("second", Draft(), Admin, Guid.NewGuid());
        await _store.SaveAsync(second.Id, second.Version, Draft("Second revision"), Admin, Guid.NewGuid());
        await using var db = await _factory.CreateDbContextAsync();
        db.ArticlePublications.Add(new SiteArticlePublication { ArticleId = first.Id, RevisionNumber = 2 });
        await Assert.ThrowsExceptionAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [TestMethod]
    public async Task ImportPreservesIdentityAndDoesNotOverwriteManualEditsOnAnUnchangedSource() {
        var input = new ImportInput("example.md", new string('A', 64), "example", Draft(), null, Array.Empty<AlternateImportSource>());
        var first = (await _store.ImportAsync(new[] { input }, Admin, Guid.NewGuid()))[0];
        Assert.IsNull(await _store.PublishedAsync("example"));
        var edited = await _store.SaveAsync(first.Id, first.Version, Draft("Manual edit"), Admin, Guid.NewGuid());
        var repeated = (await _store.ImportAsync(new[] { input }, Admin, Guid.NewGuid()))[0];
        Assert.AreEqual(edited, repeated);
        Assert.AreEqual("Manual edit", (await _store.SourceAsync(first.Id, null, Admin)).Source);
        var updatedInput = input with { FileHash = new string('B', 64), ExpectedVersion = edited.Version, Draft = Draft("New import") };
        var updated = (await _store.ImportAsync(new[] { updatedInput }, Admin, Guid.NewGuid()))[0];
        Assert.AreEqual(first.Id, updated.Id);
        Assert.AreEqual(3, updated.HeadRevision);
    }

    [TestMethod]
    public async Task ImportBatchRollsBackEveryItemOnAConflict() {
        var current = await _store.CreateAsync("existing", Draft(), Admin, Guid.NewGuid());
        var input = new[] {
            new ImportInput("new.md", new string('A', 64), "new", Draft(), null, Array.Empty<AlternateImportSource>()),
            new ImportInput("existing.md", new string('B', 64), "existing", Draft(), Guid.NewGuid(), Array.Empty<AlternateImportSource>())
        };
        await Assert.ThrowsExceptionAsync<ArticleConflictException>(() => _store.ImportAsync(input, Admin, Guid.NewGuid()));
        Assert.IsNull(await _store.FindAsync("new"));
        Assert.AreEqual(current, await _store.FindAsync("existing"));
    }

    [TestMethod]
    public async Task ChangedAlternateSourcesAreArchivedWithoutReplacingManualDraftText() {
        var input = new ImportInput("example.md", new string('A', 64), "example", Draft(), null,
            new[] { new AlternateImportSource("example.html", new string('B', 64), "Old alternate") });
        var first = (await _store.ImportAsync(new[] { input }, Admin, Guid.NewGuid()))[0];
        var manual = await _store.SaveAsync(first.Id, first.Version, Draft("Manual draft"), Admin, Guid.NewGuid());
        input = input with { ExpectedVersion = manual.Version,
            AlternateSources = new[] { new AlternateImportSource("example.html", new string('C', 64), "New alternate") } };
        var updated = (await _store.ImportAsync(new[] { input }, Admin, Guid.NewGuid()))[0];
        Assert.AreEqual("Manual draft", (await _store.SourceAsync(updated.Id, null, Admin)).Source);
        await using var db = await _factory.CreateDbContextAsync();
        Assert.IsTrue((await db.ArticleRevisions.SingleAsync(r => r.Number == 1)).ImportSourcesJson.Contains("Old alternate"));
        Assert.IsTrue((await db.ArticleRevisions.SingleAsync(r => r.Number == 3)).ImportSourcesJson.Contains("New alternate"));
    }

    [TestMethod]
    public async Task ImportCannotInheritTrustedExecutablePermission() {
        var article = await _store.CreateAsync("example", Draft(), Super, Guid.NewGuid());
        article = await _store.SetTrustAsync(article.Id, article.Version, ArticleTrust.TrustedExecutable, Super, Guid.NewGuid());
        var input = new ImportInput("example.md", new string('A', 64), "example", Draft("Imported"), article.Version, Array.Empty<AlternateImportSource>());
        await Assert.ThrowsExceptionAsync<ArgumentException>(() => _store.ImportAsync(new[] { input }, Super, Guid.NewGuid()));
        Assert.AreEqual("# Original", (await _store.SourceAsync(article.Id, null, Super)).Source);
    }
}
