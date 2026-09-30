using System.Threading.Tasks;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// An admin's session timeouts (Architecture/admin-and-identity-design.md,
/// A14), which the desktop's Settings shows and changes. Each value stays
/// within bounds only the server's configuration can move. Shortening is
/// always allowed; lengthening anything needs a session begun with a passkey
/// and a passkey tap within the confirmation window. Every change is audited
/// and emailed. Without an admin session it does not exist.
/// </summary>
[ApiController]
[Route("api/admin/settings")]
[AllowAnonymous]
[Produces("application/json")]
[AutoValidateAntiforgeryToken]
[EnableRateLimiting("admin-signin")]
public sealed class AdminSettingsController : ControllerBase {
    private readonly UserManager<IdentityUser> _users;
    private readonly AdminSessions _sessions;
    private readonly SessionPolicy _policy;
    private readonly ServerFiles _files;
    private readonly AdminOptions _options;

    public AdminSettingsController(UserManager<IdentityUser> users, AdminSessions sessions, SessionPolicy policy, ServerFiles files, IOptions<AdminOptions> options) {
        _users = users; _sessions = sessions; _policy = policy; _files = files; _options = options.Value;
    }

    private async Task<IdentityUser?> AdminAsync() {
        if (!User.IsInRole(AdminOptions.Role)) {
            return null;
        }
        var me = await _users.GetUserAsync(User);
        return me is not null && await _sessions.MaySignInAsync(me) ? me : null;
    }

    private object Describe(Timeouts t) => new {
        ok = true,
        timeouts = t,
        defaults = _policy.Defaults,
        limits = new {
            idleMinutes = new[] { _options.IdleMinutesMin, _options.IdleMinutesMax },
            absoluteHours = new[] { _options.AbsoluteHoursMin, _options.AbsoluteHoursMax },
            confirmMinutes = new[] { _options.ConfirmMinutesMin, _options.ConfirmMinutesMax },
            destructiveConfirmMinutes = new[] { _options.DestructiveConfirmMinutesMin, _options.DestructiveConfirmMinutesMax }
        },
        mayLengthen = User.FindFirst(AdminSessions.MethodClaim)?.Value == AdminSessions.Passkey
    };

    [HttpGet("timeouts")]
    public async Task<IActionResult> Get() {
        var me = await AdminAsync();
        if (me is null) {
            return NotFound();
        }
        return Ok(Describe(await _policy.ForUserAsync(me.Id)));
    }

    [HttpPut("timeouts")]
    public async Task<IActionResult> Put([FromBody] Timeouts wanted) {
        var me = await AdminAsync();
        if (me is null) {
            return NotFound();
        }
        if (wanted is null || !_policy.InBounds(wanted)) {
            return BadRequest(new { ok = false, error = "Each value must lie within the limits shown." });
        }
        var current = await _policy.ForUserAsync(me.Id);
        if (wanted.Loosens(current)) {
            if (User.FindFirst(AdminSessions.MethodClaim)?.Value != AdminSessions.Passkey) {
                return StatusCode(403, new { ok = false, error = "Lengthening a timeout needs a session begun with a passkey. You can still shorten them." });
            }
            if (!await _sessions.RecentlyConfirmedAsync(User)) {
                return StatusCode(403, new { ok = false, confirm = true, error = "Confirm it's you with a passkey first." });
            }
        }
        await _policy.SaveAsync(_users, me, wanted);
        var who = me.Email ?? me.UserName ?? me.Id;
        var summary = $"idle {wanted.IdleMinutes} min, absolute {wanted.AbsoluteHours} h, confirm {wanted.ConfirmMinutes} min, destructive confirm {wanted.DestructiveConfirmMinutes} min";
        await _files.AuditAsync(who, AdminOptions.ClientIp(HttpContext), "timeouts", "settings", summary);
        await _sessions.NotifyAsync(me, "Your admin timeouts changed",
            $"The session timeouts for {who} were changed to: {summary}.", HttpContext);
        return Ok(Describe(wanted));
    }
}
