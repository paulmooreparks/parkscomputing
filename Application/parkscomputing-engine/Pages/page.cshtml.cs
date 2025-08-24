using System.Globalization;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using System;
using System.Xml;
using HtmlAgilityPack;

using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.Extensions.Hosting;
using System.IO;
using ParksComputing.Engine.Pages.Services;
using SmartSam.Comments.Lib;
using System.Collections.Generic;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using Markdig;

namespace ParksComputing.Engine.Pages {
    public class PageLoaderModel : Microsoft.AspNetCore.Mvc.RazorPages.PageModel {
        public string? Title { get; set; }
        public string? PageContent { get; set; }
        public string? CreatedGmt { get; set; }
        public string? ModifiedGmt { get; set; }
        public DateTime CreateDate { get; set; } = DateTime.UtcNow;
        public DateTime ModifiedDate { get; set; } = DateTime.UtcNow;
        public string? Created { get; set; }
        public string? Modified { get; set; }
        public string Description { get; set; } = string.Empty;
        public string? Language { get; set; } = "en-us";

        public bool CommentsAllowed { get; set; } = false;
        public bool CommentsEnabled { get; set; } = false;
        public bool CommentPosted { get; set; } = false;
        public HtmlNodeCollection? MetaElements { get; set; }
        public HtmlNodeCollection? LinkElements { get; set; }
        public HtmlNodeCollection? StyleElements { get; set; }
        public HtmlNodeCollection? HeadScriptElements { get; set; }
        public HtmlNodeCollection? BodyScriptElements { get; set; }

        AppServices Services { get; set; }

        public IOptions<CommentServiceConfig> CommentServiceConfig { get; set; }
        public ICommentService CommentService { get; set; }
        protected IHostEnvironment Environment { get; set; }
        protected IHttpClientFactory ClientFactory { get; set; }
        public List<CommentResponse>? CommentResponse { get; set; }
        public string CommentStatus { get; set; } = string.Empty;


        public PageLoaderModel(AppServices services) {
            Services = services;
            CommentServiceConfig = services.CommentServiceConfig;
            Environment = services.Environment;
            ClientFactory = services.ClientFactory;
            CommentService = services.CommentService;
        }

        virtual public Task<IActionResult> OnGetAsync() {
            object? sectionObject = HttpContext.Request.RouteValues["section"]!;
            object? slugObject = HttpContext.Request.RouteValues["slug"];
            string slug = sectionObject?.ToString()!;

            if (slugObject is not null) {
                slug = slugObject.ToString()!.Trim('/');
            }

            var commentPosted = HttpContext.Session.GetString("CommentPosted") ?? "False";
            CommentPosted = bool.Parse(commentPosted);
            HttpContext.Session.SetString("CommentPosted", "False");

            return RetrievePage(slug);
        }

        [BindProperty]
        public CommentForm? NewComment { get; set; }

        public async Task<IActionResult> OnPostAsync() {
            if (!ModelState.IsValid) {
                return Page();
            }

            HttpResponseMessage response = await PostComment();

            if (response.IsSuccessStatusCode) {
                HttpContext.Session.SetString("CommentPosted", "True");
                await HttpContext.Session.CommitAsync(); // Force the session to save
                return RedirectToPage();
            }

            // Handle errors, maybe set an error message to display to the user
            return Page();
        }

        private async Task<HttpResponseMessage> PostComment() {
            var requestUri = $"{CommentServiceConfig.Value.ApiUrl}/api/comment";
            var domain = CommentServiceConfig.Value.Domain;

            var client = ClientFactory.CreateClient();
            var response = await client.PostAsJsonAsync(
                requestUri,
                NewComment?.ToComment(domain!, HttpContext.Request.RouteValues["slug"]?.ToString()!)
                );
            return response;
        }

        protected Task<IActionResult> RetrievePage(string slug) {
            try {
                var baseDir = $"{Environment.ContentRootPath}/wwwroot/content";
                // Prefer markdown first
                var mdPath = Path.Combine(baseDir, slug + ".md");
                if (System.IO.File.Exists(mdPath)) {
                    return LoadMarkdownAndRender(mdPath, slug);
                }

                // Fallback to raw HTML
                var htmlPath = Path.Combine(baseDir, slug + ".html");
                if (System.IO.File.Exists(htmlPath)) {
                    var doc = new HtmlDocument();
                    doc.Load(htmlPath);
                    return ExtractAndRender(doc, slug);
                }

                return Task.FromResult<IActionResult>(NotFound());
            }
            catch (Exception) {
                return Task.FromResult<IActionResult>(StatusCode(500));
            }
        }

