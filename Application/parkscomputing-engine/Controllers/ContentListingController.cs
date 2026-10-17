using System;
using System.IO;
using System.Linq;

using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;

using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.Controllers;

/// <summary>
/// The files in a folder of the site's content, for an applet or page that
/// shows what is there, such as Sight Reader's sample scores. Everything
/// under /content is already served by its address; this says what the
/// addresses are, for a folder that asks to be listed by holding a file
/// named .listed, and for no other, so a folder of drafts is never shown.
/// The list is every file under the folder, at any depth, as paths relative
/// to it, sorted; names starting with a dot are left out, as are links. It
/// is read from the disk on each request, so a file added to the folder
/// appears at once.
/// </summary>
[ApiController]
[Route("api/site/listing")]
[Produces("application/json")]
public sealed class ContentListingController : ControllerBase {
    public const string Marker = ".listed";
    private readonly string _content;

    public ContentListingController(IWebHostEnvironment env) {
        _content = Path.GetFullPath(Path.Combine(env.WebRootPath, "content"));
    }

    public sealed record ListedFile(string Path, string Name, string Folder, long Size, DateTimeOffset Modified);

    /// <summary>The files under content/{path}, when that folder holds .listed.</summary>
    [HttpGet]
    public IActionResult Get([FromQuery] string path) {
        var dir = Directory.Exists(_content) ? ServerFiles.Resolve(_content, path) : null;
        if (dir is null || dir == _content || !Directory.Exists(dir) || !System.IO.File.Exists(System.IO.Path.Combine(dir, Marker))) {
            return NotFound();
        }
        var options = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true, AttributesToSkip = FileAttributes.ReparsePoint | FileAttributes.Hidden };
        var files = new DirectoryInfo(dir).EnumerateFiles("*", options)
            .Select(f => (f, rel: ServerFiles.Rel(dir, f.FullName)))
            .Where(x => !x.rel.Split('/').Any(part => part.StartsWith('.')))
            .OrderBy(x => x.rel, StringComparer.Ordinal)
            .Select(x => new ListedFile(x.rel, x.f.Name, x.rel.Contains('/') ? x.rel[..x.rel.LastIndexOf('/')] : "", x.f.Length,
                new DateTimeOffset(x.f.LastWriteTimeUtc)))
            .ToList();
        Response.Headers.CacheControl = "no-cache";
        return Ok(new { path = ServerFiles.Rel(_content, dir), files });
    }
}
