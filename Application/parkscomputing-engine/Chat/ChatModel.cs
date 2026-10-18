using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.Chat;

/// <summary>
/// One part of a chat message, in a form no provider owns
/// (Architecture/chat-design.md): text, the model's thinking (with the
/// signature Anthropic gives it, which must go back with it), an image or a
/// file the reader attached, a tool the model asked for, and that tool's
/// result. Each provider writes these in its own request format.
/// </summary>
public sealed class ChatPart {
    /// <summary>text, thinking, image, file, tool_use or tool_result.</summary>
    [JsonPropertyName("type")] public string Type { get; set; } = "text";
    [JsonPropertyName("text")] public string? Text { get; set; }
    [JsonPropertyName("signature")] public string? Signature { get; set; }
    /// <summary>A tool call's id, which its result gives back.</summary>
    [JsonPropertyName("id")] public string? Id { get; set; }
    /// <summary>A tool's name, or an attached file's.</summary>
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("input")] public JsonNode? Input { get; set; }
    [JsonPropertyName("mediaType")] public string? MediaType { get; set; }
    /// <summary>An image's bytes, base64.</summary>
    [JsonPropertyName("data")] public string? Data { get; set; }
    /// <summary>A tool result: completed, failed or rejected.</summary>
    [JsonPropertyName("status")] public string? Status { get; set; }
    /// <summary>A block the provider ran itself (Anthropic's web search:
    /// server_tool_use and web_search_tool_result), kept as the provider
    /// gave it, since it must go back unchanged in later turns; type
    /// server_block.</summary>
    [JsonPropertyName("raw")] public JsonNode? Raw { get; set; }
    /// <summary>A text's citations, as the provider gave them, which go
    /// back with the text in later turns.</summary>
    [JsonPropertyName("citations")] public JsonArray? Citations { get; set; }

    public static ChatPart TextPart(string text) => new() { Type = "text", Text = text };
}

public sealed class ChatMessage {
    /// <summary>user or assistant. Tool results travel in a user message.</summary>
    [JsonPropertyName("role")] public string Role { get; set; } = "user";
    [JsonPropertyName("parts")] public List<ChatPart> Parts { get; set; } = new();
    [JsonPropertyName("at")] public DateTimeOffset At { get; set; }
    [JsonPropertyName("provider")] public string? Provider { get; set; }
    [JsonPropertyName("model")] public string? Model { get; set; }
    /// <summary>An assistant message's end: end_turn, tool_use, max_tokens, cancelled or error.</summary>
    [JsonPropertyName("stop")] public string? Stop { get; set; }
    [JsonPropertyName("error")] public string? Error { get; set; }
}

public sealed class Conversation {
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("title")] public string Title { get; set; } = "New chat";
    [JsonPropertyName("provider")] public string Provider { get; set; } = "";
    [JsonPropertyName("model")] public string Model { get; set; } = "";
    [JsonPropertyName("thinking")] public bool Thinking { get; set; } = true;
    [JsonPropertyName("tools")] public bool Tools { get; set; } = true;
    /// <summary>Tools the reader allowed for the rest of this chat.</summary>
    [JsonPropertyName("allowed")] public List<string> Allowed { get; set; } = new();
    [JsonPropertyName("created")] public DateTimeOffset Created { get; set; }
    [JsonPropertyName("updated")] public DateTimeOffset Updated { get; set; }
    [JsonPropertyName("messages")] public List<ChatMessage> Messages { get; set; } = new();
}

/// <summary>A provider as /etc/chat.json describes it.</summary>
public sealed class ChatProviderConfig {
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string? Name { get; set; }
    /// <summary>openai, for any OpenAI-compatible chat completions API
    /// (OpenAI, Ollama, OpenRouter and others), or anthropic.</summary>
    [JsonPropertyName("kind")] public string Kind { get; set; } = "openai";
    [JsonPropertyName("baseUrl")] public string BaseUrl { get; set; } = "";
    /// <summary>The environment variable that holds the API key; the key
    /// itself is never in the file.</summary>
    [JsonPropertyName("keyEnv")] public string? KeyEnv { get; set; }
    /// <summary>The models to offer; without them, the provider's own list
    /// (GET models) where it has one.</summary>
    [JsonPropertyName("models")] public List<string>? Models { get; set; }
    [JsonPropertyName("maxTokens")] public int? MaxTokens { get; set; }
    /// <summary>Anthropic: adaptive (the default, which the current models
    /// take) or enabled, thinking with a budget, for the older ones.</summary>
    [JsonPropertyName("thinkingType")] public string? ThinkingType { get; set; }
    /// <summary>Anthropic: the thinking budget when thinkingType is enabled.</summary>
    [JsonPropertyName("thinkingBudget")] public int? ThinkingBudget { get; set; }
    /// <summary>Anthropic: whether the model may search the web with the
    /// API's own web search tool, on by default; billed per search.</summary>
    [JsonPropertyName("webSearch")] public bool? WebSearch { get; set; }
    /// <summary>Anthropic: the most searches in one reply (5 by default).</summary>
    [JsonPropertyName("webSearchMaxUses")] public int? WebSearchMaxUses { get; set; }

