using System;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using ModelContextProtocol.Protocol;
using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.Mcp;

/// <summary>
/// The site's MCP endpoint (Architecture/applet-platform-design.md, P3):
/// /mcp over the Streamable HTTP transport of the official C# SDK, for
/// personal access tokens only (Identity/AccessTokens.cs). It exists on a
/// site with accounts and staff, whose super-user mints the tokens; anywhere
/// else /mcp is not mapped at all.
///
/// Each capability is a policy, "mcp:files.read" and so on, and each tool
/// carries the policy it needs, so the SDK's authorization filters leave a
/// tool out of a token's tool list unless the token was given its
/// capability. Every call is logged with the tool and the token's name.
/// </summary>
public static class McpSetup {
    public const string Path = "/mcp";
    public const string Policy = "mcp";
    public const string PolicyPrefix = "mcp:";
    /// <summary>Writing a file: files.write for ~, site.publish for /wwwroot,
    /// so the tool is listed to a token with either.</summary>
    public const string WritePolicy = "mcp:write";
    public const string RateLimitPolicy = "mcp";
    public const string LogCategory = "ParksComputing.Engine.Mcp";

    private const string Instructions =
        "This is a website served by the Parks Computing engine, an ASP.NET site engine; site_pages gives the site's name and its pages. " +
        "These tools act as the site's super-user, " +
        "within the capabilities the token was given. Paths: ~ is the super-user's home folder on the server, never served to the public; " +
        "/wwwroot is the site's files, where pages are Markdown or HTML in /wwwroot/content and /wwwroot/sitenav.xfer lists the pages and menus; " +
        "/etc is the server's settings. site_pages gives each page's source file. Writing or deleting in /wwwroot changes the live site at once, and " +
        "every write or delete keeps the version it replaces for 30 days. Draft in ~ when unsure. " +
        "/llms.txt is generated from sitenav.xfer and each page's title and description; text the site writes by hand for it, such as key facts, " +
        "goes in /wwwroot/content/" + ParksComputing.Engine.Pages.Services.MarkdownPages.LlmsSectionFile + ", which appears after the site's description. By default llms.txt groups the pages as the menu does; an llms list on the root of " +
        "sitenav.xfer gives other groups, each a title and a nav of pages that may have their own titles and descriptions for llms.txt, and " +
        "the menus never read it. The root's title is the short name every page's title ends with; an optional name on the root is the " +
        "site's full name, such as a business name, which link previews (og:site_name), the RSS feed and llms.txt's heading use instead. " +
        "The applet tools list what the site's applets publish " +
        "and run their pure actions (such as rolling dice, solving a sudoku or drawing a barcode) on the server; actions that need a window " +
        "or a person need the super-user's open desktop, which is not available yet.";

    public static bool Enabled(IConfiguration configuration) =>
        configuration.GetSection("Accounts").Get<AccountOptions>() is { Enabled: true, StaffEnabled: true };

    public static void AddSiteMcp(this IServiceCollection services) {
        services.AddHttpContextAccessor();
        services.AddScoped<McpCaller>();
        services.AddSingleton<AppletRunner>();
        services.AddSingleton<McpInvocations>();
        services.AddAuthentication().AddScheme<AuthenticationSchemeOptions, AccessTokenAuthentication>(AccessTokenAuthentication.SchemeName, null);
        services.AddAuthorization(o => {
            o.AddPolicy(Policy, p => p.AddAuthenticationSchemes(AccessTokenAuthentication.SchemeName).RequireAuthenticatedUser());
            foreach (var (name, _) in TokenCapabilities.All) {
                o.AddPolicy(PolicyPrefix + name, p => p.AddAuthenticationSchemes(AccessTokenAuthentication.SchemeName)
                    .RequireClaim(AccessTokenAuthentication.CapabilityClaim, name));
            }
            o.AddPolicy(WritePolicy, p => p.AddAuthenticationSchemes(AccessTokenAuthentication.SchemeName)
                .RequireClaim(AccessTokenAuthentication.CapabilityClaim, TokenCapabilities.FilesWrite, TokenCapabilities.SitePublish));
        });
        // A token gets 300 calls a minute; the global limit of 600 a minute
        // per address still holds behind it, which a stream of made-up
        // tokens meets.
        services.Configure<RateLimiterOptions>(o => o.AddPolicy(RateLimitPolicy, ctx => {
            var auth = ctx.Request.Headers.Authorization.ToString();
            var key = auth.Length > 0 ? "mcp:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(auth)))[..16] : "mcp-ip:" + AdminOptions.ClientIp(ctx);
            return RateLimitPartition.GetFixedWindowLimiter(key,
                _ => new FixedWindowRateLimiterOptions { AutoReplenishment = true, PermitLimit = auth.Length > 0 ? 300 : 30, QueueLimit = 0, Window = TimeSpan.FromMinutes(1) });
        }));
        services.AddMcpServer(o => {
            o.ServerInfo = new Implementation { Name = "parkscomputing", Title = "Parks Computing", Version = "1.0.0" };
            o.ServerInstructions = Instructions;
        })
            // Clients of the 2026-07-28 revision are served per request; the
            // many still using the initialize handshake get a session, which
            // one server process can keep.
            .WithHttpTransport(t => t.SessionMode = ModelContextProtocol.AspNetCore.HttpServerSessionMode.StatefulForInitializeClients)
            .AddAuthorizationFilters()
            .WithTools<SiteTools>()
            .WithTools<AppletTools>()
            .WithRequestFilters(f => f.AddCallToolFilter(next => async (request, cancellationToken) => {
                var result = await next(request, cancellationToken);
                var log = request.Services?.GetService<ILoggerFactory>()?.CreateLogger(LogCategory);
                log?.LogInformation("MCP {Tool} by token {Token}: {Outcome}", request.Params?.Name,
                    request.User?.FindFirstValue(AccessTokenAuthentication.TokenNameClaim) ?? "(none)", result.IsError == true ? "refused" : "done");
                return result;
            }));
    }

    public static void MapSiteMcp(this IEndpointRouteBuilder endpoints) {
        endpoints.MapMcp(Path).RequireAuthorization(Policy).RequireRateLimiting(RateLimitPolicy);
    }
}
