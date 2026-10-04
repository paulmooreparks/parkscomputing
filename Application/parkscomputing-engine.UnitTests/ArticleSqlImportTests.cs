using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Identity;
using ParksComputing.Engine.Publishing;

namespace ParksComputing.Engine.UnitTests;

[TestClass]
public class ArticleSqlImportTests {
    [TestMethod]
    [TestCategory("SQLImport")]
    public async Task FullContentTreeImportsAsPrivateDraftsAndReplaysWithoutDuplication() {
        string connection = Environment.GetEnvironmentVariable("PARKSCOMPUTING_PUBLISHING_TEST_SQL");
        string contentRoot = Environment.GetEnvironmentVariable("PARKSCOMPUTING_IMPORT_FIXTURE_ROOT");
        if (string.IsNullOrEmpty(connection) || string.IsNullOrEmpty(contentRoot)) { Assert.Inconclusive("The isolated SQL and content fixtures are required."); }
        var parsed = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connection);
        if (parsed.InitialCatalog != "parkscomputing_publishing_tests") { Assert.Fail("Unexpected SQL fixture database."); }
        parsed.InitialCatalog += "_import";
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDbContextFactory<SiteIdentityDbContext>(options => options.UseSqlServer(parsed.ConnectionString, sql => sql.EnableRetryOnFailure()));
        services.AddIdentityCore<IdentityUser>(options => options.Stores.SchemaVersion = IdentitySchemaVersions.Version3)
            .AddRoles<IdentityRole>().AddEntityFrameworkStores<SiteIdentityDbContext>();
        services.AddSingleton<ArticleRenderer>();
        services.AddSingleton<ArticleStore>();
        using var provider = services.BuildServiceProvider();
        var factory = provider.GetRequiredService<IDbContextFactory<SiteIdentityDbContext>>();
        await using (var db = await factory.CreateDbContextAsync()) {
            await db.Database.MigrateAsync();
            db.Users.Add(new IdentityUser { Id = "import-operator", UserName = "import-operator", EmailConfirmed = true,
                Email = "import@example.test", NormalizedEmail = "IMPORT@EXAMPLE.TEST" });
            db.Roles.Add(new IdentityRole { Id = "import-admin", Name = "Admin" });
            db.UserRoles.Add(new IdentityUserRole<string> { UserId = "import-operator", RoleId = "import-admin" });
            await db.SaveChangesAsync();
        }
        var store = provider.GetRequiredService<ArticleStore>();
        var plan = await ArticleImportPlanner.PlanAsync(contentRoot, slug => store.FindAsync(slug));
        Assert.IsTrue(plan.Articles.Length > 0);
        string planPath = Path.Combine(Path.GetTempPath(), "parkscomputing-import-plan-" + Guid.NewGuid().ToString("N") + ".json");
        File.WriteAllText(planPath, JsonSerializer.Serialize(plan));
        TextWriter output = Console.Out;
        try {
            Console.SetOut(new StringWriter());
            var args = new[] { "article-import", "--apply", planPath, "--actor", "import@example.test" };
            Assert.AreEqual(0, await ArticleImportCommand.RunAsync(provider, args));
            Assert.AreEqual(0, await ArticleImportCommand.RunAsync(provider, args));
            await using var db = await factory.CreateDbContextAsync();
            Assert.AreEqual(plan.Articles.Length, await db.Articles.CountAsync());
            Assert.AreEqual(plan.Articles.Length, await db.ArticleRevisions.CountAsync());
            Assert.AreEqual(plan.Articles.Length, await db.ArticleEvents.CountAsync());
            Assert.AreEqual(1, await db.ArticleOperations.CountAsync());
            Assert.AreEqual(0, await db.ArticlePublications.CountAsync());
            foreach (var input in plan.Articles.Where(a => a.Path.StartsWith("drafts/"))) {
                Assert.IsNull(await store.PublishedAsync(input.Slug));
            }
            var alternative = plan.Articles.FirstOrDefault(a => a.AlternateSources.Length > 0);
            if (alternative is not null) {
                var article = await store.FindAsync(alternative.Slug);
                string retained = (await db.ArticleRevisions.SingleAsync(r => r.ArticleId == article.Id)).ImportSourcesJson;
                Assert.AreEqual(alternative.AlternateSources[0].Source,
                    JsonSerializer.Deserialize<AlternateImportSource[]>(retained)[0].Source);
            }
        }
        finally {
            Console.SetOut(output);
            File.Delete(planPath);
        }
    }
}
