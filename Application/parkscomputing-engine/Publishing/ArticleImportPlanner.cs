using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using HtmlAgilityPack;

namespace ParksComputing.Engine.Publishing;

internal sealed record ArticleImportPlan(int Version, Guid OperationId, string ContentRoot, ImportInput[] Articles);

internal static class ArticleImportPlanner {
    private static readonly UTF8Encoding Utf8 = new(false, true);
    private static readonly HashSet<string> Skip = new(new[] { ".git", ".vs", "node_modules", "bin", "obj" }, StringComparer.OrdinalIgnoreCase);

    private static IEnumerable<string> Files(string root) {
        foreach (var path in Directory.EnumerateFileSystemEntries(root).OrderBy(p => p, StringComparer.Ordinal)) {
            var attrs = File.GetAttributes(path);
            if ((attrs & FileAttributes.ReparsePoint) != 0) { throw new InvalidOperationException("Linked content paths must be removed from the import tree: " + Path.GetFileName(path)); }
            if ((attrs & FileAttributes.Directory) != 0) {
                if (!Skip.Contains(Path.GetFileName(path))) {
                    foreach (var child in Files(path)) { yield return child; }
                }
            }
            else if (Path.GetExtension(path).Equals(".md", StringComparison.OrdinalIgnoreCase)
                || Path.GetExtension(path).Equals(".html", StringComparison.OrdinalIgnoreCase)) { yield return path; }
        }
    }

