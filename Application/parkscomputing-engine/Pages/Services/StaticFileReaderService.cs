using Microsoft.AspNetCore.Hosting;
using System.IO;

namespace ParksComputing.Engine.Pages.Services;

// Services/StaticFileReaderService.cs
/// <summary>The text of a site file the layouts include on every page, such
/// as content/head-section.html, kept until the file changes (FileCache).</summary>
public class StaticFileReaderService {
    private readonly IWebHostEnvironment _env;
    private readonly FileCache _cache;

    public StaticFileReaderService(IWebHostEnvironment env, FileCache cache) {
        _env = env;
        _cache = cache;
    }

    public string ReadFileContent(string relativePath) {
        var filePath = Path.Combine(_env.WebRootPath, relativePath.TrimStart('/'));
        return _cache.Get(filePath, "text", System.IO.File.ReadAllText) ?? string.Empty;
    }
}
