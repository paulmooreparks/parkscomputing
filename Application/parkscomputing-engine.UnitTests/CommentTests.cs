using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
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
using ParksComputing.Engine.Publishing;

namespace ParksComputing.Engine.UnitTests;

/// <summary>Comments (Identity/Discussions.cs, Architecture/unified-identity-design.md, step 2).</summary>
[TestClass]
public sealed class CommentTests {
    [TestMethod]
    public void MarkdownBecomesOnlyTheHtmlACommentMayHave() {
        var html = CommentRenderer.Render("Hello *there* and `code`\n\n<script>alert(1)</script>\n\n# Big\n\n![a cat](https://evil.example/cat.png)\n\n[link](https://example.com) [bad](javascript:alert(1))");
        StringAssert.Contains(html, "<em>there</em>");
        StringAssert.Contains(html, "<code>code</code>");
        Assert.IsFalse(html.Contains("<script"), html);
        StringAssert.Contains(html, "&lt;script&gt;");
        Assert.IsFalse(html.Contains("<h1"), html);
        StringAssert.Contains(html, "Big");
        Assert.IsFalse(html.Contains("<img"), html);
        Assert.IsFalse(html.Contains("evil.example"), html);
        StringAssert.Contains(html, "a cat");
        StringAssert.Contains(html, "href=\"https://example.com\"");
        StringAssert.Contains(html, "rel=\"ugc nofollow noopener noreferrer\"");
        Assert.IsFalse(html.Contains("javascript:"), html);
    }

    [TestMethod]
    public void FrontMatterGivesTheCommentStateAsTheImportMapsIt() {
        Assert.AreEqual(ArticleCommentPolicy.Open, CommentPolicies.PolicyOf(true, true));
        Assert.AreEqual(ArticleCommentPolicy.Closed, CommentPolicies.PolicyOf(true, false));
        Assert.AreEqual(ArticleCommentPolicy.Disabled, CommentPolicies.PolicyOf(false, true));
        var (title, enabled, allowed) = CommentPolicies.FromMarkdown("---\ntitle: \"A post\"\ncommentsEnabled: True\ncommentsAllowed: false\n---\nBody");
        Assert.AreEqual("A post", title); Assert.IsTrue(enabled); Assert.IsFalse(allowed);
        Assert.IsFalse(CommentPolicies.FromMarkdown("No front matter\ncommentsEnabled: true").Enabled);
    }

