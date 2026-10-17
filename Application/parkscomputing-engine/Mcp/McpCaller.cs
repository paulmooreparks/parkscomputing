using System;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using ModelContextProtocol;
using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.Mcp;

/// <summary>
/// Who is calling /mcp: the token (Identity/AccessTokenAuthentication.cs)
/// and the account it acts for, with the capabilities it was given. One per
/// request.
/// </summary>
public sealed class McpCaller {
    private readonly IHttpContextAccessor _http;
    private readonly UserManager<IdentityUser> _users;
    private IdentityUser? _user;

    public McpCaller(IHttpContextAccessor http, UserManager<IdentityUser> users) { _http = http; _users = users; }

    private HttpContext Context => _http.HttpContext ?? throw new InvalidOperationException("There is no request.");
    private ClaimsPrincipal Principal => Context.User;

    public bool Has(string capability) => Principal.HasClaim(AccessTokenAuthentication.CapabilityClaim, capability);

    public string TokenName => Principal.FindFirstValue(AccessTokenAuthentication.TokenNameClaim) ?? "";

    /// <summary>How the audit log names the writer: the account, then the token.</summary>
    public string Who => (Principal.FindFirstValue(ClaimTypes.Name) ?? "") + " (token " + TokenName + ")";

    public string Ip => AdminOptions.ClientIp(Context);

    public async Task<IdentityUser> UserAsync() {
        if (_user is null) {
            var id = Principal.FindFirstValue(ClaimTypes.NameIdentifier);
            _user = (id is null ? null : await _users.FindByIdAsync(id)) ?? throw new McpException("The token's account is gone.");
        }
        return _user;
    }

    public async Task<string> HomeNameAsync() => ServerFiles.HomeNameOf(await UserAsync());

    public string UserId => Principal.FindFirstValue(ClaimTypes.NameIdentifier) ?? "";

    /// <summary>Refuses unless the token was given the capability.</summary>
    public void Require(string capability) {
        if (!Has(capability)) {
            throw new McpException("This token was not given " + capability + ".");
        }
    }

    public string[] Capabilities => Principal.FindAll(AccessTokenAuthentication.CapabilityClaim).Select(c => c.Value).ToArray();
}
