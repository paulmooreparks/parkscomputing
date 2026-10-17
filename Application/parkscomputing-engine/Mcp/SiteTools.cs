using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ModelContextProtocol;
using ModelContextProtocol.Server;
using ParksComputing.Engine.Identity;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Mcp;

/// <summary>
/// The site's own tools over MCP (Architecture/applet-platform-design.md, P3),
/// which need no browser: the server's files as the admin mount shows them,
/// the page tree, the comment queue and the server log. Each is listed only to
/// a token given the capability it needs (McpSetup's policies). Paths are the
/// admin mount's: ~ is the account's home folder, /wwwroot the site's files
/// and /etc the server's own settings.
/// </summary>
[McpServerToolType]
public sealed class SiteTools {
    private const int MaxRead = 1024 * 1024;

    private readonly ServerFiles _files;
    private readonly McpCaller _caller;
    private readonly INavService _nav;
    private readonly ArticleContentService _articles;
    private readonly Discussions _discussions;
    private readonly CommentOptions _comments;
    private readonly RecentLogs _logs;

    public SiteTools(ServerFiles files, McpCaller caller, INavService nav, ArticleContentService articles, Discussions discussions,
        IOptions<CommentOptions> comments, RecentLogs logs) {
        _files = files; _caller = caller; _nav = nav; _articles = articles; _discussions = discussions; _comments = comments.Value; _logs = logs;
    }

    /* === Paths ========================================================== */

    /// <summary>A path as the tools take it, ~/notes.md, /wwwroot/content/about.md
    /// or /etc/admin-menu.xfer, inside its root.</summary>
    private async Task<ServerFiles.Target> LocateAsync(string path) {
        var home = await _caller.HomeNameAsync();
        path = (path ?? "").Trim().Replace('\\', '/');
        (string root, string rel) = path switch {
            "~" => (ServerFiles.Home, ""),
            var p when p.StartsWith("~/", StringComparison.Ordinal) => (ServerFiles.Home, p[2..]),
            var p when p == "/home/" + home || p.StartsWith("/home/" + home + "/", StringComparison.Ordinal) => (ServerFiles.Home, p[("/home/" + home).Length..]),
            "/wwwroot" => (ServerFiles.WebRoot, ""),
            var p when p.StartsWith("/wwwroot/", StringComparison.Ordinal) => (ServerFiles.WebRoot, p["/wwwroot/".Length..]),
            "/etc" => (ServerFiles.Etc, ""),
            var p when p.StartsWith("/etc/", StringComparison.Ordinal) => (ServerFiles.Etc, p["/etc/".Length..]),
            _ => throw new McpException(path + " isn't a path here. Paths start with ~ (your home folder), /wwwroot (the site's files) or /etc (the server's settings).")
        };
        return _files.Locate(root, rel, home) ?? throw new McpException(path + " isn't a path here.");
    }

    private static string Shown(ServerFiles.Target t) =>
        t.Root == ServerFiles.Home ? (t.Rel == "" ? "~" : "~/" + t.Rel) : "/" + t.Root + (t.Rel == "" ? "" : "/" + t.Rel);

    public sealed record FileEntry(string Name, string Path, string Kind, long? Size, DateTimeOffset Modified);

    /* === Files ========================================================== */

    [McpServerTool(Name = "site_files_list", Title = "List a folder", ReadOnly = true, Idempotent = true, OpenWorld = false)]
    [Description("List what is in a folder: ~ is your home folder on the server, /wwwroot the site's files (pages are Markdown or HTML in /wwwroot/content, and /wwwroot/sitenav.xfer is the site's menu and page list), /etc the server's settings.")]
    [Authorize(Policy = McpSetup.PolicyPrefix + TokenCapabilities.FilesRead)]
    public async Task<object> ListFiles([Description("The folder, such as ~, /wwwroot or /wwwroot/content.")] string path) {
        var t = await LocateAsync(path);
        if (!Directory.Exists(t.Full)) {
            throw new McpException(path + (File.Exists(t.Full) ? " is a file." : ": no such folder."));
        }
        var shown = Shown(t);
        var entries = new DirectoryInfo(t.Full)
            .EnumerateFileSystemInfos("*", new EnumerationOptions { IgnoreInaccessible = true, AttributesToSkip = FileAttributes.ReparsePoint })
            // A file being written sits beside its name until it is moved into place.
            .Where(i => !i.Name.Contains(".saving-", StringComparison.Ordinal))
            .OrderBy(i => i is FileInfo).ThenBy(i => i.Name, StringComparer.OrdinalIgnoreCase)
            .Select(i => new FileEntry(i.Name, shown.TrimEnd('/') + "/" + i.Name, i is DirectoryInfo ? "folder" : "file",
                i is FileInfo f ? f.Length : null, new DateTimeOffset(i.LastWriteTimeUtc)))
            .ToList();
        return new { path = shown, entries };
    }

