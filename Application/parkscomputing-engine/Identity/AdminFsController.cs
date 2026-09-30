using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// The admin mount's filesystem (Architecture/admin-and-identity-design.md,
/// A7, A8 and A10): /wwwroot, the web root, and /home, the signed-in admin's
/// own directory. js/sitefs.js is its client. Without an admin session it
/// does not exist: every call answers 404. Deleting, and any change in js/,
/// css/ or pudl/ of the web root, needs a passkey tap within
/// DestructiveConfirmMinutes; the answer 403 with confirm says so, and the
/// client asks for the tap and tries again.
/// </summary>
[ApiController]
[Route("api/admin/fs")]
[AllowAnonymous]
[Produces("application/json")]
[AutoValidateAntiforgeryToken]
[EnableRateLimiting(RateLimitPolicy)]
public sealed class AdminFsController : ControllerBase {
    public const string RateLimitPolicy = "admin-fs";

    private readonly ServerFiles _files;
    private readonly UserManager<IdentityUser> _users;
    private readonly AdminSessions _sessions;
    private readonly AdminOptions _options;

    public AdminFsController(ServerFiles files, UserManager<IdentityUser> users, AdminSessions sessions, IOptions<AdminOptions> options) {
        _files = files; _users = users; _sessions = sessions; _options = options.Value;
    }

    public sealed record PathRequest(string? Root, string? Path, string? To, bool Recursive, string? Id);

    private static readonly object NeedsConfirm = new { ok = false, confirm = true, error = "Confirm it's you with a passkey first." };

    /* The signed-in admin, or null for anyone else. */
    private async Task<(IdentityUser? me, string home)> AdminAsync() {
        if (!User.IsInRole(AdminOptions.Role)) {
            return (null, "");
        }
        var me = await _users.GetUserAsync(User);
        return me is not null && await _sessions.MaySignInAsync(me) ? (me, ServerFiles.HomeNameOf(me)) : (null, "");
    }

    private sealed record Target(string Root, string RootKey, string RootDir, string Rel, string Full);

    private Target? Locate(string? root, string? rel, string home) {
        var dir = root is null ? null : _files.RootDir(root, home);
        if (dir is null) {
            return null;
        }
        var full = ServerFiles.Resolve(dir, rel);
        if (full is null) {
            return null;
        }
        var key = root == ServerFiles.Home ? "home/" + home : ServerFiles.WebRoot;
        return new Target(root!, key, dir, ServerFiles.Rel(dir, full) == "." ? "" : ServerFiles.Rel(dir, full), full);
    }

    private string Who(IdentityUser me) => me.Email ?? me.UserName ?? me.Id;

    /// <summary>Every file and directory under a root, with this admin's home name.</summary>
    [HttpGet("tree")]
    public async Task<IActionResult> Tree([FromQuery] string root) {
        var (me, home) = await AdminAsync();
        var dir = me is null ? null : _files.RootDir(root, home);
        if (dir is null) {
            return NotFound();
        }
        return Ok(new { root, home, entries = _files.List(dir) });
    }

    /// <summary>A file's bytes.</summary>
    [HttpGet("file")]
    public async Task<IActionResult> Read([FromQuery] string root, [FromQuery] string path) {
        var (me, home) = await AdminAsync();
        var t = me is null ? null : Locate(root, path, home);
        if (t is null || !System.IO.File.Exists(t.Full)) {
            return NotFound();
        }
        Response.Headers.CacheControl = "no-store";
        return PhysicalFile(t.Full, "application/octet-stream");
    }

