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

        /// <summary>The site's public origin, such as https://padmajairam.com,
        /// for whole addresses in canonical links, the sitemap, llms.txt and
        /// shared links. Behind the tunnel a request arrives as plain http
        /// on an internal host, so the request cannot say it. Unset, the
        /// request's own origin is used.</summary>
        public string? Origin { get; set; }

        /// <summary>Who writes the site's articles, for their structured
        /// data; unset, the site's title from sitenav.xfer.</summary>
        public string? Author { get; set; }

        /// <summary>The time zone the site's staff keep, such as
        /// Asia/Singapore, for the times its editing pages show; unset, UTC.</summary>
        public string? TimeZone { get; set; }

        /// <summary>Where the site's own analytics show visits by people,
        /// such as its Plausible dashboard, which the staff's Visits page
        /// links to; the site itself counts only automated readers.</summary>
        public string? AnalyticsUrl { get; set; }

        /// <summary>How the site's content may be used by automated systems,
        /// as robots.txt's Content-Signal line gives it (contentsignals.org),
        /// such as "search=yes, ai-input=yes, ai-train=yes". Unset, robots.txt
        /// says nothing of it; it is the site owner's choice.</summary>
        public string? ContentSignal { get; set; }

        public bool Brochure => string.Equals(Mode, "brochure", StringComparison.OrdinalIgnoreCase);

        public string UrlOf(string slug) => PageUrl.Replace("{slug}", slug, StringComparison.Ordinal);
    }
}
