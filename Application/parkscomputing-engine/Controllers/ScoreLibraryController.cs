using System;
using System.IO;
using System.Linq;

using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;

using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.Controllers;

/// <summary>
/// The site's score library, the service score-library that installed applet
/// packages reach through pudlHost.service (Architecture/applet-packages-design.md,
/// step 7): Sight Reader lists it beside the scores its package ships. It is
/// the folder content/scores, which must hold the marker .listed, as for the
/// content listing. index.json lists every MusicXML file under it, at any depth,
/// read from the disk on each request, so a score dropped into the folder
/// appears at once; a score is fetched by its path under the service.
/// </summary>
[ApiController]
[Route("api/score-library")]
public sealed class ScoreLibraryController : ControllerBase {
    private const string Folder = "scores";
    private readonly string _dir;

    public ScoreLibraryController(IWebHostEnvironment env) {
        _dir = Path.GetFullPath(Path.Combine(env.WebRootPath, "content", Folder));
    }

    private bool Open => Directory.Exists(_dir) && System.IO.File.Exists(Path.Combine(_dir, ContentListingController.Marker));

    private static string? TypeOf(string name) => Path.GetExtension(name).ToLowerInvariant() switch {
        ".mxl" => "application/vnd.recordare.musicxml",
        ".musicxml" => "application/vnd.recordare.musicxml+xml",
        ".xml" => "application/xml",
        _ => null
    };

    /// <summary>The scores, as { files: [{ path, name, folder }] }.</summary>
    [HttpGet("index.json")]
    [Produces("application/json")]
    public IActionResult Index() {
        if (!Open) { return NotFound(); }
        var files = ContentListingController.List(_dir)
            .Where(f => TypeOf(f.Name) is not null)
            .Select(f => new { path = f.Path, name = f.Name, folder = f.Folder })
            .ToList();
        Response.Headers.CacheControl = "no-cache";
        return Ok(new { files });
    }

    /// <summary>A score by its path under the library.</summary>
    [HttpGet("{**path}")]
    public IActionResult Score(string path) {
        if (!Open || string.IsNullOrEmpty(path) || path.Split('/').Any(p => p.Length == 0 || p.StartsWith('.'))) { return NotFound(); }
        var type = TypeOf(path);
        var full = type is null ? null : ServerFiles.Resolve(_dir, path);
        if (full is null || !System.IO.File.Exists(full)) { return NotFound(); }
        return PhysicalFile(full, type!);
    }
}
