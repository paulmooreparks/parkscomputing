using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;

namespace ParksComputing.Engine.Api {
    /// <summary>
    /// Adds consistent Cache-Control (and Vary) headers for cacheable content endpoints.
    /// Currently targets GET/HEAD /api/content* responses with 200 or 304 status codes.
    /// Auth endpoints (/api/auth/*) are marked no-store.
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
            await _next(context);

            if (context.Response.HasStarted) { return; }

            var path = context.Request.Path.Value ?? string.Empty;
            var method = context.Request.Method;
            // Auth endpoints should never be cached
            if (path.StartsWith("/api/auth/", StringComparison.OrdinalIgnoreCase)) {
                if (!context.Response.Headers.ContainsKey("Cache-Control")) {
                    context.Response.Headers["Cache-Control"] = _authCacheControl;
                }

                return;
            }

            if ((method == HttpMethods.Get || method == HttpMethods.Head) && path.StartsWith("/api/content", StringComparison.OrdinalIgnoreCase)) {
                if ((context.Response.StatusCode == 200 || context.Response.StatusCode == 304) && !context.Response.Headers.ContainsKey("Cache-Control")) {
                    context.Response.Headers["Cache-Control"] = _contentCacheControl;
                }

                // Ensure Vary for representations & auth (if using bearer may influence body)
                if (!context.Response.Headers.ContainsKey("Vary")) {
                    context.Response.Headers["Vary"] = "Accept, Authorization";
                }
            }
        }
    }
}
