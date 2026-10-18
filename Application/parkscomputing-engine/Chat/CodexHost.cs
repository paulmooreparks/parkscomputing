using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

using Microsoft.Extensions.Logging;

namespace ParksComputing.Engine.Chat;

/// <summary>
/// Codex, as GK Companion drives it: the Codex CLI's app server
/// (<c>codex app-server</c>), a child process speaking JSON-RPC in lines
/// over its standard streams, started once and shared by every chat that
/// uses a provider of kind codex. The process gets a scrubbed environment
/// (no key, secret, token or password of the server's, since Codex runs
/// commands), CODEX_HOME where its sign-in lives (the etc folder's codex
/// directory unless the environment says otherwise), and, when the server
/// has OPENAI_API_KEY and Codex is not signed in yet, a sign-in with that
/// key through the documented <c>codex login --with-api-key</c>.
///
/// A request from this side is a message with an id and gets its result
/// back; a request from Codex (an approval to ask the reader) goes to
/// whoever subscribed for its thread and is answered with that message's
/// id; a notification without an id goes to the thread's subscriber too.
/// The protocol is Codex's app-server protocol, as GK's codexagent package
/// uses it; its methods are quoted where they are called.
/// </summary>
public sealed class CodexHost : IAsyncDisposable {
    public const string DefaultCommand = "/app/codex/codex";
    public const string DefaultHome = "/app/etc/codex";
    private static readonly string[] SecretWords = { "KEY", "SECRET", "TOKEN", "PASSWORD", "PASSWD", "CONNECTIONSTRING", "CONNECTION_STRING" };

    private readonly ILogger<CodexHost> _log;
    private readonly SemaphoreSlim _starting = new(1, 1);
    private CodexConnection? _conn;
    private string? _command;

    public CodexHost(ILogger<CodexHost> log) { _log = log; }

    public static string Home => Environment.GetEnvironmentVariable("CODEX_HOME") is { Length: > 0 } h ? h : DefaultHome;

    /// <summary>The running connection, started on the first call, for the
    /// command the provider names; a connection whose process has ended is
    /// replaced.</summary>
    public async Task<CodexConnection> ConnectAsync(ChatProviderConfig provider, CancellationToken cancel) {
        var command = string.IsNullOrWhiteSpace(provider.Command) ? DefaultCommand : provider.Command!;
        await _starting.WaitAsync(cancel);
        try {
            if (_conn is { Alive: true } live && _command == command) { return live; }
            if (_conn is not null) { await _conn.DisposeAsync(); _conn = null; }
            if (!File.Exists(command)) { throw new ProviderException("Codex is not installed on the server: there is no " + command + "."); }
            Directory.CreateDirectory(Home);
            await SignInIfNeededAsync(command, cancel);
            var conn = await CodexConnection.StartAsync(command, Home, ScrubbedEnvironment(), _log, cancel);
            try {
                /* initialize, then the initialized notification, as the protocol asks. */
                await conn.CallAsync("initialize", new JsonObject { ["clientInfo"] = new JsonObject { ["name"] = "parkscomputing-chat", ["title"] = "Parks Computing Chat", ["version"] = "1.0.0" } }, cancel);
                conn.Notify("initialized", new JsonObject());
            }
            catch { await conn.DisposeAsync(); throw; }
            _conn = conn; _command = command;
            return conn;
        }
        finally { _starting.Release(); }
    }

