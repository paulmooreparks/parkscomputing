using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Hosting;

namespace ParksComputing.Engine.Api {
    // File-based implementation storing markdown under wwwroot/content and drafts under wwwroot/content/drafts
    public class FileContentStorage : IContentStorage {
        private readonly IWebHostEnvironment _env;

        public FileContentStorage(IWebHostEnvironment env) {
            _env = env;
        }

        private string ContentRoot => Path.Combine(_env.ContentRootPath, "wwwroot", "content");

        public Task<ContentResource?> GetAsync(string id, CancellationToken ct = default) {
            var (path, isMarkdown) = ResolvePath(id);

            if (path == null || !File.Exists(path)) {
                return Task.FromResult<ContentResource?>(null);
            }

            var text = File.ReadAllText(path);
            var res = ParseFile(id, text, isMarkdown);
            res.ETag = ComputeETag(text);
            return Task.FromResult<ContentResource?>(res);
        }

        public Task<IReadOnlyList<ContentResource>> ListAsync(string? prefix = null, CancellationToken ct = default) {
            var list = new List<ContentResource>();

            if (!Directory.Exists(ContentRoot)) {
                return Task.FromResult<IReadOnlyList<ContentResource>>(list);
            }

            foreach (var file in Directory.EnumerateFiles(ContentRoot, "*.md", SearchOption.AllDirectories)) {
                var rel = Path.GetRelativePath(ContentRoot, file).Replace('\\', '/');

                if (!string.IsNullOrWhiteSpace(prefix) && !rel.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) {
                    continue;
                }

                var text = File.ReadAllText(file);
                var id = rel.EndsWith(".md", StringComparison.OrdinalIgnoreCase) ? rel[..^3] : rel;
                var res = ParseFile(id, text, isMarkdown: true);
                res.ETag = ComputeETag(text);
                list.Add(res);
            }

            return Task.FromResult<IReadOnlyList<ContentResource>>(list);
        }

        public Task<ContentResource> UpsertAsync(ContentResource resource, string? expectedETag = null, CancellationToken ct = default) {
            if (string.IsNullOrWhiteSpace(resource.Id)) {
                throw new ArgumentException("Id required");
            }

            var id = resource.Id.Replace('\\','/');
            var fullDir = ContentRoot;
            var name = id;

            if (id.Contains('/')) {
                var lastSlash = id.LastIndexOf('/');
                fullDir = Path.Combine(ContentRoot, id.Substring(0, lastSlash));
                name = id[(lastSlash + 1)..];
            }

            Directory.CreateDirectory(fullDir);
            var fullPath = Path.Combine(fullDir, name + ".md");

            if (File.Exists(fullPath) && expectedETag != null) {
                var existingText = File.ReadAllText(fullPath);
                var existingEtag = ComputeETag(existingText);

                if (!string.Equals(existingEtag, expectedETag, StringComparison.Ordinal)) {
                    throw new ETagMismatchException(existingEtag);
                }
            }

            // Persist front-matter + body. Assume RawMarkdown contains full file (including front matter) if present.
            var content = resource.RawMarkdown ?? BuildMarkdown(resource);
            File.WriteAllText(fullPath, content, Encoding.UTF8);
            var updated = content;
            resource.ETag = ComputeETag(updated);
            return Task.FromResult(resource);
        }

        public Task<bool> DeleteAsync(string id, string? expectedETag = null, CancellationToken ct = default) {
            var (path, _) = ResolvePath(id);

            if (path == null || !File.Exists(path)) {
                return Task.FromResult(false);
            }

            if (expectedETag != null) {
                var text = File.ReadAllText(path);
                var etag = ComputeETag(text);

                if (!string.Equals(etag, expectedETag, StringComparison.Ordinal)) {
                    throw new ETagMismatchException(etag);
                }
            }

            File.Delete(path);
            return Task.FromResult(true);
        }

        private (string? path, bool isMarkdown) ResolvePath(string id) {
            var md = Path.Combine(ContentRoot, id + ".md");
            if (File.Exists(md)) {
                return (md, true);
            }

            return (null, true);
        }

        private ContentResource ParseFile(string id, string text, bool isMarkdown) {
            DateTime? created = null, updated = null; string? title = null, description = null, lang = null; string body = text;

            if (text.StartsWith("---")) {
                int second = text.IndexOf("\n---", 3, StringComparison.Ordinal);

                if (second > -1) {
                    string front = text.Substring(3, second - 3).Trim('\r', '\n');
                    body = text[(second + 4)..];

                    foreach (var line in front.Split('\n')) {
                        var ln = line.Trim();

                        if (string.IsNullOrWhiteSpace(ln) || ln.StartsWith('#')) {
                            continue;
                        }

                        int colon = ln.IndexOf(':');

                        if (colon <= 0) {
                            continue;
                        }

                        var key = ln.Substring(0, colon).Trim();
                        var val = ln[(colon + 1)..].Trim().Trim('"');

                        switch (key.ToLowerInvariant()) {
                            case "title":
                                title ??= val;
                                break;

                            case "description":
                                description ??= val;
                                break;

                            case "date":
                                if (DateTime.TryParse(val, out var c)) {
                                    created ??= c;
                                }

                                break;

                            case "lastmodified":
                                if (DateTime.TryParse(val, out var u)) {
                                    updated ??= u;
                                }

                                break;

                            case "lang":
                                lang ??= val;
                                break;
                        }
                    }
                }
            }

            return new ContentResource {
                Id = id,
                Slug = id,
                Title = title,
                Description = description,
                CreatedUtc = created,
                UpdatedUtc = updated ?? created,
                Language = lang,
                RawMarkdown = text,
                Published = true
            };
        }

        private static string BuildMarkdown(ContentResource r) {
            var sb = new StringBuilder();
            sb.AppendLine("---");

            if (!string.IsNullOrWhiteSpace(r.Title)) {
                sb.AppendLine($"title: {r.Title}");
            }

            if (!string.IsNullOrWhiteSpace(r.Description)) {
                sb.AppendLine($"description: {r.Description}");
            }

            if (r.CreatedUtc.HasValue) {
                sb.AppendLine($"date: {r.CreatedUtc:O}");
            }

            if (r.UpdatedUtc.HasValue) {
                sb.AppendLine($"lastModified: {r.UpdatedUtc:O}");
            }

            if (!string.IsNullOrWhiteSpace(r.Language)) {
                sb.AppendLine($"lang: {r.Language}");
            }

            sb.AppendLine("---");
            sb.AppendLine();
            sb.AppendLine("# " + r.Title);
            return sb.ToString();
        }

        private static string ComputeETag(string content) {
            using var sha = SHA256.Create();
            var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(content));
            return Convert.ToHexString(bytes);
        }
    }

    public class ETagMismatchException : Exception {
        public string CurrentETag { get; }
        public ETagMismatchException(string current) : base("ETag mismatch") { CurrentETag = current; }
    }
}
