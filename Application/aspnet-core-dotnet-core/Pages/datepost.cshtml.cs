using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace aspnet_core_dotnet_core.Pages
{
    public class DatePostModel : PageModel
    {
        public IActionResult OnGet() {
            object? slugObject = HttpContext.Request.RouteValues["slug"];
            return RedirectToPagePermanent("/post", slugObject);
        }
    }
}
