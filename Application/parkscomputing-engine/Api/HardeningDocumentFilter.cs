using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace ParksComputing.Engine.Api {
    /// <summary>Document-level hardening adjustments (ProblemDetails additionalProperties=false).</summary>
    public class HardeningDocumentFilter : IDocumentFilter {
        public void Apply(OpenApiDocument swaggerDoc, DocumentFilterContext context) {
            if (swaggerDoc.Components.Schemas.TryGetValue("ProblemDetails", out var pd)) {
                pd.AdditionalPropertiesAllowed = false;
                pd.AdditionalProperties = null;
            }
        }
    }
}
