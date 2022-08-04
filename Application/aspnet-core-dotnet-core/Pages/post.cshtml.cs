using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace aspnet_core_dotnet_core.Pages {
    public class wpModel : PageModel {

        public string WpContent { get; set; }

        public void OnGet() {
            object slugObject = HttpContext.Request.RouteValues["slug"];

            if (slugObject is not null) {
                WpContent = slugObject.ToString();
                return;
            }

            WpContent = "List of posts here";
        }
    }
}
