using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Extensions.Logging;

namespace ParksComputing.Engine.Identity;

/// <summary>One logged entry as the Server log applet shows it.</summary>
public sealed record LogEntry(long Id, DateTime Utc, LogLevel Level, string Category, string Source, string Message, string? Exception);

/// <summary>
/// The server's recent log, for the super-user's Server log applet
/// (js/logs.js, Pages/Logs.cshtml). A logging provider of the site's own
/// keeps the most recent entries in memory, exactly those the container's
/// own log gets under the same level settings, so the applet never needs
/// the container's log file or access to Docker. A restart empties it;
/// Docker's capped log keeps what came before. Nothing here is written to
/// disk, and the site's log messages carry no email addresses.
/// </summary>
public sealed class RecentLogs {
    public const int Capacity = 5000;
    private readonly LinkedList<LogEntry> _entries = new();
    private long _next;

    /// <summary>The source an entry's category belongs to, for the filter.</summary>
    public static string SourceOf(string category) => category switch {
        var c when c.EndsWith(".Turnstile", StringComparison.Ordinal) => "turnstile",
        var c when c.EndsWith(".ResendMailer", StringComparison.Ordinal) => "mail",
        var c when c.EndsWith(".Discussions", StringComparison.Ordinal) || c.EndsWith(".ModerationNotices", StringComparison.Ordinal)
            || c.EndsWith(".ModerationNotifier", StringComparison.Ordinal) => "comments",
        var c when c.StartsWith("ParksComputing.Engine.Identity.", StringComparison.Ordinal) => "accounts",
        var c when c.StartsWith("ParksComputing.", StringComparison.Ordinal) => "site",
        _ => "framework"
    };

    public static readonly string[] Sources = { "accounts", "turnstile", "comments", "mail", "site", "framework" };

    public void Add(DateTime utc, LogLevel level, string category, string message, Exception? exception) {
        lock (_entries) {
            _entries.AddLast(new LogEntry(++_next, utc, level, category, SourceOf(category), message,
                exception is null ? null : exception.GetType().Name + ": " + exception.Message));
            while (_entries.Count > Capacity) { _entries.RemoveFirst(); }
        }
    }

    /// <summary>Entries newest first, at least at level and from source
    /// (null for any), after since when given, at most take of them.</summary>
    public IReadOnlyList<LogEntry> Read(LogLevel level, string? source, DateTime? sinceUtc, int take) {
        lock (_entries) {
            return _entries.Reverse()
                .Where(e => e.Level >= level && (source is null || e.Source == source) && (sinceUtc is null || e.Utc >= sinceUtc))
                .Take(take).ToList();
        }
    }

    public int Count { get { lock (_entries) { return _entries.Count; } } }
}

/// <summary>Feeds RecentLogs from the site's logging, under the same level
/// settings as every other log provider.</summary>
[ProviderAlias("RecentLogs")]
public sealed class RecentLogProvider : ILoggerProvider {
    private readonly RecentLogs _logs; private readonly TimeProvider _clock = TimeProvider.System;
    public RecentLogProvider(RecentLogs logs) { _logs = logs; }
    public ILogger CreateLogger(string categoryName) => new Logger(this, categoryName);
    public void Dispose() { }

    private sealed class Logger : ILogger {
        private readonly RecentLogProvider _provider; private readonly string _category;
        public Logger(RecentLogProvider provider, string category) { _provider = provider; _category = category; }
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) {
            if (!IsEnabled(logLevel)) { return; }
            _provider._logs.Add(_provider._clock.GetUtcNow().UtcDateTime, logLevel, _category, formatter(state, exception), exception);
        }
    }
}
