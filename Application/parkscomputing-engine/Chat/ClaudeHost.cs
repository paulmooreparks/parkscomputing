using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

using Microsoft.Extensions.Logging;

namespace ParksComputing.Engine.Chat;

/// <summary>
/// Claude, as GK Companion drives it (Architecture/chat-design.md, "Claude
/// on the operator's plan"): the Claude Agent ACP adapter, a Node.js
/// program built on Anthropic's Agent SDK, run as a child process that
/// speaks the Agent Client Protocol, JSON-RPC in lines over its standard
/// streams. One process serves every chat of a provider of kind claude
/// that bills the same way.
///
/// Who pays is set by the environment, and only by this class. The process
/// gets the server's environment without anything that looks like a secret,
/// and then exactly one credential: ANTHROPIC_API_KEY from the variable the
/// provider's keyEnv says, when it says one, or else CLAUDE_CODE_OAUTH_TOKEN,
/// the operator's own token from <c>claude setup-token</c>, which bills
/// their Claude plan. The server's own ANTHROPIC_API_KEY, which the
/// anthropic provider uses, never reaches a provider without keyEnv: Claude
/// Code ranks an API key above the token, so a stray key would bill the API
/// without anyone choosing it. Claude Code is also told to make no
/// nonessential network traffic, which includes updating itself; the
/// adapter's version is the image's.
///
/// The commands Claude runs can read that one credential. Claude Code's
/// documented way to keep it from them, CLAUDE_CODE_SUBPROCESS_ENV_SCRUB,
/// needs bubblewrap, and bubblewrap cannot create its namespaces in this
/// container without loosening the container's own isolation; with the
/// scrub on and no working bubblewrap, every command fails. Claude asks the
/// reader before each command, and the provider is kept to the one account
/// whose credential it is (Architecture/chat-design.md).
/// </summary>
public sealed class ClaudeHost : IAsyncDisposable {
    public const string DefaultNode = "/usr/local/bin/node";
    public const string Adapter = "/app/claude-agent/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js";
    /* Claude Code's configuration folder, with the sessions a chat reopens:
       a volume of its own, never inside etc, which the site lists, keeps
       history of and syncs. */
    public const string DefaultHome = "/app/claude-home";
    public const string TokenVariable = "CLAUDE_CODE_OAUTH_TOKEN";
    public const string KeyVariable = "ANTHROPIC_API_KEY";

    private readonly ILogger<ClaudeHost> _log;
    private readonly SemaphoreSlim _starting = new(1, 1);
    private readonly Dictionary<string, AcpConnection> _conns = new();

    public ClaudeHost(ILogger<ClaudeHost> log) { _log = log; }

    public static string Home => Environment.GetEnvironmentVariable("CLAUDE_CONFIG_DIR") is { Length: > 0 } h ? h : DefaultHome;

    /// <summary>The credential the provider bills to: the variable Claude
    /// Code reads and its value, which is empty when the server has none.</summary>
    public static (string Variable, string? Value) Credential(ChatProviderConfig provider) =>
        string.IsNullOrWhiteSpace(provider.KeyEnv)
            ? (TokenVariable, Environment.GetEnvironmentVariable(TokenVariable))
            : (KeyVariable, Environment.GetEnvironmentVariable(provider.KeyEnv!));

    /// <summary>Why the provider cannot start, said for the operator; null when it can.</summary>
    public static string? NotReady(ChatProviderConfig provider) {
        var (variable, value) = Credential(provider);
        if (!string.IsNullOrEmpty(value)) { return null; }
        return string.IsNullOrWhiteSpace(provider.KeyEnv)
            ? "Claude is not signed in on the server. Run claude setup-token on a computer where you use Claude Code, approve it in the browser, and put the token it prints in the server's .env as " + TokenVariable + "; then restart the site."
            : "The server has no " + provider.KeyEnv + " for Claude's API key.";
    }

