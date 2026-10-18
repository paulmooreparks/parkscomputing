using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

namespace ParksComputing.Engine.Chat;

/// <summary>What a provider says as a reply streams in.</summary>
public abstract record ProviderEvent;
public sealed record TextDelta(string Text) : ProviderEvent;
public sealed record ThinkingDelta(string Text) : ProviderEvent;
public sealed record ThinkingSignature(string Signature) : ProviderEvent;
public sealed record ToolCallReady(string Id, string Name, JsonNode Input) : ProviderEvent;
public sealed record UsageReport(int? Input, int? Output) : ProviderEvent;
public sealed record Finished(string StopReason) : ProviderEvent;

/// <summary>A tool the model may ask for: its name, what it does, and its input's JSON Schema.</summary>
public sealed record ToolSpec(string Name, string Description, JsonNode Schema);

public sealed record ProviderRequest(string Model, string? System, IReadOnlyList<ChatMessage> Messages, IReadOnlyList<ToolSpec> Tools, bool Thinking);

/// <summary>A refusal or failure the provider gave, said as it gave it.</summary>
public sealed class ProviderException : Exception {
    public ProviderException(string message) : base(message) { }
}

public interface IChatProvider {
    IAsyncEnumerable<ProviderEvent> StreamAsync(ProviderRequest request, CancellationToken cancel);
    Task<IReadOnlyList<string>> ModelsAsync(CancellationToken cancel);
}

public static class ChatProviders {
    public const string ClientName = "chat";

    public static IChatProvider For(ChatProviderConfig config, HttpClient http) => config.Kind.ToLowerInvariant() switch {
        "anthropic" => new AnthropicProvider(config, http),
        _ => new OpenAiProvider(config, http)
    };

    internal static string Base(string url) => url.EndsWith('/') ? url : url + "/";

    /// <summary>The data lines of a server-sent event stream.</summary>
    internal static async IAsyncEnumerable<(string? Event, string Data)> Sse(Stream body, [EnumeratorCancellation] CancellationToken cancel) {
        using var reader = new StreamReader(body, Encoding.UTF8);
        string? name = null; var data = new StringBuilder();
        while (true) {
            cancel.ThrowIfCancellationRequested();
            var line = await reader.ReadLineAsync(cancel);
            if (line is null) { break; }
            if (line.Length == 0) {
                if (data.Length > 0) { yield return (name, data.ToString()); }
                name = null; data.Clear(); continue;
            }
            if (line.StartsWith(':')) { continue; }
            if (line.StartsWith("event:")) { name = line[6..].Trim(); }
            else if (line.StartsWith("data:")) { if (data.Length > 0) { data.Append('\n'); } data.Append(line[5..].TrimStart()); }
        }
        if (data.Length > 0) { yield return (name, data.ToString()); }
    }

    internal static async Task<string> ErrorOf(HttpResponseMessage r, CancellationToken cancel) {
        var text = await r.Content.ReadAsStringAsync(cancel);
        try {
            var node = JsonNode.Parse(text);
            var msg = node?["error"]?["message"]?.GetValue<string>() ?? node?["error"]?.GetValue<string>() ?? node?["message"]?.GetValue<string>();
            if (!string.IsNullOrWhiteSpace(msg)) { return msg!; }
        }
        catch (Exception) { }
        return "the provider answered " + (int)r.StatusCode + (text.Length > 0 ? ": " + text[..Math.Min(text.Length, 300)] : "");
    }

    /// <summary>A text file attached to a message, as the model reads it.</summary>
    internal static string FileText(ChatPart p) => "Attached file " + (p.Name ?? "untitled") + ":\n```\n" + (p.Text ?? "") + "\n```";

    internal static string ResultText(ChatPart p) => p.Text ?? "";
}

/// <summary>
/// Any OpenAI-compatible chat completions API: OpenAI itself, Ollama's /v1,
/// OpenRouter and the many that copy it. Streams with server-sent events;
/// reasoning comes as delta.reasoning (Ollama, OpenRouter) or
/// delta.reasoning_content (DeepSeek and others), and tool calls arrive in
/// pieces by index.
/// </summary>
public sealed class OpenAiProvider : IChatProvider {
    private readonly ChatProviderConfig _config; private readonly HttpClient _http;
    public OpenAiProvider(ChatProviderConfig config, HttpClient http) { _config = config; _http = http; }

