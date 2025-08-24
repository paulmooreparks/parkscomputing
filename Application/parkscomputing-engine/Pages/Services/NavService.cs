using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using HtmlAgilityPack;
using System.Threading.Tasks;
using Markdig;

using Microsoft.Extensions.Hosting;

using ParksComputing.Xfer.Lang; // Xfer language parsing
using Microsoft.Extensions.Logging;
namespace ParksComputing.Engine.Pages.Services {
    public class NavService : INavService {
    private IHostEnvironment Environment { get; set; }
    private readonly ILogger<NavService> _logger;

        private readonly object _sync = new();
        private DateTime _lastWriteUtc;
    private NavNode? _cached;

        public NavService(IHostEnvironment environment, ILogger<NavService> logger) {
            Environment = environment;
            _logger = logger;
        }

        public NavNode? GetNavNode(string slug) {
            if (string.IsNullOrWhiteSpace(slug)) { return null; }
            var root = GetRoot();
            if (root == null) { return null; }
            foreach (var node in Enumerate(root)) {
                if (string.Equals(node.Slug, slug, StringComparison.OrdinalIgnoreCase)) { return node; }
            }
            if (root.Posts != null) {
                foreach (var p in root.Posts) {
                    if (string.Equals(p.Slug, slug, StringComparison.OrdinalIgnoreCase)) { return p; }
                }
            }
            return null;
        }

        public NavNode GetRoot() {
            var xferPath = Path.Combine(Environment.ContentRootPath, "wwwroot", "sitenav.xfer");
            if (!File.Exists(xferPath)) { return _cached ?? new NavNode { Slug = "root" }; }
            DateTime writeUtc = File.GetLastWriteTimeUtc(xferPath);
            if (_cached != null && writeUtc == _lastWriteUtc) { return _cached; }
            lock (_sync) {
                if (_cached != null && writeUtc == _lastWriteUtc) { return _cached; }
                var rootNode = ParseRoot(File.ReadAllText(xferPath), xferPath);
                PostProcess(rootNode);
                EnrichPostsFromContent(rootNode);
                _cached = rootNode;
                _lastWriteUtc = writeUtc;
                return rootNode;
            }
        }

        private IEnumerable<NavNode> Enumerate(NavNode node) {
            yield return node;
            if (node.Nav != null) {
                foreach (var c in node.Nav.SelectMany(Enumerate)) {
                    yield return c;
                }
            }
        }

        private void PostProcess(NavNode root) {
            if (root == null) { return; }
            AssignDerived(root, isTreeRoot: true);
            if (root.Posts != null) {
                foreach (var p in root.Posts) { AssignDerived(p, isTreeRoot: false, isPost: true); }
            }
        }

        private void AssignDerived(NavNode node, bool isTreeRoot = false, bool isPost = false) {
            if (node.Slug == null) { return; }

            // If explicit URL present, treat as external if absolute (http/https) and skip derivation
            if (!string.IsNullOrWhiteSpace(node.Url)) {
                if (Uri.TryCreate(node.Url, UriKind.Absolute, out var abs) && (abs.Scheme == Uri.UriSchemeHttp || abs.Scheme == Uri.UriSchemeHttps)) {
                    node.External = true;
                }
            } else if (!isTreeRoot) {
                bool hasChildren = node.Nav != null && node.Nav.Length > 0;
                node.Url = hasChildren ? $"/nav/{node.Slug}" : $"/page/{node.Slug}";
                node.DerivedUrl = true;
            }
            if (!node.Updated.HasValue && node.Date.HasValue) { node.Updated = node.Date; }
            if (node.Nav != null) {
                int ordinal = 0;
                foreach (var child in node.Nav) {
                    if (!child.Order.HasValue) { child.Order = ++ordinal; }
                    AssignDerived(child);
                }
            }
        }

        private NavNode ParseRoot(string text, string? sourcePath = null) {
            try {
                var docRoot = XferConvert.Deserialize<NavNode>(text);
                if (docRoot == null) { docRoot = new NavNode { Slug = "root" }; }
                _logger?.LogInformation("Parsed Xfer navigation navChildren={NavChildren} posts={PostCount} source={Source}", docRoot.Nav?.Length, docRoot.Posts?.Length, sourcePath);
                return docRoot;
            } catch (Exception ex) {
                _logger?.LogError(ex, "Failed XferConvert.Deserialize for {Source}", sourcePath);
                return new NavNode { Slug = "root" };
            }
        }

