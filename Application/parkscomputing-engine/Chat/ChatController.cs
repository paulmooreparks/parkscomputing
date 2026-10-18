using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.Chat;

/// <summary>
/// The chat's server side (Architecture/chat-design.md), the service the
/// Chat applet reaches as pudlHost.service('chat'). It is the staff's alone:
/// every call needs an Admin or SuperAdmin on a live session, as the server's
/// other tools do, and anyone else gets 404. The site's tools are offered in the
/// super-user's chats only, since they act as the super-user.
///
///   GET    providers                      the providers and their models, and whether tools are offered
///   GET    conversations                  the reader's conversations, newest first
///   POST   conversations                  { provider?, model? } a new one
///   GET    conversations/{id}             the conversation, with the reply in progress (State)
///   PATCH  conversations/{id}             { title?, provider?, model?, thinking?, tools? }
///   DELETE conversations/{id}
///   POST   conversations/{id}/messages    { text, attachments?, mode: send|queue|steer }
///   POST   conversations/{id}/stop        stops the reply and empties the queue
///   DELETE conversations/{id}/queue
///   POST   conversations/{id}/answer      { key, optionId } a tool's permission question
///   GET    conversations/{id}/events      the conversation's events, as server-sent events
/// </summary>
[ApiController]
[Route("api/admin/chat")]
[AllowAnonymous]
[Produces("application/json")]
[AutoValidateAntiforgeryToken]
[EnableRateLimiting(AdminFsController.RateLimitPolicy)]
public sealed class ChatController : ControllerBase {
    public const long AttachmentLimit = 8 * 1024 * 1024;
    private static readonly string[] ImageTypes = { "image/png", "image/jpeg", "image/gif", "image/webp" };

    private readonly ChatStore _store;
    private readonly ChatSettings _settings;
    private readonly ChatTurns _turns;
    private readonly ChatTools _tools;
    private readonly StaffAccess _staff;
    private readonly UserManager<IdentityUser> _users;
    private readonly IHttpClientFactory _http;

    public ChatController(ChatStore store, ChatSettings settings, ChatTurns turns, ChatTools tools, StaffAccess staff, UserManager<IdentityUser> users, IHttpClientFactory http) {
        _store = store; _settings = settings; _turns = turns; _tools = tools; _staff = staff; _users = users; _http = http;
    }

    /// <summary>The reader, when they may use the chat, with their home's
    /// name: an Admin or SuperAdmin on a live session, the bar the server's
    /// other tools (Files, the Editor, the Terminal) hold to.</summary>
    private async Task<(IdentityUser User, string Home)?> ReaderAsync() {
        if (User.Identity?.IsAuthenticated != true || !await _staff.AllowedAsync(User, confirmed: false)) { return null; }
        var me = await _users.GetUserAsync(User);
        return me is null ? null : (me, ServerFiles.HomeNameOf(me));
    }

    private Task<bool> ToolsAllowedAsync() => _staff.SuperuserAsync(User, confirmed: false);

