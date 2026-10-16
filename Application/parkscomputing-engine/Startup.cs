using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

using ParksComputing.Engine.Pages.Services;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Configuration.EnvironmentVariables;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.AspNetCore.StaticFiles;
using System.Text;
using Microsoft.OpenApi.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.FileProviders;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.RateLimiting;
using System.Threading.RateLimiting;

namespace ParksComputing.Engine {
    public partial class Startup {
        public Startup(IConfiguration configuration) {
            Configuration = configuration;
        }

        public IConfiguration Configuration { get; }

        // This method gets called by the runtime. Use this method to add services to the container.
        public void ConfigureServices(IServiceCollection services) {
            var editHost = (Configuration.GetSection("Admin").Get<ParksComputing.Engine.Identity.AdminOptions>() ?? new ParksComputing.Engine.Identity.AdminOptions()).EditHost;
            services.Configure<CookiePolicyOptions>(options => {
                // This lambda determines whether user consent for non-essential cookies is needed for a given request.
                // The edit origin sets only the cookies signing in needs, so it asks no consent.
                options.CheckConsentNeeded = context => !string.Equals(context.Request.Host.Host, editHost, StringComparison.OrdinalIgnoreCase);
                options.MinimumSameSitePolicy = SameSiteMode.None;
            });

            services.AddTransient<AppServices>();

            // What kind of site this is (Pages/Services/SiteOptions.cs). A
            // brochure site's pages take its own layout in place of _Layout.
            services.Configure<SiteOptions>(Configuration.GetSection(SiteOptions.Section));
            services.AddRazorPages();
            services.Configure<Microsoft.AspNetCore.Mvc.Razor.RazorViewEngineOptions>(o =>
                o.ViewLocationExpanders.Add(new BrochureLayoutExpander(Configuration.GetSection(SiteOptions.Section).Get<SiteOptions>() ?? new SiteOptions())));
            services.AddControllers().AddJsonOptions(o => {
                o.JsonSerializerOptions.PropertyNameCaseInsensitive = true;
            })
            .AddMvcOptions(o => {
                // Insert Xfer formatters at the front so application/xfer is honored when requested.
                // We resolve the service provider later via an options configuration stage, so build a temporary provider here is avoided.
            });

            // Register XferLang services & formatters
            services.AddSingleton<ParksComputing.Engine.Xfer.IXferService, ParksComputing.Engine.Xfer.XferService>();
            services.AddSingleton<ParksComputing.Engine.Xfer.XferInputFormatter>();
            services.AddSingleton<ParksComputing.Engine.Xfer.XferOutputFormatter>();
            services.AddSingleton<Microsoft.Extensions.Options.IConfigureOptions<MvcOptions>, ParksComputing.Engine.Xfer.XferMvcOptionsConfigurator>();

            services.Configure<Microsoft.AspNetCore.Mvc.ApiBehaviorOptions>(options => {
                // Allow controller code to handle ModelState errors so we can return a ProblemDetails body instead of empty 400.
                options.SuppressModelStateInvalidFilter = true;
            });

            services.AddHttpClient();
            services.AddHttpClient("barcode-open-food-facts")
                .ConfigurePrimaryHttpMessageHandler(() => new System.Net.Http.HttpClientHandler {
                    AllowAutoRedirect = false, UseCookies = false
                });
            services.AddDistributedMemoryCache();
            services.AddSession(options => {
                options.IdleTimeout = TimeSpan.FromMinutes(30);
                options.Cookie.HttpOnly = true;
                options.Cookie.IsEssential = true; // Make sure the cookie is marked as essential
            });

            // One for the whole site: it keeps sitenav.xfer, read and filled in, until a
            // file it comes from changes (Pages/Services/NavService.cs).
            services.AddSingleton<INavService, NavService>();

            // What the engine makes from a file, kept until the file changes
            // (Pages/Services/FileCache.cs).
            services.AddSingleton<FileCache>();
            services.AddSingleton<StaticFileReaderService>();
            // The site for AI readers: llms.txt and each page as Markdown, and
            // the count of AI agents' visits (Identity/AiVisits.cs).
            services.AddSingleton<MarkdownPages>();
            services.AddSingleton<SiteRedirects>();
            services.AddSingleton<SiteEditor>();
            services.AddSingleton<ParksComputing.Engine.Identity.AiVisitCounter>();
            services.AddSingleton<ParksComputing.Engine.Identity.VisitReport>();
            services.AddHostedService<ParksComputing.Engine.Identity.AiVisitWriter>();
            // The recent log for the super-user's Server log applet (Identity/RecentLogs.cs).
            services.AddSingleton<ParksComputing.Engine.Identity.RecentLogs>();
            services.AddSingleton<Microsoft.Extensions.Logging.ILoggerProvider, ParksComputing.Engine.Identity.RecentLogProvider>();
            services.AddSingleton<ParksComputing.Engine.Identity.PolicyDocuments>();
            services.AddSingleton<ArticleContentService>();
            services.AddSingleton<BookService>();
            services.AddOptions<ParksComputing.Engine.Api.ContentStorageOptions>();
            services.AddSingleton<ParksComputing.Engine.Api.IContentStorage, ParksComputing.Engine.Api.FileContentStorage>();

            // Auth database provider: SQL Server only (Azure or local dev). Requires Auth:ConnectionString or AUTH_CONNECTION_STRING.
            // Accept multiple sources (App Settings or App Service Connection Strings blade). App Service 'Connection strings' inject
            // environment variables with prefixes: SQLAZURECONNSTR_, SQLSERVERCONNSTR_, MYSQLCONNSTR_, POSTGRESQLCONNSTR_, CUSTOMCONNSTR_.
            // If the user created a connection string named AUTH_CONNECTION_STRING in that blade, its env var will be e.g. SQLAZURECONNSTR_AUTH_CONNECTION_STRING.
            var configuredConn =
                Configuration.GetValue<string>("Auth:ConnectionString")
                ?? Environment.GetEnvironmentVariable("AUTH_CONNECTION_STRING")
                ?? Environment.GetEnvironmentVariable("SQLAZURECONNSTR_AUTH_CONNECTION_STRING")
                ?? Environment.GetEnvironmentVariable("SQLSERVERCONNSTR_AUTH_CONNECTION_STRING")
                ?? Environment.GetEnvironmentVariable("CUSTOMCONNSTR_AUTH_CONNECTION_STRING");

            if (string.IsNullOrWhiteSpace(configuredConn)) {
                throw new InvalidOperationException("Auth:ConnectionString (or AUTH_CONNECTION_STRING env var) is required; SQLite fallback removed.");
            }

            ConfigureIdentity(services, configuredConn);

            // The built-in partitioned limiter is the site's only rate limit.
            // Readers are told apart by Cloudflare's CF-Connecting-IP, since every
            // request arrives through the tunnel from the same local address.
            services.AddRateLimiter(o => {
                // A signed-in admin is held by the admin policies below, not
                // this one, since working through the mount (a grep -r over
                // /wwwroot, say) is many requests.
                o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
                    ctx.User.IsInRole(ParksComputing.Engine.Identity.AdminOptions.Role)
                        ? RateLimitPartition.GetNoLimiter("admin")
                        : RateLimitPartition.GetFixedWindowLimiter(
                            partitionKey: ctx.User?.Identity?.Name ?? ParksComputing.Engine.Identity.AdminOptions.ClientIp(ctx),
                            factory: _ => new FixedWindowRateLimiterOptions { AutoReplenishment = true, PermitLimit = 600, QueueLimit = 0, Window = TimeSpan.FromMinutes(1) }));
                // The mount's filesystem: an admin gets 1,200 calls a minute;
                // anyone else gets a 404 from it, and 30 a minute to get it.
                o.AddPolicy(ParksComputing.Engine.Identity.AdminFsController.RateLimitPolicy, ctx => {
                    bool admin = ctx.User.IsInRole(ParksComputing.Engine.Identity.AdminOptions.Role);
                    return RateLimitPartition.GetFixedWindowLimiter(
                        partitionKey: admin ? "fs:" + ctx.User.Identity!.Name : "fs-ip:" + ParksComputing.Engine.Identity.AdminOptions.ClientIp(ctx),
                        factory: _ => new FixedWindowRateLimiterOptions { AutoReplenishment = true, PermitLimit = admin ? 1200 : 30, QueueLimit = 0, Window = TimeSpan.FromMinutes(1) });
                });
                // Sign-in and the passkey ceremonies. A stranger gets 30 calls a
                // minute per address, which is plenty to sign in and too few to
                // guess at recovery codes; a signed-in admin gets 120 a minute.
                o.AddPolicy(ParksComputing.Engine.Identity.AdminAuthController.RateLimitPolicy, ctx => {
                    bool admin = ctx.User.IsInRole(ParksComputing.Engine.Identity.AdminOptions.Role);
                    return RateLimitPartition.GetFixedWindowLimiter(
                        partitionKey: admin ? "admin:" + ctx.User.Identity!.Name : "ip:" + ParksComputing.Engine.Identity.AdminOptions.ClientIp(ctx),
                        factory: _ => new FixedWindowRateLimiterOptions { AutoReplenishment = true, PermitLimit = admin ? 120 : 30, QueueLimit = 0, Window = TimeSpan.FromMinutes(1) });
                });
                o.RejectionStatusCode = 429;
            });

