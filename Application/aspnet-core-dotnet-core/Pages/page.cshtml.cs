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
using Azure;
using SmartSam.Comments.Lib;
using System.Collections.Generic;

namespace aspnet_core_dotnet_core.Pages {
    public class PageLoaderModel : Microsoft.AspNetCore.Mvc.RazorPages.PageModel {
        public string Title { get; set; }
        public string PageContent { get; set; }
        public string CreatedGmt { get; set; }
        public string ModifiedGmt { get; set; }
        public DateTime CreateDate { get; set; } = DateTime.UtcNow;
        public DateTime ModifiedDate { get; set; } = DateTime.UtcNow;
        public string Created { get; set; }
        public string Modified { get; set; }
        public string Description { get; set; } = string.Empty;
        public string Language { get; set; } = "en-us";

        public ICommentService CommentService { get; set; }
        public bool CommentsAllowed { get; set; } = false;
        public bool CommentsEnabled { get; set; } = false;
        public HtmlNodeCollection MetaElements { get; set; }
        public HtmlNodeCollection LinkElements { get; set; }
        public HtmlNodeCollection StyleElements { get; set; }
        public HtmlNodeCollection HeadScriptElements { get; set; }
        public HtmlNodeCollection BodyScriptElements { get; set; }

        protected IHostEnvironment Environment { get; set; }
        public List<CommentResponse> CommentResponse { get; set; }

        public PageLoaderModel(ICommentService commentService, IHostEnvironment environment) {
            CommentService = commentService;
            Environment = environment;
        }

        virtual public Task<IActionResult> OnGetAsync() {
            object sectionObject = HttpContext.Request.RouteValues["section"];
            object slugObject = HttpContext.Request.RouteValues["slug"];
            string slug = sectionObject.ToString();

            if (slugObject is not null) {
                slug = slugObject.ToString().Trim('/');
            }

            return RetrievePage(slug);
        }

        protected async Task<IActionResult> RetrievePage(string slug) {
            try {
                var path = $"{Environment.ContentRootPath}/wwwroot/content/{slug}.html";
                var doc = new HtmlDocument();
                doc.Load(path);
                var node = doc.DocumentNode.SelectSingleNode("//body");

                if (node is not null) {
                    PageContent = node.InnerHtml;
                }
                else {
                    return NotFound();
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

                // CommentResponse = await CommentService.GetCommentsAsync(slug);

                return Page();
            }
            catch (FileNotFoundException) {
                return NotFound();
            }
            catch (DirectoryNotFoundException) {
                return NotFound();
            }
            catch (Exception) {
                return StatusCode(500);
            }
        }
    }
}