    [HttpGet("providers")]
    public async Task<IActionResult> Providers(CancellationToken cancel) {
        if (await ReaderAsync() is null) { return NotFound(); }
        var (config, error) = _settings.Read();
        var list = new JsonArray();
        foreach (var p in config.Providers) {
            IReadOnlyList<string> models = p.Models ?? new List<string>();
            string? problem = null;
            if (models.Count == 0) {
                try {
                    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancel);
                    timeout.CancelAfter(TimeSpan.FromSeconds(8));
                    models = await ChatProviders.For(p, _http.CreateClient(ChatProviders.ClientName)).ModelsAsync(timeout.Token);
                }
                catch (Exception ex) when (ex is ProviderException or HttpRequestException or OperationCanceledException) { problem = "Its models could not be listed: " + ex.Message; }
            }
            if (!string.IsNullOrWhiteSpace(p.KeyEnv) && string.IsNullOrEmpty(p.Key)) { problem = "The server has no " + p.KeyEnv + " for its key."; }
            list.Add(new JsonObject {
                ["id"] = p.Id, ["name"] = p.Label, ["kind"] = p.Kind,
                ["models"] = new JsonArray(models.Select(m => (JsonNode)m).ToArray()), ["problem"] = problem
            });
        }
        return Ok(new JsonObject {
            ["providers"] = list, ["defaultProvider"] = config.DefaultProvider ?? config.Providers.FirstOrDefault()?.Id,
            ["defaultModel"] = config.DefaultModel, ["error"] = error,
            ["tools"] = _tools.Available && await ToolsAllowedAsync(), ["settings"] = "/etc/" + ChatSettings.FileName
        });
    }

    [HttpGet("conversations")]
    public async Task<IActionResult> List() {
        if (await ReaderAsync() is not { } me) { return NotFound(); }
        Response.Headers.CacheControl = "no-store";
        return Ok(_store.List(me.Home).Select(s => new { id = s.Id, title = s.Title, provider = s.Provider, model = s.Model, updated = s.Updated, working = _turns.Working(me.Home, s.Id) }));
    }

    public sealed record NewRequest(string? Provider, string? Model);

    [HttpPost("conversations")]
    public async Task<IActionResult> Create([FromBody] NewRequest body) {
        if (await ReaderAsync() is not { } me) { return NotFound(); }
        var (config, _) = _settings.Read();
        var provider = config.Find(body.Provider) ?? config.Find(config.DefaultProvider) ?? config.Providers.FirstOrDefault();
        var now = DateTimeOffset.UtcNow;
        var c = new Conversation {
            Id = ChatStore.NewId(), Created = now, Updated = now, Provider = provider?.Id ?? "",
            Model = !string.IsNullOrWhiteSpace(body.Model) ? body.Model! : (provider is not null && provider.Id == config.DefaultProvider ? config.DefaultModel : null) ?? provider?.Models?.FirstOrDefault() ?? ""
        };
        await _store.SaveAsync(me.Home, c);
        return Ok(c);
    }

    [HttpGet("conversations/{id}")]
    public async Task<IActionResult> Get(string id) {
        if (await ReaderAsync() is not { } me) { return NotFound(); }
        // The state first: an event after it is in the stored conversation
        // or later, never lost between the two.
        var state = _turns.State(me.Home, id);
        var c = _store.Read(me.Home, id);
        if (c is null) { return NotFound(); }
        Response.Headers.CacheControl = "no-store";
        var o = ChatTurns.ToJson(c).AsObject();
        o["state"] = state;
        return Ok(o);
    }

    public sealed record PatchRequest(string? Title, string? Provider, string? Model, bool? Thinking, bool? Tools);

    [HttpPatch("conversations/{id}")]
    public async Task<IActionResult> Patch(string id, [FromBody] PatchRequest body) {
        if (await ReaderAsync() is not { } me) { return NotFound(); }
        var c = _store.Read(me.Home, id);
        if (c is null) { return NotFound(); }
        if (_turns.Working(me.Home, id)) { return Conflict(new { error = "Wait for the reply to finish." }); }
        if (body.Title is { } t && t.Trim().Length > 0) { c.Title = t.Trim().Length > 120 ? t.Trim()[..120] : t.Trim(); }
        if (body.Provider is { } p) {
            var (config, _) = _settings.Read();
            if (config.Find(p) is null) { return BadRequest(new { error = "There is no provider called " + p + "." }); }
            c.Provider = config.Find(p)!.Id;
        }
        if (body.Model is { } m) { c.Model = m.Trim(); }
        if (body.Thinking is { } th) { c.Thinking = th; }
        if (body.Tools is { } tl) { c.Tools = tl; }
        c.Updated = DateTimeOffset.UtcNow;
        await _store.SaveAsync(me.Home, c);
        return Ok(new { id = c.Id, title = c.Title, provider = c.Provider, model = c.Model, thinking = c.Thinking, tools = c.Tools });
    }

    [HttpDelete("conversations/{id}")]
    public async Task<IActionResult> Delete(string id) {
        if (await ReaderAsync() is not { } me) { return NotFound(); }
        _turns.Stop(me.Home, id);
        return _store.Delete(me.Home, id) ? NoContent() : NotFound();
    }

    public sealed record Attachment(string? Name, string? Type, string? Text, string? Data);
    public sealed record SendRequest(string? Text, List<Attachment>? Attachments, string? Mode);

    [HttpPost("conversations/{id}/messages")]
    [RequestSizeLimit(12 * 1024 * 1024)]
    public async Task<IActionResult> Send(string id, [FromBody] SendRequest body) {
        if (await ReaderAsync() is not { } me) { return NotFound(); }
        if (_store.Read(me.Home, id) is null) { return NotFound(); }
        var parts = new List<ChatPart>(); long size = 0;
        foreach (var a in body.Attachments ?? new List<Attachment>()) {
            var name = string.IsNullOrWhiteSpace(a.Name) ? "untitled" : a.Name!.Trim();
            if (a.Data is { Length: > 0 } data) {
                if (!ImageTypes.Contains(a.Type)) { return BadRequest(new { error = name + " is not a picture the chat can send (PNG, JPEG, GIF or WebP)." }); }
                size += data.Length * 3L / 4;
                parts.Add(new ChatPart { Type = "image", Name = name, MediaType = a.Type, Data = data });
            }
            else if (a.Text is { } text) {
                size += text.Length;
                parts.Add(new ChatPart { Type = "file", Name = name, Text = text });
            }
        }
        if (size > AttachmentLimit) { return BadRequest(new { error = "The attachments come to more than 8 MB." }); }
        if (string.IsNullOrWhiteSpace(body.Text) && parts.Count == 0) { return BadRequest(new { error = "There is nothing to send." }); }
        var send = new ChatSend(body.Text?.Trim() ?? "", parts, me.User, Request.Host.Value ?? "localhost", await ToolsAllowedAsync());
        var mode = body.Mode is "queue" or "steer" ? body.Mode : "send";
        return Ok(new { outcome = _turns.Send(me.Home, id, send, mode) });
    }

    [HttpPost("conversations/{id}/stop")]
    public async Task<IActionResult> Stop(string id) {
        if (await ReaderAsync() is not { } me) { return NotFound(); }
        _turns.Stop(me.Home, id);
        return NoContent();
    }

    [HttpDelete("conversations/{id}/queue")]
    public async Task<IActionResult> Unqueue(string id) {
        if (await ReaderAsync() is not { } me) { return NotFound(); }
        _turns.Unqueue(me.Home, id);
        return NoContent();
    }

    public sealed record AnswerRequest(string? Key, string? OptionId);

    [HttpPost("conversations/{id}/answer")]
    public async Task<IActionResult> Answer(string id, [FromBody] AnswerRequest body) {
        if (await ReaderAsync() is not { } me) { return NotFound(); }
        return _turns.Answer(me.Home, id, body.Key ?? "", body.OptionId ?? "reject") ? NoContent() : NotFound(new { error = "That question was already answered." });
    }

    /// <summary>The conversation's events, as server-sent events, with a comment every 20 seconds to keep the line open.</summary>
    [HttpGet("conversations/{id}/events")]
    [Produces("text/event-stream")]
    public async Task Events(string id, CancellationToken cancel) {
        if (await ReaderAsync() is not { } me || !ChatStore.ValidId(id)) { Response.StatusCode = 404; return; }
        Response.Headers.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache, no-store";
        Response.Headers["X-Accel-Buffering"] = "no";
        var (events, leave) = _turns.Subscribe(me.Home, id);
        try {
            await Response.WriteAsync(": open\n\n", cancel);
            await Response.Body.FlushAsync(cancel);
            while (!cancel.IsCancellationRequested) {
                using var wait = CancellationTokenSource.CreateLinkedTokenSource(cancel);
                wait.CancelAfter(TimeSpan.FromSeconds(20));
                string text;
                try { text = await events.ReadAsync(wait.Token); }
                catch (OperationCanceledException) when (!cancel.IsCancellationRequested) {
                    await Response.WriteAsync(": keep\n\n", cancel); await Response.Body.FlushAsync(cancel); continue;
                }
                await Response.WriteAsync("data: " + text + "\n\n", cancel);
                await Response.Body.FlushAsync(cancel);
            }
        }
        catch (OperationCanceledException) { }
        finally { leave(); }
    }
}
