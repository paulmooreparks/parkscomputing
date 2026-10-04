using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;

namespace ParksComputing.Engine.Api {
    /// <summary>
    /// Adds consistent Cache-Control (and Vary) headers for cacheable content endpoints.
    /// Currently targets GET/HEAD /api/content* responses with 200 or 304 status codes.
    /// Account and admin endpoints are never cached. Cookie-bearing content
    /// responses are private, including requests whose session has expired.
    /// </summary>
    public class CachingMiddleware {
        private readonly RequestDelegate _next;
        private readonly string _contentCacheControl;
        private readonly string _authCacheControl;

        public CachingMiddleware(
            RequestDelegate next,
            string contentCacheControl = "public, max-age=60, must-revalidate",
            string authCacheControl = "no-store, max-age=0"
            ) {
            _next = next;
            _contentCacheControl = contentCacheControl;
            _authCacheControl = authCacheControl;
        }

        public async Task InvokeAsync(HttpContext context) {
            // MVC may start the response while executing the endpoint. Set policy
            // in OnStarting so it applies before headers leave the server.
            context.Response.OnStarting(() => {
                var path = context.Request.Path;
                bool privateResource = path.StartsWithSegments("/api/account", StringComparison.OrdinalIgnoreCase) || path.StartsWithSegments("/account", StringComparison.OrdinalIgnoreCase)
                    || path.StartsWithSegments("/admin", StringComparison.OrdinalIgnoreCase)
                    || path.StartsWithSegments("/api/admin", StringComparison.OrdinalIgnoreCase);
                bool content = path.StartsWithSegments("/api/content", StringComparison.OrdinalIgnoreCase);
                bool personalized = context.User.Identity?.IsAuthenticated == true
                    || context.Request.Headers.ContainsKey("Cookie")
                    || context.Request.Headers.ContainsKey("Authorization")
                    || context.Response.Headers.ContainsKey("Set-Cookie");

                // A page drawn for a signed-in reader carries their name and
                // their commands, so no cache may keep it.
                // A profile picture is the same for everyone and sets its own
                // caching (Identity/AvatarController.cs).
                bool signedIn = context.User.Identity?.IsAuthenticated == true &&
                    !path.StartsWithSegments("/avatars", StringComparison.OrdinalIgnoreCase);
                if (privateResource || (content && personalized) || signedIn) {
                    // Override accidental public headers on a private response.
                    context.Response.Headers["Cache-Control"] = _authCacheControl;
                    context.Response.Headers.Remove("Expires");
                    return Task.CompletedTask;
                }
                if (content && (HttpMethods.IsGet(context.Request.Method) || HttpMethods.IsHead(context.Request.Method))) {
                    if ((context.Response.StatusCode == 200 || context.Response.StatusCode == 304)
                        && !context.Response.Headers.ContainsKey("Cache-Control")) {
                        context.Response.Headers["Cache-Control"] = _contentCacheControl;
                    }
                    // Preserve endpoint-specific representation dimensions.
                    var vary = context.Response.Headers["Vary"].ToString();
                    var values = new System.Collections.Generic.HashSet<string>(
                        vary.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries),
                        StringComparer.OrdinalIgnoreCase);
                    if (!values.Contains("*")) {
                        values.UnionWith(new[] { "Accept", "Authorization", "Cookie" });
                        context.Response.Headers["Vary"] = string.Join(", ", values);
                    }
                }
                return Task.CompletedTask;
            });
            await _next(context);
        }
    }
}
