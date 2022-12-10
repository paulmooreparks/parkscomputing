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

namespace aspnet_core_dotnet_core.Pages {
    public class IndexModel : PageModel {
        public string NavContent { get; set; }
        public List<string> NavNodes { get; set; } = new();
        private IHostEnvironment Environment { get; set; }
        public IndexModel(IHostEnvironment environment) {
            Environment = environment;
        }


        public IActionResult OnGet() {
            var path = $"{Environment.ContentRootPath}/wwwroot/sitenav.json";
            var json = System.IO.File.ReadAllText(path);
            var navRoot = JsonConvert.DeserializeObject<NavRoot>(json);

            foreach (var post in navRoot.posts) {
                string node = $"<div class='col-md-4'><h2><a href='{post.link}'>{post.title}</a></h2><p>{post.excerpt}</p><p><a class=\"btn btn-default\" href=\"{post.link}\">More &raquo;</a></p></div>";
                NavNodes.Add(node);
            }

            return Page();
        }

        public string DoTest() {
            return "Index";
        }
    }

    struct NavRoot { 
        public NavNode nav { get; set; }
        public NavNode[] posts { get; set; }
    }

    struct NavNode { 
        public string key { get; set; }
        public string title { get; set; }
        public string excerpt { get; set; }
        public string link { get; set; }
        public NavNode[] links { get; set; }
    }
}