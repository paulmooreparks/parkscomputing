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
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ParksComputing.Engine {
    public class Program {
        public static void Main(string[] args) {
            CreateHostBuilder(args).Build().Run();
        }

        /* The generic host with the web host inside it, which replaced the
           obsolete WebHost builder (ASPDEPR008 in .NET 10); Startup is
           unchanged. */
        public static IHostBuilder CreateHostBuilder(string[] args) =>
            Host.CreateDefaultBuilder(args)
                .ConfigureWebHostDefaults(web => web
                    // Bind to provided ASPNETCORE_URLS or fall back to all interfaces on 8080 for container hosting
                    .UseUrls(Environment.GetEnvironmentVariable("ASPNETCORE_URLS") ?? "http://0.0.0.0:8080")
                    // Allow override of web root path for development
                    .UseWebRoot(Environment.GetEnvironmentVariable("ASPNETCORE_WEBROOT") ?? "wwwroot")
                    .UseStartup<Startup>());
    }
}

// Extensions/HtmlHelperExtensions.cs
public static class HtmlHelperExtensions {
    public static IHtmlContent RenderStaticFile(this IHtmlHelper htmlHelper, string path, StaticFileReaderService fileReaderService) {
        var content = fileReaderService.ReadFileContent(path);
        return new HtmlString(content);
    }
}
