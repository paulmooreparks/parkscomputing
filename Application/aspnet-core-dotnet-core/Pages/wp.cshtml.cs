using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace aspnet_core_dotnet_core.Pages {
    public class wpModel : PageModel {

        public string WpContent { get; set; }

        public void OnGet() {
            var query = this.HttpContext.Request.Query;

            if (query.ContainsKey("slug")) {
                string slug = query["slug"];
            }
        }
    }
}
