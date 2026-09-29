using HtmlAgilityPack;
using Microsoft.AspNetCore.Http.HttpResults;
using System.Globalization;
using System;

using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.Extensions.Hosting;
using System.IO;
using System.Threading.Tasks;
using System.Text.Encodings.Web;

namespace ParksComputing.Engine.Pages {
    public class SrcModel : PageModel {
        public string? PageContent { get; set; }

        private IHostEnvironment Environment { get; set; }

        public SrcModel(IHostEnvironment environment) {
            Environment = environment;
        }

        public async Task<IActionResult> OnGetAsync() {
            ViewData.Add("language", "plaintext");
            object? slugObject = HttpContext.Request.RouteValues["slug"];
            string slug = string.Empty;

            if (slugObject is not null) {
                slug = slugObject?.ToString()!.Trim('/')!;
            }

            try {
                // The listing must be a file under wwwroot: a path that climbs
                // out of it, however it is spelled, is refused.
                var root = Path.GetFullPath(Path.Combine(Environment.ContentRootPath, "wwwroot"));
                var path = Path.GetFullPath(Path.Combine(root, slug));
                if (!path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal)) { return NotFound(); }
                PageContent = await System.IO.File.ReadAllTextAsync(path);
                // A download of the listing keeps the file's own name.
                ViewData["filename"] = Path.GetFileName(path);
                var encoder = HtmlEncoder.Default;
                PageContent = encoder.Encode(PageContent);

                if (Request.Query.ContainsKey("language")) {
                    ViewData["language"] = $"language-{Request.Query["language"]}";
                }
            }
            catch (Exception) {
                return NotFound();
            }

            return Page();
        }
    }
}