    /// <summary>The adapter's environment, as the summary says.</summary>
    public static Dictionary<string, string> AdapterEnvironment(string variable, string value) {
        var env = CodexHost.WithoutSecrets();
        env["CLAUDE_CONFIG_DIR"] = Home;
        env["HOME"] = Home;
        env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] = "1";
        env[variable] = value;
        return env;
    }

    /// <summary>The running adapter for the provider's credential and Node.js,
    /// started and initialized on first use; one whose process ended is
    /// replaced.</summary>
    public async Task<AcpConnection> ConnectAsync(ChatProviderConfig provider, CancellationToken cancel) {
        var node = string.IsNullOrWhiteSpace(provider.Command) ? DefaultNode : provider.Command!;
        if (NotReady(provider) is { } why) { throw new ProviderException(why); }
        var (variable, value) = Credential(provider);
        var key = node + "|" + variable + "|" + provider.KeyEnv;
        await _starting.WaitAsync(cancel);
        try {
            if (_conns.TryGetValue(key, out var live) && live.Alive) { return live; }
            if (live is not null) { await live.DisposeAsync(); _conns.Remove(key); }
            if (!File.Exists(node)) { throw new ProviderException("Node.js is not installed on the server: there is no " + node + "."); }
            if (!File.Exists(Adapter)) { throw new ProviderException("The Claude adapter is not installed on the server: there is no " + Adapter + "."); }
            Directory.CreateDirectory(Home);
            var conn = AcpConnection.Start(node, new[] { Adapter }, Home, AdapterEnvironment(variable, value!), "Claude", _log);
            try {
                var init = await conn.CallAsync("initialize", new JsonObject {
                    ["protocolVersion"] = 1,
                    /* The chat reads and writes no files for Claude and gives it
                       no terminal: Claude Code does both itself, asking first. */
                    ["clientCapabilities"] = new JsonObject { ["fs"] = new JsonObject { ["readTextFile"] = false, ["writeTextFile"] = false }, ["terminal"] = false },
                    ["clientInfo"] = new JsonObject { ["name"] = "parkscomputing-chat", ["title"] = "Parks Computing Chat", ["version"] = "1.0.0" }
                }, cancel) as JsonObject;
                conn.Capabilities = init?["agentCapabilities"] as JsonObject ?? new JsonObject();
            }
            catch { await conn.DisposeAsync(); throw; }
            _conns[key] = conn;
            return conn;
        }
        finally { _starting.Release(); }
    }

    public async ValueTask DisposeAsync() {
        foreach (var c in _conns.Values) { await c.DisposeAsync(); }
        _conns.Clear();
    }
}

/// <summary>
/// One ACP agent process and its JSON-RPC stream
/// (https://agentclientprotocol.com). What the agent says about a session,
/// its updates and its requests, goes to whoever subscribed for that
/// session; a request is answered with the value the subscriber returns.
/// The connection also remembers, for each session it has open, the
/// settings it last set (model, effort) and the MCP grant it was opened with.
/// </summary>
public sealed class AcpConnection : IAsyncDisposable {
    private readonly Process _process;
    private readonly StreamWriter _stdin;
    private readonly ILogger _log;
    private readonly string _name;
    private readonly SemaphoreSlim _writing = new(1, 1);
    private readonly ConcurrentDictionary<long, TaskCompletionSource<JsonNode?>> _pending = new();
    private readonly ConcurrentDictionary<string, Func<AcpMessage, Task<JsonNode?>>> _sessions = new();
    private long _next;
    private readonly TaskCompletionSource _ended = new(TaskCreationOptions.RunContinuationsAsynchronously);

    /// <summary>What the agent said it can do, at initialize.</summary>
    public JsonObject Capabilities { get; set; } = new();
    /// <summary>The sessions open in this process, with the MCP grant each
    /// was opened with and the values of its settings.</summary>
    public readonly ConcurrentDictionary<string, OpenSession> Open = new();
    public sealed class OpenSession {
        public string? McpSecret;
        public readonly ConcurrentDictionary<string, string> Options = new();
    }

    public bool Alive => !_process.HasExited;
    public Task Ended => _ended.Task;

    private AcpConnection(Process process, string name, ILogger log) {
        _process = process; _name = name; _log = log;
        _stdin = process.StandardInput;
        _stdin.AutoFlush = true;
    }

    public static AcpConnection Start(string command, IEnumerable<string> args, string cwd, IReadOnlyDictionary<string, string> env, string name, ILogger log) {
        var psi = new ProcessStartInfo(command) {
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, WorkingDirectory = cwd,
            StandardInputEncoding = new UTF8Encoding(false), StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        };
        foreach (var a in args) { psi.ArgumentList.Add(a); }
        psi.Environment.Clear();
        foreach (var (k, v) in env) { psi.Environment[k] = v; }
        var process = Process.Start(psi) ?? throw new ProviderException(name + " could not be started.");
        var conn = new AcpConnection(process, name, log);
        _ = conn.ReadAsync();
        _ = conn.DrainErrorsAsync();
        return conn;
    }

    /// <summary>Hears what the agent says about one session. The handler
    /// returns the answer to a request, or null for one it does not answer.</summary>
    public IDisposable Subscribe(string sessionId, Func<AcpMessage, Task<JsonNode?>> handler) {
        _sessions[sessionId] = handler;
        return new Unsubscriber(() => _sessions.TryRemove(new KeyValuePair<string, Func<AcpMessage, Task<JsonNode?>>>(sessionId, handler)));
    }
    private sealed class Unsubscriber : IDisposable { private readonly Action _a; public Unsubscriber(Action a) { _a = a; } public void Dispose() { _a(); } }

