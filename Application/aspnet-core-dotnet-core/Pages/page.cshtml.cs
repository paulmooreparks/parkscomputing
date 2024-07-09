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
using aspnet_core_dotnet_core.Pages.Services;
using SmartSam.Comments.Lib;
using System.Collections.Generic;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;

namespace aspnet_core_dotnet_core.Pages {
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
                var path = $"{Environment.ContentRootPath}/wwwroot/content/{slug}.html";
                var doc = new HtmlDocument();
                doc.Load(path);
                var node = doc.DocumentNode.SelectSingleNode("//body");

                if (node is not null) {
                    PageContent = node.InnerHtml;
                }
                else {
                    return Task.FromResult<IActionResult>(NotFound());
                }

                var titleElement = doc.DocumentNode.SelectSingleNode("//title");

                if (titleElement is not null) {
                    Title = titleElement.InnerText;
                }

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

                if (descriptionNode is not null) {
                    Description = descriptionNode.Attributes["content"].Value;
                }

                var commentNode = doc.DocumentNode.SelectSingleNode("//meta[@name='comments-allowed']/@content");

                if (commentNode is not null) {
                    CommentsAllowed = commentNode.Attributes["content"].Value.Equals("true", StringComparison.InvariantCultureIgnoreCase);
                }

                commentNode = doc.DocumentNode.SelectSingleNode("//meta[@name='comments-enabled']/@content");

                if (commentNode is not null) {
                    CommentsEnabled = commentNode.Attributes["content"].Value.Equals("true", StringComparison.InvariantCultureIgnoreCase);
                }

                ViewData["PageId"] = slug;
                ViewData["CommentsAllowed"] = CommentsAllowed;
                ViewData["CommentsEnabled"] = CommentsEnabled;

                var langNode = doc.DocumentNode.SelectSingleNode("/html/@lang");

                if (langNode is not null) {
                    Language = langNode.Attributes["lang"]?.Value;
                }

                return Task.FromResult<IActionResult>(Page());
            }
            catch (FileNotFoundException) {
                return Task.FromResult<IActionResult>(NotFound());
            }
            catch (DirectoryNotFoundException) {
                return Task.FromResult<IActionResult>(NotFound());
            }
            catch (Exception) {
                return Task.FromResult<IActionResult>(StatusCode(500));
            }
        }
    }
}
