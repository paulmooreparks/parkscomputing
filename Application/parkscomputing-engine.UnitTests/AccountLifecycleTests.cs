using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.UnitTests;

/// <summary>Deleting, exporting and housekeeping accounts
/// (Identity/AccountLifecycle.cs), and the legal documents' versions
/// (Identity/PolicyDocuments.cs).</summary>
[TestClass]
public sealed class AccountLifecycleTests {
    [TestMethod]
    public void AnEmailLimitBucketEndsWithItsHourOrDay() {
        Assert.AreEqual(new DateTime(2026, 10, 5, 4, 0, 0, DateTimeKind.Utc), AccountLifecycle.BucketEnd("email:2026100503:ABC"));
        Assert.AreEqual(new DateTime(2026, 10, 6, 0, 0, 0, DateTimeKind.Utc), AccountLifecycle.BucketEnd("global:20261005"));
        Assert.IsNull(AccountLifecycle.BucketEnd("nonsense"));
    }

    [TestMethod]
    public void ADocumentGivesItsTitleAndVersion() {
        var (title, version) = PolicyDocuments.FrontMatter("---\ntitle: Privacy policy\npolicyVersion: 2026-10-05\n---\nBody");
        Assert.AreEqual("Privacy policy", title); Assert.AreEqual("2026-10-05", version);
        Assert.IsNull(PolicyDocuments.FrontMatter("No front matter").Version);
    }

    [TestMethod]
    public void TheApplicationShipsBothDocuments() {
        var dir = AppContext.BaseDirectory;
        foreach (var slug in new[] { "privacy", "terms" }) {
            var file = Path.Combine(dir, "Legal", slug + ".md");
            Assert.IsTrue(File.Exists(file), file + " is missing from the build.");
            Assert.IsNotNull(PolicyDocuments.FrontMatter(File.ReadAllText(file)).Version, slug + " has no policyVersion.");
        }
    }

