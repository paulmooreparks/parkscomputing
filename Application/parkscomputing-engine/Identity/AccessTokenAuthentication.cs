using System.Linq;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// The authentication scheme for personal access tokens
/// (Identity/AccessTokens.cs), which only /mcp accepts. A request carries the
/// token as "Authorization: Bearer pcmcp_…"; the scheme finds it, checks that
/// its account may still use the server's tools, and gives a principal with
/// the account, the token and one pc_cap claim for each capability the token
/// was given. A cookie session counts for nothing here, so a page in a
/// browser can't reach /mcp on its reader's behalf.
/// </summary>
public sealed class AccessTokenAuthentication : AuthenticationHandler<AuthenticationSchemeOptions> {
    public const string SchemeName = "pc-token";
    public const string TokenClaim = "pc_token";
    public const string TokenNameClaim = "pc_token_name";
    public const string CapabilityClaim = "pc_cap";

    private readonly AccessTokens _tokens;
    private readonly AdminSessions _sessions;
    private readonly ChatGrants _chat;

    public AccessTokenAuthentication(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder,
        AccessTokens tokens, AdminSessions sessions, ChatGrants chat) : base(options, logger, encoder) {
        _tokens = tokens; _sessions = sessions; _chat = chat;
    }

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync() {
        string header = Request.Headers.Authorization.ToString();
        if (!header.StartsWith("Bearer ", System.StringComparison.OrdinalIgnoreCase)) {
            return AuthenticateResult.NoResult();
        }
        var secret = header["Bearer ".Length..].Trim();
        // The chat's grant for a turn (ChatGrants), made in this process.
        var found = secret.StartsWith(ChatGrants.Prefix, System.StringComparison.Ordinal)
            ? _chat.Find(secret)
            : await _tokens.FindAsync(secret, AdminOptions.ClientIp(Context));
        if (found is null || !await _sessions.MaySignInAsync(found.User)) {
            return AuthenticateResult.Fail("The token is not valid.");
        }
        var claims = new[] {
            new Claim(ClaimTypes.NameIdentifier, found.User.Id),
            new Claim(ClaimTypes.Name, found.User.Email ?? found.User.UserName ?? found.User.Id),
            new Claim(TokenClaim, found.TokenId),
            new Claim(TokenNameClaim, found.TokenName)
        }.Concat(found.Capabilities.Select(c => new Claim(CapabilityClaim, c)));
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, SchemeName));
        return AuthenticateResult.Success(new AuthenticationTicket(principal, SchemeName));
    }

    /// <summary>A missing or bad token is told so in the way bearer tokens are (RFC 6750).</summary>
    protected override Task HandleChallengeAsync(AuthenticationProperties properties) {
        Response.StatusCode = 401;
        Response.Headers.WWWAuthenticate = Request.Headers.Authorization.Count == 0
            ? "Bearer realm=\"parkscomputing\""
            : "Bearer realm=\"parkscomputing\", error=\"invalid_token\"";
        return Task.CompletedTask;
    }
}
