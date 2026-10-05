using System;

namespace ParksComputing.Engine.Pages.Services {
    /// <summary>
    /// What kind of site the engine serves, from the Site section of the
    /// configuration (Architecture/padmajairam-port-design.md). The default
    /// is parkscomputing.com's: the window view at the root and each page at
    /// /page/{slug}. A brochure site is the classic view only: its home page
    /// at the root, its own plain layout (Pages/Shared/_BrochureLayout), and
    /// no window view.
    /// </summary>
    public sealed class SiteOptions {
        public const string Section = "Site";

        /// <summary>"desktop" (the default) or "brochure".</summary>
        public string Mode { get; set; } = "desktop";

        /// <summary>The address of a page in the site's navigation, with
        /// {slug} for the page's slug: "/page/{slug}" by default, and
        /// "/{slug}/" for a site that keeps WordPress's addresses.</summary>
        public string PageUrl { get; set; } = "/page/{slug}";

        public bool Brochure => string.Equals(Mode, "brochure", StringComparison.OrdinalIgnoreCase);

        public string UrlOf(string slug) => PageUrl.Replace("{slug}", slug, StringComparison.Ordinal);
    }
}