            // Swagger / OpenAPI for discoverability
            services.AddEndpointsApiExplorer();
            services.AddSwaggerGen(c => {
                c.SwaggerDoc("v1", new OpenApiInfo {
                    Title = "ParksComputing Content API",
                    Version = "v1",
                    Description = "RESTful hypermedia API for managing site content (markdown pages/posts)."
                });

                // The admin API is not part of the public document.
                c.DocInclusionPredicate((doc, api) => !(api.RelativePath ?? "").StartsWith("api/admin", StringComparison.OrdinalIgnoreCase));
                // Include XML docs if generated
                var xml = System.IO.Path.Combine(AppContext.BaseDirectory, "ParksComputing.Engine.xml");

                if (System.IO.File.Exists(xml)) {
                    c.IncludeXmlComments(xml);
                }

                // Register XferLang Swagger filters so application/xfer appears with examples
                c.OperationFilter<ParksComputing.Engine.Xfer.XferOperationFilter>();
                // Rate limit headers & 429 response added before examples so examples filter can enrich 429
                c.OperationFilter<ParksComputing.Engine.Api.RateLimitOperationFilter>();
                c.OperationFilter<ParksComputing.Engine.Api.ErrorExamplesOperationFilter>();
                c.DocumentFilter<ParksComputing.Engine.Xfer.XferDocumentFilter>();
                c.DocumentFilter<ParksComputing.Engine.Api.HardeningDocumentFilter>();
            });
        }

