using System;
using System.Collections.Generic;
using System.Linq;
using System.Globalization;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;

using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using System.Reflection;
using NuGet.Protocol.Core.Types;
using static System.Net.Mime.MediaTypeNames;
using System.Collections;
using Microsoft.Extensions.Hosting;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json;
using ParksComputing.Engine.Pages.Services;
using ParksComputing.Engine.Pages.Shared;
using ParksComputing.Engine.Pages.Models;
using Microsoft.Extensions.DependencyInjection;
using HtmlAgilityPack;
using Microsoft.AspNetCore.Http.HttpResults;
using System.IO;

namespace ParksComputing.Engine.Pages {
    public class IndexModel : PageLoaderModel {
        public NavNode? Root { get; set; }
        public List<string>? NavNodes { get; set; } = new();

        public IndexModel(AppServices services) : base(services) {
        }

        override public Task<IActionResult> OnGetAsync() {
            Root = NavService.GetRoot();
            return RetrievePage("index");
        }

        public string DoTest() {
            return "Index";
        }

        protected override string ProcessContentPlaceholders(string content) {
            // Handle legacy {{POSTS}} placeholder for backward compatibility
            if (content.Contains("{{POSTS}}") && Root?.Posts != null) {
                content = content.Replace("{{POSTS}}", "<posts-content></posts-content>");
            }

            // Process posts-content elements
            var customElements = CustomElementParser.ParseCustomElements(content);

            foreach (var element in customElements.Where(e => e.TagName == "posts-content"))
            {
                if (Root?.Posts != null)
                {
                    var model = PostsContentModel.FromAttributes(element.Attributes, Root);
                    var marker = $"RENDER_POSTS_{Guid.NewGuid():N}";
                    ViewData[marker] = model;
                    content = CustomElementParser.ReplaceCustomElement(content, element, marker);
                }
            }

            // Call base method to handle nav-content and other elements
            return base.ProcessContentPlaceholders(content);
        }
    }
}
