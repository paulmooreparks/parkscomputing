namespace ParksComputing.Engine.Pages.Models;

/// <summary>
/// The window bar at the foot of a page of windows' window area
/// (Pages/Shared/_WindowBar.cshtml): the dock of open windows, minimize or
/// restore all, and close all. The page says what is true when it renders,
/// and where each action leads without script; PUDL keeps them current
/// after that.
/// </summary>
public sealed record WindowBarModel(bool AnyShowing = false, bool AnyMinimized = false, bool AnyOpen = false,
    string MinimizeAllUrl = "?", string RestoreAllUrl = "?", string CloseAllUrl = "?open=");
