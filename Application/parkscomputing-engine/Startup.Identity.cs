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
        services.Configure<AccountOptions>(Configuration.GetSection("Accounts"));
        var accounts = Configuration.GetSection("Accounts").Get<AccountOptions>() ?? new AccountOptions();
        accounts.Validate();
        services.Configure<AdminOptions>(Configuration.GetSection("Admin"));
        // SSH from the web terminal (A16): its destinations, and the relay's bookkeeping.
        services.Configure<SshOptions>(Configuration.GetSection("Admin:Ssh"));
        services.AddSingleton<SshRelays>();
        services.Configure<EmailOptions>(o => {
            o.ApiKey = Configuration["RESEND_API_KEY"];
            o.From = Configuration["EMAIL_FROM"];
            o.ReplyTo = Configuration["EMAIL_REPLY_TO"];
        });
        var admin = Configuration.GetSection("Admin").Get<AdminOptions>() ?? new AdminOptions();
        admin.Validate();
        var cookieSecurity = (accounts.Enabled ? accounts.Scheme == "https" : admin.Secure) ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;

        services.AddDbContextFactory<SiteIdentityDbContext>(options =>
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
            o.ServerDomain = accounts.Enabled ? accounts.Host : admin.EditHost;
            o.UserVerificationRequirement = "required";
            o.ResidentKeyRequirement = "required";
            o.ValidateOrigin = ctx => ValueTask.FromResult(
                !ctx.CrossOrigin && string.Equals(ctx.Origin, (accounts.Enabled ? accounts.Origin : admin.EditOrigin).TrimEnd('/'), StringComparison.Ordinal));
        });

        services.ConfigureApplicationCookie(o => {
            o.Cookie.Name = accounts.Enabled ? (accounts.Scheme == "https" ? "__Host-pc-account" : "pc-account") : admin.CookieName("pc-admin");
            o.Cookie.Path = "/";
            o.Cookie.HttpOnly = true;
            o.Cookie.SecurePolicy = cookieSecurity;
            o.Cookie.SameSite = accounts.Enabled ? SameSiteMode.Lax : SameSiteMode.Strict;
            o.Cookie.IsEssential = true;
            // The cookie lasts as long as the longest idle limit an admin may
            // choose; each admin's own limit is kept per session (A14).
            o.ExpireTimeSpan = TimeSpan.FromMinutes(admin.IdleMinutesMax);
            o.SlidingExpiration = true;
            o.LoginPath = accounts.Enabled ? "/account/signin" : "/admin/signin";
            o.LogoutPath = accounts.Enabled ? "/account/signout" : "/admin/signout";
            o.AccessDeniedPath = accounts.Enabled ? "/account/signin" : "/admin/signin";
            // An API call without a session is answered, not redirected.
            o.Events.OnRedirectToLogin = ctx => ApiOrRedirect(ctx, StatusCodes.Status401Unauthorized);
            o.Events.OnRedirectToAccessDenied = ctx => ApiOrRedirect(ctx, StatusCodes.Status403Forbidden);
            // Identity's own check, then the session's absolute lifetime and
            // its admin's idle limit. A page asking whether its session is
            // still there (AccountAuthController.Session) is not activity, so
            // asking neither extends the session nor renews the cookie.
            o.Events.OnValidatePrincipal = async ctx => {
                await SecurityStampValidator.ValidatePrincipalAsync(ctx);
                var policy = ctx.HttpContext.RequestServices.GetRequiredService<SessionPolicy>();
                var quiet = AccountAuthController.IsQuietSessionCheck(ctx.HttpContext.Request);
                if (quiet) { ctx.ShouldRenew = false; }
                if (ctx.Principal is not null && await (quiet ? AdminSessions.ExpiredWithoutActivityAsync(ctx.Principal, policy) : AdminSessions.ExpiredAsync(ctx.Principal, policy))) {
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
            o.Cookie.Name = accounts.Enabled ? (accounts.Scheme == "https" ? "__Host-pc-account-af" : "pc-account-af") : admin.CookieName("pc-af");
            o.Cookie.Path = "/";
            o.Cookie.SecurePolicy = cookieSecurity;
            o.Cookie.SameSite = SameSiteMode.Strict;
        });

        services.AddAuthorization();
        services.AddHttpClient(ResendMailer.ClientName, c => c.Timeout = TimeSpan.FromSeconds(15));
        services.AddScoped<ResendMailer>();
        services.AddScoped<AdminSessions>();
        services.AddScoped<MemberSessions>();
        services.AddSingleton<AccountWorkflow>();
        services.AddSingleton<StaffAccess>();
        services.AddSingleton<StaffBootstrap>();
        services.AddSingleton<AccountMenu>();
        services.AddSingleton<AccountAvatars>();
        services.AddSingleton<AccountPins>();
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<DurableSessions>();
        services.AddSingleton<AccountLinks>();
        services.AddSingleton<AccountStatus>();
        services.AddSingleton<SessionPolicy>();
        services.AddSingleton<AdminMenu>();
        services.AddSingleton<ServerFiles>();
        services.AddSingleton<AccessTokens>();
        services.AddSingleton<ChatGrants>();
        // The staff's chat (Chat/, Architecture/chat-design.md). A reply
        // streams for as long as the model takes, so its client waits long.
        services.AddSingleton<ParksComputing.Engine.Chat.ChatSettings>();
        services.AddSingleton<ParksComputing.Engine.Chat.ChatStore>();
        services.AddSingleton<ParksComputing.Engine.Chat.ChatTools>();
        services.AddSingleton<ParksComputing.Engine.Chat.ChatSkills>();
        services.AddSingleton<ParksComputing.Engine.Chat.ChatSelf>();
        services.AddSingleton<ParksComputing.Engine.Chat.ChatWeb>();
        services.AddSingleton<ParksComputing.Engine.Chat.ChatSearch>();
        services.AddHttpClient(ParksComputing.Engine.Chat.ChatWeb.ClientName, c => { c.Timeout = TimeSpan.FromSeconds(40); c.DefaultRequestHeaders.UserAgent.ParseAdd("parkscomputing-chat/1.0 (+https://parkscomputing.com)"); })
            .ConfigurePrimaryHttpMessageHandler(() => new System.Net.Http.SocketsHttpHandler { AllowAutoRedirect = true, MaxAutomaticRedirections = 5, UseCookies = false });
        services.AddSingleton<ParksComputing.Engine.Chat.ChatTurns>();
        services.AddHttpClient(ParksComputing.Engine.Chat.ChatProviders.ClientName, c => c.Timeout = TimeSpan.FromMinutes(15));
        services.AddHostedService<HistoryPruner>();
        services.AddMemoryCache();
        services.AddSingleton<PreviewDrafts>();
        services.Configure<CommentOptions>(Configuration.GetSection("Comments"));
        services.AddSingleton<CommentPolicies>();
        services.AddSingleton<Discussions>();
        services.AddSingleton<ModerationNotices>();
        services.AddHostedService<ModerationNotifier>();
        services.AddSingleton<AccountLifecycle>();
        services.AddHostedService<AccountHousekeeping>();
        services.AddHttpClient(Turnstile.ClientName, c => c.Timeout = TimeSpan.FromSeconds(10));
        services.AddSingleton<Turnstile>();
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
