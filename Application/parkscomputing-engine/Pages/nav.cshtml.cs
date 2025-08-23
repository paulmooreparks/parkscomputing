using System.Collections.Generic;
using System.Xml.Linq;

using ParksComputing.Engine.Pages.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace ParksComputing.Engine.Pages {
    public class NavModel : PageModel {
        public INavService NavService { get; set; }
        public NavRoot NavRoot { get; set; }
        public NavNode NavNode { get; set; }
        public List<string> NavNodes { get; set; } = new();
        public string? Section { get; set; }

        public NavModel(INavService navService) {
            NavService = navService;
            NavRoot = NavService.GetNavRoot();
            NavNode = GetSection(NavRoot.nav!, Section!);
        }

        public void OnGet() {
            object? sectionObject = HttpContext.Request.RouteValues["section"];
            Section = sectionObject?.ToString();
        }

        private NavNode GetSection(NavNode parent, string section) {
            NavNode retVal = FindSection(parent, section);
            return retVal;
        }

        private NavNode FindSection(NavNode node, string section) {
            if (node.key == section) {
                return node;
            }

            if (node is not null && node.links is not null) {
                foreach (var child in node.links) {
                    NavNode retVal = FindSection(child, section);

                    if (retVal.key == section) {
                        return retVal;
                    }
                }
            }

            return new NavNode();
        }
    }
}