    private HttpRequestMessage Request(HttpMethod method, string path) {
        var req = new HttpRequestMessage(method, ChatProviders.Base(_config.BaseUrl) + path);
        if (_config.Key is { Length: > 0 } key) { req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key); }
        return req;
    }

    public async Task<IReadOnlyList<string>> ModelsAsync(CancellationToken cancel) {
        using var r = await _http.SendAsync(Request(HttpMethod.Get, "models"), cancel);
        if (!r.IsSuccessStatusCode) { throw new ProviderException(await ChatProviders.ErrorOf(r, cancel)); }
        var node = JsonNode.Parse(await r.Content.ReadAsStringAsync(cancel));
        return (node?["data"]?.AsArray() ?? new JsonArray()).Select(m => m?["id"]?.GetValue<string>()).Where(s => !string.IsNullOrEmpty(s)).Select(s => s!).OrderBy(s => s).ToList();
    }

    public static JsonObject Body(ProviderRequest request, int? maxTokens) {
        var messages = new JsonArray();
        if (!string.IsNullOrWhiteSpace(request.System)) { messages.Add(new JsonObject { ["role"] = "system", ["content"] = request.System }); }
        foreach (var m in request.Messages) {
            if (m.Role == "assistant") {
                var text = string.Concat(m.Parts.Where(p => p.Type == "text").Select(p => p.Text));
                var o = new JsonObject { ["role"] = "assistant", ["content"] = text.Length > 0 ? text : null };
                var calls = m.Parts.Where(p => p.Type == "tool_use").Select(p => (JsonNode)new JsonObject {
                    ["id"] = p.Id, ["type"] = "function",
                    ["function"] = new JsonObject { ["name"] = p.Name, ["arguments"] = (p.Input ?? new JsonObject()).ToJsonString() }
                }).ToArray();
                if (calls.Length > 0) { o["tool_calls"] = new JsonArray(calls); }
                messages.Add(o);
                continue;
            }
            foreach (var r in m.Parts.Where(p => p.Type == "tool_result")) {
                messages.Add(new JsonObject { ["role"] = "tool", ["tool_call_id"] = r.Id, ["content"] = ChatProviders.ResultText(r) });
            }
            var content = new JsonArray();
            foreach (var p in m.Parts) {
                if (p.Type == "text" && !string.IsNullOrEmpty(p.Text)) { content.Add(new JsonObject { ["type"] = "text", ["text"] = p.Text }); }
                else if (p.Type == "file") { content.Add(new JsonObject { ["type"] = "text", ["text"] = ChatProviders.FileText(p) }); }
                else if (p.Type == "image") {
                    content.Add(new JsonObject { ["type"] = "image_url", ["image_url"] = new JsonObject { ["url"] = "data:" + p.MediaType + ";base64," + p.Data } });
                }
            }
            if (content.Count > 0) { messages.Add(new JsonObject { ["role"] = "user", ["content"] = content }); }
        }
        var body = new JsonObject {
            ["model"] = request.Model, ["messages"] = messages, ["stream"] = true,
            ["stream_options"] = new JsonObject { ["include_usage"] = true }
        };
        if (maxTokens is { } mt) { body["max_tokens"] = mt; }
        if (request.Tools.Count > 0) {
            body["tools"] = new JsonArray(request.Tools.Select(t => (JsonNode)new JsonObject {
                ["type"] = "function",
                ["function"] = new JsonObject { ["name"] = t.Name, ["description"] = t.Description, ["parameters"] = t.Schema.DeepClone() }
            }).ToArray());
        }
        return body;
    }

    public async IAsyncEnumerable<ProviderEvent> StreamAsync(ProviderRequest request, [EnumeratorCancellation] CancellationToken cancel) {
        var req = Request(HttpMethod.Post, "chat/completions");
        req.Content = new StringContent(Body(request, _config.MaxTokens).ToJsonString(), Encoding.UTF8, "application/json");
        using var r = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cancel);
        if (!r.IsSuccessStatusCode) { throw new ProviderException(await ChatProviders.ErrorOf(r, cancel)); }
        await using var body = await r.Content.ReadAsStreamAsync(cancel);
        await foreach (var e in Parse(body, cancel)) { yield return e; }
    }

    /// <summary>The events in a chat completions stream.</summary>
    public static async IAsyncEnumerable<ProviderEvent> Parse(Stream body, [EnumeratorCancellation] CancellationToken cancel) {
        var calls = new SortedDictionary<int, (string? Id, string? Name, StringBuilder Args)>();
        string? finish = null;
        await foreach (var (_, data) in ChatProviders.Sse(body, cancel)) {
            if (data == "[DONE]") { break; }
            JsonNode? node;
            try { node = JsonNode.Parse(data); } catch (JsonException) { continue; }
            if (node?["error"] is JsonNode err) { throw new ProviderException(err["message"]?.GetValue<string>() ?? err.ToJsonString()); }
            if (node?["usage"] is JsonObject usage) {
                yield return new UsageReport(usage["prompt_tokens"]?.GetValue<int>(), usage["completion_tokens"]?.GetValue<int>());
            }
            var choice = node?["choices"]?.AsArray().FirstOrDefault();
            if (choice is null) { continue; }
            var delta = choice["delta"];
            var reasoning = delta?["reasoning"]?.GetValue<string>() ?? delta?["reasoning_content"]?.GetValue<string>();
            if (!string.IsNullOrEmpty(reasoning)) { yield return new ThinkingDelta(reasoning); }
            var text = delta?["content"]?.GetValueKind() == JsonValueKind.String ? delta!["content"]!.GetValue<string>() : null;
            if (!string.IsNullOrEmpty(text)) { yield return new TextDelta(text); }
            foreach (var tc in delta?["tool_calls"]?.AsArray() ?? new JsonArray()) {
                var index = tc?["index"]?.GetValue<int>() ?? 0;
                if (!calls.TryGetValue(index, out var c)) { c = (null, null, new StringBuilder()); }
                c.Id ??= tc?["id"]?.GetValue<string>();
                c.Name ??= tc?["function"]?["name"]?.GetValue<string>();
                c.Args.Append(tc?["function"]?["arguments"]?.GetValue<string>() ?? "");
                calls[index] = c;
            }
            if (choice["finish_reason"]?.GetValue<string>() is { Length: > 0 } f) { finish = f; }
        }
        foreach (var (i, c) in calls) {
            JsonNode input;
            try { input = c.Args.Length == 0 ? new JsonObject() : JsonNode.Parse(c.Args.ToString()) ?? new JsonObject(); }
            catch (JsonException) { input = new JsonObject { ["_unparsed"] = c.Args.ToString() }; }
            yield return new ToolCallReady(c.Id ?? ("call_" + i), c.Name ?? "", input);
        }
        yield return new Finished(calls.Count > 0 ? "tool_use" : finish switch { "length" => "max_tokens", null or "stop" => "end_turn", var other => other });
    }
}

