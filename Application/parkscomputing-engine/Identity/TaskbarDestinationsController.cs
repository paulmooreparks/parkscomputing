using System;
using System.Security.Claims;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using ParksComputing.Engine.Pages.Models;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Identity;

public sealed record TaskbarDestination(string Id, string Key, string Label, string Glyph, string? Icon,
    bool Command, bool NewWindow = false, string? Href = null, string? Kind = null);

/// <summary>Resolves any reopenable content window through the normal loader.</summary>
[ApiController, Route("api/taskbar/destinations")]
public sealed class TaskbarDestinationsController : ControllerBase {
    private readonly ArticleContentService _content;
    private readonly INavService _nav;
    private readonly AccountMenu _accounts;
    private static readonly Regex Key = new("^[A-Za-z0-9_-]{1,100}$", RegexOptions.Compiled);

    public TaskbarDestinationsController(ArticleContentService content, INavService nav, AccountMenu accounts) {
        _content = content; _nav = nav; _accounts = accounts;
    }

    // These aliases preserve saved identities from the first beta build.
    public static string? KeyOf(string id) => id switch {
        "app-terminal" => "terminal",
        "app-files" => "files",
        "app-editor" => "editor",
        "settings" or "account" => id,
        "article-coincidences" => "coincidences",
        _ => id.StartsWith("window-", StringComparison.Ordinal) && id.Length > 7 ? id[7..] : null
    };

    [HttpGet("{id}")]
    public async Task<IActionResult> Get(string id) {
        Response.Headers.CacheControl = "no-store";
        var key = Key.IsMatch(id) ? KeyOf(id) : null;
        if (key is null || !Key.IsMatch(key) || WindowViewModel.DestinationFor(key) != id) { return NotFound(); }
        var account = await _accounts.StateAsync(HttpContext);
        var currentScope = account.SignedIn ? User.FindFirstValue(ClaimTypes.NameIdentifier) : "guest";
        if (Request.Headers.TryGetValue("X-Taskbar-Scope", out var expectedScope) && expectedScope != currentScope) {
            return Conflict();
        }
        bool forbidden = key switch {
            "account" => !account.Enabled || !account.SignedIn,
            "moderation" => !account.Moderation,
            "logs" or "visits" or "chat" => !account.ServerTools,
            _ => false
        };
        if (forbidden) { return StatusCode(403); }
        var content = _content.LoadBook(key, null) ?? _content.Load(key);
        if (content is null) { return NotFound(); }
        var page = "/page/" + key;
        var node = _nav.GetNavNode(key);
        var icon = _nav.GetRoot().IconOf(page) ?? (content.IsApplet ? null : "/favicon-16x16.png");
        return Ok(new TaskbarDestination(id, key, node?.Title ?? content.Title, content.IsApplet ? "app" : "file", icon,
            content.IsApplet, key == "terminal", content.IsApplet ? null : page, content.IsApplet ? "applet" : "page"));
    }
}