        // This method gets called by the runtime. Use this method to configure the HTTP request pipeline.
        public void Configure(IApplicationBuilder app, IWebHostEnvironment env) {
            // The accounts database is migrated in Program.Main, before the host
            // starts. Admins are made from the server only (Identity/AdminCommand.cs),
            // so nothing is seeded.

            if (env.IsDevelopment()) {
                app.UseDeveloperExceptionPage();
            }
            else {
                app.UseExceptionHandler("/Error");
            }

            // AI agents' visits are counted after each response, whatever
            // answered it (Identity/AiVisits.cs).
            app.Use((ctx, next) => ParksComputing.Engine.Identity.AiVisitCounter.Middleware(ctx, next));

            // Admin work on its own origin, before anything else answers.
            app.UseMiddleware<ParksComputing.Engine.Identity.EditOriginGate>();

            ConfigureRedirects(app, env);

            // A page answers in Markdown to a request that prefers it, and
            // otherwise links to its Markdown, llms.txt and the sitemap
            // (Pages/Services/MarkdownNegotiation.cs).
            app.UseMiddleware<MarkdownNegotiation>();

            // Redirect /swagger (no trailing slash) to /swagger/
            app.Use(async (ctx, next) => {
                if (ctx.Request.Path.Equals("/swagger", StringComparison.OrdinalIgnoreCase)) {
                    ctx.Response.Redirect("/swagger/", permanent: false);
                    return;
                }

                await next();
            });

            // Serve static files, ensuring custom extensions like .xfer are exposed
            var contentTypeProvider = new FileExtensionContentTypeProvider();

            // Map .xfer (XferLang source) to a text-based content type so it isn't rejected as unknown
            if (!contentTypeProvider.Mappings.ContainsKey(".xfer")) {
                contentTypeProvider.Mappings[".xfer"] = "text/plain"; // or application/x-xferlang
            }

            // Optionally also expose .xfer backups/alternatives if desired
            if (!contentTypeProvider.Mappings.ContainsKey(".xferlang")) {
                contentTypeProvider.Mappings[".xferlang"] = "text/plain";
            }

            app.UseStaticFiles(new StaticFileOptions {
                ContentTypeProvider = contentTypeProvider,
                // A font file never changes in place, so a browser keeps it
                // for a year; a picture for a day. Stylesheets and scripts
                // ask each time (by ETag), because an edit to one must show
                // at once; a stamped address (?v=) still saves the download.
                OnPrepareResponse = c => {
                    var ext = System.IO.Path.GetExtension(c.File.Name).ToLowerInvariant();
                    if (ext is ".woff2" or ".woff") {
                        c.Context.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
                    } else if (ext is ".webp" or ".png" or ".jpg" or ".jpeg" or ".gif" or ".svg" or ".ico" or ".avif") {
                        c.Context.Response.Headers.CacheControl = "public, max-age=86400";
                    } else if (ext is ".css" or ".js" or ".mjs") {
                        // Said rather than left unsaid, so no cache in between
                        // supplies a lifetime of its own: keep a copy, but ask
                        // (by ETag) before each use, so an edit shows at once.
                        c.Context.Response.Headers.CacheControl = "public, no-cache";
                    }
                }
            });

            // Serve extensionless files under /content/ (e.g., Linux/macOS binaries) as octet-stream downloads.
            // The default FileExtensionContentTypeProvider refuses to serve files with no recognized extension,
            // so we need a dedicated middleware scoped to this path with ServeUnknownFileTypes enabled.
            app.UseStaticFiles(new StaticFileOptions {
                RequestPath = "/content",
                FileProvider = new PhysicalFileProvider(System.IO.Path.Combine(env.WebRootPath, "content")),
                ServeUnknownFileTypes = true,
                DefaultContentType = "application/octet-stream"
            });

            // NOTE: Place Swagger BEFORE routing so that any broad/catch-all Razor Page routes do not swallow /swagger/*.js|css.
            app.UseSwagger(c => { c.RouteTemplate = "swagger/{documentName}/swagger.json"; });
            app.UseSwaggerUI(c => {
                c.RoutePrefix = "swagger";
                c.SwaggerEndpoint("/swagger/v1/swagger.json", "Content API v1");
                c.DocumentTitle = "ParksComputing API";
                c.DisplayRequestDuration();
            });

            // Register before cookie/session middleware too: their OnStarting
            // callbacks can add cookies that must prevent public caching.
            app.UseMiddleware<ParksComputing.Engine.Api.CachingMiddleware>();
            app.UseCookiePolicy();
            app.UseSession();
            app.UseRouting();
            // Authentication comes before the limiter, whose policies tell a
            // signed-in admin from everyone else; before it, every request
            // looked anonymous and the admin allowances never applied.
            app.UseAuthentication();
            app.UseRateLimiter();
            // A server tool's call without a session hears so (Identity/ServerToolSignIn.cs).
            app.UseMiddleware<ParksComputing.Engine.Identity.ServerToolSignIn>();
            app.UseMiddleware<ParksComputing.Engine.Api.ApiNotFoundMiddleware>();
            app.UseAuthorization();
            // The SSH relay's WebSocket (Identity/SshController.cs, A16); the
            // controller alone decides who may open one.
            app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(30) });

            app.UseEndpoints(endpoints => {
                endpoints.MapRazorPages();
                endpoints.MapControllers();
                // endpoints.MapGet(@"/{year:range(1900:2100)}/{month:range(1-12)}/{name:regex([\w\-]+$)}", WordPressHandler);
                // endpoints.MapGet(@"/{year:int}/{month:int}/{slug:regex(^[a-z0-9_-]+$)}", WordPressHandler);
                // endpoints.MapGet(@"/{year:int}/{month:int}/{**slug}", WordPressHandler);

                // /2021/08/set-associative-cache-in-c-part-2-interface-design/
            });
        }

        public void ConfigureRedirects(IApplicationBuilder app, IWebHostEnvironment env) {
            // A brochure site's home page is its root: / is served as /home,
            // and /home goes to /. It has no window view to put there.
            var site = Configuration.GetSection(SiteOptions.Section).Get<SiteOptions>() ?? new SiteOptions();
            if (site.Brochure) {
                app.Use(async (ctx, next) => {
                    if (ctx.Request.Path.Equals("/home", StringComparison.OrdinalIgnoreCase)) {
                        ctx.Response.Redirect("/" + ctx.Request.QueryString, permanent: true);
                        return;
                    }
                    if (ctx.Request.Path == "/") { ctx.Request.Path = "/home"; }
                    await next();
                });
            }

            // A site's own moved addresses (wwwroot/redirects.txt), and, where
            // a page's address ends in a slash (Site:PageUrl "/{slug}/"), the
            // page's address without it, so each page has one address.
            app.Use(async (ctx, next) => {
                var path = ctx.Request.Path.Value ?? "/";
                var moved = ctx.RequestServices.GetRequiredService<SiteRedirects>().Find(path);
                if (moved is not null) {
                    ctx.Response.Redirect(moved + ctx.Request.QueryString, permanent: true);
                    return;
                }
                if (site.PageUrl.EndsWith('/') && path.Length > 1 && !path.EndsWith('/') && path.IndexOf('/', 1) < 0 && path.IndexOf('.') < 0) {
                    var slug = path[1..];
                    if (ctx.RequestServices.GetRequiredService<MarkdownPages>().IsReadable(slug)) {
                        ctx.Response.Redirect(site.UrlOf(slug) + ctx.Request.QueryString, permanent: true);
                        return;
                    }
                }
                await next();
            });

            // The desktop moved from /desktop to the site root; old links follow.
            app.Use(async (ctx, next) => {
                if (ctx.Request.Path.Equals("/desktop", StringComparison.OrdinalIgnoreCase)) {
                    ctx.Response.Redirect("/" + ctx.Request.QueryString, permanent: true);
                    return;
                }

                await next();
            });
        }

        private string WordPressHandler(int year, int month, string slug) {
            return $"Retrieve content for URL /{year:0000}/{month:00}/{slug}";
        }
    }
}

