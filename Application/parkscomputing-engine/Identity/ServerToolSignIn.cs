using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// Tells a server tool's script that its session has ended. The server's
/// tools (the admin mount, SSH, a draft's preview) answer 404 to anyone
/// they won't serve, but a page opened while signed in keeps calling them
/// after its session ends, and a 404 then reads as "no such file". A request
/// that carries no valid session gets 401 with signin: true instead, which
/// the page's scripts answer by asking the reader to sign in again and
/// trying once more (window.pcAdmin.signIn, js/accounts.js). Runs after
/// authentication, so an expired session has already been refused.
/// </summary>
public sealed class ServerToolSignIn {
    private static readonly string[] Apis = { "/api/admin/fs", "/api/admin/ssh/targets", "/api/admin/ssh/ticket", "/api/admin/preview", "/api/admin/settings" };
    private readonly RequestDelegate _next;

    public ServerToolSignIn(RequestDelegate next) { _next = next; }

    public async Task Invoke(HttpContext ctx) {
        if (ctx.User.Identity?.IsAuthenticated != true &&
            Apis.Any(a => ctx.Request.Path.StartsWithSegments(a, StringComparison.OrdinalIgnoreCase))) {
            ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
            ctx.Response.Headers.CacheControl = "no-store";
            await ctx.Response.WriteAsJsonAsync(new { ok = false, signin = true, error = "you're signed out; sign in again to carry on" });
            return;
        }
        await _next(ctx);
    }
}
