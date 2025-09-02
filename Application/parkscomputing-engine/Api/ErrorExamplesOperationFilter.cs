using System.Collections.Generic;
using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace ParksComputing.Engine.Api {
    /// <summary>Adds ProblemDetails and Xfer examples for 412 and 428 responses.</summary>
    public class ErrorExamplesOperationFilter : IOperationFilter {
        private static readonly int[] Codes = { 400, 401, 403, 404, 409, 412, 428, 429 };

        public void Apply(OpenApiOperation operation, OperationFilterContext context) {
            foreach (var code in Codes) {
                var key = code.ToString();

                if (!operation.Responses.TryGetValue(key, out var resp)) {
                    continue;
                }

                resp.Content ??= new Dictionary<string, OpenApiMediaType>();

                if (!resp.Content.ContainsKey("application/json")) {
                    resp.Content["application/json"] = new OpenApiMediaType {
                        Schema = new OpenApiSchema { Reference = new OpenApiReference { Type = ReferenceType.Schema, Id = "ProblemDetails" } }
                    };
                }

                var json = resp.Content["application/json"];

                json.Example ??= ExampleJson(code);
                var xfer = Xfer.XferService.ApplicationXfer;
                var text = ExampleXfer(code);

                resp.Content[xfer] = new OpenApiMediaType {
                    Schema = new OpenApiSchema { Type = "string", Description = "XferLang representation", Example = new Microsoft.OpenApi.Any.OpenApiString(text) },
                    Example = new Microsoft.OpenApi.Any.OpenApiString(text)
                };
            }
        }

        private Microsoft.OpenApi.Any.OpenApiObject ExampleJson(int code) {
            var (title, detail) = CodeMeta(code);
            return new Microsoft.OpenApi.Any.OpenApiObject {
                ["type"] = new Microsoft.OpenApi.Any.OpenApiString($"https://httpstatuses.com/{code}"),
                ["title"] = new Microsoft.OpenApi.Any.OpenApiString(title),
                ["status"] = new Microsoft.OpenApi.Any.OpenApiInteger(code),
                ["detail"] = new Microsoft.OpenApi.Any.OpenApiString(detail),
                ["instance"] = new Microsoft.OpenApi.Any.OpenApiString("/api/content/{id}")
            };
        }

        private string ExampleXfer(int code) {
            var (title, detail) = CodeMeta(code);
            return $"{{\n  type \"https://httpstatuses.com/{code}\"\n  title \"{title}\"\n  status {code}\n  detail \"{detail}\"\n  instance \"/api/content/{{id}}\"\n}}";
        }

        private static (string title, string detail) CodeMeta(int code) => code switch {
            400 => ("Bad Request", "Validation failed"),
            401 => ("Unauthorized", "Authentication required or invalid token"),
            403 => ("Forbidden", "Insufficient permissions"),
            404 => ("Not Found", "Resource not found"),
            409 => ("Conflict", "Resource already exists"),
            412 => ("Precondition Failed", "ETag mismatch; supply current ETag via If-Match"),
            428 => ("Precondition Required", "Missing If-Match header for update"),
            429 => ("Too Many Requests", "Rate limit exceeded; retry after window resets."),
            _ => ("Error", "An error occurred")
        };
    }
}
