using aspnet_core_dotnet_core.Pages.Services;
using System.Collections.Generic;

using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.Extensions.Hosting;
using System.Threading.Tasks;

namespace aspnet_core_dotnet_core.Pages
{
    public class RssModel : PageLoaderModel
    {
        public INavService NavService { get; set; }
        public NavRoot NavRoot { get; set; }
        public List<string> NavNodes { get; set; } = new();

        public RssModel(INavService navService, ICommentService commentService, IHostEnvironment environment) : base(commentService, environment) {
            NavService = navService;
        }

        override public Task<IActionResult> OnGetAsync() {
            NavRoot = NavService.GetNavRoot();
            return RetrievePage("index");
        }
    }
}
