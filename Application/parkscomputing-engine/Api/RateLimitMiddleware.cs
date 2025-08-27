using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;

namespace ParksComputing.Engine.Api {
    /// <summary>
    /// Simple fixed-window in-memory rate limiter (per minute) adding X-RateLimit-* headers and returning 429 with ProblemDetails body when exceeded.
    /// NOT for production multi-instance (no distributed store); swap with Redis or built-in partitioned rate limiter for scale.
    /// </summary>
    public class RateLimitMiddleware {
        private readonly RequestDelegate _next;
        private static readonly ConcurrentDictionary<string, Counter> _counters = new();
        private readonly int _limit;
        private readonly TimeSpan _window = TimeSpan.FromMinutes(1);

        private class Counter { public DateTime WindowStart; public int Count; }

        public RateLimitMiddleware(RequestDelegate next, int limit = 60) { _next = next; _limit = limit; }

        public async Task InvokeAsync(HttpContext context) {
            if (IsApiRequest(context.Request.Path)) {
                var key = GetPartitionKey(context);
                var now = DateTime.UtcNow;
                var counter = _counters.AddOrUpdate(key,
                    _ => new Counter { WindowStart = now, Count = 1 },
                    (_, existing) => {
                        if (now - existing.WindowStart >= _window) { existing.WindowStart = now; existing.Count = 1; }
                        else { existing.Count++; }
                        return existing;
                    });

                int remaining = Math.Max(0, _limit - counter.Count);
                var reset = counter.WindowStart + _window;
                context.Response.Headers["X-RateLimit-Limit"] = _limit.ToString();
                context.Response.Headers["X-RateLimit-Remaining"] = remaining.ToString();
                context.Response.Headers["X-RateLimit-Reset"] = ((long)(reset - DateTime.UnixEpoch).TotalSeconds).ToString();

                if (counter.Count > _limit) {
                    await WriteProblem(context, 429, "Too Many Requests", "Rate limit exceeded; retry after window resets.");
                    return;
                }
            }

            await _next(context);

            // Inject ProblemDetails for bare 404 (no body written) for API paths
            if (IsApiRequest(context.Request.Path) && context.Response.StatusCode == 404 && !context.Response.HasStarted && context.Response.ContentLength == null) {
                await WriteProblem(context, 404, "Not Found", "Resource not found");
            }
        }

        private static bool IsApiRequest(PathString path) => path.HasValue && path.Value!.StartsWith("/api/", StringComparison.OrdinalIgnoreCase);
        private static string GetPartitionKey(HttpContext ctx) => ctx.User?.Identity?.IsAuthenticated == true
            ? ctx.User.Identity!.Name ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "anon"
            : ctx.Connection.RemoteIpAddress?.ToString() ?? "anon";

        private static async Task WriteProblem(HttpContext ctx, int status, string title, string detail) {
            if (ctx.Response.HasStarted) { return; }
            ctx.Response.StatusCode = status;
            var accept = ctx.Request.Headers["Accept"].ToString();
            var instance = ctx.Request.Path.ToString();
            if (!string.IsNullOrEmpty(accept) && accept.Contains("application/xfer", StringComparison.OrdinalIgnoreCase)) {
                ctx.Response.ContentType = "application/xfer";
                var xfer = new StringBuilder();
                xfer.AppendLine("{");
                xfer.AppendLine($"  type \"https://httpstatuses.com/{status}\"");
                xfer.AppendLine($"  title \"{Escape(title)}\"");
                xfer.AppendLine($"  status {status}");
                xfer.AppendLine($"  detail \"{Escape(detail)}\"");
                xfer.AppendLine($"  instance \"{Escape(instance)}\"");
                xfer.AppendLine("}");
                await ctx.Response.WriteAsync(xfer.ToString());
            } else {
                ctx.Response.ContentType = "application/json";
                var json = $"{{\"type\":\"https://httpstatuses.com/{status}\",\"title\":\"{Escape(title)}\",\"status\":{status},\"detail\":\"{Escape(detail)}\",\"instance\":\"{Escape(instance)}\"}}";
                await ctx.Response.WriteAsync(json);
            }
        }

        private static string Escape(string v) => v.Replace("\\", "\\\\").Replace("\"", "\\\"");
    }
}
