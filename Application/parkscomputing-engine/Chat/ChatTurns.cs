using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Logging;

namespace ParksComputing.Engine.Chat;

/// <summary>A message the reader sent, waiting for its turn.</summary>
public sealed record ChatSend(string Text, IReadOnlyList<ChatPart> Attachments, IdentityUser User, string Host, bool ToolsAllowed);

/// <summary>
/// The conversations being answered (Architecture/chat-design.md): one turn
/// at a time for each, run on the server so it carries on when the page goes
/// away. A turn sends the conversation to its provider, streams the reply,
/// runs the tools the model asks for, asking the reader first about any that
/// changes something, and sends the results back until the model is done.
/// Messages sent meanwhile wait in a queue; Steer stops the reply and sends
/// its message next; Stop ends the turn and empties the queue.
///
/// Everything a page needs to follow along is an event, each numbered within
/// its conversation, so a page that subscribes and then reads the
/// conversation (with the number it was read at) misses nothing and sees
/// nothing twice.
/// </summary>
public sealed class ChatTurns {
    public const string DefaultSystem =
        "You are the assistant in the admin chat of parkscomputing.com, Paul Parks's site. Answer plainly and concisely, in Markdown. " +
        "chat_info tells you about this chat itself (its providers and models, this conversation's settings, the reader's chats, the skills, the settings file, the API): use it for questions about the chat rather than guessing. " +
        "web_fetch reads a public web page, and web_search (where the chat offers it) finds pages: use them for what is current or outside the site, such as the models a provider's public library lists (Ollama's is https://ollama.com/library; a provider's own models are in chat_info), and say which pages you used. " +
        "When site tools are offered, they act as the site's super-user: ~ is the super-user's home folder on the server, /wwwroot is the live site " +
        "(pages are Markdown or HTML in /wwwroot/content) and /etc is the server's settings. Use a tool only when the reader's message needs it: never look " +
        "around the site, check a log, a queue or a folder, or run an action the reader did not ask for, and answer a greeting or a check-in with words alone. " +
        "Any tool that changes something asks the reader first, so say what you mean to do before you do it. The site's applets publish actions (applet_discover lists them: rolling dice, solving a sudoku, " +
        "drawing a barcode, starting a game such as Asteroids or Space Invaders at a level, opening a score); applet_invoke runs one, and an action that opens a window " +
        "opens it on the reader's own desktop. Asked to play a game, play it yourself, move by move with the actions the game publishes (Sudoku: new, then enter, " +
        "one or a few cells a call, with pencil marks on the cells you are working), reasoning from the board each action gives back; use a solver only when the reader asks you to. Mermaid diagrams in ```mermaid blocks are drawn for the reader.";

    private sealed class Question {
        public string Key = ""; public string ToolCallId = ""; public string Name = ""; public string Title = ""; public JsonNode? Input;
        public TaskCompletionSource<string> Answer = new(TaskCreationOptions.RunContinuationsAsynchronously);
    }

    private sealed class Live {
        public readonly object Gate = new();
        public long Seq;
        public readonly List<Channel<string>> Subscribers = new();
        public bool Working;
        public ChatMessage? Partial;
        public readonly LinkedList<ChatSend> Queue = new();
        public readonly Dictionary<string, Question> Questions = new();
        /* Actions the page is running for the model, by key. */
        public readonly Dictionary<string, TaskCompletionSource<(string? Output, string? Error)>> Actions = new();
        public CancellationTokenSource? Cancel;
        public int QuestionCount, ActionCount;
    }

    private readonly ConcurrentDictionary<string, Live> _live = new();
    private readonly ChatStore _store;
    private readonly ChatSettings _settings;
    private readonly ChatTools _tools;
    private readonly ChatSkills _skills;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<ChatTurns> _log;
    private readonly TimeProvider _clock;

