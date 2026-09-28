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

    [XferProperty("frame")]
    public bool Frame { get; set; }

    [XferProperty("nav")]
    public NavNode[]? Nav { get; set; }

    [XferProperty("links")]
    public NavNode[]? Links { get => Nav; set { if (value != null) { Nav = value; } } }

    [XferProperty("posts")]
    public NavNode[]? Posts { get; set; }

    // (Legacy alias properties removed to prevent duplicate key collisions in Xfer deserializer.)
}
