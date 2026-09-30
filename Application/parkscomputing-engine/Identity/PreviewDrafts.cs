using System;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// Unpublished drafts for the Editor's preview (Architecture/admin-and-identity-design.md,
/// A11). A draft is kept in memory for an hour under a random 128-bit token,
/// and the public site renders it at /preview/{token} as the page it would
/// become (Pages/page.cshtml.cs), where an article's scripts run as they will
/// once published, with no admin session anywhere near them.
/// </summary>
public sealed class PreviewDrafts {
    public sealed record Draft(string Slug, string Extension, string Text);

    private static readonly TimeSpan Lifetime = TimeSpan.FromHours(1);
    private static readonly Regex Source = new(@"^content/(?<slug>[A-Za-z0-9_-]+)(?<ext>\.md|\.html)$", RegexOptions.Compiled);
    private readonly IMemoryCache _cache;

    public PreviewDrafts(IMemoryCache cache) { _cache = cache; }

    /// <summary>Keeps a draft of an article's source; null when the path is not one.</summary>
    public string? Keep(string rel, string text) {
        var m = Source.Match(rel ?? "");
        if (!m.Success) {
            return null;
        }
        var token = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(16));
        _cache.Set("preview:" + token, new Draft(m.Groups["slug"].Value, m.Groups["ext"].Value, text), Lifetime);
        return token;
    }

    public Draft? Find(string token) => _cache.TryGetValue("preview:" + token, out Draft? d) ? d : null;
}

/// <summary>Keeps a draft for preview and says where the public site shows it.</summary>
[ApiController]
[Route("api/admin/preview")]
[AllowAnonymous]
[Produces("application/json")]
[AutoValidateAntiforgeryToken]
[EnableRateLimiting(AdminAuthController.RateLimitPolicy)]
public sealed class PreviewController : ControllerBase {
    private readonly PreviewDrafts _drafts;
    private readonly AdminOptions _options;

    public PreviewController(PreviewDrafts drafts, IOptions<AdminOptions> options) { _drafts = drafts; _options = options.Value; }

    public sealed record PreviewRequest(string? Path, string? Text);

    [HttpPost]
    [RequestSizeLimit(4 * 1024 * 1024)]
    public IActionResult Make([FromBody] PreviewRequest body) {
        if (!User.IsInRole(AdminOptions.Role)) {
            return NotFound();
        }
        var token = _drafts.Keep(body.Path ?? "", body.Text ?? "");
        if (token is null) {
            return BadRequest(new { ok = false, error = "Only an article's source under /wwwroot/content can be previewed." });
        }
        // ?frame renders the page without the site's chrome, as a window does.
        return Ok(new { ok = true, url = $"{_options.PublicOrigin.TrimEnd('/')}/preview/{token}?frame" });
    }
}
