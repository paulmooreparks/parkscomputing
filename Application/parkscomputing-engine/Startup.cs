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
using Microsoft.Extensions.Options;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using System.Text;
using Microsoft.OpenApi.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.FileProviders;
using Microsoft.EntityFrameworkCore;

namespace ParksComputing.Engine {
    public class Startup {
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
            });

            services.Configure<Microsoft.AspNetCore.Mvc.ApiBehaviorOptions>(options => {
                // Allow controller code to handle ModelState errors so we can return a ProblemDetails body instead of empty 400.
                options.SuppressModelStateInvalidFilter = true;
            });

            services.AddHttpClient();
            services.AddDistributedMemoryCache();
            services.AddSession(options =>
            {
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
            services.AddSingleton<ParksComputing.Engine.Api.IContentStorage, ParksComputing.Engine.Api.FileContentStorage>();

            // SQLite auth database (file-based). Connection string configurable via Jwt:AuthDb or env AUTH_DB_PATH
            var authDbPath = Configuration.GetValue<string>("Auth:DbPath") ?? Environment.GetEnvironmentVariable("AUTH_DB_PATH") ?? System.IO.Path.Combine(AppContext.BaseDirectory, "auth.db");
            services.AddDbContext<ParksComputing.Engine.Auth.AuthDbContext>(options => options.UseSqlite($"Data Source={authDbPath}"));
            services.AddScoped<ParksComputing.Engine.Auth.ICredentialService, ParksComputing.Engine.Auth.CredentialService>();

            // Basic JWT configuration (symmetric key) - Replace with secure key management
            // Use same retrieval logic as TokenService to avoid signing/validation key mismatch.
            var jwtSection = Configuration.GetSection("Jwt");
            var secret = jwtSection.GetValue<string>("Secret")
                         ?? Environment.GetEnvironmentVariable("JWT_SECRET")
                         ?? "dev-insecure-secret-change-please-rotate-now!!"; // Fallback (>=32 bytes) DO NOT use in production
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
            });

            services.AddAuthorization();
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
                c.AddSecurityRequirement(new OpenApiSecurityRequirement {{ securityScheme, new string[]{} }});
                // Include XML docs if generated
                var xml = System.IO.Path.Combine(AppContext.BaseDirectory, "ParksComputing.Engine.xml");

                if (System.IO.File.Exists(xml)) {
                    c.IncludeXmlComments(xml);
                }
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
                    db.Database.EnsureCreated();
                    db.Database.Migrate();
                    // Extra defensive fallback: explicitly create Users table if for any reason it still doesn't exist (e.g. EnsureCreated short‑circuited).
                    // Only create Users table manually if it truly does not exist (avoid noisy CREATE TABLE log every startup)
                    using (var conn = db.Database.GetDbConnection()) {
                        if (conn.State != System.Data.ConnectionState.Open) { conn.Open(); }
                        using (var cmd = conn.CreateCommand()) {
                            cmd.CommandText = "SELECT 1 FROM sqlite_master WHERE type='table' AND name='Users'";
                            var exists = cmd.ExecuteScalar() != null;
                            if (!exists) {
                                using (var create = conn.CreateCommand()) {
                                    create.CommandText = @"CREATE TABLE Users (
                                        Id INTEGER PRIMARY KEY AUTOINCREMENT,
                                        Username TEXT NOT NULL UNIQUE,
                                        PasswordHash TEXT NOT NULL,
                                        CreatedUtc TEXT NOT NULL,
                                        IsActive INTEGER NOT NULL
                                    );";
                                    create.ExecuteNonQuery();
                                    logger.LogInformation("Users table created via fallback (no migrations present).");
                                }
                            }
                        }
                    }
                } catch (Exception ex) {
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
            app.UseAuthentication();
            app.UseAuthorization();

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