        private void EnrichPostsFromContent(NavNode root) {
            if (root?.Posts == null) { return; }
            foreach (var post in root.Posts) {
                // Skip enrichment if explicit URL (external or special) was provided
                if (!post.DerivedUrl) { continue; }

                // Only enrich fields that are currently missing; values in sitenav.xfer take precedence
                // Trigger enrichment if ANY key field is missing. Previously Title was omitted,
                // which meant a post with date/updated/description/excerpt already set would
                // skip enrichment and never pick up the HTML <title> or Markdown heading.
                bool needs = string.IsNullOrWhiteSpace(post.Title)
                             || !post.Date.HasValue
                             || !post.Updated.HasValue
                             || string.IsNullOrWhiteSpace(post.Description)
                             || string.IsNullOrWhiteSpace(post.Excerpt);
                if (!needs) { continue; }
                if (string.IsNullOrWhiteSpace(post.Slug)) { continue; }
                // Attempt Markdown first, then HTML
                bool enriched = TryEnrichFromMarkdown(post) || TryEnrichFromHtml(post);
                if (enriched) {
                    if (!post.Updated.HasValue && post.Date.HasValue) { post.Updated = post.Date; }
                }
            }
            // Also enrich navigation tree nodes (excluding root) so header/menu titles can be inferred
            foreach (var navNode in Enumerate(root).Skip(1)) { // Skip the root itself
                // Only attempt if title missing (other fields optional for nav nodes) and we have a derived URL
                if (!navNode.DerivedUrl || !string.IsNullOrWhiteSpace(navNode.Title) || string.IsNullOrWhiteSpace(navNode.Slug)) { continue; }
                bool enrichedNav = TryEnrichFromMarkdown(navNode) || TryEnrichFromHtml(navNode);
                if (!enrichedNav || string.IsNullOrWhiteSpace(navNode.Title)) {
                    // Fallback: humanize slug into a title (e.g., "web-apps" => "Web Apps")
                    navNode.Title = HumanizeSlug(navNode.Slug);
                }
            }
        }

        private static string HumanizeSlug(string slug) {
            if (string.IsNullOrWhiteSpace(slug)) { return slug; }
            var parts = slug.Split(new[]{'-','_','/'}, StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < parts.Length; i++) {
                var p = parts[i];
                if (p.Length == 0) { continue; }
                parts[i] = char.ToUpperInvariant(p[0]) + (p.Length > 1 ? p.Substring(1) : "");
            }
            return string.Join(' ', parts);
        }

    private bool TryEnrichFromMarkdown(NavNode post) {
            try {
                var mdPath = Path.Combine(Environment.ContentRootPath, "wwwroot", "content", post.Slug + ".md");
                if (!File.Exists(mdPath)) { return false; }
                string raw = File.ReadAllText(mdPath);
                string frontMatter = string.Empty;
                string body = raw;
                if (raw.StartsWith("---")) {
                    int second = raw.IndexOf("\n---", 3, StringComparison.Ordinal);
                    if (second > -1) {
                        int fmEnd = second + 4; // position after second delimiter line
                        frontMatter = raw.Substring(3, second - 3).Trim('\r','\n');
                        body = raw.Substring(fmEnd).TrimStart('\r','\n');
                    }
                }
                DateTime? date = null;
                DateTime? lastMod = null;
                string? description = null;
        string? title = null;
                if (!string.IsNullOrWhiteSpace(frontMatter)) {
                    using var reader = new StringReader(frontMatter);
                    string? line;
                    while ((line = reader.ReadLine()) != null) {
                        line = line.Trim();
                        if (line.Length == 0 || line.StartsWith('#')) { continue; }
                        int colon = line.IndexOf(':');
                        if (colon <= 0) { continue; }
                        string key = line.Substring(0, colon).Trim();
                        string val = line.Substring(colon + 1).Trim().Trim('"');
                        switch (key.ToLowerInvariant()) {
                case "title":
                if (string.IsNullOrWhiteSpace(title)) { title = val; }
                break;
                            case "date":
                                if (!date.HasValue && DateTime.TryParse(val, out var d)) { date = d; }
                                break;
                            case "lastmodified":
                                if (!lastMod.HasValue && DateTime.TryParse(val, out var m)) { lastMod = m; }
                                break;
                            case "description":
                                if (string.IsNullOrWhiteSpace(description)) { description = val; }
                                break;
                        }
                    }
                }
                // Apply only missing
                if (!post.Date.HasValue && date.HasValue) { post.Date = date; }
                if (!post.Updated.HasValue && lastMod.HasValue) { post.Updated = lastMod; }
                if (string.IsNullOrWhiteSpace(post.Description) && !string.IsNullOrWhiteSpace(description)) { post.Description = description; }
                if (string.IsNullOrWhiteSpace(post.Title) && !string.IsNullOrWhiteSpace(title)) { post.Title = title; }
                if (string.IsNullOrWhiteSpace(post.Excerpt) || string.IsNullOrWhiteSpace(post.Title)) {
                    // Build simple Markdig pipeline (lightweight) and take first paragraph text
                    var pipeline = new MarkdownPipelineBuilder().UsePipeTables().Build();
                    string html = Markdown.ToHtml(body, pipeline);
                    var temp = new HtmlDocument();
                    temp.LoadHtml(html);
                    if (string.IsNullOrWhiteSpace(post.Title)) {
                        var firstH1 = temp.DocumentNode.SelectSingleNode("//h1");
                        if (firstH1 != null) { post.Title = WebUtility.HtmlDecode(firstH1.InnerText).Trim(); }
                    }
                    var firstP = temp.DocumentNode.SelectSingleNode("//p");
                    if (firstP != null) {
                        var text = WebUtility.HtmlDecode(firstP.InnerText).Trim();
                        if (text.Length > 400) { text = text.Substring(0, 397) + "..."; }
                        if (string.IsNullOrWhiteSpace(post.Excerpt)) { post.Excerpt = text; }
                    }
                }
                return true;
            } catch {
                return false;
            }
        }

