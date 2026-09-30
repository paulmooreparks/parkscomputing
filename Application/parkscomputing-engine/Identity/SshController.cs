using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// SSH from the web terminal (Architecture/admin-and-identity-design.md, A16).
/// The SSH client runs in the admin's browser; this only relays its
/// encrypted bytes to a destination on the configured list, so it never sees
/// a keystroke or a key. It exists only for a signed-in admin on the edit
/// origin, and answers 404 to anyone else, as the rest of the admin API does.
///
/// A connection takes two steps. POST ticket, which needs a passkey tap
/// within the admin's confirmation window and the antiforgery token, returns
/// a ticket good once, for a few seconds, for that session and destination.
/// The WebSocket then opens with the ticket, from the edit origin only. The
/// ticket is there because a browser's WebSocket carries no antiforgery
/// header and shows the page nothing of a refusal.
/// </summary>
[ApiController]
[AllowAnonymous]
[EnableRateLimiting(AdminAuthController.RateLimitPolicy)]
public sealed class SshController : ControllerBase {
    private static readonly string[] Assets = { "ssh.wasm", "wasm_exec.js", "ssh-command.js" };

    private readonly UserManager<IdentityUser> _users;
    private readonly AdminSessions _sessions;
    private readonly SessionPolicy _policy;
    private readonly SshRelays _relays;
    private readonly ServerFiles _files;
    private readonly AdminOptions _admin;
    private readonly IOptionsMonitor<SshOptions> _ssh;
    private readonly ILogger<SshController> _log;
    private readonly IServiceScopeFactory _scopes;

    public SshController(UserManager<IdentityUser> users, AdminSessions sessions, SessionPolicy policy, SshRelays relays,
        ServerFiles files, IOptions<AdminOptions> admin, IOptionsMonitor<SshOptions> ssh, ILogger<SshController> log, IServiceScopeFactory scopes) {
        _users = users; _sessions = sessions; _policy = policy; _relays = relays; _files = files;
        _admin = admin.Value; _ssh = ssh; _log = log; _scopes = scopes;
    }

    private async Task<IdentityUser?> AdminAsync() {
        if (!User.IsInRole(AdminOptions.Role)) {
            return null;
        }
        var me = await _users.GetUserAsync(User);
        return me is not null && await _sessions.MaySignInAsync(me) ? me : null;
    }

    private static string Who(IdentityUser me) => me.Email ?? me.UserName ?? me.Id;

    /// <summary>The client's files, which live outside the web root.</summary>
    [HttpGet("admin/ssh/{file}")]
    public async Task<IActionResult> Asset(string file) {
        if (await AdminAsync() is null || !Assets.Contains(file)) {
            return NotFound();
        }
        var root = _ssh.CurrentValue.AssetsRoot;
        var path = Path.Combine(root, file);
        if (!System.IO.File.Exists(path)) {
            return NotFound();
        }
        /* Kept by the browser, and asked after each time, so a new client
           arrives with the next image and an unchanged one isn't sent again. */
        Response.Headers.CacheControl = "private, no-cache";
        var type = file.EndsWith(".wasm") ? "application/wasm" : "text/javascript; charset=utf-8";
        if (file == "ssh.wasm") {
            /* Sent compressed when the browser takes it: a third the size. */
            var gz = path + ".gz";
            if (System.IO.File.Exists(gz) && Request.Headers.AcceptEncoding.ToString().Contains("gzip", StringComparison.OrdinalIgnoreCase)) {
                Response.Headers.ContentEncoding = "gzip";
                Response.Headers.Vary = "Accept-Encoding";
                path = gz;
            }
        }
        var info = new FileInfo(path);
        var tag = new Microsoft.Net.Http.Headers.EntityTagHeaderValue("\"" + info.Length.ToString("x") + "-" + info.LastWriteTimeUtc.Ticks.ToString("x") + "\"");
        return PhysicalFile(path, type, info.LastWriteTimeUtc, tag);
    }

    /// <summary>Where the terminal may go: each destination's name, login and pinned host keys.</summary>
    [HttpGet("api/admin/ssh/targets")]
    [Produces("application/json")]
    public async Task<IActionResult> Targets() {
        if (await AdminAsync() is null) {
            return NotFound();
        }
        return Ok(new {
            ok = true,
            targets = _ssh.CurrentValue.Targets.Where(t => t.Valid).Select(t => new {
                name = t.Name, user = t.User, description = t.Description,
                addr = t.Host + ":" + t.Port, hostKeys = t.HostKeys
            })
        });
    }

    public sealed record TicketRequest(string? Target);

