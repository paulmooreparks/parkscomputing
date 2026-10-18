using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

namespace ParksComputing.Engine.Chat;

/// <summary>
/// Codex as a chat provider (kind codex in /etc/chat.json), through the
/// app server CodexHost runs. A conversation is a Codex thread, started
/// on its first turn (<c>thread/start</c>) in the reader's home folder on
/// the server and kept by id for the turns after (<c>thread/resume</c>);
/// each message is a turn (<c>turn/start</c>), whose notifications become
/// the chat's events: the agent's message and reasoning deltas, each
/// command, file change, MCP call and search as a tool row, an approval
/// as a question for the reader, token usage, and the turn's end. A stop
/// interrupts the turn (<c>turn/interrupt</c>). With the site's tools on,
/// Codex gets the site's MCP server with the chat's grant, as GK Companion
/// gives it its applets' server. The thread keeps its own history, so only
/// the newest message goes; a conversation that began with another
/// provider gives Codex its earlier messages once, as the first turn.
/// </summary>
public sealed class CodexProvider : IChatProvider {
    public const string McpServerName = "parkscomputing";
    private readonly ChatProviderConfig _config;
    private readonly CodexHost _host;
    public CodexProvider(ChatProviderConfig config, CodexHost host) { _config = config; _host = host; }

    public async Task<IReadOnlyList<string>> ModelsAsync(CancellationToken cancel) {
        var conn = await _host.ConnectAsync(_config, cancel);
        var models = new List<string>();
        string? cursor = null;
        for (var page = 0; page < 10; page++) {
            var p = new JsonObject { ["limit"] = 100 };
            if (cursor is not null) { p["cursor"] = cursor; }
            var r = await conn.CallAsync("model/list", p, cancel) as JsonObject;
            foreach (var m in r?["data"] as JsonArray ?? new JsonArray()) {
                var id = m?["model"]?.GetValue<string>() ?? m?["id"]?.GetValue<string>();
                if (id is { Length: > 0 } && !models.Contains(id)) { if (m?["isDefault"]?.GetValue<bool>() == true) { models.Insert(0, id); } else { models.Add(id); } }
            }
            cursor = r?["nextCursor"]?.GetValue<string>();
            if (string.IsNullOrEmpty(cursor)) { break; }
        }
        return models;
    }

