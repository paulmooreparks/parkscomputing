using System;
using System.Collections.Generic;
using ParksComputing.Xfer.Lang;
using ParksComputing.Xfer.Lang.Attributes;

namespace ParksComputing.Engine.Pages.Services;

public class NavNode {
    public NavNode() {
        Nav = Array.Empty<NavNode>();
    }

    [XferProperty("slug")]
    public string? Slug { get; set; }

    [XferProperty("title")]
    public string? Title { get; set; }

    [XferProperty("description")]
    public string? Description { get; set; }

    [XferProperty("excerpt")]
    public string? Excerpt { get; set; }

    // Unified URL (was link). Retain old property for JSON compatibility.
    [XferProperty("url")]
    public string? Url { get; set; }

    [XferProperty("link")]
    public string? Link { get => Url; set { if (!string.IsNullOrWhiteSpace(value)) { Url = value; } } }

    [XferProperty("target")]
    public string? Target { get; set; }

    [XferProperty("date")]
    public DateTime? Date { get; set; }

    [XferProperty("updated")]
    public DateTime? Updated { get; set; }

    [XferProperty("order")]
    public int? Order { get; set; }

    [XferProperty("external")]
    public bool External { get; set; }

    // True if url was derived (not explicitly specified in source)
    public bool DerivedUrl { get; set; }

    // Tags this entry is categorized under; merged with the content file's
    // keywords metadata by NavService enrichment.
    [XferProperty("tags")]
    public string[]? Tags { get; set; }

    // True when an external destination permits framing and should open as
    // a window in the window view. Only the author can assert this, since
    // most large sites refuse framing and a refused frame is not reliably
    // detectable from script.
    /// <summary>The page's preferred default window shape, "w,h" as
    /// fractions of the desktop (e.g. "0.17,0.58" for a portrait app).
    /// A placement in the URL always wins over it.</summary>
    [XferProperty("win")]
    public string? Win { get; set; }

    /// <summary>"content" when the page's window takes its content's size
    /// and follows it (PUDL 0.35.0), as a dialog does; win is then ignored.
    /// Anything else, or nothing, leaves the reader sizing the window.</summary>
    [XferProperty("size")]
    public string? Size { get; set; }

    /// <summary>The smallest and largest size, "w,h" in pixels, a window
    /// the reader sizes may take, such as a terminal's usable grid.</summary>
    [XferProperty("min")]
    public string? Min { get; set; }

    [XferProperty("max")]
    public string? Max { get; set; }

    [XferProperty("frame")]
    public bool Frame { get; set; }

    /// <summary>The entry's icon: the address of a full-colour image on
    /// this site, such as "/images/icons/terminal.svg", shown wherever the
    /// entry stands for the thing itself (the site menu, a window's title
    /// bar). Chrome glyphs are the stylesheet's, not the navigation's.</summary>
    [XferProperty("icon")]
    public string? Icon { get; set; }

    [XferProperty("nav")]
    public NavNode[]? Nav { get; set; }

    [XferProperty("links")]
    public NavNode[]? Links { get => Nav; set { if (value != null) { Nav = value; } } }

    /// <summary>
    /// On a section: its entries are articles, dated pieces of writing.
    /// Their dates, descriptions and excerpts are read from their content
    /// files where sitenav.xfer leaves them out, and they make up the RSS
    /// feed, newest first. Other sections' entries take only a title from
    /// their files. The articles used to be a separate posts array; they
    /// are an ordinary section now (2026-10-01), in the order the file
    /// gives, as every section is.
    /// </summary>
    [XferProperty("feed")]
    public bool Feed { get; set; }

    /// <summary>The site's menu bar, on the root only
    /// (Architecture/site-menu-design.md). Each entry is a title of the
    /// logo menu, the first being the logo's own, and its nav holds the
    /// title's entries: a link (a slug, which borrows the rest from the nav
    /// entry of that slug, or a url), a command, a submenu (a title with a
    /// nav), a heading (a heading with a nav), a separator, or a from that
    /// stands for entries of the nav. The admin site's admin-menu.xfer
    /// reads the same property in its older shape, a list of the logo's
    /// entries with groups for headings.</summary>
    [XferProperty("menu")]
    public NavNode[]? Menu { get; set; }

    /// <summary>In the menu: a heading over the entries of this entry's nav.</summary>
    [XferProperty("heading")]
    public string? Heading { get; set; }

    /// <summary>In the menu: a separator between the entries around it.</summary>
    [XferProperty("separator")]
    public bool Separator { get; set; }

    /// <summary>In the menu: the name of the command this entry carries
    /// out, one the site knows (Pages/Services/SiteCommands.cs).</summary>
    [XferProperty("command")]
    public string? Command { get; set; }

    /// <summary>In the menu: the command's parameters, by name.</summary>
    [XferProperty("args")]
    public Dictionary<string, string>? Args { get; set; }

    /// <summary>In the menu: "window" or "classic", for an entry shown in
    /// that view only.</summary>
    [XferProperty("when")]
    public string? When { get; set; }

    /// <summary>In the menu: entries of the nav, in its order, kept in step
    /// with it: "sections" for every section, or a section's slug for the
    /// entries of that section.</summary>
    [XferProperty("from")]
    public string? From { get; set; }

    // (Legacy alias properties removed to prevent duplicate key collisions in Xfer deserializer.)
}
