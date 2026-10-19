using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

using ParksComputing.Engine.Chat;
using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.Poker;

/// <summary>
/// Poker's server side (Architecture/poker-design.md), the service the
/// Poker applet reaches as pudlHost.service('poker'). Stage 1 is the
/// staff's alone, as the chat is: an Admin or SuperAdmin on a live session,
/// and anyone else gets 404. A table is its owner's, in their ~/.poker, and
/// only they see it.
///
///   GET    providers               the chat's providers and their models, for the seats
///   GET    tables                  the reader's tables, newest first
///   POST   tables                  { title?, seats: [{ kind, provider?, model?, thinking?, name?, bio? }], startingStack?, smallBlind?, bigBlind?, paceMs?, turnSeconds? }
///   GET    tables/{id}             the table as the reader may see it
///   PATCH  tables/{id}             { title?, reveal?, paceMs?, turnSeconds? }
///   DELETE tables/{id}
///   POST   tables/{id}/play        starts or resumes play
///   POST   tables/{id}/pause       pauses when the hand in progress ends
///   POST   tables/{id}/seats       { kind, provider?, model?, thinking?, name?, bio? } a player joins at the next hand
///   POST   tables/{id}/end         { on } ends the game for good when the hand in progress ends
///   POST   tables/{id}/seats/{n}/leave  { on } the seat leaves with its chips when the hand ends
///   POST   tables/{id}/move        { kind: fold|check|call|raise, to? } the person's move
///   GET    tables/{id}/events      a server-sent event at every change
/// </summary>
[ApiController]
[Route("api/admin/poker")]
[AllowAnonymous]
[Produces("application/json")]
[AutoValidateAntiforgeryToken]
[EnableRateLimiting(AdminFsController.RateLimitPolicy)]
public sealed class PokerController : ControllerBase {
    private readonly PokerStore _store;
    private readonly PokerRunner _runner;
    private readonly ChatSettings _settings;
    private readonly ChatSelf _self;
    private readonly StaffAccess _staff;
    private readonly UserManager<IdentityUser> _users;

    public PokerController(PokerStore store, PokerRunner runner, ChatSettings settings, ChatSelf self, StaffAccess staff, UserManager<IdentityUser> users) {
        _store = store; _runner = runner; _settings = settings; _self = self; _staff = staff; _users = users;
    }

    private async Task<string?> HomeAsync() {
        if (User.Identity?.IsAuthenticated != true || !await _staff.AllowedAsync(User, confirmed: false)) { return null; }
        var me = await _users.GetUserAsync(User);
        return me is null ? null : ServerFiles.HomeNameOf(me);
    }

    [HttpGet("providers")]
    public async Task<IActionResult> Providers(CancellationToken cancel) {
        if (await HomeAsync() is null) { return NotFound(); }
        var (config, error) = _settings.Read();
        return Ok(await _self.ProvidersAsync(config, error, false, cancel));
    }

    [HttpGet("tables")]
    public async Task<IActionResult> List() {
        if (await HomeAsync() is not { } home) { return NotFound(); }
        Response.Headers.CacheControl = "no-store";
        return Ok(_store.List(home).Select(t => new {
            id = t.Id, title = t.Title, status = t.Status, hands = t.Hands, updated = t.Updated,
            seats = t.Seats.Select(s => new { name = s.Label, kind = s.Kind, model = s.Model, stack = s.Stack })
        }));
    }

    public sealed record SeatRequest(string? Kind, string? Provider, string? Model, bool? Thinking, string? Name, string? Bio);
    public sealed record NewTable(string? Title, List<SeatRequest>? Seats, int? StartingStack, int? SmallBlind, int? BigBlind, int? PaceMs, int? TurnSeconds);

    private static string? Words(string? s, int max) {
        if (string.IsNullOrWhiteSpace(s)) { return null; }
        s = s.Trim();
        return s.Length > max ? s[..max] : s;
    }

