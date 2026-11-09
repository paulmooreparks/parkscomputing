using System;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;

using Microsoft.AspNetCore.Http;

namespace ParksComputing.Engine.Api;

/// <summary>
/// The container's health check (the Dockerfile's HEALTHCHECK). The image has
/// no curl, so the engine checks itself: "dotnet ParksComputing.Engine.dll
/// health" asks the running site for /healthz over the loopback address and
/// exits 0 when the site answers.
///
/// /healthz answers only a request from the loopback address, so it is not
/// part of the public site, and it answers before the host check in
/// EditOriginGate, which would give a request for "localhost" a 404. It says
/// that the site's process is serving requests and nothing more. A database
/// that is down does not make the site unhealthy, since restarting the site
/// would not bring the database back and the public pages do not need it.
/// </summary>
public sealed class HealthCheck {
    public const string Path = "/healthz";
    public const string Command = "health";

    private readonly RequestDelegate _next;

    public HealthCheck(RequestDelegate next) { _next = next; }

    public Task InvokeAsync(HttpContext ctx) {
        if (ctx.Request.Path.Equals(Path, StringComparison.OrdinalIgnoreCase) &&
            ctx.Connection.RemoteIpAddress is { } remote && IPAddress.IsLoopback(remote)) {
            ctx.Response.StatusCode = StatusCodes.Status200OK;
            ctx.Response.ContentType = "text/plain";
            ctx.Response.Headers.CacheControl = "no-store";
            return ctx.Response.WriteAsync("ok");
        }
        return _next(ctx);
    }

    public static bool Matches(string[] args) => args.Length == 1 && args[0] == Command;

    /// <summary>The health subcommand: 0 when the site answers /healthz, 1 otherwise.</summary>
    public static int Run() {
        try {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
            using var response = client.GetAsync(LocalUrl(Environment.GetEnvironmentVariable("ASPNETCORE_URLS"))).GetAwaiter().GetResult();
            return response.IsSuccessStatusCode ? 0 : 1;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or UriFormatException) {
            Console.Error.WriteLine("health: " + e.Message);
            return 1;
        }
    }

    /// <summary>
    /// The /healthz address on the loopback interface, at the port the site
    /// listens on: the first address in ASPNETCORE_URLS, or 8080, which is
    /// what Program uses when that is not set.
    /// </summary>
    public static Uri LocalUrl(string? urls) {
        var first = (urls ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries) switch {
            { Length: > 0 } list => list[0],
            _ => "http://0.0.0.0:8080"
        };
        // Kestrel accepts "*" and "+" as the host, which Uri does not.
        var parsed = new Uri(first.Replace("://*", "://localhost").Replace("://+", "://localhost"));
        return new UriBuilder("http", "127.0.0.1", parsed.Port, Path).Uri;
    }
}