    [JsonIgnore] public string Label => string.IsNullOrWhiteSpace(Name) ? Id : Name!;
    [JsonIgnore] public string? Key => string.IsNullOrWhiteSpace(KeyEnv) ? null : Environment.GetEnvironmentVariable(KeyEnv!);
    [JsonIgnore] public bool SearchesTheWeb => string.Equals(Kind, "anthropic", StringComparison.OrdinalIgnoreCase) && WebSearch != false;
}

/// <summary>A search engine for the chat's own web_search tool, which any
/// provider's model may call: brave (the Brave Search API) or searxng (a
/// SearXNG instance with its JSON format on). The key, where one is
/// needed, is in the environment keyEnv names, never in the file.</summary>
public sealed class ChatSearchConfig {
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    [JsonPropertyName("baseUrl")] public string? BaseUrl { get; set; }
    [JsonPropertyName("keyEnv")] public string? KeyEnv { get; set; }
    [JsonPropertyName("count")] public int? Count { get; set; }

    [JsonIgnore] public string? Key => string.IsNullOrWhiteSpace(KeyEnv) ? null : Environment.GetEnvironmentVariable(KeyEnv!);
    [JsonIgnore] public bool Configured => Kind is "brave" or "searxng";
}

public sealed class ChatConfig {
    [JsonPropertyName("providers")] public List<ChatProviderConfig> Providers { get; set; } = new();
    [JsonPropertyName("defaultProvider")] public string? DefaultProvider { get; set; }
    [JsonPropertyName("defaultModel")] public string? DefaultModel { get; set; }
    [JsonPropertyName("system")] public string? System { get; set; }
    [JsonPropertyName("maxToolRounds")] public int MaxToolRounds { get; set; } = 25;
    [JsonPropertyName("search")] public ChatSearchConfig? Search { get; set; }

    public ChatProviderConfig? Find(string? id) => Providers.FirstOrDefault(p => string.Equals(p.Id, id, StringComparison.OrdinalIgnoreCase));
}

/// <summary>
/// The chat's settings, /etc/chat.json on the server, which the super-user
/// edits like any other settings file. It is read afresh when it changes.
/// A missing file gives no providers, and a broken one says why.
/// </summary>
public sealed class ChatSettings {
    public const string FileName = "chat.json";
    public static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true, ReadCommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true };

    private readonly ServerFiles _files;
    private readonly object _gate = new();
    private (DateTime Stamp, ChatConfig Config, string? Error)? _cached;

    public ChatSettings(ServerFiles files) { _files = files; }

    public string? PathOf() {
        var etc = _files.RootDir(ServerFiles.Etc, "");
        return etc is null ? null : System.IO.Path.Combine(etc, FileName);
    }

    /// <summary>Writes the settings whole, as the settings dialog gives them.</summary>
    public void Write(ChatConfig config) {
        var path = PathOf() ?? throw new InvalidOperationException("There is no settings folder.");
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(config, new JsonSerializerOptions { WriteIndented = true, DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull }) + "\n");
        File.Move(tmp, path, overwrite: true);
        lock (_gate) { _cached = null; }
    }

    /// <summary>The settings, and why they could not be read, or null.</summary>
    public (ChatConfig Config, string? Error) Read() {
        var path = PathOf();
        if (path is null || !File.Exists(path)) { return (new ChatConfig(), null); }
        var stamp = File.GetLastWriteTimeUtc(path);
        lock (_gate) {
            if (_cached is { } c && c.Stamp == stamp) { return (c.Config, c.Error); }
            ChatConfig config; string? error = null;
            try { config = JsonSerializer.Deserialize<ChatConfig>(File.ReadAllText(path), Json) ?? new ChatConfig(); }
            catch (JsonException ex) { config = new ChatConfig(); error = "/etc/" + FileName + " could not be read: " + ex.Message; }
            config.Providers = config.Providers.Where(p => !string.IsNullOrWhiteSpace(p.Id) && !string.IsNullOrWhiteSpace(p.BaseUrl)).ToList();
            _cached = (stamp, config, error);
            return (config, error);
        }
    }
}
