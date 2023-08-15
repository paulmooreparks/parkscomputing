using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

using aspnet_core_dotnet_core.Pages.Services;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace aspnet_core_dotnet_core {
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


            services.AddRazorPages();
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
            services.AddHttpClient("commentApi", c => {
                c.BaseAddress = new Uri("https://localhost:7004/");
            });
        }

        // This method gets called by the runtime. Use this method to configure the HTTP request pipeline.
        public void Configure(IApplicationBuilder app, IWebHostEnvironment env) {
            if (env.IsDevelopment()) {
                app.UseDeveloperExceptionPage();
            }
            else {
                app.UseExceptionHandler("/Error");
            }

            ConfigureRedirects(app, env);

            app.UseStaticFiles();
            app.UseCookiePolicy();
            app.UseSession();
            app.UseRouting();
            app.UseAuthorization();

            app.UseEndpoints(endpoints => {
                endpoints.MapRazorPages();
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
