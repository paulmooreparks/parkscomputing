using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using HtmlAgilityPack;
using System.Threading.Tasks;
using Markdig;

using Microsoft.Extensions.Hosting;
using Microsoft.AspNetCore.Hosting;

using ParksComputing.Xfer.Lang; // Xfer language parsing
using Microsoft.Extensions.Logging;
namespace ParksComputing.Engine.Pages.Services {
    public class NavService : INavService {
    private IWebHostEnvironment Environment { get; set; }
    private readonly ILogger<NavService> _logger;

        private readonly object _sync = new();
        private NavNode? _cached;
        private Microsoft.Extensions.Primitives.IChangeToken? _changed;
        private readonly Microsoft.Extensions.FileProviders.PhysicalFileProvider _files;

        /* One service for the whole site (Startup registers it as a
           singleton). Reading sitenav.xfer fills in every article's title,
           dates and excerpt from its content file, which is many files, so
           the result is kept until sitenav.xfer or a top-level content file
           changes. The content lives in a Windows folder that Docker Desktop
           passes into the container without change notices, so the files
           are looked at every few seconds instead (a documented
           PhysicalFileProvider mode); an edit shows within seconds. */
        public NavService(IWebHostEnvironment environment, ILogger<NavService> logger) {
            Environment = environment;
            _logger = logger;
            _files = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(environment.WebRootPath) {
                UsePollingFileWatcher = true,
                UseActivePolling = true
            };
        }

        public NavNode? GetNavNode(string slug) {
            if (string.IsNullOrWhiteSpace(slug)) { return null; }
            var root = GetRoot();
            if (root == null) { return null; }
            foreach (var node in Enumerate(root).Concat((root.Menu ?? Array.Empty<NavNode>()).SelectMany(Enumerate))) {
                if (string.Equals(node.Slug, slug, StringComparison.OrdinalIgnoreCase)) { return node; }
            }
            return null;
        }

        /// <summary>The top-level sections: entries with entries of their
        /// own, in the file's order.</summary>
        public static IEnumerable<NavNode> Sections(NavNode root) =>
            (root.Nav ?? Array.Empty<NavNode>()).Where(n => !string.IsNullOrEmpty(n.Slug) && n.Nav is { Length: > 0 });

        /// <summary>Every article: the entries of the sections marked feed,
        /// in the file's order, each slug once.</summary>
        public static IEnumerable<NavNode> Articles(NavNode root) =>
            Sections(root).Where(s => s.Feed).SelectMany(s => s.Nav!)
                .Where(n => !string.IsNullOrEmpty(n.Slug))
                .GroupBy(n => n.Slug!, StringComparer.OrdinalIgnoreCase).Select(g => g.First());

        public NavNode GetRoot() {
            var cached = _cached;
            if (cached != null && _changed is { HasChanged: false }) { return cached; }
            lock (_sync) {
                if (_cached != null && _changed is { HasChanged: false }) { return _cached; }
                // Watched from before the reading starts, so a change made
                // while it runs is not missed.
                _changed = new Microsoft.Extensions.Primitives.CompositeChangeToken(new[] {
                    _files.Watch("sitenav.xfer"), _files.Watch("content/*.md"), _files.Watch("content/*.html")
                });
                var xferPath = Path.Combine(Environment.WebRootPath, "sitenav.xfer");
                if (!File.Exists(xferPath)) { return _cached ??= new NavNode { Slug = "root" }; }
                var rootNode = ParseRoot(File.ReadAllText(xferPath), xferPath);
                PostProcess(rootNode);
                EnrichFromContent(rootNode);
                ShareBetweenTwins(rootNode);
                ResolveMenu(rootNode, rootNode.Menu);
                _cached = rootNode;
                return rootNode;
            }
        }

        /// <summary>
        /// Fills in the menu's links from the entries they name: a link that
        /// gives only a slug takes the title, description, icon, address and
        /// window shape of the nav entry of that slug, keeping whatever it
        /// gives itself. Titles, submenus and headings resolve their own
        /// entries the same way; commands, separators and froms name no
        /// page. The menu's entries are not part of the nav tree, so a slug
        /// in both is still found once.
        /// </summary>
        private void ResolveMenu(NavNode root, NavNode[]? entries) {
            if (entries == null) { return; }
            foreach (var entry in entries) {
                if (entry.Nav is { Length: > 0 }) { ResolveMenu(root, entry.Nav); continue; }
                if (string.IsNullOrWhiteSpace(entry.Slug) || entry.Command != null || entry.From != null || entry.Separator) { continue; }
                var twin = Enumerate(root).FirstOrDefault(n => n != root && string.Equals(n.Slug, entry.Slug, StringComparison.OrdinalIgnoreCase));
                if (twin != null) {
                    entry.Title ??= twin.Title;
                    entry.Description ??= twin.Description;
                    entry.Icon ??= twin.Icon;
                    entry.Win ??= twin.Win;
                    entry.Target ??= twin.Target;
                    if (string.IsNullOrWhiteSpace(entry.Url)) { entry.Url = twin.Url; entry.External = twin.External; entry.DerivedUrl = twin.DerivedUrl; }
                }
                if (string.IsNullOrWhiteSpace(entry.Url)) { entry.Url = $"/page/{entry.Slug}"; entry.DerivedUrl = true; }
                else if (Uri.TryCreate(entry.Url, UriKind.Absolute, out var abs) && (abs.Scheme == Uri.UriSchemeHttp || abs.Scheme == Uri.UriSchemeHttps)) { entry.External = true; }
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
        }

        private void AssignDerived(NavNode node, bool isTreeRoot = false) {
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
                _logger?.LogInformation("Parsed Xfer navigation navChildren={NavChildren} source={Source}", docRoot.Nav?.Length, sourcePath);
                return docRoot;
            } catch (Exception ex) {
                _logger?.LogError(ex, "Failed XferConvert.Deserialize for {Source}", sourcePath);
                return new NavNode { Slug = "root" };
            }
        }

