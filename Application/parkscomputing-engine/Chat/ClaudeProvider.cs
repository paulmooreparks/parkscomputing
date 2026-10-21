using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

namespace ParksComputing.Engine.Chat;

/// <summary>
/// Claude as a chat provider (kind claude in /etc/chat.json), through the
/// ACP adapter ClaudeHost runs (Architecture/chat-design.md, "Claude on the
/// operator's plan"). A conversation is an ACP session, started on its first
/// turn (<c>session/new</c>) in the reader's home folder on the server and
/// kept by id; a session the adapter's process does not have open is
/// reopened with <c>session/load</c>, which the adapter advertises, and the
/// history it replays is let go since the chat has it. Each message is a
/// <c>session/prompt</c>, whose updates become the chat's events: Claude's
/// message and thinking, each tool it runs as a row, and each permission it
/// asks for as a question for the reader. A stop is <c>session/cancel</c>.
/// The model and the effort are the session's config options, set before
/// the prompt when the chat's differ. With the site's tools on, the session
/// gets the site's MCP server with the chat's grant, as Codex does.
/// </summary>
public sealed class ClaudeProvider : IChatProvider {
    public const string McpServerName = CodexProvider.McpServerName;
    private readonly ChatProviderConfig _config;
    private readonly ClaudeHost _host;
    public ClaudeProvider(ChatProviderConfig config, ClaudeHost host) { _config = config; _host = host; }

    /// <summary>The models the adapter offers, read from a session it opens
    /// for the purpose and closes; opening one makes no model request.</summary>
    public async Task<IReadOnlyList<string>> ModelsAsync(CancellationToken cancel) {
        var conn = await _host.ConnectAsync(_config, cancel);
        var r = await conn.CallAsync("session/new", new JsonObject { ["cwd"] = ClaudeHost.Home, ["mcpServers"] = new JsonArray() }, cancel) as JsonObject;
        if (r?["sessionId"]?.GetValue<string>() is { } id && conn.Capabilities["sessionCapabilities"]?["close"] is not null) {
            try { await conn.CallAsync("session/close", new JsonObject { ["sessionId"] = id }, cancel); } catch (ProviderException) { }
        }
        return OptionValues(r?["configOptions"] as JsonArray, "model");
    }

    /// <summary>The values a select config option offers, its groups flattened.</summary>
    public static IReadOnlyList<string> OptionValues(JsonArray? options, string id) {
        var option = options?.OfType<JsonObject>().FirstOrDefault(o => o["id"]?.GetValue<string>() == id);
        var values = new List<string>();
        void Walk(JsonArray? list) {
            foreach (var o in list?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>()) {
                if (o["value"]?.GetValue<string>() is { Length: > 0 } v) { values.Add(v); }
                else { Walk(o["options"] as JsonArray); }
            }
        }
        Walk(option?["options"] as JsonArray);
        return values;
    }

    public async IAsyncEnumerable<ProviderEvent> StreamAsync(ProviderRequest request, [EnumeratorCancellation] CancellationToken cancel) {
        var agent = request.Agent ?? throw new ProviderException("Claude needs a folder to work in.");
        var conn = await _host.ConnectAsync(_config, cancel);
        var mcp = new JsonArray();
        if (agent.McpUrl is { Length: > 0 } url && agent.McpSecret is { Length: > 0 } secret) {
            mcp.Add(new JsonObject {
                ["type"] = "http", ["name"] = McpServerName, ["url"] = url,
                ["headers"] = new JsonArray(new JsonObject { ["name"] = "Authorization", ["value"] = "Bearer " + secret })
            });
        }
        var (sessionId, fresh) = await OpenAsync(conn, agent, mcp, cancel);
        if (!string.IsNullOrWhiteSpace(request.Model)) { await SetAsync(conn, sessionId, "model", request.Model, cancel); }
        await SetAsync(conn, sessionId, "effort", request.Thinking ? "default" : "low", cancel);

        var events = Channel.CreateUnbounded<ProviderEvent>();
        var turn = new TurnState(events.Writer);
        using var sub = conn.Subscribe(sessionId, m => Translate(turn, m));
        using var stop = cancel.Register(() => {
            turn.Cancelled = true;
            conn.Notify("session/cancel", new JsonObject { ["sessionId"] = sessionId });
            foreach (var a in turn.Approvals.Values) { a.TrySetResult("cancel"); }
        });
        /* The adapter sends every update of the turn before its answer to
           the prompt, which ends the turn. */
        var prompt = conn.CallAsync("session/prompt", new JsonObject { ["sessionId"] = sessionId, ["prompt"] = Prompt(request, fresh) }, CancellationToken.None);
        _ = prompt.ContinueWith(t => {
            if (t.IsFaulted) { events.Writer.TryComplete(t.Exception?.InnerException as ProviderException ?? new ProviderException("Claude stopped during the reply.")); return; }
            var r = t.Result as JsonObject;
            if (r?["usage"] is JsonObject u) { events.Writer.TryWrite(new UsageReport(Int(u["inputTokens"]), Int(u["outputTokens"]), Int(u["cachedReadTokens"]))); }
            var reason = r?["stopReason"]?.GetValue<string>() ?? "end_turn";
            events.Writer.TryWrite(new Finished(turn.Cancelled ? "cancelled" : reason));
            events.Writer.TryComplete();
        }, TaskScheduler.Default);
        await foreach (var e in events.Reader.ReadAllAsync(CancellationToken.None)) { yield return e; }
    }

