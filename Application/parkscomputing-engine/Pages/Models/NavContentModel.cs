using System.Collections.Generic;
using System.Linq;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Pages.Models
{
    public class NavContentModel
    {
        public NavNode? NavNode { get; set; }
        public string Format { get; set; } = "horizontal"; // horizontal, vertical, dropdown, breadcrumb, sidebar
        public string Style { get; set; } = "";
        public int MaxDepth { get; set; } = 2; // How many levels to show
        public bool ShowRoot { get; set; } = true; // Whether to show the root item
        public bool ShowDescriptions { get; set; } = false; // Show descriptions as tooltips or text
        public string CssClass { get; set; } = "";

        public static NavContentModel FromAttributes(Dictionary<string, string> attributes, NavNode? navNode)
        {
            var model = new NavContentModel { NavNode = navNode };

            if (attributes.TryGetValue("format", out var format))
                model.Format = format.ToLowerInvariant();

            if (attributes.TryGetValue("style", out var style))
                model.Style = style;

            if (attributes.TryGetValue("max-depth", out var maxDepthStr) && int.TryParse(maxDepthStr, out var maxDepth))
                model.MaxDepth = maxDepth;

            if (attributes.TryGetValue("show-root", out var showRootStr) && bool.TryParse(showRootStr, out var showRoot))
                model.ShowRoot = showRoot;

            if (attributes.TryGetValue("show-descriptions", out var showDescStr) && bool.TryParse(showDescStr, out var showDesc))
                model.ShowDescriptions = showDesc;

            if (attributes.TryGetValue("css-class", out var cssClass))
                model.CssClass = cssClass;

            return model;
        }

        public string GetContainerCssClass()
        {
            var classes = new List<string> { "nav-content" };

            classes.Add($"nav-content-{Format}");

            if (!string.IsNullOrEmpty(Style))
                classes.Add($"nav-content-{Style}");

            if (!string.IsNullOrEmpty(CssClass))
                classes.Add(CssClass);

            return string.Join(" ", classes);
        }
    }
}