    /// <summary>Signs Codex in with the server's OPENAI_API_KEY when it has
    /// one and Codex holds no sign-in yet (<c>codex login --with-api-key</c>
    /// reads the key from its standard input). A ChatGPT sign-in made
    /// elsewhere and copied in as auth.json is left alone.</summary>
    private async Task SignInIfNeededAsync(string command, CancellationToken cancel) {
        var key = Environment.GetEnvironmentVariable("OPENAI_API_KEY");
        if (string.IsNullOrEmpty(key) || File.Exists(Path.Combine(Home, "auth.json"))) { return; }
        var psi = new ProcessStartInfo(command) { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, WorkingDirectory = Home };
        psi.ArgumentList.Add("login"); psi.ArgumentList.Add("--with-api-key");
        foreach (var (k, v) in ScrubbedEnvironment()) { psi.Environment[k] = v; }
        psi.Environment["CODEX_HOME"] = Home;
        using var p = Process.Start(psi) ?? throw new ProviderException("Codex could not be started to sign in.");
        await p.StandardInput.WriteAsync(key);
        p.StandardInput.Close();
        var err = await p.StandardError.ReadToEndAsync(cancel);
        await p.WaitForExitAsync(cancel);
        if (p.ExitCode != 0) { throw new ProviderException("Codex could not sign in with OPENAI_API_KEY: " + err.Trim()); }
        _log.LogInformation("Codex signed in with the server's OPENAI_API_KEY");
    }

    /// <summary>The environment Codex gets: the server's, without anything
    /// that looks like a secret, since Codex runs commands and reads files
    /// for the model.</summary>
    public static Dictionary<string, string> ScrubbedEnvironment() {
        var env = new Dictionary<string, string>();
        foreach (System.Collections.DictionaryEntry e in Environment.GetEnvironmentVariables()) {
            var name = e.Key?.ToString() ?? ""; var upper = name.ToUpperInvariant();
            if (SecretWords.Any(w => upper.Contains(w))) { continue; }
            if (e.Value is string v) { env[name] = v; }
        }
        env["CODEX_HOME"] = Home;
        env.TryAdd("HOME", Home);
        return env;
    }

    public async ValueTask DisposeAsync() { if (_conn is not null) { await _conn.DisposeAsync(); _conn = null; } }
}

/// <summary>One app-server process and its JSON-RPC stream.</summary>
public sealed class CodexConnection : IAsyncDisposable {
    private readonly Process _process;
    private readonly StreamWriter _stdin;
    private readonly ILogger _log;
    private readonly SemaphoreSlim _writing = new(1, 1);
    private readonly ConcurrentDictionary<long, TaskCompletionSource<JsonNode?>> _pending = new();
    private readonly ConcurrentDictionary<string, Func<CodexMessage, Task>> _threads = new();
    private long _next;
    private readonly TaskCompletionSource _ended = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public bool Alive => !_process.HasExited;
    public Task Ended => _ended.Task;

    private CodexConnection(Process process, ILogger log) {
        _process = process; _log = log;
        _stdin = process.StandardInput;
        _stdin.AutoFlush = true;
    }

    public static Task<CodexConnection> StartAsync(string command, string cwd, IReadOnlyDictionary<string, string> env, ILogger log, CancellationToken cancel) {
        var psi = new ProcessStartInfo(command) {
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, WorkingDirectory = cwd,
            StandardInputEncoding = new UTF8Encoding(false), StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        };
        psi.ArgumentList.Add("app-server");
        psi.Environment.Clear();
        foreach (var (k, v) in env) { psi.Environment[k] = v; }
        var process = Process.Start(psi) ?? throw new ProviderException("Codex could not be started.");
        var conn = new CodexConnection(process, log);
        _ = conn.ReadAsync();
        _ = conn.DrainErrorsAsync();
        return Task.FromResult(conn);
    }

    /// <summary>Hears what Codex says about one thread: its notifications
    /// and its requests (which the subscriber answers with Respond).</summary>
    public IDisposable Subscribe(string threadId, Func<CodexMessage, Task> handler) {
        _threads[threadId] = handler;
        return new Unsubscriber(() => _threads.TryRemove(new KeyValuePair<string, Func<CodexMessage, Task>>(threadId, handler)));
    }
    private sealed class Unsubscriber : IDisposable { private readonly Action _a; public Unsubscriber(Action a) { _a = a; } public void Dispose() { _a(); } }

