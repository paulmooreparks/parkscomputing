using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;

using ParksComputing.Engine.Pages.Services;

using Microsoft.AspNetCore;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Html;
using Microsoft.AspNetCore.Mvc.Rendering;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace ParksComputing.Engine {
    public class Program {
        public static void Main(string[] args) {
            CreateWebHostBuilder(args).Build().Run();
            // var builder = Microsoft.AspNetCore.Builder.WebApplication.CreateBuilder(args);
        }

        public static IWebHostBuilder CreateWebHostBuilder(string[] args) =>
            WebHost.CreateDefaultBuilder(args)
                // Bind to provided ASPNETCORE_URLS or fall back to all interfaces on 8080 for container hosting
                .UseUrls(Environment.GetEnvironmentVariable("ASPNETCORE_URLS") ?? "http://0.0.0.0:8080")
                .UseStartup<Startup>();
    }
}

// Extensions/HtmlHelperExtensions.cs
public static class HtmlHelperExtensions {
    public static IHtmlContent RenderStaticFile(this IHtmlHelper htmlHelper, string path, StaticFileReaderService fileReaderService) {
        var content = fileReaderService.ReadFileContent(path);
        return new HtmlString(content);
    }
}