    private readonly ChatSelf _self;
    private readonly ChatWeb _web;
    private readonly ChatSearch _search;
    public ChatTurns(ChatStore store, ChatSettings settings, ChatTools tools, ChatSkills skills, ChatSelf self, ChatWeb web, ChatSearch search, IHttpClientFactory http, ILogger<ChatTurns> log, TimeProvider clock) {
        _self = self; _web = web; _search = search;
        _store = store; _settings = settings; _tools = tools; _skills = skills; _http = http; _log = log; _clock = clock;
    }

    /// <summary>The conversation as the model reads it: a message that
    /// starts with a skill's command carries the skill's instructions.</summary>
    private IReadOnlyList<ChatMessage> ForModel(string home, Conversation conv) {
        return conv.Messages.Select(m => {
            if (m.Role != "user") { return m; }
            var first = m.Parts.FirstOrDefault(p => p.Type == "text");
            var expanded = first is null ? null : _skills.Expand(home, first.Text ?? "");
            if (expanded is null) { return m; }
            return new ChatMessage { Role = m.Role, At = m.At, Parts = m.Parts.Select(p => p == first ? ChatPart.TextPart(expanded) : p).ToList() };
        }).ToList();
    }

    private Live LiveOf(string home, string id) => _live.GetOrAdd(home + "/" + id, _ => new Live());

    private static readonly JsonSerializerOptions Wire = new() { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull };

    public static JsonNode ToJson(object value) => JsonSerializer.SerializeToNode(value, Wire)!;

    private void Publish(Live live, JsonObject evt) {
        string text;
        Channel<string>[] subs;
        lock (live.Gate) {
            evt["seq"] = ++live.Seq;
            text = evt.ToJsonString();
            subs = live.Subscribers.ToArray();
        }
        foreach (var s in subs) { s.Writer.TryWrite(text); }
    }

