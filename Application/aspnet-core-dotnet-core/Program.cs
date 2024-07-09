using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;

using aspnet_core_dotnet_core.Pages.Services;

using Microsoft.AspNetCore;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Html;
using Microsoft.AspNetCore.Mvc.Rendering;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace aspnet_core_dotnet_core {
    public class Program {
        public static void Main(string[] args) {
            CreateWebHostBuilder(args).Build().Run();
            // var builder = Microsoft.AspNetCore.Builder.WebApplication.CreateBuilder(args);
        }

        public static IWebHostBuilder CreateWebHostBuilder(string[] args) =>
            WebHost.CreateDefaultBuilder(args)
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