    public async IAsyncEnumerable<ProviderEvent> StreamAsync(ProviderRequest request, [EnumeratorCancellation] CancellationToken cancel) {
        var agent = request.Agent ?? throw new ProviderException("Codex needs a folder to work in.");
        if (!System.IO.File.Exists(System.IO.Path.Combine(CodexHost.Home, "auth.json"))) {
            throw new ProviderException("Codex is not signed in on the server: copy a signed-in machine's auth.json to " + CodexHost.Home + " (CODEX_HOME), or set OPENAI_API_KEY and restart, and Codex signs in with it.");
        }
        var conn = await _host.ConnectAsync(_config, cancel);
        var events = Channel.CreateUnbounded<ProviderEvent>();
        var turn = new TurnState(events.Writer);

        /* The thread: this conversation's, resumed, or a new one. */
        var sandbox = string.IsNullOrWhiteSpace(_config.Sandbox) ? "workspace-write" : _config.Sandbox!;
        var start = new JsonObject { ["cwd"] = agent.Cwd, ["sandbox"] = sandbox, ["approvalPolicy"] = "on-request", ["approvalsReviewer"] = "user" };
        if (agent.McpUrl is { Length: > 0 } url && agent.McpSecret is { Length: > 0 } secret) {
            start["config"] = new JsonObject {
                ["mcp_servers"] = new JsonObject {
                    [McpServerName] = new JsonObject {
                        ["url"] = url, ["http_headers"] = new JsonObject { ["Authorization"] = "Bearer " + secret },
                        ["enabled"] = true, ["required"] = false, ["default_tools_approval_mode"] = "writes", ["tool_timeout_sec"] = 60
                    }
                }
            };
        }
        string threadId;
        var fresh = agent.ThreadId is null;
        if (!fresh) { start["threadId"] = agent.ThreadId; }
        JsonObject? started;
        try { started = await conn.CallAsync(fresh ? "thread/start" : "thread/resume", start, cancel) as JsonObject; }
        catch (ProviderException) when (!fresh) {
            /* The thread is gone (Codex's home moved or was cleared): a
               fresh one, with the conversation's history, carries on. */
            fresh = true; start.Remove("threadId");
            started = await conn.CallAsync("thread/start", start, cancel) as JsonObject;
        }
        threadId = started?["thread"]?["id"]?.GetValue<string>() ?? throw new ProviderException("Codex gave no thread.");
        if (fresh) { agent.ThreadStarted(threadId); }

        using var sub = conn.Subscribe(threadId, m => OnMessageAsync(conn, turn, m));
        /* The site's tools come to Codex over MCP, which it connects as the
           thread starts; the turn waits a little for that, so the model has
           them from its first word, and says so when the connection failed. */
        if (start["config"] is not null) {
            var ready = await Task.WhenAny(turn.McpStatus.Task, Task.Delay(TimeSpan.FromSeconds(15), cancel));
            if (ready != turn.McpStatus.Task) { events.Writer.TryWrite(new AgentNotice("Codex is still connecting to the site's tools; this reply may begin without them.")); }
        }
        var input = Input(request, fresh);
        var q = new JsonObject { ["threadId"] = threadId, ["input"] = input };
        if (!string.IsNullOrWhiteSpace(request.Model)) { q["model"] = request.Model; }
        if (!request.Thinking) { q["effort"] = "low"; }
        var startedTurn = await conn.CallAsync("turn/start", q, cancel) as JsonObject;
        turn.TurnId = startedTurn?["turn"]?["id"]?.GetValue<string>();

        using var stop = cancel.Register(() => {
            turn.Cancelled = true;
            if (turn.TurnId is { } id) { _ = conn.CallAsync("turn/interrupt", new JsonObject { ["threadId"] = threadId, ["turnId"] = id }, CancellationToken.None).ContinueWith(_ => { }); }
            foreach (var a in turn.Approvals.Values) { a.TrySetResult("cancel"); }
        });
        var ended = conn.Ended.ContinueWith(_ => events.Writer.TryComplete(new ProviderException("Codex stopped during the reply.")));
        await foreach (var e in events.Reader.ReadAllAsync(CancellationToken.None)) {
            yield return e;
            if (e is Finished) { break; }
        }
        if (turn.Error is { } problem) { throw new ProviderException(problem); }
    }

    public sealed class TurnState {
        public readonly ChannelWriter<ProviderEvent> Events;
        public string? TurnId; public bool Cancelled; public string? Error;
        public readonly HashSet<string> Streamed = new();
        public readonly Dictionary<string, TaskCompletionSource<string>> Approvals = new();
        /* The site's MCP server, as Codex reports its start: ready or failed. */
        public readonly TaskCompletionSource<string> McpStatus = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TurnState(ChannelWriter<ProviderEvent> events) { Events = events; }
    }

    /// <summary>The message to Codex: the newest user message's text and
    /// files (an image as a data address), after, on a fresh thread, the
    /// instructions and whatever earlier messages the conversation had.</summary>
    public static JsonArray Input(ProviderRequest request, bool fresh) {
        var items = new JsonArray();
        var last = request.Messages.LastOrDefault(m => m.Role == "user");
        if (fresh) {
            var sb = new StringBuilder();
            if (!string.IsNullOrWhiteSpace(request.System)) { sb.Append("Instructions from the site:\n").Append(request.System).Append("\n\n"); }
            var earlier = request.Messages.Where(m => m != last && m.Parts.Any(p => p.Type == "text")).ToList();
            if (earlier.Count > 0) {
                sb.Append("Earlier in this conversation (with another model):\n");
                foreach (var m in earlier) {
                    var text = string.Join("\n", m.Parts.Where(p => p.Type == "text").Select(p => p.Text));
                    if (text.Length > 0) { sb.Append(m.Role == "user" ? "Reader: " : "Assistant: ").Append(text.Length > 4000 ? text[..4000] + "…" : text).Append('\n'); }
                }
                sb.Append('\n');
            }
            if (sb.Length > 0) { items.Add(new JsonObject { ["type"] = "text", ["text"] = sb.ToString() }); }
        }
        foreach (var p in last?.Parts ?? new List<ChatPart>()) {
            switch (p.Type) {
                case "text" when !string.IsNullOrEmpty(p.Text): items.Add(new JsonObject { ["type"] = "text", ["text"] = p.Text }); break;
                case "file": items.Add(new JsonObject { ["type"] = "text", ["text"] = ChatProviders.FileText(p) }); break;
                case "image": items.Add(new JsonObject { ["type"] = "image", ["url"] = "data:" + p.MediaType + ";base64," + p.Data }); break;
            }
        }
        if (items.Count == 0) { items.Add(new JsonObject { ["type"] = "text", ["text"] = "(The reader sent nothing but attachments.)" }); }
        return items;
    }

