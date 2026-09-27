using System;

namespace ParksComputing.Engine.Pages.Models;

/// <summary>
/// One PUDL window, as _Window.cshtml renders it. The placement fields are
/// set only when the server renders a window the URL names into the desktop
/// page; the /window/{key} fetch endpoint leaves them null and the script
/// supplies the placement.
/// </summary>
public class WindowViewModel {
    public required string Key { get; init; }
    public required string Title { get; init; }
    public required string BodyHtml { get; init; }
    public required string PageUrl { get; init; }

    /// <summary>The parent window's key for a child window (PUDL 0.7.0);
    /// null for a top-level article window.</summary>
    public string? Parent { get; init; }

    /// <summary>True for content that brings its own scripts or styles;
    /// the window then hosts the article's page in a frame.</summary>
    public bool OwnDocument { get; init; }

    /// <summary>An external URL the window frames directly (a sitenav node
    /// marked frame ~true); null otherwise.</summary>
    public string? FrameUrl { get; init; }

    /// <summary>The tags the article is categorized under, for the tag row
    /// at the top of the window.</summary>
    public string[] Tags { get; init; } = Array.Empty<string>();

    /// <summary>The article's creation and revision dates, for the date
    /// line the window shows like the article's own page does.</summary>
    public DateTime? Created { get; init; }
    public DateTime? Updated { get; init; }

    public string? Mode { get; init; }
    public double? X { get; init; }
    public double? Y { get; init; }
    public double? W { get; init; }
    public double? H { get; init; }
    public bool Minimized { get; init; }
    public bool Active { get; init; }
}