    public async Task<JsonNode?> CallAsync(string method, JsonObject? parameters, CancellationToken cancel) {
        var id = Interlocked.Increment(ref _next);
        var tcs = new TaskCompletionSource<JsonNode?>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[id] = tcs;
        try {
            await WriteAsync(new JsonObject { ["jsonrpc"] = "2.0", ["id"] = id, ["method"] = method, ["params"] = parameters ?? new JsonObject() }, cancel);
            using var reg = cancel.Register(() => tcs.TrySetCanceled(cancel));
            var done = await Task.WhenAny(tcs.Task, _ended.Task);
            if (done != tcs.Task) { throw new ProviderException(_name + " stopped."); }
            return await tcs.Task;
        }
        finally { _pending.TryRemove(id, out _); }
    }

    public void Notify(string method, JsonObject parameters) {
        _ = WriteAsync(new JsonObject { ["jsonrpc"] = "2.0", ["method"] = method, ["params"] = parameters }, CancellationToken.None).ContinueWith(_ => { }, TaskScheduler.Default);
    }

    private Task RespondAsync(JsonNode id, JsonNode result) => WriteAsync(new JsonObject { ["jsonrpc"] = "2.0", ["id"] = id.DeepClone(), ["result"] = result }, CancellationToken.None);
    private Task RespondErrorAsync(JsonNode id, int code, string message) => WriteAsync(new JsonObject { ["jsonrpc"] = "2.0", ["id"] = id.DeepClone(), ["error"] = new JsonObject { ["code"] = code, ["message"] = message } }, CancellationToken.None);

    private async Task WriteAsync(JsonObject message, CancellationToken cancel) {
        await _writing.WaitAsync(cancel);
        try { await _stdin.WriteAsync(message.ToJsonString() + "\n"); }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException) { throw new ProviderException(_name + " is not listening: " + ex.Message); }
        finally { _writing.Release(); }
    }

    private async Task ReadAsync() {
        try {
            var reader = _process.StandardOutput;
            while (await reader.ReadLineAsync() is { } line) {
                if (line.Length == 0) { continue; }
                JsonObject? m;
                try { m = JsonNode.Parse(line) as JsonObject; } catch (JsonException) { _log.LogDebug("{Name} said something that is not JSON: {Line}", _name, line); continue; }
                if (m is not null) { await DispatchAsync(m); }
            }
        }
        catch (Exception ex) { _log.LogWarning(ex, "Reading from {Name} ended", _name); }
        finally {
            try { await _process.WaitForExitAsync(); } catch (Exception) { }
            foreach (var p in _pending.Values) { p.TrySetException(new ProviderException(_name + " stopped.")); }
            _ended.TrySetResult();
        }
    }

    private async Task DrainErrorsAsync() {
        try { while (await _process.StandardError.ReadLineAsync() is { } line) { if (line.Length > 0) { _log.LogDebug("{Name}: {Line}", _name, line); } } }
        catch (Exception) { }
    }

    private async Task DispatchAsync(JsonObject m) {
        var method = m["method"]?.GetValue<string>();
        var id = m["id"];
        if (method is null) {
            /* A result for a call of ours. */
            if (id is not null && long.TryParse(id.ToJsonString().Trim('"'), out var n) && _pending.TryRemove(n, out var tcs)) {
                if (m["error"] is JsonObject err) { tcs.TrySetException(new ProviderException(err["message"]?.GetValue<string>() ?? _name + " answered with an error")); }
                else { tcs.TrySetResult(m["result"]); }
            }
            return;
        }
        var parameters = m["params"] as JsonObject ?? new JsonObject();
        var sessionId = parameters["sessionId"]?.GetValue<string>();
        var handler = sessionId is null ? null : _sessions.GetValueOrDefault(sessionId);
        if (id is null) {
            /* An update, handled in order; one for a session nobody follows
               (the history a reopened session replays) is let go. */
            if (handler is not null) {
                try { await handler(new AcpMessage(method, parameters, null)); }
                catch (Exception ex) { _log.LogWarning(ex, "Handling {Name}'s {Method}", _name, method); }
            }
            return;
        }
        /* A request waits on the reader (a permission), so it is answered
           apart from the stream, which reads on. */
        _ = Task.Run(async () => {
            try {
                var answer = handler is null ? null : await handler(new AcpMessage(method, parameters, id));
                if (answer is null) { await RespondErrorAsync(id, -32601, "The chat does not answer " + method + "."); }
                else { await RespondAsync(id, answer); }
            }
            catch (Exception ex) { _log.LogWarning(ex, "Answering {Name}'s {Method}", _name, method); try { await RespondErrorAsync(id, -32603, ex.Message); } catch (Exception) { } }
        });
    }

    public async ValueTask DisposeAsync() {
        try { if (!_process.HasExited) { _stdin.Close(); if (!_process.WaitForExit(3000)) { _process.Kill(true); } } } catch (Exception) { }
        _process.Dispose();
        await Task.CompletedTask;
    }
}

/// <summary>An update or a request from an ACP agent about a session; a
/// request has an id and wants an answer.</summary>
public sealed record AcpMessage(string Method, JsonObject Params, JsonNode? Id);
