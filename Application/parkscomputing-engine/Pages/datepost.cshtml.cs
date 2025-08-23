using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace ParksComputing.Engine.Pages
{
    public class DatePostModel : PageModel
    {
        public IActionResult OnGet() {
            object? slugObject = HttpContext.Request.RouteValues["slug"];
            return RedirectToPagePermanent("/post", slugObject);
        }
    }
}
