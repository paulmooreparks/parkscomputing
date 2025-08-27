using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace ParksComputing.Engine.Api {
    /// <summary>Adds illustrative pagination, rate limit, and cache headers to 200 responses for list/get operations.</summary>
    public class RateLimitOperationFilter : IOperationFilter {
        public void Apply(OpenApiOperation operation, OperationFilterContext context) {
            var name = context.MethodInfo.Name;
            if (!operation.Responses.TryGetValue("200", out var resp)) { return; }
            resp.Headers ??= new System.Collections.Generic.Dictionary<string, OpenApiHeader>();
            // Always include ETag + Cache-Control
            Add(resp, "ETag", "Entity or aggregate ETag");
            Add(resp, "Cache-Control", "Cache directives");
            // Apply pagination + rate headers only for list
            if (name == "List") {
                Add(resp, "X-Total-Count", "Total items for current filter");
                Add(resp, "X-Page", "Current page");
                Add(resp, "X-Page-Size", "Page size");
                Add(resp, "X-RateLimit-Limit", "Request limit per window (illustrative)");
                Add(resp, "X-RateLimit-Remaining", "Remaining requests in window");
                Add(resp, "X-RateLimit-Reset", "Epoch seconds window resets");
            }

            // Ensure 429 documented with ProblemDetails + Xfer examples
            if (!operation.Responses.ContainsKey("429")) {
                operation.Responses["429"] = new Microsoft.OpenApi.Models.OpenApiResponse { Description = "Too Many Requests" };
            }
        }
        private static void Add(OpenApiResponse r, string name, string desc) {
            if (!r.Headers.ContainsKey(name)) {
                r.Headers[name] = new OpenApiHeader { Description = desc, Schema = new OpenApiSchema { Type = "string" } };
            }
        }
    }
}
