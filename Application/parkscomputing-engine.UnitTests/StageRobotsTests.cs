using System.Linq;
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

/// <summary>A server that is not production keeps out of search engines (Api/StageRobots.cs).</summary>
[TestClass]
public class StageRobotsTests {
    [DataTestMethod]
    [DataRow(null, false)]
    [DataRow("", false)]
    [DataRow("production", false)]
    [DataRow(" Production ", false)]
    [DataRow("staging", true)]
    [DataRow("beta", true)]
    public void OnlyAStageOtherThanProductionKeepsOut(string? stage, bool keepsOut) {
        Assert.AreEqual(keepsOut, StageRobots.IsNotProduction(stage));
    }

    [DataTestMethod]
    [DataRow(200)]
    [DataRow(301)]
    [DataRow(404)]
    public async Task EveryResponseCarriesNoindex(int status) {
        using var server = await new HostBuilder().ConfigureWebHost(web => web.UseTestServer().Configure(app => {
            app.UseMiddleware<StageRobots>();
            app.Run(async ctx => {
                ctx.Response.StatusCode = status;
                if (status == 200) { await ctx.Response.WriteAsync("A page."); }
            });
        })).StartAsync();
        using var response = await server.GetTestClient().GetAsync("/about/");
        Assert.AreEqual((HttpStatusCode)status, response.StatusCode);
        Assert.AreEqual("noindex, nofollow", response.Headers.GetValues("X-Robots-Tag").Single());
    }
}
