using System;
using System.Threading.Tasks;

using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine;

/* Accounts and admin sign-in (Architecture/admin-and-identity-design.md):
   ASP.NET Core Identity with passkeys, emailed links and recovery codes, one
   admin session cookie that belongs to the edit origin alone, and the
   data-protection keys kept in the accounts database. */
public partial class Startup {
    private void ConfigureIdentity(IServiceCollection services, string connectionString) {
        services.Configure<AdminOptions>(Configuration.GetSection("Admin"));
        services.Configure<EmailOptions>(o => {
            o.ApiKey = Configuration["RESEND_API_KEY"];
            o.From = Configuration["EMAIL_FROM"];
            o.ReplyTo = Configuration["EMAIL_REPLY_TO"];
        });
        var admin = Configuration.GetSection("Admin").Get<AdminOptions>() ?? new AdminOptions();
        admin.Validate();
        var cookieSecurity = admin.Secure ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;

        services.AddDbContext<SiteIdentityDbContext>(options =>
            options.UseSqlServer(connectionString, sql => sql.EnableRetryOnFailure(5, TimeSpan.FromSeconds(5), null)));

        services.AddDataProtection()
            .SetApplicationName("parkscomputing")
            .PersistKeysToDbContext<SiteIdentityDbContext>();

        services.AddIdentity<IdentityUser, IdentityRole>(o => {
            // Version 3 adds the passkeys table.
            o.Stores.SchemaVersion = IdentitySchemaVersions.Version3;
            o.User.RequireUniqueEmail = true;
            o.Lockout.MaxFailedAccessAttempts = 5;
            o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
            o.Lockout.AllowedForNewUsers = true;
        })
        .AddEntityFrameworkStores<SiteIdentityDbContext>()
        .AddDefaultTokenProviders()
        .AddTokenProvider<EmailLinkTokenProvider<IdentityUser>>(EmailLinkTokenProvider<IdentityUser>.ProviderName);

        services.Configure<EmailLinkTokenProviderOptions>(_ => { });

        // Passkeys belong to the edit origin: its host is the relying party,
        // and a ceremony from any other origin, or from a frame, is refused.
        services.Configure<IdentityPasskeyOptions>(o => {
            o.ServerDomain = admin.EditHost;
            o.UserVerificationRequirement = "required";
            o.ResidentKeyRequirement = "required";
            o.ValidateOrigin = ctx => ValueTask.FromResult(
                !ctx.CrossOrigin && string.Equals(ctx.Origin, admin.EditOrigin.TrimEnd('/'), StringComparison.Ordinal));
        });

        services.ConfigureApplicationCookie(o => {
            o.Cookie.Name = admin.CookieName("pc-admin");
            o.Cookie.Path = "/";
            o.Cookie.HttpOnly = true;
            o.Cookie.SecurePolicy = cookieSecurity;
            o.Cookie.SameSite = SameSiteMode.Strict;
            o.Cookie.IsEssential = true;
            o.ExpireTimeSpan = TimeSpan.FromMinutes(admin.IdleMinutes);
            o.SlidingExpiration = true;
            o.LoginPath = "/admin/signin";
            o.LogoutPath = "/admin/signout";
            o.AccessDeniedPath = "/admin/signin";
            // An API call without a session is answered, not redirected.
            o.Events.OnRedirectToLogin = ctx => ApiOrRedirect(ctx, StatusCodes.Status401Unauthorized);
            o.Events.OnRedirectToAccessDenied = ctx => ApiOrRedirect(ctx, StatusCodes.Status403Forbidden);
            // Identity's own check, then the session's absolute lifetime.
            o.Events.OnValidatePrincipal = async ctx => {
                await SecurityStampValidator.ValidatePrincipalAsync(ctx);
                if (ctx.Principal is not null && AdminSessions.Expired(ctx.Principal, admin)) {
                    ctx.RejectPrincipal();
                    await ctx.HttpContext.SignOutAsync(IdentityConstants.ApplicationScheme);
                }
            };
        });

        // A revoked account or a used link ends other sessions within a minute,
        // and the session's own claims survive Identity's refresh.
        services.Configure<SecurityStampValidatorOptions>(o => {
            o.ValidationInterval = TimeSpan.FromMinutes(1);
            o.OnRefreshingPrincipal = ctx => {
                if (ctx.CurrentPrincipal is not null && ctx.NewPrincipal is not null) {
                    AdminSessions.CarryClaims(ctx.CurrentPrincipal, ctx.NewPrincipal);
                }
                return Task.CompletedTask;
            };
        });

        services.AddAntiforgery(o => {
            o.HeaderName = "RequestVerificationToken";
            o.Cookie.Name = admin.CookieName("pc-af");
            o.Cookie.Path = "/";
            o.Cookie.SecurePolicy = cookieSecurity;
            o.Cookie.SameSite = SameSiteMode.Strict;
        });

        services.AddAuthorization();
        services.AddHttpClient(ResendMailer.ClientName, c => c.Timeout = TimeSpan.FromSeconds(15));
        services.AddScoped<ResendMailer>();
        services.AddScoped<AdminSessions>();
        services.AddSingleton<ServerFiles>();
        services.AddHostedService<HistoryPruner>();
        services.AddMemoryCache();
        services.AddSingleton<PreviewDrafts>();
    }

    private static Task ApiOrRedirect(Microsoft.AspNetCore.Authentication.RedirectContext<Microsoft.AspNetCore.Authentication.Cookies.CookieAuthenticationOptions> ctx, int status) {
        if (ctx.Request.Path.StartsWithSegments("/api")) {
            ctx.Response.StatusCode = status;
            return Task.CompletedTask;
        }
        ctx.Response.Redirect(ctx.RedirectUri);
        return Task.CompletedTask;
    }
}
