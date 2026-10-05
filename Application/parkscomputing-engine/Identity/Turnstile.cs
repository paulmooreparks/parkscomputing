using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// Cloudflare Turnstile on Create account and on asking for a sign-in link
/// (Architecture/unified-identity-design.md, "Gaps closed before sign-up
/// opens"). The form carries the widget's token, and the server checks it
/// with Cloudflare's documented siteverify call before any email is sent.
/// A token is good once, for five minutes. Without a site key and secret
/// there is no challenge, as on a developer's machine. If Cloudflare cannot
/// be reached the request is refused, since letting it through would undo
/// the challenge.
/// </summary>
public sealed class Turnstile {
    public const string ClientName = "turnstile";
    public const string FieldName = "cf-turnstile-response";
    public const string Origin = "https://challenges.cloudflare.com";
    private const string VerifyUrl = Origin + "/turnstile/v0/siteverify";
    private readonly IHttpClientFactory _http; private readonly AccountOptions _options; private readonly ILogger<Turnstile> _log;
    public Turnstile(IHttpClientFactory http, IOptions<AccountOptions> options, ILogger<Turnstile> log) { _http = http; _options = options.Value; _log = log; }

    public bool On => _options.Challenge;
    public string? SiteKey => _options.TurnstileSiteKey;

    private sealed record Answer([property: JsonPropertyName("success")] bool Success,
        [property: JsonPropertyName("error-codes")] string[]? Errors);

    /// <summary>Whether the token the form sent passes; always true when the
    /// challenge is off.</summary>
    public async Task<bool> PassesAsync(string? token, string? ip) {
        if (!On) { return true; }
        if (string.IsNullOrWhiteSpace(token) || token.Length > 2048) { return false; }
        var form = new Dictionary<string, string> { ["secret"] = _options.TurnstileSecret!, ["response"] = token };
        if (!string.IsNullOrEmpty(ip)) { form["remoteip"] = ip; }
        try {
            using var response = await _http.CreateClient(ClientName).PostAsync(VerifyUrl, new FormUrlEncodedContent(form));
            if (!response.IsSuccessStatusCode) { _log.LogWarning("Turnstile answered {Status}.", (int)response.StatusCode); return false; }
            var answer = await response.Content.ReadFromJsonAsync<Answer>();
            return answer?.Success == true;
        } catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException) {
            _log.LogWarning(ex, "Turnstile could not be reached.");
            return false;
        }
    }

    public const string Refusal = "The check that you're a person didn't pass. Try again.";
}