        private Task<IActionResult> LoadMarkdownAndRender(string mdPath, string slug) {
            try {
                string raw = System.IO.File.ReadAllText(mdPath);
                var (frontMatter, body) = SplitFrontMatter(raw);
                var metadata = ParseFrontMatter(frontMatter, mdPath);

                // If title missing, attempt first H1 extraction later after markdown conversion
                var pipeline = new MarkdownPipelineBuilder()
                    .UsePipeTables()
                    .UseTaskLists()
                    .UseAutoLinks()
                    .UseEmphasisExtras()
                    .UseSmartyPants()
                    .UseMediaLinks()
                    .UseGenericAttributes() // enables attribute lists: ![alt](img.png){ width=512 height=512 }
                    .Build();
                string htmlBody = Markdown.ToHtml(body, pipeline);

                // Detect code blocks to decide whether to inject highlight.js assets.
                bool hasCodeBlocks = htmlBody.Contains("<pre><code", StringComparison.OrdinalIgnoreCase);

                if (string.IsNullOrWhiteSpace(metadata.Title)) {
                    metadata.Title = ExtractFirstHeading(htmlBody) ?? slug;
                }

                // Build synthetic HTML document so existing parsing logic still works
                // string headHighlight = hasCodeBlocks ? "<link rel=\"stylesheet\" href=\"/highlightjs/styles/default.min.css\" /><script src=\"/highlightjs/highlight.min.js\"></script>" : string.Empty;
                string bodyHighlight = hasCodeBlocks ? "<script>hljs.highlightAll();</script>" : string.Empty;

                string synthetic = $"<html lang=\"{metadata.Lang}\"><head><title>{System.Net.WebUtility.HtmlEncode(metadata.Title)}</title>" +
                                   $"<meta http-equiv=\"date\" content=\"{metadata.DateUtc:yyyy'-'MM'-'dd'T'HH':'mm':'ss}\" />" +
                                   $"<meta http-equiv=\"last-modified\" content=\"{metadata.LastModifiedUtc:yyyy'-'MM'-'dd'T'HH':'mm':'ss}\" />" +
                                   (string.IsNullOrWhiteSpace(metadata.Description) ? string.Empty : $"<meta name=\"description\" content=\"{System.Net.WebUtility.HtmlEncode(metadata.Description)}\" />") +
                                   $"<meta name=\"comments-allowed\" content=\"{metadata.CommentsAllowed.ToString().ToLowerInvariant()}\" />" +
                                   $"<meta name=\"comments-enabled\" content=\"{metadata.CommentsEnabled.ToString().ToLowerInvariant()}\" />" +
                                   // headHighlight +
                                   "</head><body>" + htmlBody + bodyHighlight + "</body></html>";

                var doc = new HtmlDocument();
                doc.LoadHtml(synthetic);
                return ExtractAndRender(doc, slug);
            }
            catch (Exception) {
                return Task.FromResult<IActionResult>(StatusCode(500));
            }
        }

        private (string frontMatter, string body) SplitFrontMatter(string raw) {
            if (raw.StartsWith("---")) {
                int second = raw.IndexOf("\n---", 3, StringComparison.Ordinal);
                if (second > -1) {
                    int fmEnd = second + 4; // position after second delimiter line
                    var fm = raw.Substring(3, second - 3).Trim('\r','\n');
                    var body = raw.Substring(fmEnd).TrimStart('\r','\n');
                    return (fm, body);
                }
            }
            return (string.Empty, raw);
        }

        private (string Title, string Description, DateTime DateUtc, DateTime LastModifiedUtc, bool CommentsAllowed, bool CommentsEnabled, string Lang) ParseFrontMatter(string fm, string path) {
            DateTime fileCreate = System.IO.File.GetCreationTimeUtc(path);
            DateTime fileMod = System.IO.File.GetLastWriteTimeUtc(path);
            string title = string.Empty;
            string description = string.Empty;
            DateTime dateUtc = fileCreate;
            DateTime lastModUtc = fileMod;
            bool commentsAllowed = false;
            bool commentsEnabled = false;
            string lang = "en-us";

            if (!string.IsNullOrWhiteSpace(fm)) {
                using var reader = new StringReader(fm);
                string? line;
                while ((line = reader.ReadLine()) is not null) {
                    line = line.Trim();
                    if (line.Length == 0 || line.StartsWith('#')) { continue; }
                    int colon = line.IndexOf(':');
                    if (colon <= 0) { continue; }
                    string key = line.Substring(0, colon).Trim();
                    string val = line.Substring(colon + 1).Trim().Trim('"');
                    switch (key.ToLowerInvariant()) {
                        case "title": title = val; break;
                        case "description": description = val; break;
                        case "date":
                            if (DateTime.TryParse(val, out var d)) { dateUtc = DateTime.SpecifyKind(d, DateTimeKind.Utc); }
                            break;
                        case "lastmodified":
                            if (DateTime.TryParse(val, out var m)) { lastModUtc = DateTime.SpecifyKind(m, DateTimeKind.Utc); }
                            break;
                        case "commentsallowed":
                            if (bool.TryParse(val, out var ca)) { commentsAllowed = ca; }
                            break;
                        case "commentsenabled":
                            if (bool.TryParse(val, out var ce)) { commentsEnabled = ce; }
                            break;
                        case "lang": lang = val; break;
                    }
                }
            }

            return (title, description, dateUtc, lastModUtc, commentsAllowed, commentsEnabled, lang);
        }

