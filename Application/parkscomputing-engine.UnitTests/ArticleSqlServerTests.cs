using System;
using System.Data.Common;
using System.Linq;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Identity;
using ParksComputing.Engine.Publishing;

namespace ParksComputing.Engine.UnitTests;

[TestClass]
public class ArticleSqlServerTests {
    [TestMethod]
    [TestCategory("SQLServer")]
    public async Task MigrationConcurrencyImmutabilityAndRollbackWorkOnSqlServer() {
        string connection = Environment.GetEnvironmentVariable("PARKSCOMPUTING_PUBLISHING_TEST_SQL");
        if (string.IsNullOrEmpty(connection)) { Assert.Inconclusive("Set PARKSCOMPUTING_PUBLISHING_TEST_SQL to an isolated SQL Server test database."); }
        var parsed = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connection);
        if (parsed.InitialCatalog != "parkscomputing_publishing_tests") { Assert.Fail("The SQL fixture only accepts the parkscomputing_publishing_tests database."); }
        var gate = new ConcurrentUpdateGate();
        var services = new ServiceCollection();
        services.Configure<IdentityOptions>(o => o.Stores.SchemaVersion = IdentitySchemaVersions.Version3);
        services.AddDbContextFactory<SiteIdentityDbContext>(options => options
            .UseSqlServer(connection, sql => sql.EnableRetryOnFailure()).AddInterceptors(gate));
        using var provider = services.BuildServiceProvider();
        var factory = provider.GetRequiredService<IDbContextFactory<SiteIdentityDbContext>>();
        await using (var db = await factory.CreateDbContextAsync()) {
            await db.Database.MigrateAsync();
            Assert.IsFalse(db.Database.HasPendingModelChanges());
            db.Users.Add(new IdentityUser { Id = "operator", UserName = "operator", EmailConfirmed = true, SecurityStamp = "fixture-stamp", Email = "operator@example.test", LockoutEnabled = true });
            db.Roles.Add(new IdentityRole { Id = "admin-role", Name = "Admin" });
            db.UserRoles.Add(new IdentityUserRole<string> { UserId = "operator", RoleId = "admin-role" });
            await db.SaveChangesAsync();
        }
        var sessions = new DurableSessions(factory, TimeProvider.System);
        var sid = await sessions.CreateAsync(new IdentityUser { Id = "operator" }, AdminSessions.EmailLink);
        var principal = new ClaimsPrincipal(new ClaimsIdentity(new[] {
            new Claim(ClaimTypes.NameIdentifier, "operator"), new Claim(AdminSessions.SessionClaim, sid)
        }, "test"));
        var limits = new Timeouts(30, 12, 5, 2);
        Assert.IsTrue(await sessions.ValidAsync(principal, limits, touch: true));
        Assert.IsFalse(await sessions.ConfirmedAsync(principal, limits, false));
        Assert.IsTrue(await sessions.ConfirmAsync(principal, limits));
        Assert.IsTrue(await sessions.ConfirmedAsync(principal, limits, false));
        await Task.WhenAll(sessions.ValidAsync(principal, limits, touch: true), sessions.RevokeAsync(principal));
        Assert.IsFalse(await new DurableSessions(factory, TimeProvider.System).ValidAsync(principal, limits, touch: true));
        var second = await sessions.CreateAsync(new IdentityUser { Id = "operator" }, AdminSessions.Passkey);
        var other = new ClaimsPrincipal(new ClaimsIdentity(new[] {
            new Claim(ClaimTypes.NameIdentifier, "operator"), new Claim(AdminSessions.SessionClaim, second)
        }, "test"));
        await using (var db = await factory.CreateDbContextAsync()) {
            await db.Users.Where(u => u.Id == "operator").ExecuteUpdateAsync(u =>
                u.SetProperty(x => x.LockoutEnd, (DateTimeOffset?)DateTimeOffset.UtcNow.AddHours(1)));
        }
        Assert.IsFalse(await sessions.ValidAsync(other, limits, touch: true));
        await using (var db = await factory.CreateDbContextAsync()) {
            await db.Users.Where(u => u.Id == "operator").ExecuteUpdateAsync(u => u.SetProperty(x => x.LockoutEnd, (DateTimeOffset?)null));
            await db.Users.Where(u => u.Id == "operator").ExecuteUpdateAsync(u => u.SetProperty(x => x.SecurityStamp, "replacement"));
        }
        Assert.IsFalse(await sessions.ValidAsync(other, limits));
        var links = new AccountLinks(factory, TimeProvider.System);
        var token = await links.IssueAsync("operator", AccountLinkPurpose.SignIn);
        Assert.IsTrue(await links.ValidAsync("operator", AccountLinkPurpose.SignIn, token));
        gate.Begin("[SiteAccountLinks]");
        var redemption = await Task.WhenAll(links.RedeemAsync("operator", AccountLinkPurpose.SignIn, token),
            links.RedeemAsync("operator", AccountLinkPurpose.SignIn, token));
        gate.Enabled = false;
        Assert.AreEqual(1, redemption.Count(success => success));
        var issued = await Task.WhenAll(links.IssueAsync("operator", AccountLinkPurpose.SignIn),
            links.IssueAsync("operator", AccountLinkPurpose.SignIn));
        var validLinks = await Task.WhenAll(links.ValidAsync("operator", AccountLinkPurpose.SignIn, issued[0]),
            links.ValidAsync("operator", AccountLinkPurpose.SignIn, issued[1]));
        Assert.AreEqual(1, validLinks.Count(valid => valid));
        var store = new ArticleStore(factory, new ArticleRenderer());
        var input = new DraftInput("Example", "# Original", ArticleFormat.Markdown, ArticleCommentPolicy.Open);
        var article = await store.CreateAsync("example", input, "operator", Guid.NewGuid());
        gate.Begin("[SiteArticles]");
        async Task<bool> Save(string text) {
            try { await store.SaveAsync(article.Id, article.Version, input with { Source = text }, "operator", Guid.NewGuid()); return true; }
            catch (ArticleConflictException) { return false; }
        }
        var outcomes = await Task.WhenAll(Save("First editor"), Save("Second editor"));
        gate.Enabled = false;
        Assert.AreEqual(1, outcomes.Count(won => won));
        var current = await store.FindAsync("example");
        await store.PublishAsync(current.Id, current.Version, current.HeadRevision, "operator", Guid.NewGuid());
        Assert.IsNotNull(await store.PublishedAsync("example"));

