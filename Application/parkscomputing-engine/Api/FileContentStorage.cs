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
    // File-based implementation storing markdown & html under wwwroot/content; drafts in a drafts/ subfolder.
    public class FileContentStorage : IContentStorage {
        private readonly IWebHostEnvironment _env;
        private readonly ContentStorageOptions _options;

        public FileContentStorage(IWebHostEnvironment env, Microsoft.Extensions.Options.IOptions<ContentStorageOptions> options) {
            _env = env; _options = options.Value;
        }

        private string ContentRoot => Path.Combine(_env.ContentRootPath, "wwwroot", "content");

        public Task<ContentResource?> GetAsync(string id, CancellationToken ct = default) {
            var (path, isMarkdown) = ResolvePath(id);

            if (path == null || !File.Exists(path)) {
                return Task.FromResult<ContentResource?>(null);
            }

            var text = File.ReadAllText(path);
            var isDraft = IsDraft(path);
            var res = isMarkdown ? ParseMarkdownFile(id, text, isDraft) : ParseHtmlFile(id, text, isDraft);
            res.ETag = ComputeETag(text);
            return Task.FromResult<ContentResource?>(res);
        }

        public Task<IReadOnlyList<ContentResource>> ListAsync(string? prefix = null, CancellationToken ct = default) {
            var list = new List<ContentResource>();

            if (!Directory.Exists(ContentRoot)) {
                return Task.FromResult<IReadOnlyList<ContentResource>>(list);
            }

            var allowed = new HashSet<string>(_options.Extensions.Select(e => e.ToLowerInvariant()));
            foreach (var file in Directory.EnumerateFiles(ContentRoot, "*.*", SearchOption.AllDirectories)) {
                var ext = Path.GetExtension(file).ToLowerInvariant();
                if (!allowed.Contains(ext)) {
                    continue;
                }

                var rel = Path.GetRelativePath(ContentRoot, file).Replace('\\', '/');
                if (!string.IsNullOrWhiteSpace(prefix) && !rel.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) {
                    continue;
                }

                var text = File.ReadAllText(file);
                var id = rel.EndsWith(ext, StringComparison.OrdinalIgnoreCase) ? rel.Substring(0, rel.Length - ext.Length) : rel;
                bool isMarkdown = string.Equals(ext, ".md", StringComparison.OrdinalIgnoreCase);
                bool isDraft = IsDraft(file);
                var res = isMarkdown ? ParseMarkdownFile(id, text, isDraft) : ParseHtmlFile(id, text, isDraft);
                res.ETag = ComputeETag(text);
                list.Add(res);
            }

            return Task.FromResult<IReadOnlyList<ContentResource>>(list);
        }

        public Task<ContentResource> UpsertAsync(ContentResource resource, string? expectedETag = null, CancellationToken ct = default) {
            if (string.IsNullOrWhiteSpace(resource.Id)) {
                throw new ArgumentException("Id required");
            }

            var id = resource.Id.Replace('\\', '/');
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
            // Try each configured extension in order
            foreach (var ext in _options.Extensions) {
                var candidate = Path.Combine(ContentRoot, id + ext);
                if (File.Exists(candidate)) {
                    bool isMd = string.Equals(ext, ".md", StringComparison.OrdinalIgnoreCase);
                    return (candidate, isMd);
                }
            }
            return (null, true);
        }

        private bool IsDraft(string fullPath) {
            var rel = Path.GetRelativePath(ContentRoot, fullPath).Replace('\\', '/');
            var segments = rel.Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            return segments.Any(s => string.Equals(s, _options.DraftsFolderName, StringComparison.OrdinalIgnoreCase));
        }

        private ContentResource ParseMarkdownFile(string id, string text, bool isDraft) {
            DateTime? created = null, updated = null;
            string? title = null, description = null, lang = null;
            var tags = new List<string>();
            string body = text;

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

                            case "tags":
                                // Parse tags as JSON array or comma-separated values
                                if (val.StartsWith("[") && val.EndsWith("]")) {
                                    // JSON array format: ["programming", "algorithms"]
                                    try {
                                        var tagArray = System.Text.Json.JsonSerializer.Deserialize<string[]>(val);
                                        if (tagArray != null) {
                                            tags.AddRange(tagArray);
                                        }
                                    }
                                    catch {
                                        // Fallback to comma-separated if JSON parsing fails
                                        tags.AddRange(val.Trim('[', ']').Split(',').Select(t => t.Trim().Trim('"')).Where(t => !string.IsNullOrWhiteSpace(t)));
                                    }
                                }
                                else {
                                    // Comma-separated format: programming, algorithms
                                    tags.AddRange(val.Split(',').Select(t => t.Trim()).Where(t => !string.IsNullOrWhiteSpace(t)));
                                }
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
                Published = !isDraft,
                Tags = tags
            };
        }

        private ContentResource ParseHtmlFile(string id, string text, bool isDraft) {
            // Extremely lightweight extraction (avoid bringing full HTML parser dependency):
            string? title = ExtractBetween(text, "<title>", "</title>");
            string? description = ExtractMeta(text, "description");
            DateTime? created = TryParseMetaHttp(text, "date");
            DateTime? updated = TryParseMetaHttp(text, "last-modified") ?? created;
            // Language can come from <html lang="en">
            string? lang = ExtractHtmlLang(text);
            return new ContentResource {
                Id = id,
                Slug = id,
                Title = title,
                Description = description,
                CreatedUtc = created,
                UpdatedUtc = updated,
                Language = lang,
                RawHtml = text,
                Published = !isDraft
            };
        }

        private static string? ExtractBetween(string src, string startTag, string endTag) {
            var start = src.IndexOf(startTag, StringComparison.OrdinalIgnoreCase);
            if (start < 0) {
                return null;
            }
            start += startTag.Length;
            var end = src.IndexOf(endTag, start, StringComparison.OrdinalIgnoreCase);
            if (end < 0) {
                return null;
            }
            return src.Substring(start, end - start).Trim();
        }

        private static string? ExtractMeta(string html, string name) {
            // crude pattern search for meta name="name" content="..."
            var idx = html.IndexOf("<meta", StringComparison.OrdinalIgnoreCase);
            int searchFrom = 0;
            while (idx >= 0) {
                var close = html.IndexOf('>', idx);
                if (close < 0) {
                    break;
                }
                var fragment = html.Substring(idx, close - idx + 1);
                if (fragment.IndexOf("name=\"" + name + "\"", StringComparison.OrdinalIgnoreCase) >= 0) {
                    var contentIdx = fragment.IndexOf("content=\"", StringComparison.OrdinalIgnoreCase);
                    if (contentIdx >= 0) {
                        contentIdx += 9; // len of content="
                        var end = fragment.IndexOf('"', contentIdx);
                        if (end > contentIdx) {
                            return fragment.Substring(contentIdx, end - contentIdx).Trim();
                        }
                    }
                }
                searchFrom = close + 1;
                idx = html.IndexOf("<meta", searchFrom, StringComparison.OrdinalIgnoreCase);
            }
            return null;
        }

        private static DateTime? TryParseMetaHttp(string html, string httpEquiv) {
            // meta http-equiv="date" content="..."
            var token = "http-equiv=\"" + httpEquiv + "\"";
            var idx = html.IndexOf(token, StringComparison.OrdinalIgnoreCase);
            if (idx < 0) {
                return null;
            }
            var contentIdx = html.IndexOf("content=\"", idx, StringComparison.OrdinalIgnoreCase);
            if (contentIdx < 0) {
                return null;
            }
            contentIdx += 9;
            var end = html.IndexOf('"', contentIdx);
            if (end < 0) {
                return null;
            }
            var val = html.Substring(contentIdx, end - contentIdx).Trim();
            if (DateTime.TryParse(val, out var dt)) {
                return dt;
            }
            return null;
        }

        private static string? ExtractHtmlLang(string html) {
            var idx = html.IndexOf("<html", StringComparison.OrdinalIgnoreCase);
            if (idx < 0) {
                return null;
            }
            var close = html.IndexOf('>', idx);
            if (close < 0) {
                return null;
            }
            var fragment = html.Substring(idx, close - idx + 1);
            var langIdx = fragment.IndexOf("lang=\"", StringComparison.OrdinalIgnoreCase);
            if (langIdx < 0) {
                return null;
            }
            langIdx += 6;
            var end = fragment.IndexOf('"', langIdx);
            if (end < 0) {
                return null;
            }
            return fragment.Substring(langIdx, end - langIdx);
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

            if (r.Tags != null && r.Tags.Count > 0) {
                sb.AppendLine($"tags: {System.Text.Json.JsonSerializer.Serialize(r.Tags)}");
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
