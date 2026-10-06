using System;
using System.Collections.Concurrent;
using System.IO;

namespace ParksComputing.Engine.Pages.Services;

/// <summary>
/// What the engine makes from a file, kept until the file changes. Each
/// read checks the file's last-write time and length, one metadata call, and
/// reuses the kept result only when both are as they were; otherwise it
/// builds it again. So a change shows at once however it arrives (a save
/// from /admin, an edit on the host, a OneDrive sync from another machine)
/// and the cache relies on no change notice, which a folder Docker Desktop
/// mounts from Windows does not pass into the container (Program.cs). A
/// missing file forgets its entry. The content of a site is small, so
/// nothing is evicted.
/// </summary>
public sealed class FileCache {
    private sealed record Entry(DateTime Written, long Length, object? Value);
    private readonly ConcurrentDictionary<(string Path, string Kind), Entry> _entries = new();

    /// <summary>The value built from the file at path, as kind, rebuilt
    /// only when the file has changed; default when there is no file.</summary>
    public T? Get<T>(string path, string kind, Func<string, T> build) {
        var info = new FileInfo(path);
        var key = (path, kind);
        if (!info.Exists) { _entries.TryRemove(key, out _); return default; }
        if (_entries.TryGetValue(key, out var e) && e.Written == info.LastWriteTimeUtc && e.Length == info.Length) {
            return (T?)e.Value;
        }
        var value = build(path);
        _entries[key] = new Entry(info.LastWriteTimeUtc, info.Length, value);
        return value;
    }
}
