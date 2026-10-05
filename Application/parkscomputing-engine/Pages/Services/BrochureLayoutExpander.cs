using System.Collections.Generic;
using System.Linq;

using Microsoft.AspNetCore.Mvc.Razor;

namespace ParksComputing.Engine.Pages.Services {
    /// <summary>
    /// On a brochure site (SiteOptions.Brochure), every page that asks for
    /// _Layout gets _BrochureLayout instead: the classic view only, plain,
    /// and the same for every brochure site, whose own header, footer and
    /// look come from its content. A desktop site is left as it is.
    /// </summary>
    public sealed class BrochureLayoutExpander : IViewLocationExpander {
        private readonly bool _brochure;

        public BrochureLayoutExpander(SiteOptions site) { _brochure = site.Brochure; }

        public void PopulateValues(ViewLocationExpanderContext context) {
            context.Values["site-brochure"] = _brochure ? "1" : "0";
        }

        public IEnumerable<string> ExpandViewLocations(ViewLocationExpanderContext context, IEnumerable<string> viewLocations) {
            if (!_brochure || context.ViewName != "_Layout") { return viewLocations; }
            return viewLocations.Select(l => l.Replace("{0}", "_BrochureLayout"));
        }
    }
}
