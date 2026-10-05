using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
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

/// <summary>Telling moderators what is waiting (Identity/ModerationNotices.cs).</summary>
[TestClass]
public sealed class ModerationNoticeTests {
    private sealed class Mail : HttpMessageHandler {
        public readonly List<(string To, string Subject, string Text)> Sent = new();
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) {
            using var doc = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken));
            var to = doc.RootElement.GetProperty("to");
            Sent.Add((to.ValueKind == JsonValueKind.Array ? to[0].GetString()! : to.GetString()!,
                doc.RootElement.GetProperty("subject").GetString()!, doc.RootElement.GetProperty("text").GetString()!));
            return new HttpResponseMessage(HttpStatusCode.OK);
        }
    }

    [TestMethod, TestCategory("SQLServer")]
    public async Task ADigestGoesOnlyWhenSomethingNewIsUnseenAndTheIntervalHasPassed() {
        string connection = Environment.GetEnvironmentVariable("PARKSCOMPUTING_PUBLISHING_TEST_SQL");
        if (string.IsNullOrEmpty(connection)) { Assert.Inconclusive("An isolated SQL fixture is required."); }
        var parsed = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connection);
        if (parsed.InitialCatalog != "parkscomputing_publishing_tests") { Assert.Fail("Unexpected fixture database."); }
        parsed.InitialCatalog += "_notices";
        var directory = Path.Combine(Path.GetTempPath(), "pc-notices-" + Guid.NewGuid().ToString("N"));
        var content = Path.Combine(directory, "wwwroot", "content");
        Directory.CreateDirectory(content);
        File.WriteAllText(Path.Combine(content, "post.md"), "---\ntitle: A Post\ncommentsEnabled: true\ncommentsAllowed: true\n---\nText");
        var mail = new Mail();
        using var host = new HostBuilder().ConfigureAppConfiguration(c => c.AddInMemoryCollection(new Dictionary<string, string> {
            ["Auth:ConnectionString"] = parsed.ConnectionString, ["Accounts:Enabled"] = "true", ["Comments:Enabled"] = "true",
            ["Accounts:Origin"] = "https://beta.example.test", ["Accounts:StaffEnabled"] = "true", ["Admin:HomeRoot"] = directory + "/home",
            ["Admin:EtcRoot"] = directory + "/etc", ["Admin:HistoryRoot"] = directory + "/history",
            ["RESEND_API_KEY"] = "fixture", ["EMAIL_FROM"] = "site@example.test"
        })).ConfigureWebHost(web => web.UseTestServer().UseEnvironment("Production").UseContentRoot(directory).UseWebRoot("wwwroot")
            .UseStartup<Startup>().ConfigureTestServices(s => s.AddHttpClient(ResendMailer.ClientName).ConfigurePrimaryHttpMessageHandler(() => mail))).Build();
        try {
            using (var scope = host.Services.CreateScope()) {
                var db = scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>();
                await db.Database.EnsureDeletedAsync(); await db.Database.MigrateAsync();
            }
            async Task<string> Account(string email, string role) {
                using var scope = host.Services.CreateScope();
                var users = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
                var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();
                var user = new IdentityUser { UserName = Guid.NewGuid().ToString("N"), Email = email, EmailConfirmed = true };
                Assert.IsTrue((await users.CreateAsync(user)).Succeeded);
                if (!await roles.RoleExistsAsync(role)) { await roles.CreateAsync(new IdentityRole(role)); }
                await users.AddToRoleAsync(user, role);
                var db = scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>();
                db.AccountProfiles.Add(new SiteAccountProfile { UserId = user.Id, DisplayName = email, Version = Guid.NewGuid(), CreatedUtc = DateTime.UtcNow });
                await db.SaveChangesAsync();
                return user.Id;
            }
            async Task Backdate(string userId, int minutes) {
                using var scope = host.Services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>();
                await db.ModeratorNotices.Where(n => n.UserId == userId).ExecuteUpdateAsync(u => u
                    .SetProperty(n => n.LastNotifiedUtc, n => n.LastNotifiedUtc!.Value.AddMinutes(-minutes)));
            }
            var ann = await Account("ann@example.test", "Member");
            var mod = await Account("mod@example.test", "Moderator");
            var boss = await Account("boss@example.test", "SuperAdmin");
            var d = host.Services.GetRequiredService<Discussions>();
            var notices = host.Services.GetRequiredService<ModerationNotices>();

            Assert.AreEqual(0, (await notices.DueAsync()).Count, "Nothing waiting, no digest.");
            await d.SubmitAsync("post", ann, null, "A secret first comment", "key-ann-00001");
            Assert.AreEqual(1, (await notices.CountAsync()).Total);

            // Each moderator, and no one else, is due one; it names the article, not the comment.
            Assert.AreEqual(2, await notices.SendDueAsync());
            CollectionAssert.AreEquivalent(new[] { "mod@example.test", "boss@example.test" }, mail.Sent.Select(m => m.To).ToArray());
            var digest = mail.Sent[0];
            StringAssert.Contains(digest.Subject, "1 comment waiting for review");
            StringAssert.Contains(digest.Text, "A Post: 1 comment or edit waiting");
            StringAssert.Contains(digest.Text, "https://beta.example.test/moderation");
            Assert.IsFalse(digest.Text.Contains("secret"), "A digest never carries a comment's text.");

            // Nothing new since: nothing more.
            Assert.AreEqual(0, (await notices.DueAsync()).Count);
            // Something new, but within the interval: not yet.
            await d.SubmitAsync("post", ann, null, "A second", "key-ann-00002");
            Assert.AreEqual(0, (await notices.DueAsync()).Count);
            // Once the interval has passed, it goes.
            await Backdate(mod, 31); await Backdate(boss, 31);
            Assert.AreEqual(2, (await notices.DueAsync()).Count);
            // A moderator who has opened the queue since has seen it.
            await notices.ViewedAsync(mod);
            Assert.AreEqual(boss, (await notices.DueAsync()).Single().UserId);
            // Off means off; an hour means an hour.
            Assert.IsTrue(await notices.SetIntervalAsync(boss, 0));
            Assert.AreEqual(0, (await notices.DueAsync()).Count);
            Assert.IsFalse(await notices.SetIntervalAsync(boss, 7), "Only the offered choices.");
            Assert.IsTrue(await notices.SetIntervalAsync(boss, 60));
            Assert.AreEqual(0, (await notices.DueAsync()).Count, "31 minutes is not yet an hour.");
            await Backdate(boss, 30);
            Assert.AreEqual(1, (await notices.DueAsync()).Count);
            Assert.AreEqual(ModerationNotices.DefaultInterval, await notices.IntervalAsync(ann), "Anyone without a choice has the default.");
        } finally {
            using (var scope = host.Services.CreateScope()) {
                await scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>().Database.EnsureDeletedAsync();
            }
            Directory.Delete(directory, true);
        }
    }
}