    [HttpPost("tables")]
    public async Task<IActionResult> Create([FromBody] NewTable body) {
        if (await HomeAsync() is not { } home) { return NotFound(); }
        var seats = body.Seats ?? new List<SeatRequest>();
        if (seats.Count < 2 || seats.Count > PokerTable.MaxSeats) { return BadRequest(new { error = "A table has two to six seats." }); }
        if (seats.Count(s => s.Kind == "person") > 1) { return BadRequest(new { error = "Only you can sit at your table, so at most one seat is a person." }); }
        var stack = Math.Clamp(body.StartingStack ?? 1000, 100, 1_000_000);
        var bb = Math.Clamp(body.BigBlind ?? Math.Max(2, stack / 50), 2, stack / 2);
        var sb = Math.Clamp(body.SmallBlind ?? bb / 2, 1, bb);
        var table = new PokerTable {
            Id = PokerStore.NewId(), Title = Words(body.Title, 80) ?? "Table " + DateTime.UtcNow.ToString("d MMM HH:mm"),
            Created = DateTimeOffset.UtcNow, Updated = DateTimeOffset.UtcNow,
            StartingStack = stack, SmallBlind = sb, BigBlind = bb,
            PaceMs = Math.Clamp(body.PaceMs ?? 1500, 0, 30_000), TurnSeconds = Math.Clamp(body.TurnSeconds ?? 120, 15, 900)
        };
        foreach (var s in seats) {
            var (seat, why) = SeatFrom(s, stack);
            if (seat is null) { return BadRequest(new { error = why }); }
            table.Seats.Add(seat);
        }
        await _runner.CreateAsync(home, table);
        return Ok(_runner.View(home, table.Id));
    }

    /// <summary>A seat as the reader asked for it, with the chips it sits
    /// down with, or why it cannot be.</summary>
    private (PokerSeat? Seat, string? Why) SeatFrom(SeatRequest s, int stack) {
        if (s.Kind == "person") {
            return (new PokerSeat { Kind = "person", Name = Words(s.Name, 24) ?? "You", Bio = Words(s.Bio, 400), Stack = stack, BuyIn = stack, Introduced = true }, null);
        }
        var (config, _) = _settings.Read();
        var p = config.Find(s.Provider);
        if (p is null) { return (null, "There is no provider called " + (s.Provider ?? "(none)") + "."); }
        if (string.IsNullOrWhiteSpace(s.Model)) { return (null, "Each model seat needs a model."); }
        return (new PokerSeat {
            Kind = "model", Provider = p.Id, Model = s.Model!.Trim(), Thinking = s.Thinking ?? false,
            Name = Words(s.Name, 24) ?? "", Bio = Words(s.Bio, 400), Stack = stack, BuyIn = stack
        }, null);
    }

    /// <summary>A new player, with the table's starting chips: seated now
    /// between hands, or when the hand in progress ends.</summary>
    [HttpPost("tables/{id}/seats")]
    public async Task<IActionResult> AddSeat(string id, [FromBody] SeatRequest body) {
        if (await HomeAsync() is not { } home || _runner.Table(home, id) is not { } table) { return NotFound(); }
        var (seat, why) = SeatFrom(body, table.StartingStack);
        if (seat is null) { return BadRequest(new { error = why }); }
        why = await _runner.JoinAsync(home, id, seat);
        return why is null ? Ok(_runner.View(home, id)) : Conflict(new { error = why });
    }

    [HttpGet("tables/{id}")]
    public async Task<IActionResult> Get(string id) {
        if (await HomeAsync() is not { } home || _runner.Table(home, id) is null) { return NotFound(); }
        Response.Headers.CacheControl = "no-store";
        return Ok(_runner.View(home, id));
    }

    public sealed record TablePatch(string? Title, bool? Reveal, int? PaceMs, int? TurnSeconds);

    [HttpPatch("tables/{id}")]
    public async Task<IActionResult> Patch(string id, [FromBody] TablePatch body) {
        if (await HomeAsync() is not { } home || _runner.Table(home, id) is null) { return NotFound(); }
        await _runner.UpdateAsync(home, id, t => {
            if (Words(body.Title, 80) is { } title) { t.Title = title; }
            if (body.Reveal is { } r) { t.Reveal = r; }
            if (body.PaceMs is { } pace) { t.PaceMs = Math.Clamp(pace, 0, 30_000); }
            if (body.TurnSeconds is { } turn) { t.TurnSeconds = Math.Clamp(turn, 15, 900); }
        });
        return Ok(_runner.View(home, id));
    }

