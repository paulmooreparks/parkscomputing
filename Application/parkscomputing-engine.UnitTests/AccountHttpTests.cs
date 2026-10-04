using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using ParksComputing.Engine.Identity;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace ParksComputing.Engine.UnitTests;

[TestClass]
public class AccountHttpTests {
    [TestMethod]
    [TestCategory("SQLServer")]
    public async Task EmailLinkRequiresPostAntiforgeryAndDurableSignOut() {
        string connection = Environment.GetEnvironmentVariable("PARKSCOMPUTING_PUBLISHING_TEST_SQL");
        if (string.IsNullOrEmpty(connection)) { Assert.Inconclusive("An isolated SQL fixture is required."); }
        var parsed = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connection);
        if (parsed.InitialCatalog != "parkscomputing_publishing_tests") { Assert.Fail("Unexpected SQL fixture database."); }
        parsed.InitialCatalog += "_http";
        var directory = Path.Combine(Path.GetTempPath(), "pc-account-http-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(directory, "wwwroot", "content"));
        using var host = new HostBuilder()
            .ConfigureAppConfiguration(c => c.AddInMemoryCollection(new Dictionary<string, string> {
                ["Auth:ConnectionString"] = parsed.ConnectionString,
                ["Admin:EditOrigin"] = "http://edit.localhost",
                ["Admin:PublicOrigin"] = "http://public.localhost",
                ["Admin:HomeRoot"] = Path.Combine(directory, "home"),
                ["Admin:EtcRoot"] = Path.Combine(directory, "etc"),
                ["Admin:HistoryRoot"] = Path.Combine(directory, "history"),
                ["CommentService:ApiUrl"] = "http://unused.localhost",
                ["RESEND_API_KEY"] = "", ["EMAIL_FROM"] = ""
            }))
            .ConfigureWebHost(web => web.UseTestServer().UseEnvironment("Production")
                .UseContentRoot(directory).UseWebRoot("wwwroot").UseStartup<Startup>()).Build();
        try {
            string userId;
            using (var scope = host.Services.CreateScope()) {
                await scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>().Database.MigrateAsync();
                var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();
                Assert.IsTrue((await roles.CreateAsync(new IdentityRole("Admin"))).Succeeded);
                var users = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
                var user = new IdentityUser { UserName = "http@example.test", Email = "http@example.test", EmailConfirmed = true };
                Assert.IsTrue((await users.CreateAsync(user)).Succeeded);
                Assert.IsTrue((await users.AddToRoleAsync(user, "Admin")).Succeeded);
                userId = user.Id;
            }
            await host.StartAsync();
            using var client = host.GetTestClient();
            client.BaseAddress = new Uri("http://edit.localhost");
            var cookies = new Dictionary<string, string>();
            async Task<HttpResponseMessage> Send(HttpMethod method, string path, Dictionary<string, string> form = null) {
                using var request = new HttpRequestMessage(method, path);
                if (cookies.Count > 0) { request.Headers.Add("Cookie", string.Join("; ", cookies.Values)); }
                if (form is not null) { request.Content = new FormUrlEncodedContent(form); }
                var response = await client.SendAsync(request);
                if (response.Headers.TryGetValues("Set-Cookie", out var values)) {
                    foreach (string value in values) {
                        var cookie = value.Split(';')[0];
                        cookies[cookie.Split('=')[0]] = cookie;
                    }
                }
                return response;
            }
            static async Task<string> Antiforgery(HttpResponseMessage response) {
                var match = Regex.Match(await response.Content.ReadAsStringAsync(), "name=\"__RequestVerificationToken\"[^>]*value=\"([^\"]+)\"");
                Assert.IsTrue(match.Success, "The page must provide an antiforgery token.");
                return WebUtility.HtmlDecode(match.Groups[1].Value);
            }
            var links = host.Services.GetRequiredService<AccountLinks>();
            var token = await links.IssueAsync(userId, AccountLinkPurpose.SignIn);
            var path = "/admin/link?uid=" + Uri.EscapeDataString(userId) + "&token=" + Uri.EscapeDataString(token);
            using var page = await Send(HttpMethod.Get, path);
            Assert.AreEqual(HttpStatusCode.OK, page.StatusCode);
            Assert.IsTrue(page.Headers.CacheControl.NoStore);
            Assert.AreEqual("no-referrer", page.Headers.GetValues("Referrer-Policy").Single());
            Assert.IsTrue(await links.ValidAsync(userId, AccountLinkPurpose.SignIn, token));
            var form = new Dictionary<string, string> { ["Uid"] = userId, ["Token"] = token };
            using var refused = await Send(HttpMethod.Post, "/admin/link", form);
            Assert.AreEqual(HttpStatusCode.BadRequest, refused.StatusCode);
            Assert.IsTrue(await links.ValidAsync(userId, AccountLinkPurpose.SignIn, token));
            form["__RequestVerificationToken"] = await Antiforgery(page);
            using var signedIn = await Send(HttpMethod.Post, "/admin/link", form);
            Assert.AreEqual(HttpStatusCode.Redirect, signedIn.StatusCode);
            Assert.IsFalse(await links.ValidAsync(userId, AccountLinkPurpose.SignIn, token));
            using var account = await Send(HttpMethod.Get, "/admin/account");
            Assert.AreEqual(HttpStatusCode.OK, account.StatusCode);
            var oldCookie = cookies["pc-admin"];
            using var signOut = await Send(HttpMethod.Post, "/admin/signout", new Dictionary<string, string> {
                ["__RequestVerificationToken"] = await Antiforgery(account)
            });
            Assert.AreEqual(HttpStatusCode.Redirect, signOut.StatusCode);
            cookies["pc-admin"] = oldCookie;
            using var replay = await Send(HttpMethod.Get, "/admin/account");
            Assert.AreEqual(HttpStatusCode.Redirect, replay.StatusCode);
            using var emailPage = await Send(HttpMethod.Get, "/admin/signin");
            using var failedDelivery = await Send(HttpMethod.Post, "/admin/signin?handler=Email", new Dictionary<string, string> {
                ["__RequestVerificationToken"] = await Antiforgery(emailPage), ["Email"] = "http@example.test"
            });
            Assert.AreEqual(HttpStatusCode.OK, failedDelivery.StatusCode);
            using var verification = host.Services.CreateScope();
            var db = verification.ServiceProvider.GetRequiredService<SiteIdentityDbContext>();
            Assert.IsTrue((await db.SiteSessions.SingleAsync()).RevokedUtc.HasValue);
            Assert.AreEqual(2, await db.AccountLinks.CountAsync());
            Assert.AreEqual(0, await db.AccountLinks.CountAsync(l => l.SupersededUtc == null && l.ConsumedUtc == null));
        } finally {
            await host.StopAsync();
            Directory.Delete(directory, recursive: true);
        }
    }
}
