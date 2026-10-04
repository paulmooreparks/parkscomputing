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

    /* What the admin workspace's pages load: PUDL, the terminal, Files and
       the Editor with their stylesheets and vendored libraries, and the
       site's read-only listing and page text, which the public site serves
       too. Nothing else of the public site answers here. */
    private static readonly string[] AssetPaths = {
        "/pudl/", "/favicon", "/css/admin.css", "/js/admin.js", "/js/admin-desktop.js",
        "/js/continuity.js", "/js/window-bar.js", "/css/window-bar.css", "/js/config.js", "/js/settings.js", "/css/settings.css",
        "/js/applets.js", "/js/sitefs.js", "/js/filebrowser.js", "/js/terminal.js", "/js/terminal-text.js", "/js/files.js", "/js/editor.js", "/js/vendor/",
        "/css/terminal.css", "/css/files.css", "/css/filebrowser.css", "/css/editor.css",
        "/api/site/"
    };

    private readonly RequestDelegate _next;
    private readonly AdminOptions _options;
    private readonly string _csp;
    private readonly AccountOptions _accounts;

    public EditOriginGate(RequestDelegate next, IOptions<AdminOptions> options, IOptions<AccountOptions> accounts) {
        _next = next; _options = options.Value; _accounts = accounts.Value;
        // Only the public site's previews may be framed here (A11). The SSH
        // client is WebAssembly, which 'wasm-unsafe-eval' lets the page
        // compile without allowing eval itself (A16).
        _csp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
            "font-src 'self'; connect-src 'self'; frame-src " + _options.PublicOrigin.TrimEnd('/') + "; " +
            "form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
    }

    public static bool IsAdminPath(PathString path) {
        var p = path.Value ?? "/";
        return AdminPrefixes.Any(a => p.Equals(a, StringComparison.OrdinalIgnoreCase)
            || p.StartsWith(a + "/", StringComparison.OrdinalIgnoreCase));
    }

    public async Task Invoke(HttpContext ctx) {
        if (_accounts.Enabled) {
            await InvokeAccountsSite(ctx);
            return;
        }
        if (ctx.Request.Path.StartsWithSegments("/account", StringComparison.OrdinalIgnoreCase) ||
            ctx.Request.Path.StartsWithSegments("/api/account", StringComparison.OrdinalIgnoreCase)) {
            ctx.Response.StatusCode = 404; return;
        }
        bool admin = IsAdminPath(ctx.Request.Path);

        await InvokeSplitSite(ctx, admin);
    }

    /* The site with accounts (Architecture/unified-identity-design.md, "Beta
       site with accounts"): one origin, where anyone reads the site exactly
       as on the public host, and signing in adds the account's commands to
       it. The account pages and the revision workspace are private, and the
       super-user's server tools (the admin mount and SSH) answer only the
       super-user. The rest of the old edit-origin workspace, its own pages,
       sign-in and settings, does not exist here: those paths answer 404. */
    private static readonly string[] ServerToolPrefixes = { "/api/admin/fs", "/api/admin/ssh", "/admin/ssh", "/api/admin/preview" };

    private static readonly string AccountsCsp =
        "default-src 'none'; script-src 'self' https://plausible.io; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://plausible.io; " +
        "form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

    private async Task InvokeAccountsSite(HttpContext ctx) {
        if (!string.Equals(ctx.Request.Host.Host, _accounts.Host, StringComparison.OrdinalIgnoreCase)) {
            ctx.Response.StatusCode = StatusCodes.Status404NotFound; return;
        }
        ctx.Request.Scheme = _accounts.Scheme;
        var path = ctx.Request.Path;
        bool workspace = _accounts.StaffEnabled &&
            (path.StartsWithSegments("/admin/articles", StringComparison.OrdinalIgnoreCase) || path.StartsWithSegments("/articles", StringComparison.OrdinalIgnoreCase));
        // The server's own tools, which Terminal, Files and the Editor use
        // for the super-user (the admin mount, SSH and its client, a draft's
        // preview). Each answers 404 to anyone else itself.
        bool serverTools = ServerToolPrefixes.Any(p => path.StartsWithSegments(p, StringComparison.OrdinalIgnoreCase));
        if (_accounts.StaffEnabled && path == "/admin") { ctx.Response.Redirect("/admin/articles"); return; }
        if (IsAdminPath(path) && !workspace && !serverTools) { ctx.Response.StatusCode = StatusCodes.Status404NotFound; return; }

        bool account = path.StartsWithSegments("/account", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWithSegments("/api/account", StringComparison.OrdinalIgnoreCase);
        if (serverTools) {
            ctx.Response.Headers["Referrer-Policy"] = "no-referrer";
            ctx.Response.Headers["X-Content-Type-Options"] = "nosniff";
        }
        if (account || workspace) {
            var h = ctx.Response.Headers;
            h["Cache-Control"] = "no-store";
            h["Referrer-Policy"] = "no-referrer";
            h["X-Content-Type-Options"] = "nosniff";
            h["Content-Security-Policy"] = AccountsCsp;
        }
        await _next(ctx);
    }

    private async Task InvokeSplitSite(HttpContext ctx, bool admin) {
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
        h["Content-Security-Policy"] = _csp;
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
