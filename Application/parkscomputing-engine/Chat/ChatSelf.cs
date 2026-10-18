using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

namespace ParksComputing.Engine.Chat;

/// <summary>The chat's knowledge of itself, for the model: chat_info is a
/// built-in, read-only tool every staff reader's chat offers, beside the
/// site's tools, that answers from the same code the chat's own API
/// (ChatController) answers from. So the model can say which providers and
/// models the chat has, what this conversation is set to, which chats
/// exist, which skills, and where the settings live, without guessing. The
/// provider listing is shared with GET providers.</summary>
public sealed class ChatSelf {
    public const string ToolName = "chat_info";

    private readonly ChatSettings _settings;
    private readonly ChatStore _store;
    private readonly ChatSkills _skills;
    private readonly IHttpClientFactory _http;
    private readonly CodexHost _codex;

    public ChatSelf(ChatSettings settings, ChatStore store, ChatSkills skills, IHttpClientFactory http, CodexHost codex) {
        _settings = settings; _store = store; _skills = skills; _http = http; _codex = codex;
    }

    public static readonly string[] Topics = { "overview", "providers", "conversation", "conversations", "skills", "settings", "api" };

    public ToolSpec Spec { get; } = new(ToolName,
        "What this chat is and has, from its own API: its providers and their models (with the defaults), this conversation's settings (provider, model, thinking, " +
        "whether the site's tools are on, the tools allowed without asking), the reader's other chats, the skills, the settings file, and the chat's API routes. " +
        "Ask with a topic, or overview for all of it. Use it when the reader asks about the chat itself, its models or its settings.",
        new JsonObject {
            ["type"] = "object", ["additionalProperties"] = false,
            ["properties"] = new JsonObject {
                ["topic"] = new JsonObject { ["type"] = "string", ["enum"] = new JsonArray(Topics.Select(t => (JsonNode)t).ToArray()), ["default"] = "overview",
                    ["description"] = "overview (everything), providers, conversation (this one), conversations (the reader's chats), skills, settings, or api (the routes)." }
            }
        });

    /// <summary>The providers with their models, as GET providers gives
    /// them: a provider that lists no models in the settings is asked, with
    /// a short wait, and a missing key or a failed listing is its problem.</summary>
    /* A provider's own model list, kept ten minutes: every chat window asks
       for the providers as it opens, and asking Codex or Ollama each time
       held the window up. */
    private readonly Dictionary<string, (DateTimeOffset At, IReadOnlyList<string> Models)> _models = new();
    private readonly object _gate = new();

