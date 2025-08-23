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
using Microsoft.Extensions.DependencyInjection;
using HtmlAgilityPack;
using Microsoft.AspNetCore.Http.HttpResults;
using System.IO;

namespace ParksComputing.Engine.Pages {
    public class IndexModel : PageLoaderModel {
        public INavService NavService { get; set; }
        public NavRoot? NavRoot { get; set; }
        public List<string>? NavNodes { get; set; } = new();

        public IndexModel(AppServices services) : base(services) {
            NavService = services.NavService;
        }

        override public Task<IActionResult> OnGetAsync() {
            NavRoot = NavService.GetNavRoot();
            return RetrievePage("index");
        }

        public string DoTest() {
            return "Index";
        }
    }
}