    /// <summary>A page following a conversation: its events as JSON, until it lets go.</summary>
    public (ChannelReader<string> Events, Action Leave) Subscribe(string home, string id) {
        var live = LiveOf(home, id);
        var ch = Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = true });
        lock (live.Gate) { live.Subscribers.Add(ch); }
        return (ch.Reader, () => { lock (live.Gate) { live.Subscribers.Remove(ch); } ch.Writer.TryComplete(); });
    }

    /// <summary>What a page needs besides the stored conversation: the
    /// reply in progress, the questions waiting, the queue, and the number
    /// of the last event, all as of one moment.</summary>
    public JsonObject State(string home, string id) {
        var live = LiveOf(home, id);
        lock (live.Gate) {
            return new JsonObject {
                ["seq"] = live.Seq,
                ["working"] = live.Working,
                ["partial"] = live.Partial is null ? null : ToJson(live.Partial),
                ["queued"] = new JsonArray(live.Queue.Select(q => (JsonNode)q.Text).ToArray()),
                ["questions"] = new JsonArray(live.Questions.Values.Select(QuestionJson).ToArray())
            };
        }
    }

    private static JsonNode QuestionJson(Question q) => new JsonObject {
        ["key"] = q.Key, ["toolCallId"] = q.ToolCallId, ["name"] = q.Name, ["title"] = q.Title, ["input"] = q.Input?.DeepClone(),
        ["options"] = new JsonArray(
            new JsonObject { ["optionId"] = "allow_once", ["name"] = "Allow", ["kind"] = "allow_once" },
            new JsonObject { ["optionId"] = "allow_always", ["name"] = "Allow in this chat", ["kind"] = "allow_always" },
            new JsonObject { ["optionId"] = "reject", ["name"] = "Don't allow", ["kind"] = "reject_once" })
    };

    public bool Working(string home, string id) { var live = LiveOf(home, id); lock (live.Gate) { return live.Working; } }

    /// <summary>Sends, queues or steers with a message; says which happened.</summary>
    public string Send(string home, string id, ChatSend message, string mode) {
        var live = LiveOf(home, id);
        bool start = false; string outcome;
        lock (live.Gate) {
            if (!live.Working) { live.Working = true; start = true; outcome = "sent"; }
            else if (mode == "steer") { live.Queue.AddFirst(message); live.Cancel?.Cancel(); outcome = "steered"; }
            else { live.Queue.AddLast(message); outcome = "queued"; }
        }
        if (start) {
            Publish(live, new JsonObject { ["type"] = "working", ["working"] = true });
            _ = Task.Run(() => RunAsync(home, id, live, message));
        }
        else { PublishQueue(live); }
        return outcome;
    }

    private void PublishQueue(Live live) {
        JsonArray queued;
        lock (live.Gate) { queued = new JsonArray(live.Queue.Select(q => (JsonNode)q.Text).ToArray()); }
        Publish(live, new JsonObject { ["type"] = "queue", ["queued"] = queued });
    }

    /// <summary>Stops the reply, refuses any question it is waiting on, and empties the queue.</summary>
    public void Stop(string home, string id) {
        var live = LiveOf(home, id);
        lock (live.Gate) { live.Queue.Clear(); live.Cancel?.Cancel(); }
        PublishQueue(live);
    }

    public void Unqueue(string home, string id) {
        var live = LiveOf(home, id);
        lock (live.Gate) { live.Queue.Clear(); }
        PublishQueue(live);
    }

    /// <summary>The page gives back what an action it ran for the model produced.</summary>
    public bool ActionDone(string home, string id, string key, string? output, string? error) {
        var live = LiveOf(home, id);
        TaskCompletionSource<(string?, string?)>? tcs;
        lock (live.Gate) { live.Actions.TryGetValue(key, out tcs); }
        return tcs is not null && tcs.TrySetResult((output, error));
    }

    public bool Answer(string home, string id, string key, string option) {
        var live = LiveOf(home, id);
        Question? q;
        lock (live.Gate) { live.Questions.TryGetValue(key, out q); }
        return q is not null && q.Answer.TrySetResult(option);
    }

    private async Task RunAsync(string home, string id, Live live, ChatSend first) {
        ChatSend? next = first;
        while (next is not null) {
            try { await TurnAsync(home, id, live, next); }
            catch (Exception ex) {
                _log.LogError(ex, "The chat turn in {Id} failed", id);
                Publish(live, new JsonObject { ["type"] = "turn", ["stopReason"] = "error", ["error"] = ex.Message });
            }
            lock (live.Gate) {
                next = live.Queue.First?.Value;
                if (next is not null) { live.Queue.RemoveFirst(); } else { live.Working = false; }
            }
            if (next is not null) { PublishQueue(live); }
        }
        Publish(live, new JsonObject { ["type"] = "working", ["working"] = false });
    }

    private static string TitleFrom(string text) {
        var line = (text ?? "").Split('\n').Select(l => l.Trim()).FirstOrDefault(l => l.Length > 0) ?? "New chat";
        return line.Length > 60 ? line[..57].TrimEnd() + "…" : line;
    }

    private async Task TurnAsync(string home, string id, Live live, ChatSend send) {
        var conv = _store.Read(home, id);
        if (conv is null) { return; }
        var (config, configError) = _settings.Read();
        var providerConfig = config.Find(conv.Provider);

        var user = new ChatMessage { Role = "user", At = _clock.GetUtcNow() };
        if (!string.IsNullOrWhiteSpace(send.Text)) { user.Parts.Add(ChatPart.TextPart(send.Text)); }
        user.Parts.AddRange(send.Attachments);
        conv.Messages.Add(user);
        if (conv.Title == "New chat" && !string.IsNullOrWhiteSpace(send.Text)) {
            conv.Title = TitleFrom(send.Text);
            Publish(live, new JsonObject { ["type"] = "title", ["title"] = conv.Title });
        }
        conv.Updated = _clock.GetUtcNow();
        await _store.SaveAsync(home, conv);
        Publish(live, new JsonObject { ["type"] = "user_message", ["message"] = ToJson(user) });

        if (providerConfig is null) {
            var why = configError ?? ("There is no provider called " + (conv.Provider.Length > 0 ? conv.Provider : "(none)") + " in /etc/chat.json.");
            Publish(live, new JsonObject { ["type"] = "turn", ["stopReason"] = "error", ["error"] = why });
            return;
        }

        using var cancel = new CancellationTokenSource();
        lock (live.Gate) { live.Cancel = cancel; }
        var clock = Stopwatch.StartNew();
        int inputTokens = 0, outputTokens = 0; string? turnError = null; string stopReason = "end_turn";
        ChatTools.Session? tools = null;
        try {
            if (conv.Tools && send.ToolsAllowed && _tools.Available) {
                try { tools = await _tools.OpenAsync(send.User, send.Host, cancel.Token); }
                catch (Exception ex) when (ex is not OperationCanceledException) {
                    _log.LogWarning(ex, "The chat could not reach the site's tools");
                    Publish(live, new JsonObject { ["type"] = "notice", ["text"] = "The site's tools could not be reached, so this reply has none: " + ex.Message });
                }
            }
            var provider = ChatProviders.For(providerConfig, _http.CreateClient(ChatProviders.ClientName));
            /* The chat's own tool comes first, for every reader; the site's
               follow when the chat has them. */
            var specs = new List<ToolSpec> { _self.Spec, _web.Spec };
            /* The chat's own search, for a model whose provider has none of its own. */
            if (config.Search is { Configured: true } && !providerConfig.SearchesTheWeb) { specs.Add(_search.Spec); }
            if (tools is not null) { specs.AddRange(tools.Tools.Select(t => t.Spec)); }
            var system = (string.IsNullOrWhiteSpace(config.System) ? DefaultSystem : config.System) + "\n\nToday is " + _clock.GetUtcNow().ToString("dddd, d MMMM yyyy") + " (UTC).";
            var model = string.IsNullOrWhiteSpace(conv.Model) ? (config.DefaultModel ?? providerConfig.Models?.FirstOrDefault() ?? "") : conv.Model;

            for (var round = 0; round < Math.Max(1, config.MaxToolRounds); round++) {
                var reply = new ChatMessage { Role = "assistant", At = _clock.GetUtcNow(), Provider = providerConfig.Id, Model = model };
                lock (live.Gate) { live.Partial = reply; }
                Publish(live, new JsonObject { ["type"] = "message_start", ["provider"] = providerConfig.Id, ["model"] = model });
                try {
                    await foreach (var e in provider.StreamAsync(new ProviderRequest(model, system, ForModel(home, conv), specs, conv.Thinking), cancel.Token)) {
                        switch (e) {
                            case TextDelta t:
                                lock (live.Gate) { Append(reply, "text", t.Text); }
                                Publish(live, new JsonObject { ["type"] = "text", ["text"] = t.Text });
                                break;
                            case BlockStart b when b.Type == "text":
                                /* A fresh text part, so a citation lands on its own block. */
                                lock (live.Gate) { if (reply.Parts.LastOrDefault() is { Type: "text" } open && !string.IsNullOrEmpty(open.Text)) { reply.Parts.Add(new ChatPart { Type = "text", Text = "" }); } }
                                break;
                            case Citation cite: {
                                lock (live.Gate) {
                                    var text = reply.Parts.LastOrDefault(p => p.Type == "text") ?? AppendNew(reply, "text");
                                    (text.Citations ??= new JsonArray()).Add(cite.Value.DeepClone());
                                }
                                Publish(live, new JsonObject { ["type"] = "citation", ["url"] = cite.Value["url"]?.GetValue<string>(), ["title"] = cite.Value["title"]?.GetValue<string>() });
                                break;
                            }
                            case ServerBlock sb: {
                                lock (live.Gate) { reply.Parts.Add(new ChatPart { Type = "server_block", Raw = sb.Block }); }
                                PublishServerBlock(live, sb.Block);
                                break;
                            }
                            case ThinkingDelta t:
                                lock (live.Gate) { Append(reply, "thinking", t.Text); }
                                Publish(live, new JsonObject { ["type"] = "thought", ["text"] = t.Text });
                                break;
                            case ThinkingSignature s:
                                lock (live.Gate) { var last = reply.Parts.LastOrDefault(p => p.Type == "thinking"); if (last is not null) { last.Signature = (last.Signature ?? "") + s.Signature; } }
                                break;
                            case ToolCallReady c: {
                                var known = c.Name == ChatSelf.ToolName ? SelfTool : c.Name == ChatWeb.ToolName ? WebTool : c.Name == ChatSearch.ToolName ? SearchTool : tools?.Find(c.Name);
                                lock (live.Gate) { reply.Parts.Add(new ChatPart { Type = "tool_use", Id = c.Id, Name = c.Name, Input = c.Input }); }
                                Publish(live, new JsonObject {
                                    ["type"] = "tool_call", ["toolCallId"] = c.Id, ["name"] = c.Name, ["title"] = known?.Title ?? c.Name,
                                    ["input"] = c.Input.DeepClone(), ["readOnly"] = known?.ReadOnly ?? false
                                });
                                break;
                            }
                            case UsageReport u:
                                if (u.Input is { } i) { inputTokens += i; }
                                if (u.Output is { } o) { outputTokens += o; }
                                break;
                            case Finished f:
                                reply.Stop = f.StopReason;
                                break;
                        }
                    }
                }
                catch (OperationCanceledException) when (cancel.IsCancellationRequested) { reply.Stop = "cancelled"; }
                catch (Exception ex) when (ex is ProviderException or HttpRequestException or TaskCanceledException) {
                    reply.Stop = "error"; reply.Error = ex is TaskCanceledException ? "The provider took too long to answer." : ex.Message;
                }
                lock (live.Gate) { live.Partial = null; }
                if (reply.Parts.Count > 0 || reply.Error is not null) { conv.Messages.Add(reply); }
                stopReason = reply.Stop ?? "end_turn"; turnError = reply.Error;

                var uses = reply.Parts.Where(p => p.Type == "tool_use").ToList();
                if (uses.Count > 0) {
                    var results = new ChatMessage { Role = "user", At = _clock.GetUtcNow() };
                    foreach (var use in uses) { results.Parts.Add(await RunToolAsync(live, conv, tools, use, home, send, cancel.Token)); }
                    conv.Messages.Add(results);
                }
                conv.Updated = _clock.GetUtcNow();
                await _store.SaveAsync(home, conv);
                /* The API pauses a long search turn (pause_turn): the reply so
                   far goes back as it is and the model goes on. */
                if ((uses.Count == 0 && reply.Stop != "pause_turn") || reply.Stop is "cancelled" or "error" || cancel.IsCancellationRequested) { break; }
            }
        }
        finally {
            lock (live.Gate) { live.Cancel = null; live.Partial = null; }
            if (tools is not null) { try { await tools.DisposeAsync(); } catch (Exception ex) { _log.LogDebug(ex, "Closing the chat's tools"); } }
        }
        Publish(live, new JsonObject {
            ["type"] = "turn", ["stopReason"] = stopReason, ["seconds"] = Math.Round(clock.Elapsed.TotalSeconds, 1),
            ["usage"] = new JsonObject { ["input"] = inputTokens, ["output"] = outputTokens }, ["error"] = turnError
        });
    }

    private static void Append(ChatMessage m, string type, string text) {
        var last = m.Parts.LastOrDefault();
        if (last is not null && last.Type == type) { last.Text += text; }
        else { m.Parts.Add(new ChatPart { Type = type, Text = text }); }
    }
    private static ChatPart AppendNew(ChatMessage m, string type) { var p = new ChatPart { Type = type, Text = "" }; m.Parts.Add(p); return p; }

    /// <summary>A web search the provider ran itself, shown as a tool row:
    /// the call with its query, then its result with what it found.</summary>
    public static JsonObject? ServerBlockEvent(JsonObject block) {
        switch (block["type"]?.GetValue<string>()) {
            case "server_tool_use": {
                var query = block["input"]?["query"]?.GetValue<string>();
                return new JsonObject {
                    ["type"] = "tool_call", ["toolCallId"] = block["id"]?.GetValue<string>(), ["name"] = block["name"]?.GetValue<string>() ?? "web_search",
                    ["title"] = query is { Length: > 0 } ? "Searched the web for \"" + query + "\"" : "Searched the web", ["input"] = block["input"]?.DeepClone(), ["readOnly"] = true, ["status"] = "completed"
                };
            }
            case "web_search_tool_result": {
                var id = block["tool_use_id"]?.GetValue<string>();
                if (block["content"] is JsonArray found) {
                    var lines = found.Select(r => (r?["title"]?.GetValue<string>() ?? "") + "\n" + (r?["url"]?.GetValue<string>() ?? "")).ToList();
                    return new JsonObject { ["type"] = "tool_result", ["toolCallId"] = id, ["status"] = "completed", ["output"] = lines.Count == 0 ? "Nothing found." : string.Join("\n\n", lines) };
                }
                return new JsonObject { ["type"] = "tool_result", ["toolCallId"] = id, ["status"] = "failed", ["output"] = "The search failed: " + (block["content"]?["error_code"]?.GetValue<string>() ?? "unknown") };
            }
            default: return null;
        }
    }
    private void PublishServerBlock(Live live, JsonObject block) { if (ServerBlockEvent(block) is { } e) { Publish(live, e); } }

    /// <summary>Runs one tool the model asked for, asking the reader first
    /// when it changes something, and gives its result to send back.</summary>
    private ChatTool SelfTool => new(_self.Spec, "Ask the chat about itself", true);
    private ChatTool WebTool => new(_web.Spec, "Read a web page", true);
    private ChatTool SearchTool => new(_search.Spec, "Search the web", true);

    private async Task<ChatPart> RunToolAsync(Live live, Conversation conv, ChatTools.Session? tools, ChatPart use, string home, ChatSend send, CancellationToken cancel) {
        ChatPart Result(string status, string text) {
            var part = new ChatPart { Type = "tool_result", Id = use.Id, Name = use.Name, Status = status, Text = text };
            Publish(live, new JsonObject {
                ["type"] = "tool_result", ["toolCallId"] = use.Id, ["status"] = status,
                ["output"] = text.Length > 4000 ? text[..4000] + "…" : text
            });
            return part;
        }
        if (cancel.IsCancellationRequested) { return Result("rejected", "The reader stopped the reply before this ran."); }
        if (use.Name == ChatSelf.ToolName) {
            Publish(live, new JsonObject { ["type"] = "tool_progress", ["toolCallId"] = use.Id, ["status"] = "in_progress" });
            try { return Result("completed", await _self.RunAsync(use.Input, home, conv, send.ToolsAllowed && _tools.Available, send.ToolsAllowed, cancel)); }
            catch (Exception ex) when (ex is not OperationCanceledException) { return Result("failed", ex.Message); }
        }
        if (use.Name == ChatWeb.ToolName) {
            Publish(live, new JsonObject { ["type"] = "tool_progress", ["toolCallId"] = use.Id, ["status"] = "in_progress" });
            try { return Result("completed", await _web.RunAsync(use.Input, cancel)); }
            catch (Exception ex) when (ex is not OperationCanceledException) { return Result("failed", ex.Message); }
        }
        if (use.Name == ChatSearch.ToolName) {
            Publish(live, new JsonObject { ["type"] = "tool_progress", ["toolCallId"] = use.Id, ["status"] = "in_progress" });
            try { return Result("completed", await _search.RunAsync(use.Input, cancel)); }
            catch (Exception ex) when (ex is not OperationCanceledException) { return Result("failed", ex.Message); }
        }
        var tool = tools?.Find(use.Name ?? "");
        if (tool is null) { return Result("failed", "There is no tool called " + use.Name + " in this chat."); }

        if (!tool.ReadOnly && !conv.Allowed.Contains(tool.Spec.Name)) {
            var q = new Question { ToolCallId = use.Id ?? "", Name = tool.Spec.Name, Title = tool.Title, Input = use.Input?.DeepClone() };
            lock (live.Gate) { q.Key = "q" + (++live.QuestionCount); live.Questions[q.Key] = q; }
            var asked = QuestionJson(q).AsObject(); asked["type"] = "permission";
            Publish(live, asked);
            string answer;
            try {
                using var reg = cancel.Register(() => q.Answer.TrySetResult("reject"));
                answer = await q.Answer.Task;
            }
            finally {
                lock (live.Gate) { live.Questions.Remove(q.Key); }
                Publish(live, new JsonObject { ["type"] = "answered", ["key"] = q.Key });
            }
            if (cancel.IsCancellationRequested) { return Result("rejected", "The reader stopped the reply before this ran."); }
            if (answer == "allow_always") { conv.Allowed.Add(tool.Spec.Name); }
            else if (answer != "allow_once") { return Result("rejected", "The reader did not allow this. Ask what they would like instead."); }
        }
        Publish(live, new JsonObject { ["type"] = "tool_progress", ["toolCallId"] = use.Id, ["status"] = "in_progress" });
        try {
            /* An applet's action runs on the reader's own desktop when a
               page is watching: the site's action broker there opens the
               applet's window where the action needs one, which the server
               cannot. With no page watching, the server runs what it can. */
            bool watched; lock (live.Gate) { watched = live.Subscribers.Count > 0; }
            if (tool.Spec.Name == "applet_invoke" && watched && use.Input is JsonObject call && call["action"]?.GetValue<string>() is { Length: > 0 } action) {
                var tcs = new TaskCompletionSource<(string? Output, string? Error)>(TaskCreationOptions.RunContinuationsAsynchronously);
                string key;
                lock (live.Gate) { key = "a" + (++live.ActionCount); live.Actions[key] = tcs; }
                /* A model now and then writes the input as JSON text rather
                   than an object; the text is read so the action gets the object. */
                JsonNode? input = call["input"]?.DeepClone();
                if (input is JsonValue v && v.TryGetValue<string>(out var inputText)) {
                    try { input = JsonNode.Parse(inputText); } catch (JsonException) { input = null; }
                }
                Publish(live, new JsonObject { ["type"] = "run_action", ["key"] = key, ["toolCallId"] = use.Id, ["action"] = action, ["input"] = input ?? new JsonObject() });
                try {
                    using var limit = CancellationTokenSource.CreateLinkedTokenSource(cancel);
                    limit.CancelAfter(TimeSpan.FromMinutes(10));
                    using var reg = limit.Token.Register(() => tcs.TrySetResult((null, cancel.IsCancellationRequested ? "The reader stopped the reply." : "The desktop did not answer in time.")));
                    var (output, error) = await tcs.Task;
                    return error is null ? Result("completed", output ?? "{}") : Result("failed", error);
                }
                finally { lock (live.Gate) { live.Actions.Remove(key); } }
            }
            var (text, failed) = await tools!.CallAsync(tool.Spec.Name, use.Input, cancel);
            return Result(failed ? "failed" : "completed", text);
        }
        catch (OperationCanceledException) when (cancel.IsCancellationRequested) { return Result("rejected", "The reader stopped the reply while this ran."); }
        catch (Exception ex) { return Result("failed", ex.Message); }
    }
}
