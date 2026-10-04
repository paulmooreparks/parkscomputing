using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Threading.Tasks;

using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// Sends plain-text mail through Resend's documented HTTP API
/// (POST https://api.resend.com/emails). Without an API key it logs and sends
/// nothing. Callers must cancel undelivered sign-in links.
/// </summary>
public sealed class ResendMailer {
    public const string ClientName = "resend";

    private readonly IHttpClientFactory _clients;
    private readonly EmailOptions _options;
    private readonly ILogger<ResendMailer> _logger;

    public ResendMailer(IHttpClientFactory clients, IOptions<EmailOptions> options, ILogger<ResendMailer> logger) {
        _clients = clients; _options = options.Value; _logger = logger;
    }

    public async Task<bool> SendAsync(string to, string subject, string text) {
        if (string.IsNullOrWhiteSpace(_options.ApiKey) || string.IsNullOrWhiteSpace(_options.From)) {
            _logger.LogWarning("Mail not sent: RESEND_API_KEY or EMAIL_FROM is not set");
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

            _logger.LogError("Resend refused mail: {Status}", (int)response.StatusCode);
            return false;
        }
        catch (Exception ex) {
            _logger.LogError("Resend request failed ({ErrorType})", ex.GetType().Name);
            return false;
        }
    }
}