        private string? ExtractFirstHeading(string htmlBody) {
            try {
                var temp = new HtmlDocument();
                temp.LoadHtml(htmlBody);
                var h1 = temp.DocumentNode.SelectSingleNode("//h1");
                return h1?.InnerText.Trim();
            } catch { return null; }
        }

        private Task<IActionResult> ExtractAndRender(HtmlDocument doc, string slug) {
            var node = doc.DocumentNode.SelectSingleNode("//body");
            if (node is null) { return Task.FromResult<IActionResult>(NotFound()); }
            PageContent = node.InnerHtml;

            var titleElement = doc.DocumentNode.SelectSingleNode("//title");
            if (titleElement is not null) { Title = titleElement.InnerText; }

            MetaElements = doc.DocumentNode.SelectNodes("//head/meta");
            LinkElements = doc.DocumentNode.SelectNodes("//head/link");
            StyleElements = doc.DocumentNode.SelectNodes("//head/style");
            HeadScriptElements = doc.DocumentNode.SelectNodes("//head/script");
            BodyScriptElements = doc.DocumentNode.SelectNodes("//body/script");

            var createMeta = doc.DocumentNode.SelectSingleNode("//meta[@http-equiv='date']/@content");
            if (createMeta is not null) {
                CreatedGmt = createMeta.Attributes["content"].Value;
                CreateDate = DateTime.ParseExact(CreatedGmt, "s", DateTimeFormatInfo.InvariantInfo);
                Created = CreateDate.ToLongDateString();
            }

            var modMeta = doc.DocumentNode.SelectSingleNode("//meta[@http-equiv='last-modified']/@content");
            if (modMeta is not null) {
                ModifiedGmt = modMeta.Attributes["content"].Value;
                ModifiedDate = DateTime.ParseExact(ModifiedGmt, "s", DateTimeFormatInfo.InvariantInfo);
                Modified = ModifiedDate.ToLongDateString();
            }

            var descriptionNode = doc.DocumentNode.SelectSingleNode("//meta[@name='description']/@content");
            if (descriptionNode is not null) { Description = descriptionNode.Attributes["content"].Value; }

            // Fallback: if no description meta supplied, derive from first paragraph and inject meta tag
            if (string.IsNullOrWhiteSpace(Description)) {
                try {
                    var firstPara = doc.DocumentNode.SelectSingleNode("//body//p");
                    if (firstPara is not null) {
                        var text = HtmlEntity.DeEntitize(firstPara.InnerText).Trim();
                        if (!string.IsNullOrEmpty(text)) {
                            // Trim to a reasonable meta description length (200 chars cap)
                            if (text.Length > 200) { text = text.Substring(0, 200).TrimEnd(); }
                            Description = text;
                            // Inject a meta description so downstream consumers (feeds, SEO) see it
                            var head = doc.DocumentNode.SelectSingleNode("//head");
                            if (head is not null) {
                                var meta = doc.CreateElement("meta");
                                meta.SetAttributeValue("name", "description");
                                meta.SetAttributeValue("content", Description);
                                head.AppendChild(meta);
                                // Refresh MetaElements collection so layout sections include injected node
                                MetaElements = doc.DocumentNode.SelectNodes("//head/meta");
                            }
                        }
                    }
                } catch { /* swallow fallback errors */ }
            }

            var commentNode = doc.DocumentNode.SelectSingleNode("//meta[@name='comments-allowed']/@content");
            if (commentNode is not null) { CommentsAllowed = commentNode.Attributes["content"].Value.Equals("true", StringComparison.InvariantCultureIgnoreCase); }

            commentNode = doc.DocumentNode.SelectSingleNode("//meta[@name='comments-enabled']/@content");
            if (commentNode is not null) { CommentsEnabled = commentNode.Attributes["content"].Value.Equals("true", StringComparison.InvariantCultureIgnoreCase); }

            ViewData["PageId"] = slug;
            ViewData["CommentsAllowed"] = CommentsAllowed;
            ViewData["CommentsEnabled"] = CommentsEnabled;

            var langNode = doc.DocumentNode.SelectSingleNode("/html/@lang");
            if (langNode is not null) { Language = langNode.Attributes["lang"]?.Value; }

            return Task.FromResult<IActionResult>(Page());
        }
    }
}
