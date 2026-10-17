using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// The visual editor's server side (Architecture/wysiwyg-editor-design.md,
/// step 2): the site's one renderer and the document model behind the
/// Editor's Visual and Split views. Like the admin mount, it exists only for
/// the admin who may use the server's tools; anyone else gets 404.
///
///   POST document   { text, slug }  the article as blocks (EditorDocument.Model)
///   POST serialize  { nodes }       each edited block written as Markdown
///   POST inline     { src, slug }   a shortcode written in a line, rendered
///   GET  shortcodes                 the shortcodes, for the insert menu
/// </summary>
[ApiController]
[Route("api/admin/editor")]
[AllowAnonymous]
[Produces("application/json")]
[AutoValidateAntiforgeryToken]
[EnableRateLimiting(AdminFsController.RateLimitPolicy)]
public sealed class EditorController : ControllerBase {
    private readonly EditorDocument _doc;
    private readonly SiteMarkdown _md;
    private readonly UserManager<IdentityUser> _users;
    private readonly AdminSessions _sessions;

    public EditorController(EditorDocument doc, SiteMarkdown md, UserManager<IdentityUser> users, AdminSessions sessions) {
        _doc = doc; _md = md; _users = users; _sessions = sessions;
    }

    private async Task<bool> AdminAsync() {
        if (!User.IsInRole(AdminOptions.Role)) { return false; }
        var me = await _users.GetUserAsync(User);
        return me is not null && await _sessions.MaySignInAsync(me);
    }

    public sealed record DocumentRequest(string? Text, string? Slug);
    public sealed record SerializeRequest(List<JsonObject>? Nodes);
    public sealed record InlineRequest(string? Src, string? Slug);

    [HttpPost("document")]
    [RequestSizeLimit(4 * 1024 * 1024)]
    public async Task<IActionResult> Document([FromBody] DocumentRequest body) {
        if (!await AdminAsync()) { return NotFound(); }
        var m = _doc.Load(body.Text ?? "", body.Slug);
        return Ok(new {
            front = m.Front, lead = m.Lead,
            blocks = m.Blocks.Select(b => new { uid = b.Uid, source = b.Source, gap = b.Gap, rich = b.Rich, node = b.Node, html = b.Html })
        });
    }

    [HttpPost("serialize")]
    [RequestSizeLimit(4 * 1024 * 1024)]
    public async Task<IActionResult> Serialize([FromBody] SerializeRequest body) {
        if (!await AdminAsync()) { return NotFound(); }
        try {
            return Ok(new { markdown = (body.Nodes ?? new List<JsonObject>()).Select(n => _doc.Serialize(n)).ToList() });
        }
        catch (ArgumentException ex) {
            return BadRequest(new { ok = false, error = ex.Message });
        }
    }

    [HttpPost("inline")]
    public async Task<IActionResult> Inline([FromBody] InlineRequest body) {
        if (!await AdminAsync()) { return NotFound(); }
        var src = body.Src ?? "";
        return Ok(new { html = _md.InlineHtml(src, ShortcodeContext.For(_md, body.Slug, editing: true)) });
    }

    [HttpGet("shortcodes")]
    public async Task<IActionResult> Shortcodes() {
        if (!await AdminAsync()) { return NotFound(); }
        return Ok(new {
            shortcodes = _md.Shortcodes.All.Select(d => new {
                name = d.Name, kind = d.Kind.ToString().ToLowerInvariant(), title = d.Title, description = d.Description, example = d.Example,
                @params = d.Params.Select(p => new { name = p.Name, description = p.Description, required = p.Required })
            })
        });
    }
}
