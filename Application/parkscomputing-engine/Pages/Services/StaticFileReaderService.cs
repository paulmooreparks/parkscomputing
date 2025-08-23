using Microsoft.AspNetCore.Hosting;
using System.IO;

namespace ParksComputing.Engine.Pages.Services;

// Services/StaticFileReaderService.cs
public class StaticFileReaderService {
    private readonly IWebHostEnvironment _env;

    public StaticFileReaderService(IWebHostEnvironment env) {
        _env = env;
    }

    public string ReadFileContent(string relativePath) {
        var filePath = Path.Combine(_env.WebRootPath, relativePath.TrimStart('/'));

        if (System.IO.File.Exists(filePath)) {
            return System.IO.File.ReadAllText(filePath);
        }

        return string.Empty;
    }
}