    [McpServerTool(Name = "site_file_read", Title = "Read a file", ReadOnly = true, Idempotent = true, OpenWorld = false)]
    [Description("Read a text file, up to 1 MB. Paths start with ~, /wwwroot or /etc. site_pages gives each page's source file.")]
    [Authorize(Policy = McpSetup.PolicyPrefix + TokenCapabilities.FilesRead)]
    public async Task<object> ReadFile([Description("The file, such as /wwwroot/content/about.md or ~/notes.md.")] string path) {
        var t = await LocateAsync(path);
        if (!File.Exists(t.Full)) {
            throw new McpException(path + (Directory.Exists(t.Full) ? " is a folder." : ": no such file."));
        }
        var info = new FileInfo(t.Full);
        if (info.Length > MaxRead) {
            throw new McpException(path + " is larger than 1 MB, too large to read here.");
        }
        var bytes = await File.ReadAllBytesAsync(t.Full);
        string text;
        try { text = new UTF8Encoding(false, true).GetString(bytes); }
        catch (DecoderFallbackException) { throw new McpException(path + " isn't a text file."); }
        if (text.Contains('\0')) {
            throw new McpException(path + " isn't a text file.");
        }
        return new { path = Shown(t), size = info.Length, modified = new DateTimeOffset(info.LastWriteTimeUtc), text };
    }

    [McpServerTool(Name = "site_file_write", Title = "Write a file", ReadOnly = false, Destructive = true, Idempotent = true, OpenWorld = false)]
    [Description("Write a text file, replacing it if it exists; the version it replaces is kept in the server's history for 30 days. In ~ this needs files.write. In /wwwroot it needs site.publish and changes the live site at once; js/, css/ and pudl/ can't be written this way, and nor can /etc. A new page also needs an entry in /wwwroot/sitenav.xfer to appear in the site's menus.")]
    [Authorize(Policy = McpSetup.WritePolicy)]
    public async Task<object> WriteFile(
        [Description("The file, such as ~/drafts/idea.md or /wwwroot/content/about.md.")] string path,
        [Description("The whole text of the file, as UTF-8.")] string text,
        [Description("Make any folders on the way that don't exist yet.")] bool makeFolders = false) {
        var t = await LocateAsync(path);
        if (t.Root == ServerFiles.Etc) {
            throw new McpException("/etc can't be written over MCP. Change it from the admin desktop.");
        }
        _caller.Require(t.Root == ServerFiles.Home ? TokenCapabilities.FilesWrite : TokenCapabilities.SitePublish);
        if (ServerFiles.IsProtected(t.Root, t.Rel)) {
            throw new McpException(path + " is in js/, css/ or pudl/, which can't be written over MCP. Change it from the admin desktop.");
        }
        if (t.Rel == "") {
            throw new McpException(path + " is a folder.");
        }
        var dir = Path.GetDirectoryName(t.Full)!;
        if (!Directory.Exists(dir) && makeFolders) {
            var made = ServerFiles.Rel(t.RootDir, dir);
            if (ServerFiles.Resolve(t.RootDir, made) is null) {
                throw new McpException(path + " isn't a path here.");
            }
            Directory.CreateDirectory(dir);
            await _files.AuditAsync(_caller.Who, _caller.Ip, "mkdir", t.RootKey, made);
        }
        bool existed = File.Exists(t.Full);
        var bytes = new UTF8Encoding(false).GetBytes(text ?? "");
        var refused = await _files.ReplaceAsync(t, s => s.WriteAsync(bytes).AsTask(), _caller.Who, _caller.Ip);
        if (refused is not null) {
            throw new McpException(refused);
        }
        return new { path = Shown(t), size = bytes.Length, created = !existed, live = t.Root == ServerFiles.WebRoot };
    }

    /* === The site ======================================================= */

    public sealed record PageEntry(string Slug, string Title, string Kind, string? Description, string? Url, DateTime? Date,
        IReadOnlyList<string>? Tags, string? Source, IReadOnlyList<PageEntry>? Pages);

    [McpServerTool(Name = "site_pages", Title = "The site's pages", ReadOnly = true, Idempotent = true, OpenWorld = false)]
    [Description("The site's sections and pages as its menus show them, from /wwwroot/sitenav.xfer, with each page's title, address, date, tags and source file (the file to read or write to change it).")]
    [Authorize(Policy = McpSetup.PolicyPrefix + TokenCapabilities.FilesRead)]
    public object Pages() {
        var root = _nav.GetRoot();
        PageEntry Entry(NavNode n) {
            bool external = n.External || (n.Url?.StartsWith("http", StringComparison.OrdinalIgnoreCase) ?? false);
            var children = n.Nav is { Length: > 0 } ? n.Nav.Where(c => !string.IsNullOrEmpty(c.Slug)).Select(Entry).ToList() : null;
            return new PageEntry(n.Slug!, n.Title ?? n.Slug!, children is not null ? "section" : external ? "link" : "page",
                n.Description ?? n.Excerpt, n.Url, NavService.EffectiveDate(n), n.Tags is { Length: > 0 } ? n.Tags : null,
                external ? null : _articles.SourcePathOf(n.Slug), children);
        }
        return new { title = root.Title, sections = (root.Nav ?? Array.Empty<NavNode>()).Where(n => !string.IsNullOrEmpty(n.Slug)).Select(Entry).ToList() };
    }

