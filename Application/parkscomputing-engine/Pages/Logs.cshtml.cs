using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.Extensions.Logging;
using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.Pages;

/// <summary>
/// The Server log (Identity/RecentLogs.cs): the server's recent log entries,
/// newest first, for the super-user alone, after a passkey tap. The classic
/// page is /logs; the logs applet (js/logs.js) shows the same panel in a
/// window (?handler=Applet). The filters are the address's query, so a
/// filtered view can be bookmarked, and they work without script. Anyone
/// else finds nothing here.
/// </summary>
public sealed class LogsModel : PageModel {
    private readonly RecentLogs _logs; private readonly StaffAccess _staff;
    public LogsModel(RecentLogs logs, StaffAccess staff) { _logs = logs; _staff = staff; }

    public static readonly (string Value, string Label, LogLevel Level)[] Levels = {
        ("warning", "Warnings and errors", LogLevel.Warning), ("error", "Errors only", LogLevel.Error), ("all", "Everything kept", LogLevel.Trace)
    };
    public static readonly (string Value, string Label, TimeSpan? Span)[] Spans = {
        ("1h", "The last hour", TimeSpan.FromHours(1)), ("24h", "The last day", TimeSpan.FromDays(1)), ("all", "Everything kept", null)
    };
    public const int Shown = 500;

    [BindProperty(SupportsGet = true)] public string? Level { get; set; }
    [BindProperty(SupportsGet = true)] public string? Source { get; set; }
    [BindProperty(SupportsGet = true)] public string? Since { get; set; }

    /// <summary>signin, confirm or ready.</summary>
    public string Stage { get; private set; } = "signin";
    public IReadOnlyList<LogEntry> Entries { get; private set; } = Array.Empty<LogEntry>();
    public int Kept { get; private set; }

    private async Task<bool> LoadAsync() {
        Response.Headers.CacheControl = "no-cache, no-store";
        ViewData["Title"] = "Server log";
        if (User.Identity?.IsAuthenticated != true) { Stage = "signin"; return true; }
        if (!await _staff.SuperuserAsync(User, confirmed: false)) { return false; }
        if (!await _staff.SuperuserAsync(User)) { Stage = "confirm"; return true; }
        Stage = "ready";
        Level = Levels.Any(l => l.Value == Level) ? Level : "warning";
        Source = RecentLogs.Sources.Contains(Source) ? Source : null;
        Since = Spans.Any(s => s.Value == Since) ? Since : "24h";
        var span = Spans.First(s => s.Value == Since).Span;
        Entries = _logs.Read(Levels.First(l => l.Value == Level).Level, Source, span is { } t ? DateTime.UtcNow - t : null, Shown);
        Kept = _logs.Count;
        return true;
    }

    public async Task<IActionResult> OnGetAsync() => await LoadAsync() ? Page() : NotFound();
    public async Task<IActionResult> OnGetAppletAsync() => await LoadAsync() ? Partial("_LogsContent", this) : NotFound();
}
