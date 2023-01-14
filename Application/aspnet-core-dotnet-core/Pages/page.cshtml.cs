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

namespace aspnet_core_dotnet_core.Pages {
    public class PageLoaderModel : Microsoft.AspNetCore.Mvc.RazorPages.PageModel {
        public string Title { get; set; }
        public string PageContent { get; set; }
        public string CreatedGmt { get; set; }
        public string ModifiedGmt { get; set; }
        public string Created { get; set; }
        public string Modified { get; set; }
        public HtmlNodeCollection MetaElements { get; set; }
        public HtmlNodeCollection LinkElements { get; set; }
        public HtmlNodeCollection StyleElements { get; set; }
        public HtmlNodeCollection HeadScriptElements { get; set; }
        public HtmlNodeCollection BodyScriptElements { get; set; }

        protected IHostEnvironment Environment { get; set; }

        public PageLoaderModel(IHostEnvironment environment) {
            Environment = environment;
        }

        virtual public IActionResult OnGet() {
            object sectionObject = HttpContext.Request.RouteValues["section"];
            object slugObject = HttpContext.Request.RouteValues["slug"];
            string slug = sectionObject.ToString();

            if (slugObject is not null) {
                slug = slugObject.ToString().Trim('/');
            }

            return RetrievePage(slug);
        }

        protected IActionResult RetrievePage(string slug) {
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
                    var createDate = DateTime.ParseExact(CreatedGmt, "s", DateTimeFormatInfo.InvariantInfo);
                    Created = createDate.ToLongDateString();
                }

                var modMeta = doc.DocumentNode.SelectSingleNode("//meta[@http-equiv='last-modified']/@content");

                if (modMeta is not null) {
                    ModifiedGmt = modMeta.Attributes["content"].Value;
                    var modDate = DateTime.ParseExact(ModifiedGmt, "s", DateTimeFormatInfo.InvariantInfo);
                    Modified = modDate.ToLongDateString();
                }

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
