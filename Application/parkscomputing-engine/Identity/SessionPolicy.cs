using System;
using System.Globalization;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;

using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Identity;

/// <summary>An admin's session timeouts (Architecture/admin-and-identity-design.md, A14).</summary>
public sealed record Timeouts(int IdleMinutes, int AbsoluteHours, int ConfirmMinutes, int DestructiveConfirmMinutes) {
    /// <summary>Whether any value here is longer than the same value in <paramref name="than"/>.</summary>
    public bool Loosens(Timeouts than) =>
        IdleMinutes > than.IdleMinutes || AbsoluteHours > than.AbsoluteHours ||
        ConfirmMinutes > than.ConfirmMinutes || DestructiveConfirmMinutes > than.DestructiveConfirmMinutes;
}

/// <summary>
/// Each admin's timeouts, within the bounds the server's configuration sets
/// (A14). They are kept as claims on the Identity user, cached for a minute,
/// and applied to every session: the idle limit through a last-seen time per
/// session held here, and the rest through the session's own claims.
/// </summary>
public sealed class SessionPolicy {
    public const string IdleClaim = "pc_timeout_idle";
    public const string AbsoluteClaim = "pc_timeout_absolute";
    public const string ConfirmClaim = "pc_timeout_confirm";
    public const string DestructiveClaim = "pc_timeout_destructive";

    private readonly IMemoryCache _cache;
    private readonly IServiceScopeFactory _scopes;
    private readonly AdminOptions _options;

    public SessionPolicy(IMemoryCache cache, IServiceScopeFactory scopes, IOptions<AdminOptions> options) {
        _cache = cache; _scopes = scopes; _options = options.Value;
    }

    public Timeouts Defaults => new(_options.IdleMinutes, _options.AbsoluteHours, _options.ConfirmMinutes, _options.DestructiveConfirmMinutes);

    /// <summary>The same timeouts held inside the configured bounds.</summary>
    public Timeouts Clamp(Timeouts t) => new(
        Math.Clamp(t.IdleMinutes, _options.IdleMinutesMin, _options.IdleMinutesMax),
        Math.Clamp(t.AbsoluteHours, _options.AbsoluteHoursMin, _options.AbsoluteHoursMax),
        Math.Clamp(t.ConfirmMinutes, _options.ConfirmMinutesMin, _options.ConfirmMinutesMax),
        Math.Clamp(t.DestructiveConfirmMinutes, _options.DestructiveConfirmMinutesMin, _options.DestructiveConfirmMinutesMax));

    /// <summary>Whether every value lies within the configured bounds.</summary>
    public bool InBounds(Timeouts t) => Clamp(t) == t;

    private static string Key(string userId) => "pc-timeouts:" + userId;

    /// <summary>The timeouts of the admin a principal belongs to.</summary>
    public Task<Timeouts> ForAsync(ClaimsPrincipal p) {
        var id = p.FindFirstValue(ClaimTypes.NameIdentifier);
        return id is null ? Task.FromResult(Defaults) : ForUserAsync(id);
    }

    public async Task<Timeouts> ForUserAsync(string userId) {
        if (_cache.TryGetValue(Key(userId), out Timeouts? cached) && cached is not null) {
            return cached;
        }
        using var scope = _scopes.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
        var user = await users.FindByIdAsync(userId);
        var t = Defaults;
        if (user is not null) {
            var claims = await users.GetClaimsAsync(user);
            int Get(string type, int fallback) =>
                int.TryParse(claims.FirstOrDefault(c => c.Type == type)?.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : fallback;
            t = Clamp(new Timeouts(Get(IdleClaim, t.IdleMinutes), Get(AbsoluteClaim, t.AbsoluteHours), Get(ConfirmClaim, t.ConfirmMinutes), Get(DestructiveClaim, t.DestructiveConfirmMinutes)));
        }
        _cache.Set(Key(userId), t, TimeSpan.FromMinutes(1));
        return t;
    }

    /// <summary>Stores an admin's timeouts, which must already be in bounds.</summary>
    public async Task SaveAsync(UserManager<IdentityUser> users, IdentityUser user, Timeouts t) {
        var claims = await users.GetClaimsAsync(user);
        async Task Put(string type, int value) {
            var v = value.ToString(CultureInfo.InvariantCulture);
            var old = claims.FirstOrDefault(c => c.Type == type);
            var result = old is null ? await users.AddClaimAsync(user, new Claim(type, v)) : await users.ReplaceClaimAsync(user, old, new Claim(type, v));
            if (!result.Succeeded) {
                throw new InvalidOperationException("The timeouts could not be saved: " + string.Join("; ", result.Errors.Select(e => e.Description)));
            }
        }
        await Put(IdleClaim, t.IdleMinutes);
        await Put(AbsoluteClaim, t.AbsoluteHours);
        await Put(ConfirmClaim, t.ConfirmMinutes);
        await Put(DestructiveClaim, t.DestructiveConfirmMinutes);
        _cache.Remove(Key(user.Id));
    }

    /// <summary>
    /// Records a request on a session and says whether the session had gone
    /// idle for longer than its admin allows. A session this process has not
    /// seen, such as one begun before a restart, counts as seen now; the
    /// cookie's own expiry, at the configured ceiling, still bounds it.
    /// </summary>
    /// <summary>
    /// Whether a session has gone idle, without counting this as a request.
    /// The SSH relay asks it while it runs (A16).
    /// </summary>
    public bool Idle(string sessionId, int idleMinutes) =>
        _cache.TryGetValue("pc-seen:" + sessionId, out DateTimeOffset last)
        && DateTimeOffset.UtcNow - last > TimeSpan.FromMinutes(idleMinutes);

    public bool Touch(string sessionId, int idleMinutes) {
        var key = "pc-seen:" + sessionId;
        var now = DateTimeOffset.UtcNow;
        bool idle = _cache.TryGetValue(key, out DateTimeOffset last) && now - last > TimeSpan.FromMinutes(idleMinutes);
        _cache.Set(key, now, TimeSpan.FromMinutes(_options.IdleMinutesMax + 1));
        return !idle;
    }
}
