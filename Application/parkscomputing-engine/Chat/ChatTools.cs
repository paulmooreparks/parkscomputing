using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

using ParksComputing.Engine.Identity;
using ParksComputing.Engine.Mcp;

namespace ParksComputing.Engine.Chat;

/// <summary>A tool the chat may offer, and whether it changes anything.</summary>
public sealed record ChatTool(ToolSpec Spec, string Title, bool ReadOnly);

/// <summary>
/// The site's own tools for the chat (Architecture/chat-design.md): the
/// chat is a client of the site's /mcp, on the loopback address, with a
/// grant made for the turn (Identity/ChatGrants.cs) and the site's host
/// name, so each tool checks and logs the call exactly as it does for any
/// personal access token. Only the super-user's chats have tools, since the
/// tools act as the super-user.
/// </summary>
public sealed class ChatTools {
    public const int ResultLimit = 100_000;
    private readonly ChatGrants _grants;
    private readonly IServer _server;
    private readonly IConfiguration _configuration;
    private readonly ILoggerFactory _logs;

    public ChatTools(ChatGrants grants, IServer server, IConfiguration configuration, ILoggerFactory logs) {
        _grants = grants; _server = server; _configuration = configuration; _logs = logs;
    }

    public bool Available => McpSetup.Enabled(_configuration);

    /// <summary>Where this process listens, as a loopback address.</summary>
    private Uri Loopback() {
        var configured = _configuration["Chat:Loopback"];
        if (!string.IsNullOrWhiteSpace(configured)) { return new Uri(configured); }
        var address = _server.Features.Get<IServerAddressesFeature>()?.Addresses.FirstOrDefault(a => a.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
            ?? "http://127.0.0.1:8080";
        var port = new Uri(address.Replace("://+", "://localhost").Replace("://*", "://localhost").Replace("://[::]", "://localhost").Replace("://0.0.0.0", "://localhost")).Port;
        return new Uri("http://127.0.0.1:" + port + McpSetup.Path);
    }

    /// <summary>Gives each request the site's own host name, which the site answers to.</summary>
    private sealed class HostHandler : DelegatingHandler {
        private readonly string _host;
        public HostHandler(string host) : base(new HttpClientHandler()) { _host = host; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancel) {
            request.Headers.Host = _host;
            return base.SendAsync(request, cancel);
        }
    }

    public async Task<Session> OpenAsync(IdentityUser user, string host, CancellationToken cancel) {
        var secret = _grants.Create(user, "chat", TokenCapabilities.All.Select(c => c.Name).ToList(), TimeSpan.FromHours(2));
        try {
            var http = new HttpClient(new HostHandler(host)) { Timeout = TimeSpan.FromMinutes(5) };
            var transport = new HttpClientTransport(new HttpClientTransportOptions {
                Endpoint = Loopback(), Name = "chat",
                AdditionalHeaders = new Dictionary<string, string> { ["Authorization"] = "Bearer " + secret }
            }, http, _logs, ownsHttpClient: true);
            var client = await McpClient.CreateAsync(transport, new McpClientOptions {
                ClientInfo = new Implementation { Name = "parkscomputing-chat", Version = "1.0.0" }
            }, _logs, cancel);
            var tools = await client.ListToolsAsync(cancellationToken: cancel);
            return new Session(_grants, secret, client, tools.Select(t => new ChatTool(
                new ToolSpec(t.Name, t.Description ?? t.Title ?? t.Name, JsonNode.Parse(t.JsonSchema.GetRawText()) ?? new JsonObject { ["type"] = "object" }),
                t.Title ?? t.ProtocolTool.Annotations?.Title ?? t.Name,
                t.ProtocolTool.Annotations?.ReadOnlyHint == true)).ToList());
        }
        catch {
            _grants.Revoke(secret);
            throw;
        }
    }

    /// <summary>The tools for one turn, and the grant that reaches them.</summary>
    public sealed class Session : IAsyncDisposable {
        private readonly ChatGrants _grants; private readonly string _secret; private readonly McpClient _client;
        public IReadOnlyList<ChatTool> Tools { get; }

        internal Session(ChatGrants grants, string secret, McpClient client, IReadOnlyList<ChatTool> tools) {
            _grants = grants; _secret = secret; _client = client; Tools = tools;
        }

        public ChatTool? Find(string name) => Tools.FirstOrDefault(t => t.Spec.Name == name);

        /// <summary>The tool's result as text for the model, and whether it failed.</summary>
        public async Task<(string Text, bool Failed)> CallAsync(string name, JsonNode? input, CancellationToken cancel) {
            var args = new Dictionary<string, object?>();
            if (input is JsonObject o) {
                foreach (var (k, v) in o) { args[k] = v is null ? null : JsonSerializer.Deserialize<JsonElement>(v.ToJsonString()); }
            }
            var result = await _client.CallToolAsync(name, args, cancellationToken: cancel);
            var text = new StringBuilder();
            foreach (var block in result.Content) {
                if (block is TextContentBlock t) { text.Append(t.Text); }
                else { text.Append("[" + block.Type + "]"); }
                text.Append('\n');
            }
            if (text.Length == 0 && result.StructuredContent is { } sc) { text.Append(sc.GetRawText()); }
            var s = text.ToString().TrimEnd();
            if (s.Length > ResultLimit) { s = s[..ResultLimit] + "\n[The result was cut at " + ResultLimit + " characters.]"; }
            return (s, result.IsError == true);
        }

        public async ValueTask DisposeAsync() {
            _grants.Revoke(_secret);
            await _client.DisposeAsync();
        }
    }
}
