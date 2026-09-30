using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Razor.Infrastructure;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// The server directories the admin mount shows (Architecture/admin-and-identity-design.md,
/// A7 and A10): the web root, and each admin's own directory under /home.
/// Every path is kept inside its root, and no symbolic link inside a root is
/// followed, so nothing outside can be reached. Before a file is overwritten,
/// moved over or deleted, its previous version goes to the history directory,
/// outside the web root, for HistoryDays; every change is appended to the
/// audit log there.
/// </summary>
public sealed class ServerFiles {
    public const string WebRoot = "wwwroot";
    public const string Home = "home";

    private static readonly string[] Protected = { "js/", "css/", "pudl/" };
    private static readonly Regex HomeNameChars = new("[^a-z0-9._-]+", RegexOptions.Compiled);
    private static readonly SemaphoreSlim AuditLock = new(1, 1);

    private readonly string _webRoot;
    private readonly AdminOptions _options;
    private readonly TagHelperMemoryCacheProvider _tagHelperCache;
    private readonly ILogger<ServerFiles> _logger;

    public ServerFiles(IWebHostEnvironment env, IOptions<AdminOptions> options, TagHelperMemoryCacheProvider tagHelperCache, ILogger<ServerFiles> logger) {
        _webRoot = Path.GetFullPath(env.WebRootPath);
        _options = options.Value;
        _tagHelperCache = tagHelperCache;
        _logger = logger;
    }

    public sealed record Entry(string P, bool D, long S, long M);

    /// <summary>An admin's directory name: the account's short name, or its email's local part.</summary>
    public static string HomeNameOf(IdentityUser user) {
        var raw = (user.UserName ?? "").Contains('@') || string.IsNullOrWhiteSpace(user.UserName)
            ? (user.Email ?? user.Id).Split('@')[0]
            : user.UserName!;
        var name = HomeNameChars.Replace(raw.ToLowerInvariant(), "-").Trim('-', '.');
        return string.IsNullOrEmpty(name) ? "admin" : name;
    }

    /// <summary>The directory a root names for this admin, made if it is missing; null for an unknown root.</summary>
    public string? RootDir(string root, string homeName) {
        switch (root) {
            case WebRoot:
                return _webRoot;
            case Home: {
                var dir = Path.GetFullPath(Path.Combine(_options.HomeRoot, homeName));
                if (!Directory.Exists(dir)) {
                    Directory.CreateDirectory(dir);
                    File.WriteAllText(Path.Combine(dir, "README"),
                        "This is your home directory on the server, " + homeName + ".\n\n" +
                        "It follows you: whichever device you sign in from, ~ is here.\n" +
                        "Nothing in it is ever served to the public; it sits beside\n" +
                        "/wwwroot, not inside it. Keep your scripts in ~/bin, and they\n" +
                        "run by name in the terminal.\n");
                }
                return dir;
            }
            default:
                return null;
        }
    }