    [HttpDelete("tables/{id}")]
    public async Task<IActionResult> Delete(string id) {
        if (await HomeAsync() is not { } home) { return NotFound(); }
        return await _runner.DeleteAsync(home, id) ? NoContent() : NotFound();
    }

    [HttpPost("tables/{id}/play")]
    public async Task<IActionResult> Play(string id) {
        if (await HomeAsync() is not { } home || _runner.Table(home, id) is null) { return NotFound(); }
        var why = await _runner.PlayAsync(home, id);
        return why is null ? Ok(_runner.View(home, id)) : Conflict(new { error = why });
    }

    [HttpPost("tables/{id}/pause")]
    public async Task<IActionResult> Pause(string id) {
        if (await HomeAsync() is not { } home || _runner.Table(home, id) is null) { return NotFound(); }
        await _runner.PauseAsync(home, id);
        return Ok(_runner.View(home, id));
    }

    public sealed record Choice(bool? On);

    /// <summary>{ on: true } ends the game when the hand in progress ends
    /// (or now, between hands); { on: false } takes that back.</summary>
    [HttpPost("tables/{id}/end")]
    public async Task<IActionResult> End(string id, [FromBody] Choice body) {
        if (await HomeAsync() is not { } home || _runner.Table(home, id) is null) { return NotFound(); }
        var why = await _runner.EndAsync(home, id, body.On != false);
        return why is null ? Ok(_runner.View(home, id)) : Conflict(new { error = why });
    }

    /// <summary>{ on: true } a seat leaves with its chips when the hand in
    /// progress ends (or now, between hands); { on: false } it stays.</summary>
    [HttpPost("tables/{id}/seats/{seat:int}/leave")]
    public async Task<IActionResult> Leave(string id, int seat, [FromBody] Choice body) {
        if (await HomeAsync() is not { } home || _runner.Table(home, id) is null) { return NotFound(); }
        var why = await _runner.LeaveAsync(home, id, seat, body.On != false);
        return why is null ? Ok(_runner.View(home, id)) : Conflict(new { error = why });
    }

    public sealed record MoveRequest(string? Kind, int? To);

    [HttpPost("tables/{id}/move")]
    public async Task<IActionResult> Move(string id, [FromBody] MoveRequest body) {
        if (await HomeAsync() is not { } home || _runner.Table(home, id) is null) { return NotFound(); }
        var why = _runner.Move(home, id, new PokerMove((body.Kind ?? "").Trim().ToLowerInvariant(), body.To));
        return why is null ? NoContent() : Conflict(new { error = why });
    }

    /// <summary>A server-sent event at each change to the table, with a
    /// comment every 20 seconds to keep the line open. The page reads the
    /// table again when one arrives.</summary>
    [HttpGet("tables/{id}/events")]
    [Produces("text/event-stream")]
    public async Task Events(string id, CancellationToken cancel) {
        if (await HomeAsync() is not { } home || _runner.Subscribe(home, id, long.TryParse(Request.Headers["Last-Event-ID"].FirstOrDefault(), out var last) ? last : -1) is not { } sub) {
            Response.StatusCode = 404; return;
        }
        Response.Headers.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache, no-store";
        Response.Headers["X-Accel-Buffering"] = "no";
        try {
            await Response.WriteAsync(": open\n\n", cancel);
            await Response.Body.FlushAsync(cancel);
            while (!cancel.IsCancellationRequested) {
                using var wait = CancellationTokenSource.CreateLinkedTokenSource(cancel);
                wait.CancelAfter(TimeSpan.FromSeconds(20));
                (long Seq, string Text) e;
                try { e = await sub.Events.ReadAsync(wait.Token); }
                catch (OperationCanceledException) when (!cancel.IsCancellationRequested) {
                    await Response.WriteAsync(": keep\n\n", cancel); await Response.Body.FlushAsync(cancel); continue;
                }
                await Response.WriteAsync("id: " + e.Seq + "\ndata: " + e.Text + "\n\n", cancel);
                await Response.Body.FlushAsync(cancel);
            }
        }
        catch (OperationCanceledException) { }
        finally { sub.Leave(); }
    }
}
