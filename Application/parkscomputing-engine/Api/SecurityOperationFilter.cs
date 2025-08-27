using System.Linq;
using Microsoft.AspNetCore.Authorization;
using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace ParksComputing.Engine.Api {
    /// <summary>
    /// Removes global security requirements from operations explicitly marked AllowAnonymous and
    /// ensures 401/403 responses are present for authorized operations.
    /// </summary>
    public class SecurityOperationFilter : IOperationFilter {
        public void Apply(OpenApiOperation operation, OperationFilterContext context) {
            var allowAnon = context.MethodInfo.GetCustomAttributes(true).OfType<AllowAnonymousAttribute>().Any() ||
                            context.MethodInfo.DeclaringType!.GetCustomAttributes(true).OfType<AllowAnonymousAttribute>().Any();
            if (allowAnon) {
                operation.Security?.Clear();
                // Remove any auto-added auth error responses for anonymous endpoints
                operation.Responses.Remove("401");
                operation.Responses.Remove("403");
            } else {
                // Add 401/403 if missing
                if (!operation.Responses.ContainsKey("401")) {
                    operation.Responses.Add("401", new OpenApiResponse { Description = "Unauthorized" });
                }
                if (!operation.Responses.ContainsKey("403")) {
                    operation.Responses.Add("403", new OpenApiResponse { Description = "Forbidden" });
                }
                if (!operation.Responses.ContainsKey("404")) {
                    operation.Responses.Add("404", new OpenApiResponse { Description = "Not Found" });
                }
            }
        }
    }
}
