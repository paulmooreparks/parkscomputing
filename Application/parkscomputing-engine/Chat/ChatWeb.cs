using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace ParksComputing.Engine.Chat;

/// <summary>web_fetch, a built-in, read-only tool of the chat: the text of
/// a public web page, for a question the model cannot answer from what it
/// knows (which models Ollama's library offers this month, say). It reads
/// http and https addresses on the public internet only, never the
/// server's own network (loopback, private and link-local addresses are
/// refused, before and after redirects), takes HTML down to its text, and
/// gives at most 60,000 characters. It changes nothing, so it asks no
/// permission.</summary>
public sealed class ChatWeb {
    public const string ToolName = "web_fetch";
    private const int TextLimit = 60_000;
    private const int BodyLimit = 2_000_000;

    private readonly IHttpClientFactory _http;
    public ChatWeb(IHttpClientFactory http) { _http = http; }

    public ToolSpec Spec { get; } = new(ToolName,
        "Read a public web page and get its text (HTML stripped, at most 60,000 characters). Use it when the reader asks about something current or outside the site " +
        "that you cannot answer from what you know, such as the models a provider's public library lists; say which page you read. Only http and https addresses on the public internet.",
        new JsonObject {
            ["type"] = "object", ["additionalProperties"] = false, ["required"] = new JsonArray("url"),
            ["properties"] = new JsonObject {
                ["url"] = new JsonObject { ["type"] = "string", ["description"] = "The page's address, http or https." },
                ["find"] = new JsonObject { ["type"] = "string", ["description"] = "Optional: words to look for; the text is centred on their first occurrence when the page is long." }
            }
        });

    public async Task<string> RunAsync(JsonNode? input, CancellationToken cancel) {
        var o = input as JsonObject;
        var url = o?["url"]?.GetValue<string>() ?? "";
        var find = o?["find"]?.GetValue<string>();
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https")) { throw new InvalidOperationException("web_fetch takes an http or https address."); }
        await RefuseLocalAsync(uri, cancel);

        var client = _http.CreateClient(ClientName);
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.TryAddWithoutValidation("Accept", "text/html, text/plain, application/json;q=0.9, */*;q=0.5");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancel);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        if (response.RequestMessage?.RequestUri is { } landed && landed != uri) { await RefuseLocalAsync(landed, cancel); }
        if (!response.IsSuccessStatusCode) { throw new InvalidOperationException("The page answered " + (int)response.StatusCode + " " + response.ReasonPhrase + "."); }
        var type = response.Content.Headers.ContentType?.MediaType ?? "";
        if (type.StartsWith("image/") || type.StartsWith("audio/") || type.StartsWith("video/") || type == "application/octet-stream") { throw new InvalidOperationException("The page is " + type + ", not text."); }
        var raw = await response.Content.ReadAsStringAsync(timeout.Token);
        if (raw.Length > BodyLimit) { raw = raw[..BodyLimit]; }
        var text = type.Contains("html") || raw.TrimStart().StartsWith("<") ? Strip(raw) : raw;
        text = Regex.Replace(text, @"[ \t]+\n", "\n");
        text = Regex.Replace(text, @"\n{3,}", "\n\n").Trim();
        var at = 0;
        if (!string.IsNullOrWhiteSpace(find)) {
            var hit = text.IndexOf(find.Trim(), StringComparison.OrdinalIgnoreCase);
            if (hit > TextLimit / 2) { at = hit - TextLimit / 4; }
        }
        var cut = text.Length > at + TextLimit;
        var body = text.Substring(at, Math.Min(TextLimit, text.Length - at));
        return "Page: " + (response.RequestMessage?.RequestUri ?? uri) + "\n" + (response.Content.Headers.ContentType is { } ct ? "Type: " + ct.MediaType + "\n" : "") +
            (at > 0 ? "(From character " + at + ".)\n" : "") + "\n" + body + (cut ? "\n\n[The page goes on; ask with find to read another part.]" : "");
    }

    public const string ClientName = "chat-web";

    private static readonly Regex Drop = new(@"<(script|style|noscript|svg|template)\b[^>]*>.*?</\1\s*>", RegexOptions.Singleline | RegexOptions.IgnoreCase);
    private static readonly Regex Breaks = new(@"</?(p|div|br|li|tr|h[1-6]|section|article|header|footer|ul|ol|table|blockquote|pre|dd|dt)\b[^>]*>", RegexOptions.IgnoreCase);
    private static readonly Regex Tags = new(@"<[^>]+>");
    private static string Strip(string html) {
        var s = Drop.Replace(html, " ");
        s = Breaks.Replace(s, "\n");
        s = Tags.Replace(s, " ");
        s = WebUtility.HtmlDecode(s);
        return Regex.Replace(s, @"[ \t ]{2,}", " ");
    }

    /// <summary>The server's own network is out of bounds: the address
    /// must resolve to public ones only.</summary>
    private static async Task RefuseLocalAsync(Uri uri, CancellationToken cancel) {
        var host = uri.Host.Trim('[', ']');
        if (host.Equals("localhost", StringComparison.OrdinalIgnoreCase) || host.EndsWith(".local", StringComparison.OrdinalIgnoreCase) || host.EndsWith(".internal", StringComparison.OrdinalIgnoreCase) || !host.Contains('.')) {
            throw new InvalidOperationException("web_fetch reads the public internet only.");
        }
        IPAddress[] addresses;
        if (IPAddress.TryParse(host, out var literal)) { addresses = new[] { literal }; }
        else {
            try { addresses = await Dns.GetHostAddressesAsync(host, cancel); }
            catch (Exception ex) when (ex is not OperationCanceledException) { throw new InvalidOperationException("The address " + host + " could not be looked up: " + ex.Message); }
        }
        if (addresses.Length == 0 || addresses.Any(IsLocal)) { throw new InvalidOperationException("web_fetch reads the public internet only."); }
    }

    private static bool IsLocal(IPAddress ip) {
        if (ip.IsIPv4MappedToIPv6) { ip = ip.MapToIPv4(); }
        if (IPAddress.IsLoopback(ip) || ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv6UniqueLocal || ip.Equals(IPAddress.Any) || ip.Equals(IPAddress.IPv6Any)) { return true; }
        if (ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) { return false; }
        var b = ip.GetAddressBytes();
        return b[0] == 10 || b[0] == 127 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168) || (b[0] == 169 && b[1] == 254) || (b[0] == 100 && b[1] >= 64 && b[1] <= 127) || b[0] == 0;
    }
}