    /// <summary>Writes a file from the request body, keeping the version it replaces.</summary>
    [HttpPut("file")]
    [RequestSizeLimit(16 * 1024 * 1024)]
    [Consumes("application/octet-stream")]
    public async Task<IActionResult> Write([FromQuery] string root, [FromQuery] string path) {
        var (me, home) = await AdminAsync();
        var t = me is null ? null : Locate(root, path, home);
        if (t is null || t.Rel == "") {
            return NotFound();
        }
        if (Directory.Exists(t.Full)) {
            return Conflict(new { ok = false, error = path + " is a directory." });
        }
        if (!Directory.Exists(Path.GetDirectoryName(t.Full))) {
            return Conflict(new { ok = false, error = "There is no directory to hold " + path + "." });
        }
        if (ServerFiles.IsProtected(t.Root, t.Rel) && !_sessions.ConfirmedForDestructive(User)) {
            return StatusCode(StatusCodes.Status403Forbidden, NeedsConfirm);
        }
        if (Request.ContentLength > _options.MaxFileBytes) {
            return StatusCode(StatusCodes.Status413PayloadTooLarge, new { ok = false, error = "Files are limited to " + (_options.MaxFileBytes / (1024 * 1024)) + " MB." });
        }

        // Written beside the file first and moved into place, so a reader
        // never sees half a file.
        var temp = Path.Combine(Path.GetDirectoryName(t.Full)!, "." + Path.GetFileName(t.Full) + ".saving-" + Guid.NewGuid().ToString("n"));
        long written;
        await using (var fs = System.IO.File.Create(temp)) {
            await Request.Body.CopyToAsync(fs);
            written = fs.Length;
        }
        if (written > _options.MaxFileBytes) {
            System.IO.File.Delete(temp);
            return StatusCode(StatusCodes.Status413PayloadTooLarge, new { ok = false, error = "Files are limited to " + (_options.MaxFileBytes / (1024 * 1024)) + " MB." });
        }
        bool existed = System.IO.File.Exists(t.Full);
        _files.KeepPrevious(t.RootKey, t.Rel, t.Full);
        System.IO.File.Move(temp, t.Full, overwrite: true);
        await _files.AuditAsync(Who(me!), AdminOptions.ClientIp(HttpContext), existed ? "write" : "create", t.RootKey, t.Rel, full: t.Full);
        if (t.Root == ServerFiles.WebRoot) {
            _files.AssetsChanged();
        }
        var info = new FileInfo(t.Full);
        return Ok(new { ok = true, entry = new ServerFiles.Entry(t.Rel, false, info.Length, new DateTimeOffset(info.LastWriteTimeUtc).ToUnixTimeMilliseconds()) });
    }

    /// <summary>Makes a directory.</summary>
    [HttpPost("mkdir")]
    public async Task<IActionResult> MakeDirectory([FromBody] PathRequest body) {
        var (me, home) = await AdminAsync();
        var t = me is null ? null : Locate(body.Root, body.Path, home);
        if (t is null || t.Rel == "") {
            return NotFound();
        }
        if (System.IO.File.Exists(t.Full) || Directory.Exists(t.Full)) {
            return Conflict(new { ok = false, error = body.Path + " already exists." });
        }
        if (!Directory.Exists(Path.GetDirectoryName(t.Full))) {
            return Conflict(new { ok = false, error = "There is no directory to hold " + body.Path + "." });
        }
        if (ServerFiles.IsProtected(t.Root, t.Rel) && !_sessions.ConfirmedForDestructive(User)) {
            return StatusCode(StatusCodes.Status403Forbidden, NeedsConfirm);
        }
        Directory.CreateDirectory(t.Full);
        await _files.AuditAsync(Who(me!), AdminOptions.ClientIp(HttpContext), "mkdir", t.RootKey, t.Rel);
        return Ok(new { ok = true });
    }

    /// <summary>Moves or renames within one root, keeping anything it replaces.</summary>
    [HttpPost("move")]
    public async Task<IActionResult> Move([FromBody] PathRequest body) {
        var (me, home) = await AdminAsync();
        var from = me is null ? null : Locate(body.Root, body.Path, home);
        var to = me is null ? null : Locate(body.Root, body.To, home);
        if (from is null || to is null || from.Rel == "" || to.Rel == "") {
            return NotFound();
        }
        if (!System.IO.File.Exists(from.Full) && !Directory.Exists(from.Full)) {
            return NotFound();
        }
        if ((to.Full + Path.DirectorySeparatorChar).StartsWith(from.Full + Path.DirectorySeparatorChar, StringComparison.Ordinal)) {
            return Conflict(new { ok = false, error = "A directory can't be moved into itself." });
        }
        if (Directory.Exists(to.Full)) {
            return Conflict(new { ok = false, error = body.To + " is a directory that already exists." });
        }
        if (!Directory.Exists(Path.GetDirectoryName(to.Full))) {
            return Conflict(new { ok = false, error = "There is no directory to hold " + body.To + "." });
        }
        if ((ServerFiles.IsProtected(from.Root, from.Rel) || ServerFiles.IsProtected(to.Root, to.Rel) || System.IO.File.Exists(to.Full))
            && !_sessions.ConfirmedForDestructive(User)) {
            return StatusCode(StatusCodes.Status403Forbidden, NeedsConfirm);
        }
        if (System.IO.File.Exists(to.Full)) {
            if (Directory.Exists(from.Full)) {
                return Conflict(new { ok = false, error = body.To + " is a file that already exists." });
            }
            _files.KeepPrevious(to.RootKey, to.Rel, to.Full, moveAway: true);
        }
        ServerFiles.MoveAcross(from.Full, to.Full);
        await _files.AuditAsync(Who(me!), AdminOptions.ClientIp(HttpContext), "move", from.RootKey, from.Rel, to: to.Rel);
        if (from.Root == ServerFiles.WebRoot) {
            _files.AssetsChanged();
        }
        return Ok(new { ok = true });
    }

