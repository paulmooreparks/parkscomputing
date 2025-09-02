using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;
using ParksComputing.Xfer.Lang; // for XferConvert
using Microsoft.OpenApi.Any;

namespace ParksComputing.Engine.Xfer {
    /// <summary>
    /// Inserts the custom media type application/xfer ahead of JSON for request and response content and generates a simple XferLang example from the primary schema.
    /// </summary>
    public class XferOperationFilter : IOperationFilter {
        public void Apply(OpenApiOperation operation, OperationFilterContext context) {
            if (operation.Responses != null) {
                foreach (var response in operation.Responses.Values) {
                    if (response.Content == null || response.Content.Count == 0) {
                        continue;
                    }

                    EnsureXferFirst(response.Content, context, context.MethodInfo.Name, TryInferPrimarySchema(response.Content));
                }
            }

            var requestContent = operation.RequestBody?.Content;

            if (requestContent != null && requestContent.Count > 0) {
                EnsureXferFirst(requestContent, context, context.MethodInfo.Name, TryInferPrimarySchema(requestContent));
            }
        }

        private OpenApiSchema? TryInferPrimarySchema(IDictionary<string, OpenApiMediaType> content) {
            // Prefer existing JSON schema if present
            if (content.TryGetValue("application/json", out var json) && json.Schema != null) {
                return json.Schema;
            }

            return content.Values.FirstOrDefault(v => v.Schema != null)?.Schema;
        }

        private void EnsureXferFirst(IDictionary<string, OpenApiMediaType> content, OperationFilterContext context, string methodName, OpenApiSchema? baseSchema) {
            // Remove any existing xfer to rebuild.
            if (content.ContainsKey(XferService.ApplicationXfer)) {
                content.Remove(XferService.ApplicationXfer);
            }

            var example = BuildExample(baseSchema, context, methodName);
            var xferText = example != null ? XferConvert.Serialize(example, ParksComputing.Xfer.Lang.Formatting.Pretty) : "# Xfer example not available";
            var raw = new OpenApiString(xferText);

            var xferMedia = new OpenApiMediaType {
                Schema = new OpenApiSchema { Type = "string", Description = "XferLang representation", Example = raw },
                Example = raw,
                Examples = new Dictionary<string, OpenApiExample> {
                    ["xfer"] = new OpenApiExample { Summary = "XferLang", Description = "XferLang media representation", Value = raw }
                }
            };

            // Rebuild dictionary placing application/xfer first
            var reordered = new Dictionary<string, OpenApiMediaType> { [XferService.ApplicationXfer] = xferMedia };

            foreach (var kv in content) {
                reordered[kv.Key] = kv.Value;
            }

            content.Clear();

            foreach (var kv in reordered) {
                content[kv.Key] = kv.Value;
            }
        }

        private static readonly HashSet<string> ServerControlled = new(StringComparer.OrdinalIgnoreCase) { "id", "createdUtc", "updatedUtc", "rawHtml", "eTag", "links" };

        private object? BuildExample(OpenApiSchema? schema, OperationFilterContext context, string method) {
            // If no schema, return lightweight fallback including method name.
            if (schema == null) {
                return new { message = $"Example from {method}", timestamp = DateTime.UtcNow };
            }

            // Resolve $ref schemas from repository if needed
            schema = ResolveReference(schema, context) ?? schema;

            // Respect explicit example on the schema if present.
            if (schema.Example is IOpenApiPrimitive primitive) {
                return primitive switch {
                    OpenApiString s => (object?) s.Value,
                    OpenApiInteger i => i.Value,
                    OpenApiLong l => l.Value,
                    OpenApiDouble d => d.Value,
                    OpenApiFloat f => f.Value,
                    OpenApiBoolean b => b.Value,
                    _ => primitive.ToString()
                };
            }

            var visited = new HashSet<OpenApiSchema>();
            var shaped = ShapeFromSchema(schema, context, visited, 0);

            if (shaped is Dictionary<string, object?> dict && method.StartsWith("Put", StringComparison.OrdinalIgnoreCase)) {
                // Remove server-controlled fields from PUT examples
                foreach (var k in ServerControlled.ToList()) {
                    dict.Remove(k);
                }
            }

            if (shaped != null) {
                return shaped;
            }

            // Fallback generic object.
            return new { message = "Hello Xfer", ok = true };
        }

        private object? ShapeFromSchema(OpenApiSchema schema, OperationFilterContext context, HashSet<OpenApiSchema> visited, int depth, string? propName = null) {
            if (depth > 3) {
                return null; // prevent runaway recursion
            }

            if (!visited.Add(schema)) {
                return null; // cycle protection
            }

            // Arrays
            if (schema.Type == "array" && schema.Items != null) {
                var item = ShapeFromSchema(ResolveReference(schema.Items, context) ?? schema.Items, context, visited, depth + 1, propName);
                return item != null ? new[] { item } : Array.Empty<object>();
            }

            // Objects (treat missing Type but with properties as object)
            schema = ResolveReference(schema, context) ?? schema;
            bool looksObject = schema.Type == "object" || (schema.Type == null && schema.Properties?.Count > 0);

            if (looksObject && schema.Properties != null && schema.Properties.Count > 0) {
                var dict = new Dictionary<string, object?>();

                foreach (var kv in schema.Properties.Take(15)) { // cap property count for brevity
                    var resolvedProp = ResolveReference(kv.Value, context) ?? kv.Value;
                    var value = BuildPropertyValue(kv.Key, resolvedProp, context, visited, depth + 1);
                    dict[kv.Key] = value;
                }

                return dict;
            }