    private static int? Int(JsonNode? n) => n is JsonValue v && v.TryGetValue<long>(out var l) ? (int)Math.Min(l, int.MaxValue) : null;

    /// <summary>The conversation's session, open in this process with the
    /// chat's current MCP grant: kept, reopened, or new (and recorded).</summary>
    private static async Task<(string Id, bool Fresh)> OpenAsync(AcpConnection conn, AgentContext agent, JsonArray mcp, CancellationToken cancel) {
        if (agent.ThreadId is { } known) {
            if (conn.Open.TryGetValue(known, out var open)) {
                if (open.McpSecret == agent.McpSecret) { return (known, false); }
                /* The grant was renewed, and a session's MCP servers are set as
                   it opens: closed, it reopens below with the new one. */
                if (conn.Capabilities["sessionCapabilities"]?["close"] is not null) {
                    try { await conn.CallAsync("session/close", new JsonObject { ["sessionId"] = known }, cancel); } catch (ProviderException) { }
                    conn.Open.TryRemove(known, out _);
                }
                else { return (known, false); }
            }
            if (conn.Capabilities["loadSession"]?.GetValue<bool>() == true) {
                try {
                    var loaded = await conn.CallAsync("session/load", new JsonObject { ["sessionId"] = known, ["cwd"] = agent.Cwd, ["mcpServers"] = mcp.DeepClone() }, cancel) as JsonObject;
                    Remember(conn, known, loaded, agent.McpSecret);
                    return (known, false);
                }
                /* The session is gone (Claude's home was cleared): a new one,
                   with the conversation's history, carries on. */
                catch (ProviderException) { }
            }
        }
        var started = await conn.CallAsync("session/new", new JsonObject { ["cwd"] = agent.Cwd, ["mcpServers"] = mcp.DeepClone() }, cancel) as JsonObject;
        var id = started?["sessionId"]?.GetValue<string>() ?? throw new ProviderException("Claude gave no session.");
        Remember(conn, id, started, agent.McpSecret);
        agent.ThreadStarted(id);
        return (id, true);
    }

    private static void Remember(AcpConnection conn, string id, JsonObject? answer, string? secret) {
        var open = new AcpConnection.OpenSession { McpSecret = secret };
        Note(open, answer);
        conn.Open[id] = open;
    }

    /// <summary>Keeps the config options an answer gives, with their current
    /// values, in place of those kept before: the options depend on the
    /// model (Haiku has no effort), so a change of model changes the set.</summary>
    private static void Note(AcpConnection.OpenSession open, JsonObject? answer) {
        if (answer?["configOptions"] is not JsonArray options) { return; }
        open.Options.Clear();
        foreach (var o in options.OfType<JsonObject>()) {
            if (o["id"]?.GetValue<string>() is { } oid && o["currentValue"] is JsonValue cv && cv.TryGetValue<string>(out var s)) { open.Options[oid] = s; }
        }
    }

    /// <summary>Sets a config option the session offers, when its value differs.</summary>
    private static async Task SetAsync(AcpConnection conn, string sessionId, string configId, string value, CancellationToken cancel) {
        if (!conn.Open.TryGetValue(sessionId, out var open) || !open.Options.TryGetValue(configId, out var current) || current == value) { return; }
        var r = await conn.CallAsync("session/set_config_option", new JsonObject { ["sessionId"] = sessionId, ["configId"] = configId, ["value"] = value }, cancel) as JsonObject;
        if (r?["configOptions"] is JsonArray) { Note(open, r); } else { open.Options[configId] = value; }
    }

    /// <summary>The prompt: on a fresh session the site's instructions and
    /// the earlier messages first, then the newest message's text and
    /// files, and its pictures as images, which the adapter takes.</summary>
    public static JsonArray Prompt(ProviderRequest request, bool fresh) {
        var blocks = new JsonArray();
        var last = request.Messages.LastOrDefault(m => m.Role == "user");
        if (fresh && CodexProvider.Preamble(request, last) is { } preamble) { blocks.Add(new JsonObject { ["type"] = "text", ["text"] = preamble }); }
        foreach (var p in last?.Parts ?? new List<ChatPart>()) {
            switch (p.Type) {
                case "text" when !string.IsNullOrEmpty(p.Text): blocks.Add(new JsonObject { ["type"] = "text", ["text"] = p.Text }); break;
                case "file": blocks.Add(new JsonObject { ["type"] = "text", ["text"] = ChatProviders.FileText(p) }); break;
                case "image": blocks.Add(new JsonObject { ["type"] = "image", ["data"] = p.Data, ["mimeType"] = p.MediaType }); break;
            }
        }
        if (blocks.Count == 0) { blocks.Add(new JsonObject { ["type"] = "text", ["text"] = "(The reader sent nothing but attachments.)" }); }
        return blocks;
    }