        await using (var db = await factory.CreateDbContextAsync()) {
            Assert.AreEqual(2, await db.ArticleRevisions.CountAsync());
            Assert.AreEqual(3, await db.ArticleEvents.CountAsync());
            Assert.AreEqual(3, await db.ArticleOperations.CountAsync());
            foreach (string statement in new[] {
                "UPDATE [dbo].[SiteArticleRevisions] SET [Title] = 'Rewrite history'",
                "UPDATE [dbo].[SiteArticleEvents] SET [Kind] = 'Rewrite history'",
                "UPDATE [dbo].[SiteArticleOperations] SET [RequestHash] = 'Rewrite history'",
                "DELETE FROM [dbo].[SiteArticleEvents]",
                "DELETE FROM [dbo].[SiteArticleRevisions] WHERE [Number] = 1"
            }) {
                var error = await Assert.ThrowsExceptionAsync<Microsoft.Data.SqlClient.SqlException>(() =>
                    db.Database.ExecuteSqlRawAsync(statement));
                Assert.AreEqual(51000, error.Number);
            }
            await db.GetService<IMigrator>().MigrateAsync("20260929201113_InitialIdentity");
            Assert.AreEqual(1, await db.Users.CountAsync());
            await db.Database.MigrateAsync();
            Assert.IsFalse(db.Database.HasPendingModelChanges());
            Assert.AreEqual(0, await db.Articles.CountAsync());
        }
    }

    private sealed class ConcurrentUpdateGate : DbCommandInterceptor {
        public bool Enabled { get; set; }
        private int _waiting;
        private TaskCompletionSource _bothReady = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private string _table = "[SiteArticles]";
        public void Begin(string table) {
            _table = table; _waiting = 0;
            _bothReady = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            Enabled = true;
        }
        public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default) {
            if (Enabled && command.CommandText.StartsWith("UPDATE", StringComparison.OrdinalIgnoreCase)
                && command.CommandText.Contains(_table)) {
                if (Interlocked.Increment(ref _waiting) == 2) { _bothReady.TrySetResult(); }
                await _bothReady.Task.WaitAsync(TimeSpan.FromSeconds(20), cancellationToken);
            }
            return result;
        }
    }
}