    [TestMethod, TestCategory("SQLServer")]
    public async Task ACommentWaitsForAModeratorAndOnlyApprovedTextIsPublic() {
        string connection = Environment.GetEnvironmentVariable("PARKSCOMPUTING_PUBLISHING_TEST_SQL");
        if (string.IsNullOrEmpty(connection)) { Assert.Inconclusive("An isolated SQL fixture is required."); }
        var parsed = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connection);
        if (parsed.InitialCatalog != "parkscomputing_publishing_tests") { Assert.Fail("Unexpected fixture database."); }
        parsed.InitialCatalog += "_comments";
        var directory = Path.Combine(Path.GetTempPath(), "pc-comments-" + Guid.NewGuid().ToString("N"));
        var content = Path.Combine(directory, "wwwroot", "content");
        Directory.CreateDirectory(content);
        File.WriteAllText(Path.Combine(content, "open-post.md"), "---\ntitle: Open post\ncommentsEnabled: true\ncommentsAllowed: true\n---\nText");
        File.WriteAllText(Path.Combine(content, "closed-post.html"), "<html><head><title>Closed post</title><meta name=\"comments-enabled\" content=\"true\"><meta name=\"comments-allowed\" content=\"false\"></head><body></body></html>");
        File.WriteAllText(Path.Combine(content, "quiet-post.md"), "---\ntitle: Quiet\n---\nText");
        using var host = new HostBuilder().ConfigureAppConfiguration(c => c.AddInMemoryCollection(new Dictionary<string, string> {
            ["Auth:ConnectionString"] = parsed.ConnectionString, ["Accounts:Enabled"] = "true",
            ["Accounts:Origin"] = "https://beta.example.test", ["Accounts:StaffEnabled"] = "true", ["Admin:HomeRoot"] = directory + "/home",
            ["Admin:EtcRoot"] = directory + "/etc", ["Admin:HistoryRoot"] = directory + "/history",
            ["Comments:MaxPerTenMinutes"] = "4", ["CommentService:ApiUrl"] = "http://unused.localhost"
        })).ConfigureWebHost(web => web.UseTestServer().UseEnvironment("Production").UseContentRoot(directory).UseWebRoot("wwwroot")
            .UseStartup<Startup>()).Build();
        try {
            using (var scope = host.Services.CreateScope()) {
                var db = scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>();
                await db.Database.EnsureDeletedAsync(); await db.Database.MigrateAsync();
            }
            async Task<string> Account(string email, string name, string role, bool verified = true) {
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
                db.AccountProfiles.Add(new SiteAccountProfile { UserId = user.Id, DisplayName = name, Version = Guid.NewGuid(), CreatedUtc = DateTime.UtcNow });
                await db.SaveChangesAsync();
                return user.Id;
            }
            var ann = await Account("ann@example.test", "<b>Ann</b>", "Member");
            var bob = await Account("bob@example.test", "Bob", "Member");
            var unverified = await Account("eve@example.test", "Eve", null, verified: false);
            var mod = await Account("mod@example.test", "Mod", "Moderator");
            var d = host.Services.GetRequiredService<Discussions>();

            // Who may comment where.
            Assert.AreEqual(403, (await d.SubmitAsync("open-post", unverified, null, "Hi", "key-eve-0001")).Status);
            Assert.AreEqual(409, (await d.SubmitAsync("closed-post", ann, null, "Hi", "key-ann-0001")).Status);
            Assert.AreEqual(404, (await d.SubmitAsync("quiet-post", ann, null, "Hi", "key-ann-0002")).Status);
            Assert.AreEqual(404, (await d.SubmitAsync("no-such-post", ann, null, "Hi", "key-ann-0003")).Status);
            Assert.AreEqual(400, (await d.SubmitAsync("open-post", ann, null, "   ", "key-ann-0004")).Status);
            Assert.AreEqual(400, (await d.SubmitAsync("open-post", ann, null, new string('x', 10_001), "key-ann-0005")).Status);

            // A comment waits: its author sees it, nobody else does.
            var first = await d.SubmitAsync("open-post", ann, null, "First *comment*", "key-ann-0006");
            Assert.AreEqual(201, first.Status);
            var again = await d.SubmitAsync("open-post", ann, null, "First *comment*", "key-ann-0006");
            Assert.AreEqual(first.Id, again.Id, "A retried submission finds the comment it made.");
            var publicView = await d.ReadAsync("open-post", null, false);
            Assert.AreEqual(0, publicView!.Comments.Count);
            Assert.AreEqual(0, publicView.Count);
            var annView = await d.ReadAsync("open-post", ann, false);
            Assert.AreEqual(1, annView!.Comments.Count);
            Assert.IsNull(annView.Comments[0].Html);
            Assert.AreEqual("pending", annView.Comments[0].PendingStatus);
            Assert.AreEqual(0, (await d.ReadAsync("open-post", bob, false))!.Comments.Count);
            Assert.AreEqual(409, (await d.SubmitAsync("open-post", bob, first.Id, "A reply too soon", "key-bob-0001")).Status, "No reply to a comment not yet public.");

            // The moderator approves the exact version they read.
            var queue = await d.QueueAsync();
            Assert.AreEqual(1, queue.Pending.Count);
            var item = queue.Pending[0];
            Assert.AreEqual("Open post", item.Title);
            StringAssert.Contains(item.Author!.Name, "<b>Ann</b>");
            Assert.AreEqual(409, (await d.DecideAsync(item.RevisionId, mod, "approve", null, Guid.NewGuid().ToString("N"))).Status);
            Assert.IsTrue((await d.DecideAsync(item.RevisionId, mod, "approve", null, item.Version)).Ok);
            publicView = await d.ReadAsync("open-post", null, false);
            Assert.AreEqual(1, publicView!.Count);
            StringAssert.Contains(publicView.Comments[0].Html, "<em>comment</em>");
            Assert.IsFalse(publicView.Comments[0].Actions.Any());
            var bobView = await d.ReadAsync("open-post", bob, false);
            CollectionAssert.AreEquivalent(new[] { "reply", "report" }, bobView!.Comments[0].Actions.ToArray());

            // An edit waits too, while the approved text stays public.
            var version = (await d.ReadAsync("open-post", ann, false))!.Comments[0].Version;
            Assert.AreEqual(409, (await d.EditAsync(first.Id!.Value, ann, "Stale edit", Guid.NewGuid().ToString("N"))).Status);
            Assert.AreEqual(404, (await d.EditAsync(first.Id!.Value, bob, "Not mine", version)).Status);
            Assert.IsTrue((await d.EditAsync(first.Id!.Value, ann, "Edited text", version)).Ok);
            publicView = await d.ReadAsync("open-post", null, false);
            StringAssert.Contains(publicView!.Comments[0].Html, "First");
            annView = await d.ReadAsync("open-post", ann, false);
            StringAssert.Contains(annView!.Comments[0].PendingHtml, "Edited text");
            queue = await d.QueueAsync();
            Assert.IsNotNull(queue.Pending.Single().PublishedHtml);
            Assert.IsTrue((await d.DecideAsync(queue.Pending[0].RevisionId, mod, "reject", "Off topic", queue.Pending[0].Version)).Ok);
            StringAssert.Contains((await d.ReadAsync("open-post", null, false))!.Comments[0].Html, "First");
            Assert.AreEqual("rejected", (await d.ReadAsync("open-post", ann, false))!.Comments[0].PendingStatus);

            // A reply, a report, and a removal that leaves the reply its context.
            var reply = await d.SubmitAsync("open-post", bob, first.Id, "A reply", "key-bob-0002");
            Assert.AreEqual(201, reply.Status);
            queue = await d.QueueAsync();
            Assert.IsTrue(queue.Pending[0].IsReply);
            Assert.IsTrue((await d.DecideAsync(queue.Pending[0].RevisionId, mod, "approve", null, queue.Pending[0].Version)).Ok);
            Assert.AreEqual(409, (await d.SubmitAsync("open-post", ann, reply.Id, "Reply to a reply", "key-ann-0007")).Status, "Replies are one level deep.");
            Assert.AreEqual(400, (await d.ReportAsync(first.Id!.Value, ann, "Mine")).Status);
            Assert.AreEqual(201, (await d.ReportAsync(first.Id!.Value, bob, "Rude")).Status);
            Assert.AreEqual(200, (await d.ReportAsync(first.Id!.Value, bob, "Rude again")).Status, "A second report from the same reader is the same report.");
            queue = await d.QueueAsync();
            Assert.AreEqual(1, queue.Reports.Count);
            Assert.IsTrue((await d.RemoveAsync(first.Id!.Value, mod, "Rude", queue.Reports[0].Version)).Ok);
            publicView = await d.ReadAsync("open-post", null, false);
            Assert.AreEqual(1, publicView!.Comments.Count, "The removed comment stays as a placeholder for its reply.");
            Assert.AreEqual("removed", publicView.Comments[0].State);
            Assert.IsNull(publicView.Comments[0].Html);
            Assert.IsNull(publicView.Comments[0].Author);
            Assert.AreEqual(1, publicView.Comments[0].Replies.Count);
            Assert.AreEqual(1, publicView.Count);
            Assert.AreEqual(0, (await d.QueueAsync()).Reports.Count, "Removing a comment settles its reports.");

            // Withdrawing takes the text away for good.
            Assert.IsTrue((await d.WithdrawAsync(reply.Id!.Value, bob)).Ok);
            Assert.AreEqual(0, (await d.ReadAsync("open-post", null, false))!.Comments.Count);
            using (var scope = host.Services.CreateScope()) {
                var db = scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>();
                Assert.IsTrue(await db.CommentRevisions.Where(r => r.CommentId == reply.Id).AllAsync(r => r.Redacted && r.Source == ""));
                Assert.IsTrue(await db.CommentDecisions.CountAsync() >= 8);
            }
            var mine = await d.MineAsync(bob);
            Assert.AreEqual("withdrawn", mine.Single().Status);

            // The limit on how much one account says at once.
            for (int i = 0; i < 4; i++) { await d.SubmitAsync("open-post", ann, null, "Busy " + i, "key-ann-busy-" + i); }
            Assert.AreEqual(429, (await d.SubmitAsync("open-post", ann, null, "One too many", "key-ann-busy-9")).Status);
        } finally {
            using (var scope = host.Services.CreateScope()) {
                await scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>().Database.EnsureDeletedAsync();
            }
            Directory.Delete(directory, true);
        }
    }
}