    public async Task<JsonNode?> CallAsync(string method, JsonObject? parameters, CancellationToken cancel) {
        var id = Interlocked.Increment(ref _next);
        var tcs = new TaskCompletionSource<JsonNode?>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[id] = tcs;
        try {
            await WriteAsync(new JsonObject { ["id"] = id, ["method"] = method, ["params"] = parameters ?? new JsonObject() }, cancel);
            using var reg = cancel.Register(() => tcs.TrySetCanceled(cancel));
            var done = await Task.WhenAny(tcs.Task, _ended.Task);
            if (done != tcs.Task) { throw new ProviderException("Codex stopped."); }
            return await tcs.Task;
        }
        finally { _pending.TryRemove(id, out _); }
    }

    public void Notify(string method, JsonObject parameters) { _ = WriteAsync(new JsonObject { ["method"] = method, ["params"] = parameters }, CancellationToken.None); }

    /// <summary>Answers a request Codex made (an approval).</summary>
    public Task RespondAsync(JsonNode id, JsonNode? result) => WriteAsync(new JsonObject { ["id"] = id.DeepClone(), ["result"] = result ?? new JsonObject() }, CancellationToken.None);
    public Task RespondErrorAsync(JsonNode id, int code, string message) => WriteAsync(new JsonObject { ["id"] = id.DeepClone(), ["error"] = new JsonObject { ["code"] = code, ["message"] = message } }, CancellationToken.None);

    private async Task WriteAsync(JsonObject message, CancellationToken cancel) {
        await _writing.WaitAsync(cancel);
        try { await _stdin.WriteAsync(message.ToJsonString() + "\n"); }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException) { throw new ProviderException("Codex is not listening: " + ex.Message); }
        finally { _writing.Release(); }
    }

    private async Task ReadAsync() {
        try {
            var reader = _process.StandardOutput;
            while (await reader.ReadLineAsync() is { } line) {
                if (line.Length == 0) { continue; }
                JsonObject? m;
                try { m = JsonNode.Parse(line) as JsonObject; } catch (JsonException) { _log.LogDebug("Codex said something that is not JSON: {Line}", line); continue; }
                if (m is null) { continue; }
                await DispatchAsync(m);
            }
        }
        catch (Exception ex) { _log.LogWarning(ex, "Reading from Codex ended"); }
        finally {
            try { await _process.WaitForExitAsync(); } catch (Exception) { }
            foreach (var p in _pending.Values) { p.TrySetException(new ProviderException("Codex stopped.")); }
            _ended.TrySetResult();
        }
    }

    private async Task DrainErrorsAsync() {
        try { while (await _process.StandardError.ReadLineAsync() is { } line) { if (line.Length > 0) { _log.LogDebug("codex: {Line}", line); } } }
        catch (Exception) { }
    }

    private async Task DispatchAsync(JsonObject m) {
        var method = m["method"]?.GetValue<string>();
        var id = m["id"];
        if (method is null) {
            /* A result for a call of ours. */
            if (id is not null && long.TryParse(id.ToJsonString().Trim('"'), out var n) && _pending.TryRemove(n, out var tcs)) {
                if (m["error"] is JsonObject err) { tcs.TrySetException(new ProviderException(err["message"]?.GetValue<string>() ?? "Codex answered with an error")); }
                else { tcs.TrySetResult(m["result"]); }
            }
            return;
        }
        var parameters = m["params"] as JsonObject ?? new JsonObject();
        var threadId = parameters["threadId"]?.GetValue<string>();
        if (threadId is not null && _threads.TryGetValue(threadId, out var handler)) {
            try { await handler(new CodexMessage(method, parameters, id)); }
            catch (Exception ex) { _log.LogWarning(ex, "Handling Codex's {Method}", method); if (id is not null) { await RespondErrorAsync(id, -32603, ex.Message); } }
            return;
        }
        if (id is not null) { await RespondErrorAsync(id, -32601, "Nothing here answers " + method + " for that thread."); }
    }

    public async ValueTask DisposeAsync() {
        try { if (!_process.HasExited) { _stdin.Close(); if (!_process.WaitForExit(3000)) { _process.Kill(true); } } } catch (Exception) { }
        _process.Dispose();
        await Task.CompletedTask;
    }
}

/// <summary>A notification or a request from Codex about a thread; a
/// request has an id and wants an answer.</summary>
public sealed record CodexMessage(string Method, JsonObject Params, JsonNode? Id);