    [TestMethod, TestCategory("SQLServer")]
    public async Task DeletingAnAccountLeavesNothingOfItsButPlaceholders() {
        string connection = Environment.GetEnvironmentVariable("PARKSCOMPUTING_PUBLISHING_TEST_SQL");
        if (string.IsNullOrEmpty(connection)) { Assert.Inconclusive("An isolated SQL fixture is required."); }
        var parsed = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connection);
        if (parsed.InitialCatalog != "parkscomputing_publishing_tests") { Assert.Fail("Unexpected fixture database."); }
        parsed.InitialCatalog += "_lifecycle";
        var directory = Path.Combine(Path.GetTempPath(), "pc-lifecycle-" + Guid.NewGuid().ToString("N"));
        var content = Path.Combine(directory, "wwwroot", "content");
        Directory.CreateDirectory(content);
        File.WriteAllText(Path.Combine(content, "post.md"), "---\ntitle: Post\ncommentsEnabled: true\ncommentsAllowed: true\n---\nText");
        using var host = new HostBuilder().ConfigureAppConfiguration(c => c.AddInMemoryCollection(new Dictionary<string, string> {
            ["Auth:ConnectionString"] = parsed.ConnectionString, ["Accounts:Enabled"] = "true",
            ["Accounts:Origin"] = "https://beta.example.test", ["Accounts:StaffEnabled"] = "true", ["Admin:HomeRoot"] = directory + "/home",
            ["Admin:EtcRoot"] = directory + "/etc", ["Admin:HistoryRoot"] = directory + "/history"
        })).ConfigureWebHost(web => web.UseTestServer().UseEnvironment("Production").UseContentRoot(directory).UseWebRoot("wwwroot")
            .UseStartup<Startup>()).Build();
        try {
            using (var scope = host.Services.CreateScope()) {
                var db = scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>();
                await db.Database.EnsureDeletedAsync(); await db.Database.MigrateAsync();
            }
            async Task<string> Account(string email, string role, bool verified = true, DateTime? created = null) {
                using var scope = host.Services.CreateScope();
                var users = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
                var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();
                var user = new IdentityUser { UserName = Guid.NewGuid().ToString("N"), Email = email, EmailConfirmed = verified };
                Assert.IsTrue((await users.CreateAsync(user)).Succeeded);
                if (role is not null) {
                    if (!await roles.RoleExistsAsync(role)) { await roles.CreateAsync(new IdentityRole(role)); }
                    await users.AddToRoleAsync(user, role);
                }
                var db = scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>();
                db.AccountProfiles.Add(new SiteAccountProfile { UserId = user.Id, DisplayName = email, Version = Guid.NewGuid(), CreatedUtc = created ?? DateTime.UtcNow });
                await db.SaveChangesAsync();
                return user.Id;
            }
            var ann = await Account("ann@example.test", "Member");
            var bob = await Account("bob@example.test", "Member");
            var mod = await Account("mod@example.test", "Moderator");
            var d = host.Services.GetRequiredService<Discussions>();
            var life = host.Services.GetRequiredService<AccountLifecycle>();

            var first = await d.SubmitAsync("post", ann, null, "Ann's comment", "key-ann-00001");
            var q = await d.QueueAsync();
            await d.DecideAsync(q.Pending[0].RevisionId, mod, "approve", null, q.Pending[0].Version);
            var reply = await d.SubmitAsync("post", bob, first.Id, "Bob's reply", "key-bob-00001");
            q = await d.QueueAsync();
            await d.DecideAsync(q.Pending[0].RevisionId, mod, "approve", null, q.Pending[0].Version);
            await d.ReportAsync(reply.Id!.Value, ann, "Ann reports Bob");
            await host.Services.GetRequiredService<AccountPins>().SetAsync(ann, new[] { new Pin("about", null, "About", null, false) });

            // The export holds what the account has.
            var export = JsonSerializer.Serialize(await life.ExportAsync(ann), new JsonSerializerOptions(JsonSerializerDefaults.Web) {
                Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
            StringAssert.Contains(export, "ann@example.test");
            StringAssert.Contains(export, "Ann's comment");
            StringAssert.Contains(export, "Ann reports Bob");
            StringAssert.Contains(export, "\"about\"");

            // Staff are deleted from the host, not a browser.
            Assert.IsNotNull(await life.DeletionRefusalAsync(mod));
            Assert.IsFalse(await life.ConfirmDeletionAsync(mod, "x"));

            // Deleting Ann: her text goes, Bob's reply keeps its placeholder.
            Assert.IsTrue(await life.DeleteAsync(ann));
            using (var scope = host.Services.CreateScope()) {
                var db = scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>();
                Assert.IsFalse(await db.Users.AnyAsync(u => u.Id == ann));
                Assert.IsFalse(await db.AccountProfiles.AnyAsync(p => p.UserId == ann));
                Assert.IsFalse(await db.AccountPins.AnyAsync(p => p.UserId == ann));
                Assert.IsFalse(await db.CommentReports.AnyAsync(r => r.ReporterId == ann));
                var c = await db.Comments.SingleAsync(x => x.Id == first.Id);
                Assert.IsNull(c.AuthorId); Assert.AreEqual(CommentState.Withdrawn, c.State);
                Assert.IsTrue(await db.CommentRevisions.Where(r => r.CommentId == first.Id).AllAsync(r => r.Redacted && r.Source == ""));
            }
            var view = await d.ReadAsync("post", null, false);
            Assert.AreEqual("withdrawn", view!.Comments.Single().State);
            Assert.IsNull(view.Comments[0].Author);
            StringAssert.Contains(view.Comments[0].Replies.Single().Html, "Bob's reply");

            // Housekeeping: an old unverified sign-up and stale records go; a new one stays.
            var stale = await Account("old@example.test", null, verified: false, created: DateTime.UtcNow.AddDays(-8));
            var fresh = await Account("new@example.test", null, verified: false);
            using (var scope = host.Services.CreateScope()) {
                var db = scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>();
                db.EmailBudgets.Add(new SiteEmailBudget { Bucket = "email:" + DateTime.UtcNow.AddHours(-3).ToString("yyyyMMddHH") + ":X", Count = 1 });
                db.EmailBudgets.Add(new SiteEmailBudget { Bucket = "email:" + DateTime.UtcNow.ToString("yyyyMMddHH") + ":Y", Count = 1 });
                await db.SaveChangesAsync();
            }
            await life.HousekeepAsync();
            using (var scope = host.Services.CreateScope()) {
                var db = scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>();
                Assert.IsFalse(await db.Users.AnyAsync(u => u.Id == stale), "An unverified sign-up older than seven days goes.");
                Assert.IsTrue(await db.Users.AnyAsync(u => u.Id == fresh), "A new one stays.");
                Assert.IsTrue(await db.Users.AnyAsync(u => u.Id == bob), "A verified member stays.");
                var buckets = await db.EmailBudgets.Select(b => b.Bucket).ToListAsync();
                Assert.IsFalse(buckets.Any(b => b.EndsWith(":X")), "A count whose hour ended over an hour ago goes.");
                Assert.IsTrue(buckets.Any(b => b.EndsWith(":Y")), "This hour's count stays.");
            }
        } finally {
            using (var scope = host.Services.CreateScope()) {
                await scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>().Database.EnsureDeletedAsync();
            }
            Directory.Delete(directory, true);
        }
    }
}