    [HttpPost("api/admin/ssh/ticket")]
    [Produces("application/json")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Ticket([FromBody] TicketRequest body) {
        var me = await AdminAsync();
        if (me is null) {
            return NotFound();
        }
        var target = _ssh.CurrentValue.Find(body?.Target);
        if (target is null || !target.Valid) {
            return BadRequest(new { ok = false, error = "There is no destination called " + (body?.Target ?? "that") + "." });
        }
        if (!await _sessions.RecentlyConfirmedAsync(User)) {
            return StatusCode(StatusCodes.Status403Forbidden, new { ok = false, confirm = true, error = "Confirm it's you with a passkey first." });
        }
        var sid = User.FindFirst(AdminSessions.SessionClaim)?.Value;
        if (sid is null) {
            return NotFound();
        }
        if (_relays.OpenFor(me.Id) >= _ssh.CurrentValue.MaxSessionsPerAdmin) {
            return StatusCode(StatusCodes.Status429TooManyRequests, new { ok = false, error = "You have as many SSH sessions open as are allowed. Close one first." });
        }
        var ticket = _relays.Issue(new SshRelays.Ticket(me.Id, sid, target.Name));
        return Ok(new { ok = true, ticket, relay = "/api/admin/ssh/relay?ticket=" + ticket });
    }

    [HttpGet("api/admin/ssh/relay")]
    public async Task Relay([FromQuery] string? ticket) {
        var me = await AdminAsync();
        var sid = User.FindFirst(AdminSessions.SessionClaim)?.Value;
        /* A WebSocket can be opened from any page, so the edit origin's own
           pages are the only ones allowed to. */
        var origin = Request.Headers.Origin.ToString();
        bool sameOrigin = string.Equals(origin.TrimEnd('/'), _admin.EditOrigin.TrimEnd('/'), StringComparison.OrdinalIgnoreCase);
        var t = me is null ? null : _relays.Redeem(ticket);
        var target = t is null ? null : _ssh.CurrentValue.Find(t.Target);
        if (me is null || !HttpContext.WebSockets.IsWebSocketRequest || !sameOrigin || t is null
            || t.UserId != me.Id || t.SessionId != sid || target is null || !target.Valid) {
            Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        var who = Who(me);
        var ip = AdminOptions.ClientIp(HttpContext);
        using var tcp = new TcpClient();
        try {
            using var connecting = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            await tcp.ConnectAsync(target.Host, target.Port, connecting.Token);
        } catch (Exception ex) when (ex is SocketException or OperationCanceledException) {
            await _files.AuditAsync(who, ip, "ssh-refused", "ssh", target.Name, ex.Message);
            Response.StatusCode = StatusCodes.Status502BadGateway;
            return;
        }

        using var ws = await HttpContext.WebSockets.AcceptWebSocketAsync();
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(HttpContext.RequestAborted);
        using var tracked = _relays.Track(me.Id, sid!, stop);
        await _files.AuditAsync(who, ip, "ssh-open", "ssh", target.Name, target.Host + ":" + target.Port);
        var clock = Stopwatch.StartNew();
        long up = 0, down = 0;
        string ended = "closed";
        var net = tcp.GetStream();

        /* The relay lives only as long as the admin's session: signing out,
           the absolute limit, or going idle ends it. Typing into it counts
           as using the session. */
        var principal = User;
        var userId = me.Id;
        var watch = Task.Run(async () => {
            while (!stop.IsCancellationRequested) {
                try { await Task.Delay(TimeSpan.FromSeconds(30), stop.Token); } catch (OperationCanceledException) { return; }
                var tm = await _policy.ForAsync(principal);
                if (await AdminSessions.ExpiredAbsoluteAsync(principal, _policy) || _policy.Idle(sid!, tm.IdleMinutes)) {
                    ended = "session ended";
                    stop.Cancel();
                    return;
                }
                /* Revoking an admin, from the server's command line, ends
                   their relays too. A scope of its own gives a fresh read. */
                using var scope = _scopes.CreateScope();
                var sessions = scope.ServiceProvider.GetRequiredService<AdminSessions>();
                var fresh = await scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>().FindByIdAsync(userId);
                if (fresh is null || !await sessions.MaySignInAsync(fresh)) {
                    ended = "admin revoked";
                    stop.Cancel();
                    return;
                }
            }
        });

        var toServer = Task.Run(async () => {
            var buf = new byte[32 * 1024];
            var lastTouch = DateTimeOffset.MinValue;
            while (!stop.IsCancellationRequested) {
                var r = await ws.ReceiveAsync(buf, stop.Token);
                if (r.MessageType == WebSocketMessageType.Close) {
                    return;
                }
                if (r.Count > 0) {
                    await net.WriteAsync(buf.AsMemory(0, r.Count), stop.Token);
                    Interlocked.Add(ref up, r.Count);
                    if (DateTimeOffset.UtcNow - lastTouch > TimeSpan.FromSeconds(30)) {
                        lastTouch = DateTimeOffset.UtcNow;
                        _policy.Touch(sid!, (await _policy.ForAsync(principal)).IdleMinutes);
                    }
                }
            }
        });
        var toBrowser = Task.Run(async () => {
            var buf = new byte[32 * 1024];
            while (!stop.IsCancellationRequested) {
                int n = await net.ReadAsync(buf, stop.Token);
                if (n == 0) {
                    return;
                }
                await ws.SendAsync(buf.AsMemory(0, n), WebSocketMessageType.Binary, true, stop.Token);
                Interlocked.Add(ref down, n);
            }
        });

        try {
            await Task.WhenAny(toServer, toBrowser);
        } catch (Exception ex) {
            _log.LogDebug(ex, "SSH relay to {Target} ended", target.Name);
        }
        stop.Cancel();
        try {
            if (ws.State == WebSocketState.Open) {
                using var closing = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, ended, closing.Token);
            }
        } catch (Exception) { }
        await Task.WhenAll(Quiet(toServer), Quiet(toBrowser), Quiet(watch));
        await _files.AuditAsync(who, ip, "ssh-close", "ssh", target.Name,
            $"{ended}; {clock.Elapsed:hh\\:mm\\:ss}; {Interlocked.Read(ref up)} bytes up, {Interlocked.Read(ref down)} down");
    }

    private static async Task Quiet(Task t) {
        try { await t; } catch (Exception) { }
    }
}