    /// <summary>
    /// A path under a root as a full path, or null when it would leave the
    /// root or pass through a symbolic link. The root itself is "".
    /// </summary>
    public static string? Resolve(string rootDir, string? rel) {
        rel = (rel ?? "").Replace('\\', '/').Trim('/');
        var full = Path.GetFullPath(Path.Combine(rootDir, rel));
        if (!(full == rootDir || full.StartsWith(rootDir + Path.DirectorySeparatorChar, StringComparison.Ordinal))) {
            return null;
        }
        // No step on the way may be a link, which could point anywhere.
        var here = rootDir;
        foreach (var part in Path.GetRelativePath(rootDir, full).Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries)) {
            if (part == ".") {
                continue;
            }
            here = Path.Combine(here, part);
            var info = new FileInfo(here);
            if (info.Exists || Directory.Exists(here)) {
                if (File.GetAttributes(here).HasFlag(FileAttributes.ReparsePoint)) {
                    return null;
                }
            }
        }
        return full;
    }

    public static string Rel(string rootDir, string full) => Path.GetRelativePath(rootDir, full).Replace(Path.DirectorySeparatorChar, '/');

    /// <summary>Whether a change here needs a recent passkey tap: anything in js/, css/ or pudl/ of the web root.</summary>
    public static bool IsProtected(string root, string rel) =>
        root == WebRoot && Protected.Any(p => (rel.Replace('\\', '/').Trim('/') + "/").StartsWith(p, StringComparison.OrdinalIgnoreCase));

    /// <summary>Every file and directory under a root, links left out.</summary>
    public IReadOnlyList<Entry> List(string rootDir) {
        var list = new List<Entry>();
        var opts = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true, AttributesToSkip = FileAttributes.ReparsePoint };
        foreach (var info in new DirectoryInfo(rootDir).EnumerateFileSystemInfos("*", opts)) {
            bool dir = info is DirectoryInfo;
            list.Add(new Entry(Rel(rootDir, info.FullName), dir, dir ? 0 : ((FileInfo)info).Length,
                new DateTimeOffset(info.LastWriteTimeUtc).ToUnixTimeMilliseconds()));
        }
        return list;
    }

    /* === History ======================================================== */

    private string HistoryDir(string rootKey) => Path.Combine(_options.HistoryRoot, rootKey);

    private static string Stamp() => DateTime.UtcNow.ToString("yyyyMMdd'T'HHmmssfff'Z'", CultureInfo.InvariantCulture);

    /// <summary>Keeps the current version of a file or directory before it changes or goes. rootKey is "wwwroot" or "home/{name}".</summary>
    public void KeepPrevious(string rootKey, string rel, string full, bool moveAway = false) {
        if (!File.Exists(full) && !Directory.Exists(full)) {
            return;
        }
        var dest = Path.Combine(HistoryDir(rootKey), rel.Replace('/', Path.DirectorySeparatorChar) + "@" + Stamp());
        Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
        if (Directory.Exists(full)) {
            if (moveAway) { MoveAcross(full, dest); }
            else { CopyDirectory(full, dest); }
        }
        else if (moveAway) {
            MoveAcross(full, dest);
        }
        else {
            File.Copy(full, dest);
        }
    }

    /// <summary>The kept versions of a path, newest first.</summary>
    public IReadOnlyList<(string Id, DateTime Time, bool Dir, long Size)> Versions(string rootKey, string rel) {
        var at = Path.Combine(HistoryDir(rootKey), rel.Replace('/', Path.DirectorySeparatorChar));
        var dir = Path.GetDirectoryName(at)!;
        var name = Path.GetFileName(at) + "@";
        if (!Directory.Exists(dir)) {
            return Array.Empty<(string, DateTime, bool, long)>();
        }
        return new DirectoryInfo(dir).EnumerateFileSystemInfos(name + "*")
            .Select(i => (Id: i.Name[name.Length..], Info: i))
            .Where(x => DateTime.TryParseExact(x.Id, "yyyyMMdd'T'HHmmssfff'Z'", CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out _))
            .Select(x => (x.Id, DateTime.ParseExact(x.Id, "yyyyMMdd'T'HHmmssfff'Z'", CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal),
                x.Info is DirectoryInfo, x.Info is FileInfo f ? f.Length : 0L))
            .OrderByDescending(x => x.Item2)
            .ToList();
    }

    /// <summary>The full path of one kept version, or null.</summary>
    public string? VersionPath(string rootKey, string rel, string id) {
        if (!Regex.IsMatch(id, @"^\d{8}T\d{9}Z$")) {
            return null;
        }
        var p = Path.Combine(HistoryDir(rootKey), rel.Replace('/', Path.DirectorySeparatorChar) + "@" + id);
        return File.Exists(p) || Directory.Exists(p) ? p : null;
    }

    /// <summary>Removes kept versions older than HistoryDays.</summary>
    public void Prune() {
        if (!Directory.Exists(_options.HistoryRoot)) {
            return;
        }
        var cutoff = DateTime.UtcNow.AddDays(-_options.HistoryDays);
        foreach (var info in new DirectoryInfo(_options.HistoryRoot).EnumerateFileSystemInfos("*@*", new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true, AttributesToSkip = FileAttributes.ReparsePoint }).ToList()) {
            var at = info.Name.LastIndexOf('@');
            if (at < 0 || !DateTime.TryParseExact(info.Name[(at + 1)..], "yyyyMMdd'T'HHmmssfff'Z'", CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var when) || when > cutoff) {
                continue;
            }
            try {
                if (info is DirectoryInfo d) { d.Delete(true); } else { info.Delete(); }
            }
            catch (Exception ex) {
                _logger.LogWarning(ex, "Could not prune {Path}", info.FullName);
            }
        }
    }

    /* === Audit ========================================================== */

    public async Task AuditAsync(string who, string ip, string op, string rootKey, string rel, string? to = null, string? full = null) {
        string? hash = null;
        if (full is not null && File.Exists(full)) {
            await using var s = File.OpenRead(full);
            hash = Convert.ToHexString(await SHA256.HashDataAsync(s)).ToLowerInvariant();
        }
        var line = JsonSerializer.Serialize(new { time = DateTimeOffset.UtcNow, who, ip, op, root = rootKey, path = rel, to, sha256 = hash });
        Directory.CreateDirectory(_options.HistoryRoot);
        await AuditLock.WaitAsync();
        try { await File.AppendAllTextAsync(Path.Combine(_options.HistoryRoot, "audit.log"), line + "\n"); }
        finally { AuditLock.Release(); }
    }

    /* === After a change ================================================= */

    /// <summary>
    /// Clears the cached asset-version stamps (asp-append-version), so a
    /// changed script or stylesheet reaches readers without a restart.
    /// </summary>
    public void AssetsChanged() {
        if (_tagHelperCache.Cache is MemoryCache cache) {
            cache.Clear();
        }
    }

    /* === Helpers ======================================================== */

    public static void CopyDirectory(string from, string to) {
        Directory.CreateDirectory(to);
        foreach (var f in Directory.EnumerateFiles(from)) {
            File.Copy(f, Path.Combine(to, Path.GetFileName(f)));
        }
        foreach (var d in Directory.EnumerateDirectories(from)) {
            if (File.GetAttributes(d).HasFlag(FileAttributes.ReparsePoint)) {
                continue;
            }
            CopyDirectory(d, Path.Combine(to, Path.GetFileName(d)));
        }
    }

    /// <summary>Moves a file or directory, copying and deleting when it crosses file systems.</summary>
    public static void MoveAcross(string from, string to) {
        try {
            if (Directory.Exists(from)) { Directory.Move(from, to); } else { File.Move(from, to); }
        }
        catch (IOException) {
            if (Directory.Exists(from)) { CopyDirectory(from, to); Directory.Delete(from, true); }
            else { File.Copy(from, to); File.Delete(from); }
        }
    }
}

/// <summary>Prunes the history once a day.</summary>
public sealed class HistoryPruner : BackgroundService {
    private readonly ServerFiles _files;
    private readonly ILogger<HistoryPruner> _logger;

    public HistoryPruner(ServerFiles files, ILogger<HistoryPruner> logger) { _files = files; _logger = logger; }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
        while (!stoppingToken.IsCancellationRequested) {
            try { _files.Prune(); }
            catch (Exception ex) { _logger.LogWarning(ex, "History pruning failed"); }
            try { await Task.Delay(TimeSpan.FromDays(1), stoppingToken); }
            catch (TaskCanceledException) { return; }
        }
    }
}