    private bool TryEnrichFromHtml(NavNode post) {
            try {
                var contentPath = Path.Combine(Environment.ContentRootPath, "wwwroot", "content", post.Slug + ".html");
                if (!File.Exists(contentPath)) { return false; }
                var doc = new HtmlDocument();
                doc.Load(contentPath);
                if (string.IsNullOrWhiteSpace(post.Title)) {
                    var titleNode = doc.DocumentNode.SelectSingleNode("//title");
                    if (titleNode != null) { post.Title = WebUtility.HtmlDecode(titleNode.InnerText.Trim()); }
                }
                // DATE
                if (!post.Date.HasValue) {
                    // Support meta http-equiv or name variants and <time datetime>
                    var dateMeta = doc.DocumentNode.SelectSingleNode("//meta[translate(@http-equiv,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='date' or translate(@name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='date']");
                    if (dateMeta?.Attributes["content"] != null && DateTime.TryParse(dateMeta.Attributes["content"].Value, out var d1)) { post.Date = d1; }
                    if (!post.Date.HasValue) {
                        var timeNode = doc.DocumentNode.SelectSingleNode("//time[@datetime]");
                        if (timeNode?.Attributes["datetime"] != null && DateTime.TryParse(timeNode.Attributes["datetime"].Value, out var d2)) { post.Date = d2; }
                    }
                }
                // UPDATED / LAST MODIFIED
                if (!post.Updated.HasValue) {
                    var updMeta = doc.DocumentNode.SelectSingleNode("//meta[translate(@http-equiv,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='last-modified' or translate(@name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='last-modified' or translate(@name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='updated' or translate(@name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='modified']");
                    if (updMeta?.Attributes["content"] != null && DateTime.TryParse(updMeta.Attributes["content"].Value, out var u1)) { post.Updated = u1; }
                }
                // DESCRIPTION
                if (string.IsNullOrWhiteSpace(post.Description)) {
                    var descMeta = doc.DocumentNode.SelectSingleNode("//meta[translate(@name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='description']");
                    if (descMeta?.Attributes["content"] != null) { post.Description = WebUtility.HtmlDecode(descMeta.Attributes["content"].Value.Trim()); }
                }
                // EXCERPT (first paragraph)
                if (string.IsNullOrWhiteSpace(post.Excerpt)) {
                    var firstP = doc.DocumentNode.SelectSingleNode("//p");
                    if (firstP != null) {
                        var text = WebUtility.HtmlDecode(firstP.InnerText).Trim();
                        if (text.Length > 400) { text = text.Substring(0, 397) + "..."; }
                        post.Excerpt = text;
                    }
                }
                // If description still missing, reuse excerpt (shorten to 200 chars)
                if (string.IsNullOrWhiteSpace(post.Description) && !string.IsNullOrWhiteSpace(post.Excerpt)) {
                    var d = post.Excerpt.Length > 200 ? post.Excerpt.Substring(0,197)+"..." : post.Excerpt;
                    post.Description = d;
                }
                // Updated fallback
                if (!post.Updated.HasValue && post.Date.HasValue) { post.Updated = post.Date; }
                // As final fallback for Date, use file last write time (UTC)
                if (!post.Date.HasValue) {
                    var writeUtc = File.GetLastWriteTimeUtc(contentPath);
                    if (writeUtc.Year > 2000) { post.Date = writeUtc; if (!post.Updated.HasValue) { post.Updated = writeUtc; } }
                }
                return true;
            } catch {
                return false;
            }
        }
    }
}