namespace ParksComputing.Engine {
    public partial class Startup {
        private static System.Threading.Tasks.Task WriteProblem(Microsoft.AspNetCore.Http.HttpContext ctx, int status, string title, string detail) {
            // Avoid rewriting if response started (e.g., websocket upgrade)
            if (ctx.Response.HasStarted) {
                return System.Threading.Tasks.Task.CompletedTask;
            }

            ctx.Response.StatusCode = status;
            string accept = ctx.Request.Headers["Accept"].ToString();
            string instance = ctx.Request.Path;

            if (!string.IsNullOrEmpty(accept) && accept.Contains("application/xfer", StringComparison.OrdinalIgnoreCase)) {
                ctx.Response.ContentType = "application/xfer";
                var sb = new StringBuilder();
                sb.AppendLine("{");
                sb.AppendLine($"  type \"https://httpstatuses.com/{status}\"");
                sb.AppendLine($"  title \"{Escape(title)}\"");
                sb.AppendLine($"  status {status}");
                sb.AppendLine($"  detail \"{Escape(detail)}\"");
                sb.AppendLine($"  instance \"{Escape(instance)}\"");
                sb.AppendLine("}");
                return ctx.Response.WriteAsync(sb.ToString());
            }
            else {
                ctx.Response.ContentType = "application/json";
                var json = $"{{\"type\":\"https://httpstatuses.com/{status}\",\"title\":\"{Escape(title)}\",\"status\":{status},\"detail\":\"{Escape(detail)}\",\"instance\":\"{Escape(instance)}\"}}";
                return ctx.Response.WriteAsync(json);
            }
        }

        private static string Escape(string v) => v.Replace("\\", "\\\\").Replace("\"", "\\\"");
    }
}
