using System;
using System.Net;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Hosting;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Api;

namespace ParksComputing.Engine.UnitTests;

[TestClass]
public class HealthCheckTests {
    private static Task<IHost> Server(IPAddress? remote) =>
        new HostBuilder().ConfigureWebHost(web => web.UseTestServer().Configure(app => {
            app.Use((ctx, next) => { ctx.Connection.RemoteIpAddress = remote; return next(ctx); });
            app.UseMiddleware<HealthCheck>();
            // Stands in for the host check behind it, which answers 404 to
            // any host but the site's own.
            app.Run(ctx => { ctx.Response.StatusCode = StatusCodes.Status404NotFound; return Task.CompletedTask; });
        })).StartAsync();

    [TestMethod]
    public async Task TheSiteAnswersItsHealthCheckFromInsideTheContainer() {
        using var host = await Server(IPAddress.Loopback);
        var response = await host.GetTestClient().GetAsync("http://localhost/healthz");
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.AreEqual("ok", await response.Content.ReadAsStringAsync());

        using var v6 = await Server(IPAddress.IPv6Loopback);
        Assert.AreEqual(HttpStatusCode.OK, (await v6.GetTestClient().GetAsync("http://localhost/healthz")).StatusCode);
    }

    [TestMethod]
    public async Task TheHealthCheckIsNotPartOfThePublicSite() {
        // The tunnel and the published port both reach the site from another
        // address, so these get the site's usual answer.
        using var tunnel = await Server(IPAddress.Parse("172.18.0.5"));
        Assert.AreEqual(HttpStatusCode.NotFound, (await tunnel.GetTestClient().GetAsync("http://localhost/healthz")).StatusCode);

        using var unknown = await Server(null);
        Assert.AreEqual(HttpStatusCode.NotFound, (await unknown.GetTestClient().GetAsync("http://localhost/healthz")).StatusCode);

        using var inside = await Server(IPAddress.Loopback);
        Assert.AreEqual(HttpStatusCode.NotFound, (await inside.GetTestClient().GetAsync("http://localhost/")).StatusCode);
    }

    [TestMethod]
    public void TheHealthCommandAsksTheSiteAtThePortItListensOn() {
        Assert.AreEqual(new Uri("http://127.0.0.1:8080/healthz"), HealthCheck.LocalUrl(null));
        Assert.AreEqual(new Uri("http://127.0.0.1:8080/healthz"), HealthCheck.LocalUrl(""));
        Assert.AreEqual(new Uri("http://127.0.0.1:5000/healthz"), HealthCheck.LocalUrl("http://0.0.0.0:5000"));
        Assert.AreEqual(new Uri("http://127.0.0.1:9000/healthz"), HealthCheck.LocalUrl("http://+:9000;https://+:9443"));
        Assert.AreEqual(new Uri("http://127.0.0.1:7000/healthz"), HealthCheck.LocalUrl("http://*:7000"));
        Assert.IsTrue(HealthCheck.Matches(["health"]));
        Assert.IsFalse(HealthCheck.Matches(["health", "extra"]));
        Assert.IsFalse(HealthCheck.Matches([]));
    }
}
