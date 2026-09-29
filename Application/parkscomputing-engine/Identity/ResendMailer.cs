using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Threading.Tasks;

using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// Sends plain-text mail through Resend's documented HTTP API
/// (POST https://api.resend.com/emails). Without an API key it logs and sends
/// nothing, so a missing key never stops a sign-in, only its notice.
/// </summary>
public sealed class ResendMailer {
    public const string ClientName = "resend";

    private readonly IHttpClientFactory _clients;
    private readonly EmailOptions _options;
    private readonly ILogger<ResendMailer> _logger;

    private readonly bool _development;

    public ResendMailer(IHttpClientFactory clients, IOptions<EmailOptions> options, ILogger<ResendMailer> logger, IHostEnvironment environment) {
        _clients = clients; _options = options.Value; _logger = logger; _development = environment.IsDevelopment();
    }

    public async Task<bool> SendAsync(string to, string subject, string text) {
        if (string.IsNullOrWhiteSpace(_options.ApiKey) || string.IsNullOrWhiteSpace(_options.From)) {
            // In development the message itself is logged, so a sign-in link
            // can be followed without sending mail. Never in production,
            // where it would put live links in the logs.
            if (_development) {
                _logger.LogWarning("Mail to {To} not sent (no RESEND_API_KEY): {Subject}\n{Text}", to, subject, text);
            } else {
                _logger.LogWarning("Mail to {To} not sent: RESEND_API_KEY or EMAIL_FROM is not set ({Subject})", to, subject);
            }
            return false;
        }

        var client = _clients.CreateClient(ClientName);
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.resend.com/emails") {
            Content = JsonContent.Create(new {
                from = _options.From,
                to = new[] { to },
                subject,
                text,
                reply_to = string.IsNullOrWhiteSpace(_options.ReplyTo) ? null : _options.ReplyTo
            })
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiKey);

        try {
            using var response = await client.SendAsync(request);
            if (response.IsSuccessStatusCode) {
                return true;
            }

            _logger.LogError("Resend refused mail to {To}: {Status} {Body}", to, (int)response.StatusCode, await response.Content.ReadAsStringAsync());
            return false;
        }
        catch (Exception ex) {
            _logger.LogError(ex, "Resend could not be reached for mail to {To}", to);
            return false;
        }
    }
}
