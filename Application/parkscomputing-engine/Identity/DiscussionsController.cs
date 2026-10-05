using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// Article discussions for the comments applet (js/comments.js) and a
/// member's own comments for the Account applet
/// (Architecture/unified-identity-design.md, step 2). Every answer is drawn
/// for the reader asking, so none may be cached. A change answers 401 with
/// signin: true when the session has gone, as the server tools do, so the
/// page can ask the reader to sign in again and retry.
/// </summary>
[ApiController, AutoValidateAntiforgeryToken]
public sealed class DiscussionsController : ControllerBase {
    private readonly Discussions _discussions; private readonly UserManager<IdentityUser> _users;
    private readonly StaffAccess _staff; private readonly SessionPolicy _policy; private readonly AccountOptions _options;
    public DiscussionsController(Discussions discussions, UserManager<IdentityUser> users, StaffAccess staff, SessionPolicy policy,
        IOptions<AccountOptions> options, IOptions<CommentOptions> comments) {
        _discussions = discussions; _users = users; _staff = staff; _policy = policy;
        // Without comments, every endpoint here answers 404, as without accounts.
        _options = new AccountOptions { Enabled = options.Value.Enabled && comments.Value.Enabled };
    }

    public sealed record NewComment(Guid? ParentId, string? Source, string? Key);
    public sealed record Change(string? Source, string? Version);
    public sealed record Report(string? Reason);

    private async Task<string?> ReaderAsync() {
        var id = _users.GetUserId(User);
        return id is not null && await _policy.ValidAsync(User) ? id : null;
    }

    private IActionResult Answer(CommentOutcome o) => o.Ok
        ? StatusCode(o.Status, new { ok = true, id = o.Id })
        : StatusCode(o.Status, new { ok = false, error = o.Error });

    private IActionResult SignIn() => Unauthorized(new { ok = false, signin = true, error = "You're signed out. Sign in again to carry on." });

    [HttpGet("api/discussions/{slug}")]
    public async Task<IActionResult> Read(string slug) {
        if (!_options.Enabled) { return NotFound(); }
        Response.Headers.CacheControl = "no-cache, no-store";
        var view = await _discussions.ReadAsync(slug, await ReaderAsync(), await _staff.ModeratesAsync(User, confirmed: false));
        return view is null ? NotFound() : Ok(view);
    }

    [HttpPost("api/discussions/{slug}/comments")]
    public async Task<IActionResult> Submit(string slug, [FromBody] NewComment body) {
        if (!_options.Enabled) { return NotFound(); }
        Response.Headers.CacheControl = "no-cache, no-store";
        if (await ReaderAsync() is not { } id) { return SignIn(); }
        return Answer(await _discussions.SubmitAsync(slug, id, body.ParentId, body.Source ?? "", body.Key ?? ""));
    }

    [HttpPut("api/comments/{id:guid}")]
    public async Task<IActionResult> Edit(Guid id, [FromBody] Change body) {
        if (!_options.Enabled) { return NotFound(); }
        Response.Headers.CacheControl = "no-cache, no-store";
        if (await ReaderAsync() is not { } me) { return SignIn(); }
        return Answer(await _discussions.EditAsync(id, me, body.Source ?? "", body.Version));
    }

    [HttpDelete("api/comments/{id:guid}")]
    public async Task<IActionResult> Withdraw(Guid id) {
        if (!_options.Enabled) { return NotFound(); }
        Response.Headers.CacheControl = "no-cache, no-store";
        if (await ReaderAsync() is not { } me) { return SignIn(); }
        return Answer(await _discussions.WithdrawAsync(id, me));
    }

    [HttpPost("api/comments/{id:guid}/reports")]
    public async Task<IActionResult> ReportComment(Guid id, [FromBody] Report body) {
        if (!_options.Enabled) { return NotFound(); }
        Response.Headers.CacheControl = "no-cache, no-store";
        if (await ReaderAsync() is not { } me) { return SignIn(); }
        return Answer(await _discussions.ReportAsync(id, me, body.Reason ?? ""));
    }

