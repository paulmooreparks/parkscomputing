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
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
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
            services.Configure<CookiePolicyOptions>(options => {
                // This lambda determines whether user consent for non-essential cookies is needed for a given request.
                options.CheckConsentNeeded = context => true;
                options.MinimumSameSitePolicy = SameSiteMode.None;
            });

            services.AddTransient<AppServices>();

            services.Configure<CommentServiceConfig>(Configuration.GetSection("CommentService"));
            services.AddRazorPages();
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
            services.AddDistributedMemoryCache();
            services.AddSession(options => {
                options.IdleTimeout = TimeSpan.FromMinutes(30);
                options.Cookie.HttpOnly = true;
                options.Cookie.IsEssential = true; // Make sure the cookie is marked as essential
            });

            services.AddTransient<INavService, NavService>();
            services.AddTransient<ICommentService, CommentService>();
            services.AddHttpClient("commentApi", (serviceProvider, c) => {
                var config = serviceProvider.GetRequiredService<IOptions<CommentServiceConfig>>().Value;
                c.BaseAddress = new Uri(config?.ApiUrl ?? throw new InvalidOperationException("ApiUrl is null"));
            });

            services.AddSingleton<StaticFileReaderService>();
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

            services.AddDbContext<ParksComputing.Engine.Auth.AuthDbContext>(options => {
                // Use SQL Server for all database connections
                options.UseSqlServer(configuredConn, sql => sql.EnableRetryOnFailure(5, TimeSpan.FromSeconds(5), null));
            });

            services.AddScoped<ParksComputing.Engine.Auth.ICredentialService, ParksComputing.Engine.Auth.CredentialService>();

            // Basic JWT configuration (symmetric key) - Replace with secure key management
            // Use same retrieval logic as TokenService to avoid signing/validation key mismatch.
            var jwtSection = Configuration.GetSection("Jwt");
            var secret = jwtSection.GetValue<string>("Secret")
                         ?? Environment.GetEnvironmentVariable("JWT_SECRET");

            if (string.IsNullOrWhiteSpace(secret)) {
                throw new InvalidOperationException("JWT secret missing. Set Jwt:Secret or JWT_SECRET environment variable (32+ bytes).");
            }

            var keyBytes = Encoding.UTF8.GetBytes(secret);

            if (keyBytes.Length < 32) {
                throw new InvalidOperationException($"JWT secret is too short: {keyBytes.Length} bytes. Minimum is 32 bytes (256 bits) for HS256. Configure Jwt:Secret or JWT_SECRET.");
            }

            services.AddAuthentication(options => {
                options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
                options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
            }).AddJwtBearer(options => {
                options.RequireHttpsMetadata = false; // set true in production with HTTPS
                options.SaveToken = true;
                options.TokenValidationParameters = new TokenValidationParameters {
                    ValidateIssuer = false,
                    ValidateAudience = false,
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = new SymmetricSecurityKey(keyBytes),
                    ClockSkew = TimeSpan.FromMinutes(2)
                };
                options.Events = new JwtBearerEvents {
                    OnChallenge = context => {
                        // Suppress default WWW-Authenticate header body
                        context.HandleResponse();
                        return WriteProblem(context.HttpContext, 401, "Unauthorized", "Authentication required or invalid token");
                    },
                    OnForbidden = context => WriteProblem(context.HttpContext, 403, "Forbidden", "Insufficient permissions")
                };
            });

            services.AddAuthorization();

            // Simple built-in fixed window limiter (metadata only; custom middleware adds headers/body)
            services.AddRateLimiter(o => {
                o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx => RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: ctx.User?.Identity?.Name ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "anon",
                    factory: _ => new FixedWindowRateLimiterOptions { AutoReplenishment = true, PermitLimit = 600, QueueLimit = 0, Window = TimeSpan.FromMinutes(1) }));
                o.RejectionStatusCode = 429;
            });

            services.AddSingleton<ParksComputing.Engine.Api.TokenService>();

            // Swagger / OpenAPI for discoverability
            services.AddEndpointsApiExplorer();
            services.AddSwaggerGen(c => {
                c.SwaggerDoc("v1", new OpenApiInfo {
                    Title = "ParksComputing Content API",
                    Version = "v1",
                    Description = "RESTful hypermedia API for managing site content (markdown pages/posts)."
                });

                // JWT bearer auth definition
                var securityScheme = new OpenApiSecurityScheme {
                    Name = "Authorization",
                    Description = "Enter 'Bearer {token}'",
                    In = ParameterLocation.Header,
                    Type = SecuritySchemeType.Http,
                    Scheme = "bearer",
                    BearerFormat = "JWT",
                    Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" }
                };

                c.AddSecurityDefinition("Bearer", securityScheme);
                // Per-operation requirements are added via SecurityOperationFilter only for [Authorize] endpoints.
                // Include XML docs if generated
                var xml = System.IO.Path.Combine(AppContext.BaseDirectory, "ParksComputing.Engine.xml");

                if (System.IO.File.Exists(xml)) {
                    c.IncludeXmlComments(xml);
                }

                // Register XferLang Swagger filters so application/xfer appears with examples
                c.OperationFilter<ParksComputing.Engine.Xfer.XferOperationFilter>();
                c.OperationFilter<ParksComputing.Engine.Api.SecurityOperationFilter>();
                // Rate limit headers & 429 response added before examples so examples filter can enrich 429
                c.OperationFilter<ParksComputing.Engine.Api.RateLimitOperationFilter>();
                c.OperationFilter<ParksComputing.Engine.Api.ErrorExamplesOperationFilter>();
                c.DocumentFilter<ParksComputing.Engine.Xfer.XferDocumentFilter>();
                c.DocumentFilter<ParksComputing.Engine.Api.HardeningDocumentFilter>();
            });
        }

        // This method gets called by the runtime. Use this method to configure the HTTP request pipeline.
        public void Configure(IApplicationBuilder app, IWebHostEnvironment env) {
            // Apply migrations & seed initial admin if needed
            using (var scope = app.ApplicationServices.CreateScope()) {
                var db = scope.ServiceProvider.GetRequiredService<ParksComputing.Engine.Auth.AuthDbContext>();
                var logger = scope.ServiceProvider.GetRequiredService<ILogger<Startup>>();
                try {
                    // If no migrations have ever been added yet, Migrate() will effectively just ensure the database.
                    // However, when there are truly zero migration metadata tables, querying Users for seeding BEFORE the
                    // model is applied causes 'no such table'. We defensively EnsureCreated first, then Migrate so that
                    // once you add explicit migrations later they can still run (EnsureCreated + later migrations is safe
                    // as long as the schema hasn't diverged yet).
                    // Apply migrations (idempotent). If zero migrations and SQLite, bootstrap schema with EnsureCreated first.
                    db.Database.Migrate();
                }
                catch (Exception ex) {
                    logger.LogError(ex, "Auth DB migration error");
                    throw; // rethrow so startup still fails visibly
                }

                var seedUser = Configuration.GetValue<string>("Auth:Seed:Username") ?? Environment.GetEnvironmentVariable("SEED_ADMIN_USERNAME");
                var seedHash = Configuration.GetValue<string>("Auth:Seed:PasswordHash") ?? Environment.GetEnvironmentVariable("SEED_ADMIN_PASSWORD_HASH");
                ParksComputing.Engine.Auth.CredentialService.SeedIfEmptyAsync(db, seedUser, seedHash, logger).GetAwaiter().GetResult();
            }

            if (env.IsDevelopment()) {
                app.UseDeveloperExceptionPage();
            }
            else {
                app.UseExceptionHandler("/Error");
            }

            ConfigureRedirects(app, env);

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

            app.UseStaticFiles(new StaticFileOptions { ContentTypeProvider = contentTypeProvider });

            // NOTE: Place Swagger BEFORE routing so that any broad/catch-all Razor Page routes do not swallow /swagger/*.js|css.
            app.UseSwagger(c => { c.RouteTemplate = "swagger/{documentName}/swagger.json"; });
            app.UseSwaggerUI(c => {
                c.RoutePrefix = "swagger";
                c.SwaggerEndpoint("/swagger/v1/swagger.json", "Content API v1");
                c.DocumentTitle = "ParksComputing API";
                c.DisplayRequestDuration();
            });

            app.UseCookiePolicy();
            app.UseSession();
            app.UseRouting();
            app.UseRateLimiter();
            app.UseMiddleware<ParksComputing.Engine.Api.RateLimitMiddleware>();
            app.UseMiddleware<ParksComputing.Engine.Api.CachingMiddleware>();
            app.UseAuthentication();
            app.UseAuthorization();
            // 404 ProblemDetails for unmatched API routes handled inside RateLimitMiddleware after pipeline

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
