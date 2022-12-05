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

namespace aspnet_core_dotnet_core.Pages {
    public class IndexModel : PageModel {
        public string WpContent { get; set; }

        public IActionResult OnGet() {
            // PageContent = $"<p>List of posts here</p>";
            return Page();
        }

        public string DoTest() {
            return "Index";
        }
    }
}