/// <summary>
/// Anthropic's Messages API, streamed: text, thinking with its signature,
/// and tool use, whose input arrives as partial JSON to be put together at
/// the block's end.
/// </summary>
public sealed class AnthropicProvider : IChatProvider {
    public const string Version = "2023-06-01";
    private readonly ChatProviderConfig _config; private readonly HttpClient _http;
    public AnthropicProvider(ChatProviderConfig config, HttpClient http) { _config = config; _http = http; }

    private HttpRequestMessage Request(HttpMethod method, string path) {
        var req = new HttpRequestMessage(method, ChatProviders.Base(_config.BaseUrl) + path);
        req.Headers.Add("anthropic-version", Version);
        if (_config.Key is { Length: > 0 } key) { req.Headers.Add("x-api-key", key); }
        return req;
    }

    public async Task<IReadOnlyList<string>> ModelsAsync(CancellationToken cancel) {
        using var r = await _http.SendAsync(Request(HttpMethod.Get, "models"), cancel);
        if (!r.IsSuccessStatusCode) { throw new ProviderException(await ChatProviders.ErrorOf(r, cancel)); }
        var node = JsonNode.Parse(await r.Content.ReadAsStringAsync(cancel));
        return (node?["data"]?.AsArray() ?? new JsonArray()).Select(m => m?["id"]?.GetValue<string>()).Where(s => !string.IsNullOrEmpty(s)).Select(s => s!).ToList();
    }

    public static JsonObject Body(ProviderRequest request, int? maxTokens, int? thinkingBudget) {
        var messages = new JsonArray();
        foreach (var m in request.Messages) {
            var content = new JsonArray();
            foreach (var p in m.Parts) {
                switch (p.Type) {
                    case "text" when !string.IsNullOrEmpty(p.Text):
                        content.Add(new JsonObject { ["type"] = "text", ["text"] = p.Text }); break;
                    // Thinking goes back only with its signature, and only as
                    // the model gave it.
                    case "thinking" when m.Role == "assistant" && request.Thinking && !string.IsNullOrEmpty(p.Signature):
                        content.Add(new JsonObject { ["type"] = "thinking", ["thinking"] = p.Text ?? "", ["signature"] = p.Signature }); break;
                    case "file":
                        content.Add(new JsonObject { ["type"] = "text", ["text"] = ChatProviders.FileText(p) }); break;
                    case "image":
                        content.Add(new JsonObject { ["type"] = "image", ["source"] = new JsonObject { ["type"] = "base64", ["media_type"] = p.MediaType, ["data"] = p.Data } }); break;
                    case "tool_use":
                        content.Add(new JsonObject { ["type"] = "tool_use", ["id"] = p.Id, ["name"] = p.Name, ["input"] = (p.Input ?? new JsonObject()).DeepClone() }); break;
                    case "tool_result":
                        content.Add(new JsonObject { ["type"] = "tool_result", ["tool_use_id"] = p.Id, ["content"] = ChatProviders.ResultText(p), ["is_error"] = p.Status != "completed" }); break;
                }
            }
            if (content.Count > 0) { messages.Add(new JsonObject { ["role"] = m.Role, ["content"] = content }); }
        }
        var budget = request.Thinking ? Math.Max(1024, thinkingBudget ?? 4096) : 0;
        var body = new JsonObject {
            ["model"] = request.Model, ["messages"] = messages, ["stream"] = true,
            ["max_tokens"] = Math.Max(maxTokens ?? 8192, budget + 1024)
        };
        if (!string.IsNullOrWhiteSpace(request.System)) { body["system"] = request.System; }
        if (request.Thinking) { body["thinking"] = new JsonObject { ["type"] = "enabled", ["budget_tokens"] = budget }; }
        if (request.Tools.Count > 0) {
            body["tools"] = new JsonArray(request.Tools.Select(t => (JsonNode)new JsonObject {
                ["name"] = t.Name, ["description"] = t.Description, ["input_schema"] = t.Schema.DeepClone()
            }).ToArray());
        }
        return body;
    }