    /// <summary>Deletes a file, or with recursive a directory; what goes is kept in the history.</summary>
    [HttpPost("delete")]
    public async Task<IActionResult> Delete([FromBody] PathRequest body) {
        var (me, home) = await AdminAsync();
        var t = me is null ? null : Locate(body.Root, body.Path, home);
        if (t is null || t.Rel == "") {
            return NotFound();
        }
        bool isDir = Directory.Exists(t.Full);
        if (!isDir && !System.IO.File.Exists(t.Full)) {
            return NotFound();
        }
        if (isDir && !body.Recursive && Directory.EnumerateFileSystemEntries(t.Full).Any()) {
            return Conflict(new { ok = false, error = body.Path + " is a directory that isn't empty." });
        }
        if (!_sessions.ConfirmedForDestructive(User)) {
            return StatusCode(StatusCodes.Status403Forbidden, NeedsConfirm);
        }
        _files.KeepPrevious(t.RootKey, t.Rel, t.Full, moveAway: true);
        await _files.AuditAsync(Who(me!), AdminOptions.ClientIp(HttpContext), "delete", t.RootKey, t.Rel);
        if (t.Root == ServerFiles.WebRoot) {
            _files.AssetsChanged();
        }
        return Ok(new { ok = true });
    }

    /// <summary>The kept versions of a path, newest first.</summary>
    [HttpGet("history")]
    public async Task<IActionResult> History([FromQuery] string root, [FromQuery] string path) {
        var (me, home) = await AdminAsync();
        var t = me is null ? null : Locate(root, path, home);
        if (t is null || t.Rel == "") {
            return NotFound();
        }
        return Ok(new { versions = _files.Versions(t.RootKey, t.Rel).Select(v => new { id = v.Id, time = v.Time, dir = v.Dir, size = v.Size }) });
    }

    /// <summary>Puts a kept version back, keeping the version it replaces.</summary>
    [HttpPost("restore")]
    public async Task<IActionResult> Restore([FromBody] PathRequest body) {
        var (me, home) = await AdminAsync();
        var t = me is null ? null : Locate(body.Root, body.Path, home);
        var version = t is null || body.Id is null ? null : _files.VersionPath(t.RootKey, t.Rel, body.Id);
        if (t is null || version is null) {
            return NotFound();
        }
        if (!_sessions.ConfirmedForDestructive(User)) {
            return StatusCode(StatusCodes.Status403Forbidden, NeedsConfirm);
        }
        if (!Directory.Exists(Path.GetDirectoryName(t.Full))) {
            Directory.CreateDirectory(Path.GetDirectoryName(t.Full)!);
        }
        _files.KeepPrevious(t.RootKey, t.Rel, t.Full, moveAway: true);
        if (Directory.Exists(version)) { ServerFiles.CopyDirectory(version, t.Full); }
        else { System.IO.File.Copy(version, t.Full); }
        await _files.AuditAsync(Who(me!), AdminOptions.ClientIp(HttpContext), "restore", t.RootKey, t.Rel, to: body.Id, full: t.Full);
        if (t.Root == ServerFiles.WebRoot) {
            _files.AssetsChanged();
        }
        return Ok(new { ok = true });
    }
}
