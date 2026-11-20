using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Api;

/// <summary>
/// A server that is not production, such as staging.padmajairam.com, asks
/// search engines to leave every response out of their indexes, with
/// X-Robots-Tag: noindex, nofollow. Site:Stage says which stage a server
/// runs as; it is production when unset (MenuBuilder.DefaultStage). The
/// header is set as the response starts, so it covers static files,
/// redirects and errors as well as pages.
/// </summary>
public sealed class StageRobots {
    private readonly RequestDelegate _next;

    public StageRobots(RequestDelegate next) { _next = next; }

    /// <summary>Whether a stage is something other than production.</summary>
    public static bool IsNotProduction(string? stage) =>
        !string.IsNullOrWhiteSpace(stage) && !string.Equals(stage.Trim(), MenuBuilder.DefaultStage, StringComparison.OrdinalIgnoreCase);

    /// <summary>Whether the site's configuration asks for this middleware.</summary>
    public static bool Wanted(IConfiguration configuration) => IsNotProduction(configuration["Site:Stage"]);

    public Task InvokeAsync(HttpContext context) {
        context.Response.OnStarting(() => {
            context.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
            return Task.CompletedTask;
        });
        return _next(context);
    }
}