    public sealed class TurnState {
        public readonly ChannelWriter<ProviderEvent> Events;
        public bool Cancelled;
        /* Each tool's title and kind, from its first update, for the later ones. */
        public readonly Dictionary<string, (string Title, string Kind)> Tools = new();
        public readonly Dictionary<string, TaskCompletionSource<string>> Approvals = new();
        public TurnState(ChannelWriter<ProviderEvent> events) { Events = events; }
    }

    /// <summary>Turns one message from the adapter into events on the turn;
    /// for a request, the answer to send back (null for one the chat does
    /// not answer). Public and static so a test can feed it messages.</summary>
    public static async Task<JsonNode?> Translate(TurnState turn, AcpMessage m) {
        switch (m.Method) {
            case "session/update": {
                if (m.Params["update"] is not JsonObject u) { return null; }
                switch (u["sessionUpdate"]?.GetValue<string>()) {
                    case "agent_message_chunk":
                        if (Text(u["content"]) is { } said) { turn.Events.TryWrite(new TextDelta(said)); }
                        break;
                    case "agent_thought_chunk":
                        if (Text(u["content"]) is { } thought) { turn.Events.TryWrite(new ThinkingDelta(thought)); }
                        break;
                    case "tool_call":
                    case "tool_call_update": {
                        var id = u["toolCallId"]?.GetValue<string>() ?? "";
                        var status = u["status"]?.GetValue<string>();
                        var known = turn.Tools.TryGetValue(id, out var was);
                        var title = u["title"]?.GetValue<string>() is { Length: > 0 } t ? t : known ? was.Title : "A step";
                        var kind = u["kind"]?.GetValue<string>() is { Length: > 0 } k ? Kind(k) : known ? was.Kind : "other";
                        turn.Tools[id] = (title, kind);
                        /* A tool's first title is often its kind (Terminal), and a
                           later update gives the command: the row is said again. */
                        if (!known || (title != was.Title && status is not ("completed" or "failed"))) { turn.Events.TryWrite(new AgentTool(id, title, kind, "in_progress", u["rawInput"]?.DeepClone(), null)); }
                        if (status is "completed" or "failed") { turn.Events.TryWrite(new AgentTool(id, title, kind, status, null, Output(u))); }
                        break;
                    }
                }
                return null;
            }
            case "session/request_permission": {
                var call = m.Params["toolCall"] as JsonObject;
                var options = (m.Params["options"] as JsonArray ?? new JsonArray()).OfType<JsonObject>()
                    .Select(o => (o["optionId"]?.GetValue<string>() ?? "", o["name"]?.GetValue<string>() ?? "", o["kind"]?.GetValue<string>() ?? "allow_once"))
                    .Where(o => o.Item1.Length > 0).ToList();
                if (turn.Cancelled || options.Count == 0) { return Cancelled(); }
                var id = call?["toolCallId"]?.GetValue<string>() ?? Guid.NewGuid().ToString("n");
                var title = call?["title"]?.GetValue<string>() is { Length: > 0 } t ? t : turn.Tools.TryGetValue(id, out var tool) ? tool.Title : "Claude asks to go on";
                var answer = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
                turn.Approvals[id] = answer;
                turn.Events.TryWrite(new AgentApproval(id, title, call?["rawInput"]?.DeepClone(), options, answer));
                var chosen = await answer.Task;
                turn.Approvals.Remove(id);
                return options.Any(o => o.Item1 == chosen)
                    ? new JsonObject { ["outcome"] = new JsonObject { ["outcome"] = "selected", ["optionId"] = chosen } }
                    : Cancelled();
            }
            default:
                return null;
        }
    }

    private static JsonObject Cancelled() => new() { ["outcome"] = new JsonObject { ["outcome"] = "cancelled" } };

    private static string? Text(JsonNode? content) => content?["type"]?.GetValue<string>() == "text" ? content["text"]?.GetValue<string>() : null;

    /// <summary>ACP's tool kinds, as the chat's rows draw them.</summary>
    private static string Kind(string acp) => acp switch {
        "execute" => "execute",
        "edit" or "delete" or "move" => "edit",
        "search" or "fetch" => "search",
        _ => "other"
    };

    /// <summary>What a finished tool gave: its text, the files it changed,
    /// or its raw output.</summary>
    private static string? Output(JsonObject u) {
        var lines = new List<string>();
        foreach (var c in (u["content"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>()) {
            switch (c["type"]?.GetValue<string>()) {
                case "content": if (Text(c["content"]) is { } t) { lines.Add(t); } break;
                case "diff": lines.Add("Changed " + (c["path"]?.GetValue<string>() ?? "a file")); break;
            }
        }
        if (lines.Count > 0) { return string.Join("\n", lines); }
        return u["rawOutput"] switch {
            null => null,
            JsonValue v when v.TryGetValue<string>(out var s) => s,
            var other => other.ToJsonString()
        };
    }
}