    /// <summary>Codex's notifications and requests for the thread, as the
    /// chat's events; public and static in its heart (Translate) so a test
    /// can feed it messages.</summary>
    private static async Task OnMessageAsync(CodexConnection conn, TurnState turn, CodexMessage m) {
        if (m.Id is not null) {
            var answer = await Translate(turn, m);
            if (answer is null) { await conn.RespondErrorAsync(m.Id, -32601, "The chat does not answer " + m.Method + "."); }
            else { await conn.RespondAsync(m.Id, answer); }
            return;
        }
        await Translate(turn, m);
    }

    /// <summary>Turns one message into events on the turn; for a request,
    /// the result to send back (null for one the chat does not answer).</summary>
    public static async Task<JsonNode?> Translate(TurnState turn, CodexMessage m) {
        var p = m.Params;
        switch (m.Method) {
            case "turn/started":
                turn.TurnId ??= p["turn"]?["id"]?.GetValue<string>();
                return null;
            case "item/agentMessage/delta":
                turn.Streamed.Add(p["itemId"]?.GetValue<string>() ?? "");
                turn.Events.TryWrite(new TextDelta(p["delta"]?.GetValue<string>() ?? ""));
                return null;
            case "item/reasoning/summaryTextDelta":
                turn.Streamed.Add(p["itemId"]?.GetValue<string>() ?? "");
                turn.Events.TryWrite(new ThinkingDelta(p["delta"]?.GetValue<string>() ?? ""));
                return null;
            case "item/started":
            case "item/completed": {
                if (p["item"] is not JsonObject item) { return null; }
                var completed = m.Method == "item/completed";
                var id = item["id"]?.GetValue<string>() ?? "";
                switch (item["type"]?.GetValue<string>()) {
                    case "agentMessage":
                        if (completed && !turn.Streamed.Contains(id)) { turn.Events.TryWrite(new TextDelta(item["text"]?.GetValue<string>() ?? "")); }
                        break;
                    case "reasoning":
                        if (completed && !turn.Streamed.Contains(id)) {
                            var summary = string.Join("\n", (item["summary"] as JsonArray ?? new JsonArray()).Select(s => s?.GetValue<string>() ?? ""));
                            if (summary.Length > 0) { turn.Events.TryWrite(new ThinkingDelta(summary)); }
                        }
                        break;
                    case "userMessage": case "plan": break;
                    default: {
                        var (title, kind) = Describe(item);
                        var status = !completed ? "in_progress" : item["status"]?.GetValue<string>() is "failed" or "declined" ? "failed" : "completed";
                        var output = completed ? item["aggregatedOutput"]?.GetValue<string>() ?? ToolOutput(item) : null;
                        turn.Events.TryWrite(new AgentTool(id, title, kind, status, completed ? null : item.DeepClone(), output));
                        break;
                    }
                }
                return null;
            }
            case "item/commandExecution/outputDelta":
                return null;
            case "mcpServer/startupStatus/updated": {
                if (p["name"]?.GetValue<string>() != McpServerName) { return null; }
                var status = p["status"]?.GetValue<string>() ?? "";
                if (status == "ready") { turn.McpStatus.TrySetResult("ready"); }
                else if (status == "failed") {
                    turn.McpStatus.TrySetResult("failed");
                    turn.Events.TryWrite(new AgentNotice("Codex could not connect to the site's tools: " + (p["error"]?.GetValue<string>() ?? "no reason given") + "."));
                }
                return null;
            }
            case "thread/tokenUsage/updated": {
                var last = p["tokenUsage"]?["last"];
                if (last is not null) { turn.Events.TryWrite(new UsageReport(last["inputTokens"]?.GetValue<int>(), last["outputTokens"]?.GetValue<int>())); }
                return null;
            }
            case "turn/completed": {
                var t = p["turn"];
                var status = t?["status"]?.GetValue<string>() ?? "completed";
                if (status == "failed") { turn.Error = t?["error"]?["message"]?.GetValue<string>() ?? "Codex's turn failed."; }
                turn.Events.TryWrite(new Finished(status == "interrupted" || turn.Cancelled ? "cancelled" : status == "failed" ? "error" : "end_turn"));
                turn.Events.TryComplete();
                return null;
            }
            case "item/commandExecution/requestApproval":
            case "item/fileChange/requestApproval": {
                if (turn.Cancelled) { return new JsonObject { ["decision"] = "cancel" }; }
                var title = p["command"]?.GetValue<string>() is { Length: > 0 } cmd ? "Run: " + cmd : "Change files";
                if (p["networkApprovalContext"] is JsonObject net) { title = "Allow " + net["protocol"]?.GetValue<string>() + " access to " + net["host"]?.GetValue<string>(); }
                if (p["reason"]?.GetValue<string>() is { Length: > 0 } why) { title += " (" + why + ")"; }
                var available = (p["availableDecisions"] as JsonArray)?.Select(d => d?.GetValue<string>()).Where(d => d is not null).ToHashSet();
                var options = new List<(string, string, string)>();
                foreach (var (id, name, kind) in new[] { ("accept", "Allow once", "allow_once"), ("acceptForSession", "Allow in this chat", "allow_always"), ("decline", "Don't allow", "reject_once"), ("cancel", "Stop the reply", "reject_once") }) {
                    if (available is null ? id != "acceptForSession" : available.Contains(id)) { options.Add((id, name, kind)); }
                }
                var answer = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
                var key = p["itemId"]?.GetValue<string>() ?? Guid.NewGuid().ToString("n");
                turn.Approvals[key] = answer;
                turn.Events.TryWrite(new AgentApproval(key, title, p.DeepClone(), options, answer));
                var decision = await answer.Task;
                turn.Approvals.Remove(key);
                return new JsonObject { ["decision"] = decision };
            }
            case "item/permissions/requestApproval":
                return new JsonObject { ["permissions"] = new JsonObject(), ["scope"] = "turn" };
            case "item/tool/requestUserInput":
            case "mcpServer/elicitation/request":
                return m.Method == "mcpServer/elicitation/request" ? new JsonObject { ["action"] = "decline", ["content"] = null } : null;
            default:
                return null;
        }
    }

    private static (string Title, string Kind) Describe(JsonObject item) => item["type"]?.GetValue<string>() switch {
        "commandExecution" => (item["command"]?.GetValue<string>() ?? "a command", "execute"),
        "fileChange" => ("Change files", "edit"),
        "mcpToolCall" => ((item["server"]?.GetValue<string>() ?? "") + ": " + (item["tool"]?.GetValue<string>() ?? ""), "other"),
        "webSearch" => ("Search: " + (item["query"]?.GetValue<string>() ?? ""), "search"),
        var other => (other ?? "step", "other")
    };

    private static string? ToolOutput(JsonObject item) {
        if (item["type"]?.GetValue<string>() == "fileChange" && item["changes"] is JsonArray changes) {
            return string.Join("\n", changes.Select(c => (c?["kind"]?.GetValue<string>() ?? "changed") + " " + (c?["path"]?.GetValue<string>() ?? "")));
        }
        if (item["result"] is { } r) { return r.ToJsonString(); }
        return null;
    }
}
