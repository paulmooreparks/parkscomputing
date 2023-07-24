using aspnet_core_dotnet_core.Pages.Services;
using System.Collections.Generic;

using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.Extensions.Hosting;

namespace aspnet_core_dotnet_core.Pages
{
    public class RssModel : PageLoaderModel
    {
        public INavService NavService { get; set; }
        public NavRoot NavRoot { get; set; }
        public List<string> NavNodes { get; set; } = new();

        public RssModel(INavService navService, IHostEnvironment environment) : base(environment) {
            NavService = navService;
        }

        public override IActionResult OnGet() {
            NavRoot = NavService.GetNavRoot();
            return RetrievePage("index");
        }
    }
}
