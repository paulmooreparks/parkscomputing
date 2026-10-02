using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;

namespace ParksComputing.Engine.Controllers;

// This connector has one fixed provider. It cannot fetch a user-supplied URL.
[ApiController]
[Route("api/barcode-products/open-food-facts")]
public class BarcodeProductsController : ControllerBase {
    private readonly IHttpClientFactory clients;
    private static readonly object Gate = new();
    private static readonly Queue<DateTimeOffset> Requests = new();
    private static DateTimeOffset blockedUntil;
    public BarcodeProductsController(IHttpClientFactory clients) { this.clients = clients; }

    public static bool Eligible(string code) {
        if (!Regex.IsMatch(code, "^(?:[0-9]{8}|[0-9]{12}|[0-9]{13})$")) return false;
        int sum = 0;
        for (int i = code.Length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) sum += (code[i] - '0') * weight;
        if ((10 - sum % 10) % 10 != code[^1] - '0') return false;
        var ean = code.Length == 12 ? "0" + code : code;
        return ean.Length == 8 ? !Regex.IsMatch(ean, "^[02]") : !Regex.IsMatch(ean, "^(02|04|2|978|979|977|98|99)");
    }

    [HttpGet("{code}")]
    public async Task<IActionResult> Get(string code, CancellationToken ct) {
        Response.Headers.CacheControl = "no-store";
        if (!Eligible(code)) return BadRequest(new { error = "A valid unrestricted EAN/UPC product identifier is required." });
        var now = DateTimeOffset.UtcNow;
        int retry = 0;
        lock (Gate) {
            while (Requests.Count > 0 && Requests.Peek() <= now.AddMinutes(-1)) Requests.Dequeue();
            if (blockedUntil > now) retry = (int)Math.Ceiling((blockedUntil - now).TotalSeconds);
            else if (Requests.Count >= 15) retry = Math.Max(1, (int)Math.Ceiling((Requests.Peek().AddMinutes(1) - now).TotalSeconds));
            else Requests.Enqueue(now);
        }
        if (retry > 0) { Response.Headers.RetryAfter = retry.ToString(); return StatusCode(429, new { error = "Lookup rate limit reached." }); }
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(12));
        try {
            var client = clients.CreateClient("barcode-open-food-facts");
            using var request = new HttpRequestMessage(HttpMethod.Get,
                "https://world.openfoodfacts.org/api/v3/product/" + code + "?product_type=food&fields=code,product_name,brands,quantity,ingredients_text");
            request.Headers.UserAgent.ParseAdd("ParksComputingBarcodeScanner/1.0 (+https://www.parkscomputing.com)");
            request.Headers.Accept.ParseAdd("application/json");
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            if (response.StatusCode == HttpStatusCode.TooManyRequests) {
                var until = response.Headers.RetryAfter?.Date ?? now.Add(response.Headers.RetryAfter?.Delta ?? TimeSpan.FromMinutes(1));
                lock (Gate) { blockedUntil = until > now ? until : now.AddMinutes(1); }
                Response.Headers.RetryAfter = Math.Max(1, (int)Math.Ceiling((blockedUntil - now).TotalSeconds)).ToString();
                return StatusCode(429, new { error = "The provider is rate limited." });
            }
            // The provider documents 404 as a missing product for this resource.
            if (response.StatusCode == HttpStatusCode.NotFound) return Ok(new { found = false });
            if (!response.IsSuccessStatusCode) return StatusCode(502, new { error = "The product provider is unavailable." });
            if (!(response.Content.Headers.ContentType?.MediaType?.Contains("json", StringComparison.OrdinalIgnoreCase) ?? false)) return StatusCode(502, new { error = "The provider did not return JSON." });
            using var input = await response.Content.ReadAsStreamAsync(timeout.Token);
            using var buffer = new MemoryStream();
            var chunk = new byte[8192];
            int count;
            while ((count = await input.ReadAsync(chunk, timeout.Token)) > 0) {
                if (buffer.Length + count > 2 * 1024 * 1024) return StatusCode(502, new { error = "The provider response is too large." });
                buffer.Write(chunk, 0, count);
            }
            using var json = JsonDocument.Parse(buffer.ToArray());
            if (!json.RootElement.TryGetProperty("product", out var product) || product.ValueKind != JsonValueKind.Object)
                return StatusCode(502, new { error = "The provider response has no product record." });
            var fields = new Dictionary<string, string>();
            foreach (var key in new[] { "product_name", "brands", "quantity", "ingredients_text" }) {
                if (product.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String) fields[key] = value.GetString()!;
            }
            if (!fields.TryGetValue("product_name", out var name) || string.IsNullOrWhiteSpace(name)) fields["product_name"] = "Product " + code;
            return Ok(new { found = true, product = fields, links = new { source = "https://world.openfoodfacts.org/product/" + code, self = "/api/barcode-products/open-food-facts/" + code } });
        } catch (OperationCanceledException) when (!ct.IsCancellationRequested) {
            return StatusCode(504, new { error = "The product provider timed out." });
        } catch (HttpRequestException) {
            return StatusCode(502, new { error = "The product provider could not be reached." });
        } catch (JsonException) {
            return StatusCode(502, new { error = "The provider returned invalid JSON." });
        } catch (IOException) {
            return StatusCode(502, new { error = "The provider response was interrupted." });
        }
    }
}
