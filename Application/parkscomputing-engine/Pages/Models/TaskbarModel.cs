using System;
using System.Collections.Generic;

namespace ParksComputing.Engine.Pages.Models;

/// <summary>
/// The taskbar along the bottom of a page of windows (Pages/Shared/_Taskbar.cshtml,
/// Architecture/admin-and-identity-design.md, A12): a Start menu, the dock of
/// open windows, and the window-wide actions. It knows nothing about the page
/// it sits on; the page hands it the Start menu's entries.
/// </summary>
public sealed class TaskbarModel {
    public string StartLabel { get; init; } = "Start";
    public IReadOnlyList<TaskbarEntry> Entries { get; init; } = Array.Empty<TaskbarEntry>();
}

/// <summary>
/// One entry in the Start menu. It opens a window by its key, or makes a PUDL
/// applet request (a new terminal, say) with <see cref="Request"/>; either way
/// <see cref="Href"/> is where it leads without script. <see cref="Glyph"/>
/// names a PUDL glyph.
/// </summary>
public sealed record TaskbarEntry(string Label, string Href, string Glyph, string? Window = null, string? Request = null);
