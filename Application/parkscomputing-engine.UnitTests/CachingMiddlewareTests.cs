using System.Net;
using System.Net.Http;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Api;

namespace ParksComputing.Engine.UnitTests;

[TestClass]
public class CachingMiddlewareTests {
    private static Task<IHost> Server(bool publicHeader = false, bool setCookie = false,
        bool authenticated = false, int status = 200, string vary = "Accept-Encoding", bool useSession = false) =>
        new HostBuilder().ConfigureWebHost(web => web.UseTestServer().ConfigureServices(services => {
            services.AddDistributedMemoryCache();
            services.AddSession();
        }).Configure(app => {
            app.UseMiddleware<CachingMiddleware>();
            if (useSession) { app.UseSession(); }
            app.Run(async ctx => {
                if (useSession) { ctx.Session.SetString("example", "value"); }
                if (publicHeader) { ctx.Response.Headers.CacheControl = "public, max-age=300"; }
                if (authenticated) { ctx.User = new ClaimsPrincipal(new ClaimsIdentity("test")); }
                if (setCookie) {
                    ctx.Response.OnStarting(() => {
                        ctx.Response.Headers.SetCookie = "session=example; HttpOnly";
                        return Task.CompletedTask;
                    });
                }
                ctx.Response.StatusCode = status;
                ctx.Response.Headers.Vary = vary;
                if (status != 304) { await ctx.Response.WriteAsync("The endpoint started its response."); }
            });
        })).StartAsync();

    [TestMethod]
    public async Task HeadersAreAppliedBeforeTheEndpointStartsItsResponse() {
        using var server = await Server();
        using var response = await server.GetTestClient().GetAsync("/api/content/article");
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.IsTrue(response.Headers.CacheControl.Public);
        CollectionAssert.IsSubsetOf(new[] { "Accept-Encoding", "Accept", "Authorization", "Cookie" },
            new System.Collections.Generic.List<string>(response.Headers.Vary));
    }

    [DataTestMethod]
    [DataRow("/account")]
    [DataRow("/account/links")]
    [DataRow("/admin")]
    [DataRow("/api/admin")]
    [DataRow("/API/ADMIN/fs/file")]
    public async Task PrivateRoutesOverrideAnAccidentalPublicPolicy(string path) {
        using var server = await Server(publicHeader: true);
        using var response = await server.GetTestClient().GetAsync(path);
        Assert.IsTrue(response.Headers.CacheControl.NoStore);
        Assert.IsFalse(response.Headers.CacheControl.Public);
    }

    [DataTestMethod]
    [DataRow("Cookie", "expired-session=example")]
    [DataRow("Authorization", "Bearer example")]
    public async Task PersonalizedContentNeverUsesThePublicCache(string header, string value) {
        using var server = await Server(publicHeader: true);
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/content/article");
        request.Headers.TryAddWithoutValidation(header, value);
        using var response = await server.GetTestClient().SendAsync(request);
        Assert.IsTrue(response.Headers.CacheControl.NoStore);
    }

    [TestMethod]
    public async Task AResponseThatSetsACookieIsNotPubliclyCached() {
        using var server = await Server(setCookie: true);
        using var response = await server.GetTestClient().GetAsync("/api/content/article");
        Assert.IsTrue(response.Headers.CacheControl.NoStore);
    }

    [TestMethod]
    public async Task SimilarPrefixesDoNotSelectUnrelatedRoutes() {
        using var server = await Server();
        using var response = await server.GetTestClient().GetAsync("/api/contentious");
        Assert.IsNull(response.Headers.CacheControl);
    }

    [TestMethod]
    public async Task AuthenticatedContentIsPrivateEvenWithoutACookieHeader() {
        using var server = await Server(authenticated: true);
        using var response = await server.GetTestClient().GetAsync("/api/content/article");
        Assert.IsTrue(response.Headers.CacheControl.NoStore);
    }

    [TestMethod]
    public async Task NotModifiedResponsesRetainTheSameCacheDimensions() {
        using var server = await Server(status: 304);
        using var response = await server.GetTestClient().GetAsync("/api/content/article");
        Assert.IsTrue(response.Headers.CacheControl.Public);
        Assert.IsTrue(response.Headers.Vary.Contains("Cookie"));
    }

    [TestMethod]
    public async Task WildcardVaryIsPreserved() {
        using var server = await Server(vary: "*");
        using var response = await server.GetTestClient().GetAsync("/api/content/article");
        CollectionAssert.AreEqual(new[] { "*" }, new System.Collections.Generic.List<string>(response.Headers.Vary));
    }

    [TestMethod]
    public async Task SessionMiddlewareCannotAddACookieAfterTheCacheDecision() {
        using var server = await Server(useSession: true, publicHeader: true);
        using var response = await server.GetTestClient().GetAsync("/api/content/article");
        Assert.IsTrue(response.Headers.Contains("Set-Cookie"));
        Assert.IsTrue(response.Headers.CacheControl.NoStore);
    }
}
