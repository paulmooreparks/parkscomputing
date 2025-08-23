using ParksComputing.Engine.Pages.Services;
using System.Collections.Generic;

using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.Extensions.Hosting;
using System.Threading.Tasks;
using System.Net.Http;
using System;

namespace ParksComputing.Engine.Pages {
    public class RssModel : PageLoaderModel {
        public INavService NavService { get; set; }
        public NavRoot? NavRoot { get; set; }
        public List<string>? NavNodes { get; set; } = new();

        public RssModel(AppServices services) : base(services) {
            NavService = services.NavService;
        }

        override public Task<IActionResult> OnGetAsync() {
            NavRoot = NavService.GetNavRoot();
            return RetrievePage("index");
        }
    }
}
