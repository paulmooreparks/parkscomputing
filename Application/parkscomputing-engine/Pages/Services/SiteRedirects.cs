using System;
using System.Collections.Generic;
using System.IO;
using Microsoft.AspNetCore.Hosting;

namespace ParksComputing.Engine.Pages.Services;

/// <summary>
/// A site's own permanent redirects, from redirects.txt at the top of its
/// wwwroot, so an address that moved, such as a page of the WordPress site
/// a site replaced, keeps working. Each line is an old address and the new
/// one, separated by spaces; a line starting with # is a comment. An old
/// address ending in * matches every address that starts with what comes
/// before it. The file is read again whenever it changes.
/// </summary>
public sealed class SiteRedirects {
    private readonly string _file;
    private DateTime _read = DateTime.MinValue;
    private Dictionary<string, string> _exact = new(StringComparer.OrdinalIgnoreCase);
    private List<(string Prefix, string To)> _prefixes = new();
    private readonly object _gate = new();

    public SiteRedirects(IWebHostEnvironment env) { _file = Path.Combine(env.WebRootPath, "redirects.txt"); }

    /// <summary>Where an address now lives, or null when it has not moved.</summary>
    public string? Find(string path) {
        Refresh();
        if (_exact.TryGetValue(path, out var to)) { return to; }
        foreach (var (prefix, target) in _prefixes) {
            if (path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) { return target; }
        }
        return null;
    }

    private void Refresh() {
        var stamp = File.Exists(_file) ? File.GetLastWriteTimeUtc(_file) : DateTime.MinValue;
        if (stamp == _read) { return; }
        lock (_gate) {
            if (stamp == _read) { return; }
            var exact = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var prefixes = new List<(string, string)>();
            if (stamp != DateTime.MinValue) {
                foreach (var raw in File.ReadAllLines(_file)) {
                    var line = raw.Trim();
                    if (line.Length == 0 || line.StartsWith('#')) { continue; }
                    var parts = line.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length < 2 || !parts[0].StartsWith('/')) { continue; }
                    if (parts[0].EndsWith('*')) { prefixes.Add((parts[0][..^1], parts[1])); }
                    else { exact[parts[0]] = parts[1]; }
                }
            }
            _exact = exact; _prefixes = prefixes; _read = stamp;
        }
    }
}
