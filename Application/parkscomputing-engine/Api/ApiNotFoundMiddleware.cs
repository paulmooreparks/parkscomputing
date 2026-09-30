using System;
using System.Text;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;

namespace ParksComputing.Engine.Api {
    /// <summary>
    /// Gives a bare 404 from an API path a ProblemDetails body, as JSON, or as
    /// Xfer when the request asks for it. Rate limiting is the built-in
    /// limiter's (Startup.cs), which tells readers apart by Cloudflare's
    /// CF-Connecting-IP and knows who is signed in.
    /// </summary>
    public class ApiNotFoundMiddleware {
        private readonly RequestDelegate _next;

        public ApiNotFoundMiddleware(RequestDelegate next) { _next = next; }

        public async Task InvokeAsync(HttpContext context) {
            await _next(context);
            if (IsApiRequest(context.Request.Path) && context.Response.StatusCode == 404 && !context.Response.HasStarted && context.Response.ContentLength == null) {
                await WriteProblem(context, 404, "Not Found", "Resource not found");
            }
        }

        private static bool IsApiRequest(PathString path) => path.HasValue && path.Value!.StartsWith("/api/", StringComparison.OrdinalIgnoreCase);

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
