using System;
using System.Collections.Generic;
using ParksComputing.XferLang.Serialization;

namespace ParksComputing.Engine.Pages.Services;

public class NavNode {
    public NavNode() {
        Nav = Array.Empty<NavNode>();
    }

    [XferPropertyName("slug")]
    public string? Slug { get; set; }

    [XferPropertyName("title")]
    public string? Title { get; set; }

    [XferPropertyName("description")]
    public string? Description { get; set; }

    [XferPropertyName("excerpt")]
    public string? Excerpt { get; set; }

    // Unified URL (was link). The old key is read as an alias and never
    // written; the old property stays for JSON compatibility.
    [XferPropertyName("url", Aliases = ["link"])]
    public string? Url { get; set; }

    [XferIgnore]
    public string? Link { get => Url; set { if (!string.IsNullOrWhiteSpace(value)) { Url = value; } } }

    [XferPropertyName("target")]
    public string? Target { get; set; }

    [XferPropertyName("date")]
    public DateTime? Date { get; set; }

    [XferPropertyName("updated")]
    public DateTime? Updated { get; set; }

    [XferPropertyName("order")]
    public int? Order { get; set; }

    [XferPropertyName("external")]
    public bool External { get; set; }

    // True if url was derived (not explicitly specified in source)
    [XferIgnore]
    public bool DerivedUrl { get; set; }

    // Tags this entry is categorized under; merged with the content file's
    // keywords metadata by NavService enrichment.
    [XferPropertyName("tags")]
    public string[]? Tags { get; set; }

    // True when an external destination permits framing and should open as
    // a window in the window view. Only the author can assert this, since
    // most large sites refuse framing and a refused frame is not reliably
    // detectable from script.
    /// <summary>The page's preferred default window shape, "w,h" as
    /// fractions of the desktop (e.g. "0.17,0.58" for a portrait app).
    /// A placement in the URL always wins over it.</summary>
    [XferPropertyName("win")]
    public string? Win { get; set; }

    /// <summary>The smallest and largest size, "w,h" in pixels, a window
    /// the reader sizes may take, such as a terminal's usable grid.</summary>
    [XferPropertyName("min")]
    public string? Min { get; set; }

    [XferPropertyName("max")]
    public string? Max { get; set; }

    [XferPropertyName("frame")]
    public bool Frame { get; set; }

    /// <summary>The entry's icon: the address of a full-colour image on
    /// this site, such as "/images/icons/terminal.svg", shown wherever the
    /// entry stands for the thing itself (the site menu, a window's title
    /// bar). Chrome glyphs are the stylesheet's, not the navigation's.</summary>
    [XferPropertyName("icon")]
    public string? Icon { get; set; }

    // The old key "links" is read as an alias and never written.
    [XferPropertyName("nav", Aliases = ["links"])]
    public NavNode[]? Nav { get; set; }

    [XferIgnore]
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
    [XferPropertyName("feed")]
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
    [XferPropertyName("menu")]
    public NavNode[]? Menu { get; set; }

    /// <summary>The stable PUDL identity of a menu title.</summary>
    [XferPropertyName("menu-id")]
    public string? MenuId { get; set; }

    [XferPropertyName("window-commands")]
    public bool WindowCommands { get; set; }

    /// <summary>In the menu: a heading over the entries of this entry's nav.</summary>
    [XferPropertyName("heading")]
    public string? Heading { get; set; }

    /// <summary>In the menu: a separator between the entries around it.</summary>
    [XferPropertyName("separator")]
    public bool Separator { get; set; }

    /// <summary>In the menu: the name of the command this entry carries
    /// out, one the site knows (Pages/Services/SiteCommands.cs).</summary>
    [XferPropertyName("command")]
    public string? Command { get; set; }

    /// <summary>In the menu: the command's parameters, by name.</summary>
    [XferPropertyName("args")]
    public Dictionary<string, string>? Args { get; set; }

    /// <summary>In the menu: "window" or "classic", for an entry shown in
    /// that view only.</summary>
    [XferPropertyName("when")]
    public string? When { get; set; }

    /// <summary>In the menu: entries of the nav, in its order, kept in step
    /// with it: "sections" for every section, or a section's slug for the
    /// entries of that section.</summary>
    [XferPropertyName("from")]
    public string? From { get; set; }

}