    /* === Comments ======================================================= */

    [McpServerTool(Name = "comments_queue", Title = "Comments waiting for a moderator", ReadOnly = true, Idempotent = true, OpenWorld = false)]
    [Description("The comments and edits waiting for a moderator, oldest first, and the open reports on published comments. Each waiting item has the revisionId and version that comment_decide needs.")]
    [Authorize(Policy = McpSetup.PolicyPrefix + TokenCapabilities.CommentsModerate)]
    public async Task<object> CommentsQueue() {
        if (!_comments.Enabled) {
            throw new McpException("Comments are turned off on this site.");
        }
        var q = await _discussions.QueueAsync();
        return new {
            pending = q.Pending.Select(p => new {
                revisionId = p.RevisionId, commentId = p.CommentId, article = p.Slug, articleTitle = p.Title, author = p.Author?.Name,
                submitted = p.SubmittedUtc, isReply = p.IsReply, html = p.Html, replacesHtml = p.PublishedHtml, version = p.Version
            }),
            reports = q.Reports.Select(r => new {
                reportId = r.ReportId, commentId = r.CommentId, article = r.Slug, articleTitle = r.Title, author = r.Author?.Name,
                html = r.Html, reason = r.Reason, reported = r.ReportedUtc, version = r.Version
            })
        };
    }

    [McpServerTool(Name = "comment_decide", Title = "Approve or reject a comment", ReadOnly = false, Destructive = false, Idempotent = false, OpenWorld = false)]
    [Description("Decide on one waiting comment or edit from comments_queue: approve publishes exactly that text; reject and spam withhold it, leaving any earlier approved text as it was. The version must be the one the queue gave, so a comment that changed since is not decided by mistake.")]
    [Authorize(Policy = McpSetup.PolicyPrefix + TokenCapabilities.CommentsModerate)]
    public async Task<object> CommentDecide(
        [Description("The waiting item's revisionId.")] Guid revisionId,
        [Description("approve, reject or spam.")] string decision,
        [Description("The waiting item's version.")] string version,
        [Description("Why, for the moderation record; never shown to the author.")] string? reason = null) {
        if (!_comments.Enabled) {
            throw new McpException("Comments are turned off on this site.");
        }
        var outcome = await _discussions.DecideAsync(revisionId, _caller.UserId, (decision ?? "").Trim().ToLowerInvariant(), reason, version);
        if (!outcome.Ok) {
            throw new McpException(outcome.Error ?? "That didn't work.");
        }
        return new { decided = decision, commentId = outcome.Id };
    }

    /* === The server log ================================================= */

    [McpServerTool(Name = "server_log", Title = "Read the server log", ReadOnly = true, Idempotent = true, OpenWorld = false)]
    [Description("The server's recent log, newest first, as the Server log applet shows it. Messages never carry email addresses.")]
    [Authorize(Policy = McpSetup.PolicyPrefix + TokenCapabilities.LogsRead)]
    public object ServerLog(
        [Description("The least serious level to include: information, warning or error.")] string level = "warning",
        [Description("Only entries from accounts, turnstile, comments, mail, site or framework.")] string? source = null,
        [Description("Only entries from the last this many minutes.")] int? sinceMinutes = null,
        [Description("At most this many entries, up to 500.")] int limit = 100) {
        var lvl = (level ?? "warning").Trim().ToLowerInvariant() switch {
            "information" or "info" => LogLevel.Information,
            "warning" or "warn" => LogLevel.Warning,
            "error" => LogLevel.Error,
            _ => throw new McpException("level is information, warning or error.")
        };
        if (source is not null && !RecentLogs.Sources.Contains(source)) {
            throw new McpException("source is one of " + string.Join(", ", RecentLogs.Sources) + ".");
        }
        var since = sinceMinutes is > 0 ? DateTime.UtcNow.AddMinutes(-sinceMinutes.Value) : (DateTime?)null;
        return new {
            entries = _logs.Read(lvl, source, since, Math.Clamp(limit, 1, 500)).Select(e => new {
                time = e.Utc, level = e.Level.ToString(), source = e.Source, category = e.Category, message = e.Message, exception = e.Exception
            })
        };
    }
}
