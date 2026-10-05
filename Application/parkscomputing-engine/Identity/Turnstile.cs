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
        [property: JsonPropertyName("error-codes")] string[]? Errors,
        [property: JsonPropertyName("action")] string? Action,
        [property: JsonPropertyName("hostname")] string? Hostname);

    /// <summary>The widget's action on each form, which the widget is drawn
    /// with and the answer must name, so a token earned on one form cannot
    /// be spent on the other.</summary>
    public const string SignInAction = "signin";
    public const string RegisterAction = "register";

    /// <summary>Cloudflare's documented test secrets, which answer success
    /// for a dummy token without an action or this site's hostname; on a
    /// developer's or a test instance the action and hostname are not
    /// checked.</summary>
    private bool TestSecret => _options.TurnstileSecret is { } s && (s.StartsWith("1x0000", StringComparison.Ordinal)
        || s.StartsWith("2x0000", StringComparison.Ordinal) || s.StartsWith("3x0000", StringComparison.Ordinal));

    /// <summary>Whether the token the form sent passes: Cloudflare says it
    /// succeeded, on this form's action, on this site's own hostname, as
    /// Turnstile's integration guide asks. Always true when the challenge is
    /// off.</summary>
    public async Task<bool> PassesAsync(string? token, string? ip, string action) {
        if (!On) { return true; }
        if (string.IsNullOrWhiteSpace(token) || token.Length > 2048) { return false; }
        var form = new Dictionary<string, string> { ["secret"] = _options.TurnstileSecret!, ["response"] = token };
        if (!string.IsNullOrEmpty(ip)) { form["remoteip"] = ip; }
        try {
            using var response = await _http.CreateClient(ClientName).PostAsync(VerifyUrl, new FormUrlEncodedContent(form));
            if (!response.IsSuccessStatusCode) { _log.LogWarning("Turnstile answered {Status}.", (int)response.StatusCode); return false; }
            var answer = await response.Content.ReadFromJsonAsync<Answer>();
            if (answer?.Success != true) { return false; }
            if (TestSecret) { return true; }
            if (!string.Equals(answer.Action, action, StringComparison.Ordinal)) {
                _log.LogWarning("Turnstile token was for another action.");
                return false;
            }
            if (!string.Equals(answer.Hostname, _options.Host, StringComparison.OrdinalIgnoreCase)) {
                _log.LogWarning("Turnstile token was from another hostname.");
                return false;
            }
            return true;
        } catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException) {
            _log.LogWarning(ex, "Turnstile could not be reached.");
            return false;
        }
    }

    public const string Refusal = "The check that you're a person didn't pass. Try again.";
}
