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
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ParksComputing.Engine {
    public class Program {
        public static int Main(string[] args) {
            // Server-side admin commands (Identity/AdminCommand.cs) use the
            // site's services without starting the web server.
            if (ParksComputing.Engine.Identity.AdminCommand.Matches(args)) {
                using var host = CreateHostBuilder(Array.Empty<string>()).Build();
                return ParksComputing.Engine.Identity.AdminCommand.RunAsync(host.Services, args).GetAwaiter().GetResult();
            }

            using var app = CreateHostBuilder(args).Build();
            // The accounts database is brought up to date before the host
            // starts, since data protection reads its keys from it as soon as
            // the host starts; on a fresh database the table must exist first.
            using (var scope = app.Services.CreateScope()) {
                scope.ServiceProvider.GetRequiredService<ParksComputing.Engine.Identity.SiteIdentityDbContext>().Database.Migrate();
            }
            app.Run();
            return 0;
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
