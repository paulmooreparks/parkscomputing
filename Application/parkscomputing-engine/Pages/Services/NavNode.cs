using System;
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

    /// <summary>The site menu, the logo's menu in the topbar, on the root
    /// only. An entry naming only a slug borrows the rest (title, icon,
    /// address, window shape) from the nav entry of that slug; an entry
    /// with a nav of its own is a labelled group of entries.</summary>
    [XferProperty("menu")]
    public NavNode[]? Menu { get; set; }

    // (Legacy alias properties removed to prevent duplicate key collisions in Xfer deserializer.)
}
