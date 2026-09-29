using System;
using System.Linq;
using System.Threading.Tasks;

using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// Keeps admin work on its own origin (Architecture/admin-and-identity-design.md, A5).
/// On the public host the admin paths do not exist: they answer 404, the same
/// as any address that names nothing. On the edit host nothing else exists
/// but the admin paths and the few assets their pages load, every response
/// carries a strict Content-Security-Policy, and admin responses are never
/// cached.
/// </summary>
public sealed class EditOriginGate {
    private static readonly string[] AdminPrefixes = { "/admin", "/api/admin" };
    private static readonly string[] AssetPaths = { "/pudl/", "/css/admin.css", "/js/admin.js", "/favicon" };

    private const string Csp =
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
        "font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

    private readonly RequestDelegate _next;
    private readonly AdminOptions _options;

    public EditOriginGate(RequestDelegate next, IOptions<AdminOptions> options) {
        _next = next; _options = options.Value;
    }

    public static bool IsAdminPath(PathString path) {
        var p = path.Value ?? "/";
        return AdminPrefixes.Any(a => p.Equals(a, StringComparison.OrdinalIgnoreCase)
            || p.StartsWith(a + "/", StringComparison.OrdinalIgnoreCase));
    }

    public async Task Invoke(HttpContext ctx) {
        bool admin = IsAdminPath(ctx.Request.Path);

        if (!_options.IsEditHost(ctx)) {
            if (admin) { ctx.Response.StatusCode = StatusCodes.Status404NotFound; return; }
            await _next(ctx);
            return;
        }

        // The edit host is reached only through the cloudflared tunnel (the
        // site's port is bound to loopback), and Cloudflare ends TLS, so the
        // request arrived at the configured origin's scheme whatever the hop
        // from cloudflared says.
        ctx.Request.Scheme = _options.EditScheme;

        var path = ctx.Request.Path.Value ?? "/";
        if (path == "/") {
            ctx.Response.Redirect("/admin");
            return;
        }

        bool asset = AssetPaths.Any(a => path.StartsWith(a, StringComparison.OrdinalIgnoreCase));
        if (!admin && !asset) {
            ctx.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        var h = ctx.Response.Headers;
        h["Content-Security-Policy"] = Csp;
        h["X-Content-Type-Options"] = "nosniff";
        h["Referrer-Policy"] = "no-referrer";
        h["X-Frame-Options"] = "DENY";
        h["Cross-Origin-Opener-Policy"] = "same-origin";
        if (admin) {
            h["Cache-Control"] = "no-store";
        }

        await _next(ctx);
    }
}
