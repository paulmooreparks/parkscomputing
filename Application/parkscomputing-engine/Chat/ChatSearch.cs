using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

namespace ParksComputing.Engine.Chat;

/// <summary>web_search, the chat's own search tool for any provider's
/// model, so Ollama's models can find things on the web as Claude does with
/// the API's own search. It asks the engine the settings name
/// (/etc/chat.json, "search": the Brave Search API, with its key in the
/// environment keyEnv names, or a SearXNG instance with its JSON format on)
/// and gives the model titles, addresses and snippets; web_fetch then reads
/// the pages that matter. Offered only when a search engine is configured,
/// and not to a provider that searches for itself.</summary>
public sealed class ChatSearch {
    public const string ToolName = "web_search";
    public const string BraveUrl = "https://api.search.brave.com/res/v1/web/search";

    private readonly ChatSettings _settings;
    private readonly IHttpClientFactory _http;
    public ChatSearch(ChatSettings settings, IHttpClientFactory http) { _settings = settings; _http = http; }

    public ToolSpec Spec { get; } = new(ToolName,
        "Search the web and get the best results: each one's title, address and a snippet. Use it for what is current or outside the site that you cannot answer from " +
        "what you know, then web_fetch the pages that matter. Say what you searched for and which pages you used.",
        new JsonObject {
            ["type"] = "object", ["additionalProperties"] = false, ["required"] = new JsonArray("query"),
            ["properties"] = new JsonObject {
                ["query"] = new JsonObject { ["type"] = "string", ["description"] = "The search words." },
                ["count"] = new JsonObject { ["type"] = "integer", ["minimum"] = 1, ["maximum"] = 20, ["description"] = "How many results, up to 20 (10 unless given)." }
            }
        });

    /// <summary>Whether a search engine is configured, so the tool is offered.</summary>
    public bool Available => _settings.Read().Config.Search is { Configured: true };

    public async Task<string> RunAsync(JsonNode? input, CancellationToken cancel) {
        var o = input as JsonObject;
        var query = (o?["query"]?.GetValue<string>() ?? "").Trim();
        if (query.Length == 0) { throw new InvalidOperationException("web_search needs the words to search for."); }
        var count = Math.Clamp(o?["count"]?.GetValue<int>() ?? 0, 0, 20);
        var search = _settings.Read().Config.Search;
        if (search is null || !search.Configured) { throw new InvalidOperationException("No search engine is configured: the chat's settings file names one under \"search\"."); }
        if (count == 0) { count = Math.Clamp(search.Count ?? 10, 1, 20); }

        var client = _http.CreateClient(ChatWeb.ClientName);
        using var request = new HttpRequestMessage(HttpMethod.Get, Address(search, query, count));
        request.Headers.TryAddWithoutValidation("Accept", "application/json");
        if (search.Kind == "brave") {
            if (string.IsNullOrEmpty(search.Key)) { throw new InvalidOperationException("The server has no " + (search.KeyEnv ?? "key") + " for the Brave Search API."); }
            request.Headers.TryAddWithoutValidation("X-Subscription-Token", search.Key);
        }
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancel);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));
        using var response = await client.SendAsync(request, timeout.Token);
        var text = await response.Content.ReadAsStringAsync(timeout.Token);
        if (!response.IsSuccessStatusCode) { throw new InvalidOperationException("The search engine answered " + (int)response.StatusCode + " " + response.ReasonPhrase + "."); }
        JsonNode? node;
        try { node = JsonNode.Parse(text); } catch (Exception) { throw new InvalidOperationException("The search engine's answer was not JSON."); }
        return Format(query, Results(search.Kind, node));
    }

    public static Uri Address(ChatSearchConfig search, string query, int count) {
        var q = Uri.EscapeDataString(query);
        if (search.Kind == "brave") {
            var b = string.IsNullOrWhiteSpace(search.BaseUrl) ? BraveUrl : search.BaseUrl!;
            return new Uri(b + (b.Contains('?') ? "&" : "?") + "q=" + q + "&count=" + count);
        }
        var s = (search.BaseUrl ?? "").TrimEnd('/');
        if (s.Length == 0) { throw new InvalidOperationException("The SearXNG instance's address is not set."); }
        return new Uri(s + "/search?q=" + q + "&format=json");
    }

    public sealed record Found(string Title, string Url, string Snippet);

    /// <summary>The results in an engine's answer: Brave's web.results
    /// (title, url, description), SearXNG's results (title, url, content).</summary>
    public static IReadOnlyList<Found> Results(string kind, JsonNode? node) {
        var list = kind == "brave" ? node?["web"]?["results"] as JsonArray : node?["results"] as JsonArray;
        if (list is null) { return Array.Empty<Found>(); }
        return list.Select(r => new Found(
                r?["title"]?.GetValue<string>() ?? "", r?["url"]?.GetValue<string>() ?? "",
                (kind == "brave" ? r?["description"]?.GetValue<string>() : r?["content"]?.GetValue<string>()) ?? ""))
            .Where(f => f.Url.Length > 0).ToList();
    }

    public static string Format(string query, IReadOnlyList<Found> found) {
        if (found.Count == 0) { return "Nothing found for \"" + query + "\"."; }
        var sb = new StringBuilder("Results for \"" + query + "\":\n");
        for (var i = 0; i < found.Count; i++) {
            sb.Append('\n').Append(i + 1).Append(". ").Append(found[i].Title).Append('\n').Append(found[i].Url);
            if (found[i].Snippet.Length > 0) { sb.Append('\n').Append(found[i].Snippet); }
            sb.Append('\n');
        }
        return sb.ToString();
    }
}