    private static (string Source, string Hash) Read(string root, string relative) {
        if (relative.Contains('\\') || relative.StartsWith('/') || relative.Split('/').Any(p => p is "" or "." or "..")) {
            throw new ArgumentException("Invalid source path in import plan.");
        }
        var fullRoot = Path.GetFullPath(root);
        string path = fullRoot;
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) { throw new ArgumentException("The import root must not be a linked directory."); }
        foreach (string segment in relative.Split('/')) {
            path = Path.Combine(path, segment);
            if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) { throw new ArgumentException("The import source contains a linked path."); }
        }
        if (new FileInfo(path).Length > 2 * 1024 * 1024) { throw new ArgumentException("An import source exceeds 2 MB."); }
        byte[] bytes = File.ReadAllBytes(path);
        if (bytes.Length > 2 * 1024 * 1024) { throw new ArgumentException("An import source exceeds 2 MB."); }
        return (Utf8.GetString(bytes).TrimStart('\uFEFF'), Convert.ToHexString(SHA256.HashData(bytes)));
    }

    internal static DraftInput Metadata(string path, string source) {
        bool markdown = Path.GetExtension(path).Equals(".md", StringComparison.OrdinalIgnoreCase);
        bool enabled = false, allowed = false;
        string? title = null;
        var doc = new HtmlDocument();
        if (markdown) {
            int end = source.StartsWith("---", StringComparison.Ordinal) ? source.IndexOf("\n---", 3, StringComparison.Ordinal) : -1;
            if (end >= 0) {
                foreach (string line in source[3..end].Split('\n')) {
                    if (string.IsNullOrWhiteSpace(line) || char.IsWhiteSpace(line[0]) || line.StartsWith('#')) { continue; }
                    int colon = line.IndexOf(':');
                    if (colon < 1) { continue; }
                    string key = line[..colon].Trim().ToLowerInvariant();
                    string value = line[(colon + 1)..].Trim().Trim('"');
                    if (key == "title") { title = value; }
                    if (key == "commentsenabled" && bool.TryParse(value, out bool e)) { enabled = e; }
                    if (key == "commentsallowed" && bool.TryParse(value, out bool a)) { allowed = a; }
                }
            }
            doc.LoadHtml(Markdig.Markdown.ToHtml(ArticleRenderer.WithoutFrontMatter(source)));
            // Mixed metadata is ambiguous under the current rendered-page path.
            // Refuse an import instead of silently choosing a new comment policy.
            foreach (string name in new[] { "comments-enabled", "comments-allowed" }) {
                var meta = doc.DocumentNode.SelectSingleNode($"//meta[@name='{name}']");
                if (meta is not null) { throw new ArgumentException("Markdown with HTML comment metadata needs explicit source cleanup: " + path); }
            }
            title ??= ArticleRenderer.WithoutFrontMatter(source).Split('\n').Select(l => l.Trim())
                .FirstOrDefault(l => l.StartsWith("# ", StringComparison.Ordinal))?[2..].Trim();
        }
        else {
            doc.LoadHtml(source);
            title = HtmlEntity.DeEntitize(doc.DocumentNode.SelectSingleNode("//title")?.InnerText
                ?? doc.DocumentNode.SelectSingleNode("//h1")?.InnerText ?? "");
            bool Meta(string name) => doc.DocumentNode.SelectSingleNode($"//meta[@name='{name}']")
                ?.GetAttributeValue("content", "false").Equals("true", StringComparison.OrdinalIgnoreCase) == true;
            enabled = Meta("comments-enabled"); allowed = Meta("comments-allowed");
        }
        if (string.IsNullOrWhiteSpace(title)) { title = Path.GetFileNameWithoutExtension(path); }
        return new(title, source, markdown ? ArticleFormat.Markdown : ArticleFormat.Html,
            !enabled ? ArticleCommentPolicy.Disabled : allowed ? ArticleCommentPolicy.Open : ArticleCommentPolicy.Closed);
    }

    public static async Task<ArticleImportPlan> PlanAsync(string root, Func<string, Task<ArticleState?>> find, CancellationToken ct = default) {
        root = Path.GetFullPath(root);
        if (!Directory.Exists(root)) { throw new DirectoryNotFoundException("Content root does not exist."); }
        var entries = Files(root).Select(p => Path.GetRelativePath(root, p).Replace('\\', '/'))
            .GroupBy(p => ArticleStore.NormalizeSlug(p[..^Path.GetExtension(p).Length]), StringComparer.Ordinal);
        var items = new List<ImportInput>();
        foreach (var group in entries.OrderBy(g => g.Key, StringComparer.Ordinal)) {
            ct.ThrowIfCancellationRequested();
            var paths = group.OrderBy(p => Path.GetExtension(p).Equals(".md", StringComparison.OrdinalIgnoreCase) ? 0 : 1)
                .ThenBy(p => p, StringComparer.Ordinal).ToArray();
            // On Linux two case variants may both exist. The public route contract
            // cannot distinguish them safely, so the operator must resolve them.
            if (paths.GroupBy(p => Path.GetExtension(p).ToLowerInvariant()).Any(g => g.Count() > 1)) {
                throw new ArgumentException("Case-colliding source paths need review: " + group.Key);
            }
            var active = Read(root, paths[0]);
            var current = await find(group.Key);
            var alternatives = paths.Skip(1).Select(p => {
                var alternate = Read(root, p);
                return new AlternateImportSource(p, alternate.Hash, alternate.Source);
            }).ToArray();
            items.Add(new(paths[0], active.Hash, group.Key, Metadata(paths[0], active.Source), current?.Version, alternatives));
        }
        return new(1, Guid.NewGuid(), root, items.ToArray());
    }

    public static void Verify(ArticleImportPlan plan) {
        if (plan.Version != 1 || plan.OperationId == Guid.Empty || plan.Articles is null) { throw new ArgumentException("Invalid import plan."); }
        foreach (var item in plan.Articles) {
            var active = Read(plan.ContentRoot, item.Path);
            if (!active.Hash.Equals(item.FileHash, StringComparison.OrdinalIgnoreCase) || active.Source != item.Draft.Source
                || Metadata(item.Path, active.Source) != item.Draft) { throw new ArgumentException("Source changed since import planning: " + item.Path); }
            foreach (var alternate in item.AlternateSources) {
                var content = Read(plan.ContentRoot, alternate.Path);
                if (!content.Hash.Equals(alternate.Hash, StringComparison.OrdinalIgnoreCase) || content.Source != alternate.Source) {
                    throw new ArgumentException("Alternate source changed since import planning: " + alternate.Path);
                }
            }
        }
    }
}