        /* An article (an entry of a feed section) takes whatever sitenav.xfer
           leaves out from its content file: title, dates, description,
           excerpt and keywords. Any other entry takes only a title, since
           a page that is not writing has no date worth showing, and an HTML
           file's date falls back to when it was last written. */
        private void EnrichFromContent(NavNode root) {
            if (root is null) { return; }
            var articles = Sections(root).Where(s => s.Feed).SelectMany(s => s.Nav!).ToHashSet();
            foreach (var post in articles) {
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
                             || string.IsNullOrWhiteSpace(post.Excerpt)
                             || post.Tags is null or { Length: 0 };
                if (!needs) { continue; }
                if (string.IsNullOrWhiteSpace(post.Slug)) { continue; }
                // Attempt Markdown first, then HTML
                bool enriched = TryEnrichFromMarkdown(post) || TryEnrichFromHtml(post);
                if (enriched) {
                    if (!post.Updated.HasValue && post.Date.HasValue) { post.Updated = post.Date; }
                }
            }
            // Every other entry: a title, if it has none.
            foreach (var navNode in Enumerate(root).Skip(1)) { // Skip the root itself
                if (articles.Contains(navNode)) { continue; }
                // Only attempt if title missing (other fields optional for nav nodes) and we have a derived URL
                if (!navNode.DerivedUrl || !string.IsNullOrWhiteSpace(navNode.Title) || string.IsNullOrWhiteSpace(navNode.Slug)) { continue; }
                bool enrichedNav = TryEnrichFromMarkdown(navNode) || TryEnrichFromHtml(navNode);
                if (!enrichedNav || string.IsNullOrWhiteSpace(navNode.Title)) {
                    // Fallback: humanize slug into a title (e.g., "web-apps" => "Web Apps")
                    navNode.Title = HumanizeSlug(navNode.Slug);
                }
            }
        }

        /// <summary>
        /// Entries for the same slug in different sections, such as Sudoku
        /// under Articles and under Applets, are one page. Each fills in what
        /// it leaves out from the others: tags, a title and description, and
        /// how its window is sized and shown. So a page's window is the same
        /// whichever section it is opened from, and whichever entry is found
        /// first. Dates and excerpts are not shared, since they belong to an
        /// article's listing and not to the page.
        /// </summary>
        private void ShareBetweenTwins(NavNode root) {
            var groups = Enumerate(root).Skip(1)
                .Where(n => !string.IsNullOrEmpty(n.Slug))
                .GroupBy(n => n.Slug!, StringComparer.OrdinalIgnoreCase)
                .Where(g => g.Count() > 1);
            foreach (var g in groups) {
                var twins = g.ToList();
                T? First<T>(Func<NavNode, T?> pick) where T : class => twins.Select(pick).FirstOrDefault(v => v is not null);
                var tags = twins.FirstOrDefault(t => t.Tags is { Length: > 0 })?.Tags;
                var title = First(t => string.IsNullOrWhiteSpace(t.Title) ? null : t.Title);
                var description = First(t => string.IsNullOrWhiteSpace(t.Description) ? null : t.Description);
                var win = First(t => t.Win); var min = First(t => t.Min); var max = First(t => t.Max);
                var icon = First(t => t.Icon);
                bool frame = twins.Any(t => t.Frame);
                foreach (var t in twins) {
                    if (t.Tags is not { Length: > 0 }) { t.Tags = tags; }
                    if (string.IsNullOrWhiteSpace(t.Title)) { t.Title = title; }
                    if (string.IsNullOrWhiteSpace(t.Description)) { t.Description = description; }
                    t.Win ??= win; t.Min ??= min; t.Max ??= max; t.Icon ??= icon;
                    t.Frame = t.Frame || frame;
                }
            }
        }

        /// <summary>A node's effective date: the latest of its updated and
        /// created dates; the sort key and displayed date across the site.</summary>
        public static DateTime? EffectiveDate(NavNode node) {
            if (node.Updated is null) { return node.Date; }
            if (node.Date is null) { return node.Updated; }
            return node.Updated > node.Date ? node.Updated : node.Date;
        }

        /// <summary>Merges keyword tags from a content file into the node's
        /// explicit sitenav tags, deduplicating case-insensitively.</summary>
        private static void MergeTags(NavNode node, string? keywordList) {
            if (string.IsNullOrWhiteSpace(keywordList)) { return; }
            var merged = new List<string>(node.Tags ?? Array.Empty<string>());
            foreach (var raw in keywordList.Split(',', StringSplitOptions.RemoveEmptyEntries)) {
                var tag = raw.Trim();
                if (tag.Length > 0 && !merged.Any(t => t.Equals(tag, StringComparison.OrdinalIgnoreCase))) {
                    merged.Add(tag);
                }
            }
            node.Tags = merged.ToArray();
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
                var mdPath = Path.Combine(Environment.WebRootPath, "content", post.Slug + ".md");
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
                            case "keywords":
                                MergeTags(post, val);
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
                var contentPath = Path.Combine(Environment.WebRootPath, "content", post.Slug + ".html");
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
                // TAGS from keywords metadata
                var kwMeta = doc.DocumentNode.SelectSingleNode("//meta[translate(@name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='keywords']");
                if (kwMeta?.Attributes["content"] != null) { MergeTags(post, WebUtility.HtmlDecode(kwMeta.Attributes["content"].Value)); }
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
