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

        /// <summary>The selected category from ?cat=; the nav tabs filter
        /// which cards the home page shows. Null means all.</summary>
        public string? Cat { get; private set; }

        /// <summary>The cards the page shows: the selected section's entries,
        /// or with no section every section's, each once, in sitenav.xfer's
        /// order (Paul, 2026-10-01).</summary>
        public IReadOnlyList<NavNode> Entries { get; private set; } = new List<NavNode>();

        /// <summary>The words at the top of the list: the selected section's
        /// description, or with no section the site's own (the root entry's).
        /// Content files place it with {{HEADING}}.</summary>
        public string? Heading { get; private set; }

        public IndexModel(AppServices services) : base(services) {
        }

        override public Task<IActionResult> OnGetAsync() {
            Root = NavService.GetRoot();

            var cat = HttpContext.Request.Query["cat"].FirstOrDefault();
            var section = cat is null ? null : ParksComputing.Engine.Pages.Services.NavService.Sections(Root).FirstOrDefault(n => n.Slug == cat);
            if (section is not null) {
                Cat = cat;
                Entries = section.Nav!.ToList();
                Heading = section.Description ?? section.Title;
            }
            else {
                Entries = ParksComputing.Engine.Pages.Services.NavService.Sections(Root).SelectMany(s => s.Nav!)
                    .Where(n => !string.IsNullOrEmpty(n.Slug))
                    .GroupBy(n => n.Slug!, StringComparer.OrdinalIgnoreCase).Select(g => g.First())
                    .ToList();
                Heading = Root.Description ?? Root.Title;
            }

            ViewData["NavCat"] = Cat;
            ViewData["NavHome"] = true;
            return RetrievePage("index");
        }

        public string DoTest() {
            return "Index";
        }

        protected override string ProcessContentPlaceholders(string content) {
            // The heading follows the selected section.
            content = content.Replace("{{HEADING}}", System.Net.WebUtility.HtmlEncode(Heading ?? string.Empty));

            // Handle legacy {{POSTS}} placeholder for backward compatibility
            if (content.Contains("{{POSTS}}")) {
                content = content.Replace("{{POSTS}}", "<posts-content></posts-content>");
            }

            // Process posts-content elements: the selected section's entries.
            var customElements = CustomElementParser.ParseCustomElements(content);

            foreach (var element in customElements.Where(e => e.TagName == "posts-content"))
            {
                var model = PostsContentModel.FromAttributes(element.Attributes, Entries);
                var marker = $"RENDER_POSTS_{Guid.NewGuid():N}";
                ViewData[marker] = model;
                content = CustomElementParser.ReplaceCustomElement(content, element, marker);
            }

            // Call base method to handle nav-content and other elements
            return base.ProcessContentPlaceholders(content);
        }
    }
}