            // Primitive fallback
            return PrimitiveValue(schema, propName);
        }

        private object? BuildPropertyValue(string name, OpenApiSchema propertySchema, OperationFilterContext context, HashSet<OpenApiSchema> visited, int depth) {
            // Use property example if provided.
            if (propertySchema.Example is IOpenApiPrimitive prim) {
                return prim switch {
                    OpenApiString s => (object?) s.Value,
                    OpenApiInteger i => i.Value,
                    OpenApiLong l => l.Value,
                    OpenApiDouble d => d.Value,
                    OpenApiFloat f => f.Value,
                    OpenApiBoolean b => b.Value,
                    _ => prim.ToString()
                };
            }

            // Enum first value.
            if (propertySchema.Enum != null && propertySchema.Enum.Count > 0) {
                return propertySchema.Enum.First().ToString()?.Trim('"');
            }

            if (propertySchema.Type == "array" && propertySchema.Items != null) {
                var shaped = ShapeFromSchema(ResolveReference(propertySchema.Items, context) ?? propertySchema.Items, context, visited, depth + 1, name);
                return shaped != null ? new[] { shaped } : Array.Empty<object>();
            }

            if (propertySchema.Properties?.Count > 0) {
                return ShapeFromSchema(propertySchema, context, visited, depth + 1, name);
            }

            return PrimitiveValue(propertySchema, name);
        }

        private OpenApiSchema? ResolveReference(OpenApiSchema schema, OperationFilterContext context) {
            if (schema.Reference?.Id != null) {
                if (context.SchemaRepository.Schemas.TryGetValue(schema.Reference.Id, out var resolved)) {
                    return resolved;
                }
            }

            // Merge first allOf if present (common pattern for composed models)
            if (schema.AllOf != null && schema.AllOf.Count > 0) {
                foreach (var part in schema.AllOf) {
                    var resolved = ResolveReference(part, context) ?? part;

                    if (resolved.Properties?.Count > 0) {
                        return resolved;
                    }
                }
            }

            return null;
        }

        private object? PrimitiveValue(OpenApiSchema schema, string? propName) {
            var name = propName ?? string.Empty;
            string lower = name.ToLowerInvariant();
            bool looksBool = schema.Type == "boolean" || lower.StartsWith("is") || lower.StartsWith("has") || lower.StartsWith("can") || lower.EndsWith("enabled");

            if (looksBool) {
                return true;
            }

            if (lower == "id") {
                return "sample-slug";
            }

            if (lower.EndsWith("id")) {
                if (string.Equals(schema.Format, "uuid", StringComparison.OrdinalIgnoreCase)) {
                    return "00000000-0000-0000-0000-000000000001";
                }

                return 1;
            }

            if (lower.Contains("date") && !lower.Contains("updated")) {
                return DateTime.UtcNow.ToString("yyyy-MM-dd");
            }

            if (lower.Contains("time")) {
                return DateTime.UtcNow.ToString("HH:mm:ss");
            }

            if (lower.Contains("email")) {
                return "user@example.com";
            }

            if (lower.Contains("name")) {
                return "SampleName";
            }

            if (lower.Contains("message") || lower.Contains("description")) {
                return $"Sample {propName}".Trim();
            }

            switch (schema.Type) {
                case "integer":
                    return 42;
                case "number":
                    return 123.45;
                case "boolean":
                    return true;
                case "string":
                    return "string";
                default:
                    return "value";
            }
        }
    }

    /// <summary>
    /// Normalizes application/xfer examples so they remain plain text (unquoted) in the OpenAPI document.
    /// </summary>
    public class XferDocumentFilter : IDocumentFilter {
        public void Apply(OpenApiDocument swaggerDoc, DocumentFilterContext context) {
            if (swaggerDoc.Paths == null) {
                return;
            }

            foreach (var path in swaggerDoc.Paths.Values) {
                if (path.Operations == null) {
                    continue;
                }
                foreach (var op in path.Operations.Values) {
                    // Responses
                    if (op.Responses != null) {
                        foreach (var resp in op.Responses.Values) {
                            if (resp.Content == null) {
                                continue;
                            }

                            if (resp.Content.TryGetValue(XferService.ApplicationXfer, out var media) && media != null && media.Example is IOpenApiAny mediaExample) {
                                var mediaText = mediaExample.ToString() ?? string.Empty;
                                var trimmed = mediaText.Trim('"');
                                media.Example = new OpenApiString(trimmed);

                                if (media.Schema is { } schema) {
                                    schema.Example = new OpenApiString(trimmed);
                                }
                            }
                        }
                    }
                    // Request body
                    var rbContent = op.RequestBody?.Content;

                    if (rbContent != null && rbContent.TryGetValue(XferService.ApplicationXfer, out var rbMedia) && rbMedia != null && rbMedia.Example is IOpenApiAny rbExample) {
                        var rbText = rbExample.ToString() ?? string.Empty;
                        var trimmedReq = rbText.Trim('"');
                        rbMedia.Example = new OpenApiString(trimmedReq);

                        if (rbMedia.Schema is { } rbSchema) {
                            rbSchema.Example = new OpenApiString(trimmedReq);
                        }
                    }
                }
            }
        }
    }
}