    public async IAsyncEnumerable<ProviderEvent> StreamAsync(ProviderRequest request, [EnumeratorCancellation] CancellationToken cancel) {
        var req = Request(HttpMethod.Post, "messages");
        req.Content = new StringContent(Body(request, _config.MaxTokens, _config.ThinkingBudget).ToJsonString(), Encoding.UTF8, "application/json");
        using var r = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cancel);
        if (!r.IsSuccessStatusCode) { throw new ProviderException(await ChatProviders.ErrorOf(r, cancel)); }
        await using var body = await r.Content.ReadAsStreamAsync(cancel);
        await foreach (var e in Parse(body, cancel)) { yield return e; }
    }

    /// <summary>The events in a Messages API stream.</summary>
    public static async IAsyncEnumerable<ProviderEvent> Parse(Stream body, [EnumeratorCancellation] CancellationToken cancel) {
        var blocks = new Dictionary<int, (string Type, string? Id, string? Name, StringBuilder Json)>();
        string stop = "end_turn"; int? input = null;
        await foreach (var (_, data) in ChatProviders.Sse(body, cancel)) {
            JsonNode? node;
            try { node = JsonNode.Parse(data); } catch (JsonException) { continue; }
            switch (node?["type"]?.GetValue<string>()) {
                case "message_start":
                    input = node["message"]?["usage"]?["input_tokens"]?.GetValue<int>();
                    break;
                case "content_block_start": {
                    var i = node["index"]!.GetValue<int>(); var b = node["content_block"];
                    blocks[i] = (b?["type"]?.GetValue<string>() ?? "", b?["id"]?.GetValue<string>(), b?["name"]?.GetValue<string>(), new StringBuilder());
                    break;
                }
                case "content_block_delta": {
                    var i = node["index"]!.GetValue<int>(); var d = node["delta"];
                    switch (d?["type"]?.GetValue<string>()) {
                        case "text_delta": yield return new TextDelta(d["text"]?.GetValue<string>() ?? ""); break;
                        case "thinking_delta": yield return new ThinkingDelta(d["thinking"]?.GetValue<string>() ?? ""); break;
                        case "signature_delta": yield return new ThinkingSignature(d["signature"]?.GetValue<string>() ?? ""); break;
                        case "input_json_delta": if (blocks.TryGetValue(i, out var blk)) { blk.Json.Append(d["partial_json"]?.GetValue<string>() ?? ""); } break;
                    }
                    break;
                }
                case "content_block_stop": {
                    var i = node["index"]!.GetValue<int>();
                    if (blocks.TryGetValue(i, out var blk) && blk.Type == "tool_use") {
                        JsonNode args;
                        try { args = blk.Json.Length == 0 ? new JsonObject() : JsonNode.Parse(blk.Json.ToString()) ?? new JsonObject(); }
                        catch (JsonException) { args = new JsonObject { ["_unparsed"] = blk.Json.ToString() }; }
                        yield return new ToolCallReady(blk.Id ?? ("toolu_" + i), blk.Name ?? "", args);
                    }
                    break;
                }
                case "message_delta":
                    if (node["delta"]?["stop_reason"]?.GetValue<string>() is { Length: > 0 } s) { stop = s; }
                    yield return new UsageReport(input, node["usage"]?["output_tokens"]?.GetValue<int>());
                    break;
                case "error":
                    throw new ProviderException(node["error"]?["message"]?.GetValue<string>() ?? "the provider stopped with an error");
            }
        }
        yield return new Finished(stop);
    }
}