    [HttpGet("api/account/comments")]
    public async Task<IActionResult> Mine() {
        if (!_options.Enabled) { return NotFound(); }
        Response.Headers.CacheControl = "no-cache, no-store";
        if (await ReaderAsync() is not { } me) { return SignIn(); }
        return Ok(new { comments = await _discussions.MineAsync(me) });
    }
}

/// <summary>
/// The moderation queue (js/moderation.js): waiting comments and edits, and
/// open reports. A moderator confirms with a passkey before reading or
/// deciding; until then the answer is 403 with confirm: true, which the
/// page answers with a passkey tap and a retry.
/// </summary>
[ApiController, Route("api/moderation"), AutoValidateAntiforgeryToken]
public sealed class ModerationController : ControllerBase {
    private readonly Discussions _discussions; private readonly UserManager<IdentityUser> _users;
    private readonly StaffAccess _staff; private readonly AccountOptions _options;
    private readonly bool _comments; private readonly ModerationNotices _notices;
    public ModerationController(Discussions discussions, UserManager<IdentityUser> users, StaffAccess staff, IOptions<AccountOptions> options,
        IOptions<CommentOptions> comments, ModerationNotices notices) {
        _discussions = discussions; _users = users; _staff = staff; _options = options.Value; _comments = comments.Value.Enabled; _notices = notices;
    }

    /// <summary>How much is waiting, for the badge on a moderator's page
    /// (js/accounts.js), which asks every two minutes. A count reveals no
    /// comment, so it needs the moderator's role but not a passkey tap.</summary>
    [HttpGet("count")]
    public async Task<IActionResult> Count() {
        Response.Headers.CacheControl = "no-cache, no-store";
        if (!_options.Enabled || !_options.StaffEnabled || !_comments) { return NotFound(); }
        if (User.Identity?.IsAuthenticated != true) { return Unauthorized(new { ok = false, signin = true }); }
        if (!await _staff.ModeratesAsync(User, confirmed: false)) { return NotFound(); }
        var c = await _notices.CountAsync();
        return Ok(new { waiting = c.Waiting, reports = c.Reports, total = c.Total });
    }

    public sealed record Decision(string? Kind, string? Reason, string? Version);
    public sealed record Removal(string? Reason, string? Version);

    /// <summary>Null when the reader may moderate now; otherwise the answer
    /// that says what they must do first.</summary>
    private async Task<IActionResult?> GateAsync() {
        Response.Headers.CacheControl = "no-cache, no-store";
        if (!_options.Enabled || !_options.StaffEnabled || !_comments) { return NotFound(); }
        if (User.Identity?.IsAuthenticated != true) { return Unauthorized(new { ok = false, signin = true, error = "You're signed out. Sign in again to carry on." }); }
        if (!await _staff.ModeratesAsync(User, confirmed: false)) { return NotFound(); }
        if (!await _staff.ModeratesAsync(User)) { return StatusCode(403, new { ok = false, confirm = true, error = "Confirm with your passkey to moderate." }); }
        return null;
    }

    private IActionResult Answer(CommentOutcome o) => o.Ok
        ? StatusCode(o.Status, new { ok = true, id = o.Id })
        : StatusCode(o.Status, new { ok = false, error = o.Error });

    [HttpGet("queue")]
    public async Task<IActionResult> Queue() {
        if (await GateAsync() is { } refused) { return refused; }
        var queue = await _discussions.QueueAsync();
        await _notices.ViewedAsync(_users.GetUserId(User)!);
        return Ok(queue);
    }

    [HttpPost("revisions/{id:guid}/decision")]
    public async Task<IActionResult> Decide(Guid id, [FromBody] Decision body) =>
        await GateAsync() ?? Answer(await _discussions.DecideAsync(id, _users.GetUserId(User)!, body.Kind ?? "", body.Reason, body.Version));

    [HttpPost("comments/{id:guid}/removal")]
    public async Task<IActionResult> Remove(Guid id, [FromBody] Removal body) =>
        await GateAsync() ?? Answer(await _discussions.RemoveAsync(id, _users.GetUserId(User)!, body.Reason, body.Version));

    [HttpPost("reports/{id:guid}/dismissal")]
    public async Task<IActionResult> Dismiss(Guid id) =>
        await GateAsync() ?? Answer(await _discussions.DismissReportAsync(id, _users.GetUserId(User)!));
}