    public async Task<JsonObject> ProvidersAsync(ChatConfig config, string? error, bool toolsOffered, CancellationToken cancel) {
        var list = new JsonArray();
        foreach (var p in config.Providers) {
            IReadOnlyList<string> models = p.Models ?? new List<string>();
            string? problem = null;
            if (models.Count == 0) {
                var key = p.Id + "|" + p.Kind + "|" + p.BaseUrl + "|" + p.Command;
                lock (_gate) { if (_models.TryGetValue(key, out var kept) && DateTimeOffset.UtcNow - kept.At < TimeSpan.FromMinutes(10)) { models = kept.Models; } }
            }
            if (models.Count == 0) {
                try {
                    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancel);
                    timeout.CancelAfter(TimeSpan.FromSeconds(8));
                    models = await ChatProviders.For(p, _http.CreateClient(ChatProviders.ClientName), _codex).ModelsAsync(timeout.Token);
                    if (models.Count > 0) { lock (_gate) { _models[p.Id + "|" + p.Kind + "|" + p.BaseUrl + "|" + p.Command] = (DateTimeOffset.UtcNow, models); } }
                }
                catch (Exception ex) when (ex is ProviderException or HttpRequestException or OperationCanceledException) { problem = "Its models could not be listed: " + ex.Message; }
            }
            if (!string.IsNullOrWhiteSpace(p.KeyEnv) && string.IsNullOrEmpty(p.Key)) { problem = "The server has no " + p.KeyEnv + " for its key."; }
            list.Add(new JsonObject {
                ["id"] = p.Id, ["name"] = p.Label, ["kind"] = p.Kind,
                ["models"] = new JsonArray(models.Select(m => (JsonNode)m).ToArray()), ["problem"] = problem
            });
        }
        return new JsonObject {
            ["providers"] = list, ["defaultProvider"] = config.DefaultProvider ?? config.Providers.FirstOrDefault()?.Id,
            ["defaultModel"] = config.DefaultModel, ["error"] = error,
            ["tools"] = toolsOffered, ["settings"] = "/etc/" + ChatSettings.FileName
        };
    }

    /// <summary>The answer to a chat_info call, as JSON text for the model.</summary>
    public async Task<string> RunAsync(JsonNode? input, string home, Conversation conv, bool toolsOffered, bool canEditSettings, CancellationToken cancel) {
        var topic = input is JsonObject o && o["topic"]?.GetValue<string>() is { Length: > 0 } t && Topics.Contains(t) ? t : "overview";
        var (config, error) = _settings.Read();
        var all = topic == "overview";
        var answer = new JsonObject();
        if (all || topic == "conversation") {
            answer["conversation"] = new JsonObject {
                ["id"] = conv.Id, ["title"] = conv.Title, ["provider"] = conv.Provider, ["model"] = conv.Model,
                ["thinking"] = conv.Thinking, ["siteTools"] = conv.Tools && toolsOffered,
                ["allowedWithoutAsking"] = new JsonArray(conv.Allowed.Select(a => (JsonNode)a).ToArray()),
                ["messages"] = conv.Messages.Count, ["created"] = conv.Created, ["updated"] = conv.Updated
            };
        }
        if (all || topic == "providers") { answer["providers"] = await ProvidersAsync(config, error, toolsOffered, cancel); }
        if (all || topic == "conversations") {
            answer["conversations"] = new JsonArray(_store.List(home).Select(s => (JsonNode)new JsonObject {
                ["id"] = s.Id, ["title"] = s.Title, ["provider"] = s.Provider, ["model"] = s.Model, ["updated"] = s.Updated, ["thisOne"] = s.Id == conv.Id
            }).ToArray());
        }
        if (all || topic == "skills") {
            answer["skills"] = new JsonArray(_skills.List(home).Select(s => (JsonNode)new JsonObject {
                ["name"] = s.Name, ["description"] = s.Description, ["hint"] = s.Hint, ["source"] = s.Source == "mine" ? "~/skills" : "/etc/skills"
            }).ToArray());
        }
        if (all || topic == "settings") {
            answer["settings"] = new JsonObject {
                ["path"] = "/etc/" + ChatSettings.FileName, ["editableByReader"] = canEditSettings, ["error"] = error,
                ["defaultProvider"] = config.DefaultProvider, ["defaultModel"] = config.DefaultModel, ["maxToolRounds"] = config.MaxToolRounds,
                ["systemPrompt"] = string.IsNullOrWhiteSpace(config.System) ? "the built-in one" : "the one in the settings",
                ["webSearch"] = config.Search is { Configured: true } ? "the chat's web_search tool, through " + config.Search.Kind : "no search engine is configured for the chat's own web_search tool",
                ["providersSearchingForThemselves"] = new JsonArray(config.Providers.Where(p => p.SearchesTheWeb).Select(p => (JsonNode)p.Id).ToArray()),
                ["keys"] = "never in the file: each provider names an environment variable (keyEnv) that holds its key"
            };
        }
        if (all || topic == "api") {
            answer["api"] = new JsonObject {
                ["base"] = "/api/admin/chat/", ["access"] = "the site's staff (Admin or SuperAdmin) on a live session; the site's tools and the settings' editing need the super-user",
                ["routes"] = new JsonArray(
                    "GET providers", "GET settings", "PUT settings", "GET skills", "GET conversations", "POST conversations", "GET conversations/{id}",
                    "PATCH conversations/{id} (title, provider, model, thinking, tools)", "DELETE conversations/{id}", "POST conversations/{id}/messages (text, attachments, mode send|queue|steer)",
                    "POST conversations/{id}/stop", "DELETE conversations/{id}/queue", "POST conversations/{id}/answer", "POST conversations/{id}/actions", "GET conversations/{id}/events (SSE)")
            };
        }
        return answer.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
    }
}
