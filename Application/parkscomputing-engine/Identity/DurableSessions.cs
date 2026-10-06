using System;
using System.Linq;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace ParksComputing.Engine.Identity;

internal sealed class SiteSession {
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string SecurityStamp { get; set; } = "";
    public string Method { get; set; } = "";
    public DateTime StartedUtc { get; set; }
    public DateTime LastSeenUtc { get; set; }
    public DateTime? ConfirmedUtc { get; set; }
    public DateTime? RevokedUtc { get; set; }

    internal static void Configure(ModelBuilder builder) {
        var session = builder.Entity<SiteSession>();
        session.ToTable("SiteSessions");
        session.HasKey(s => s.Id);
        session.Property(s => s.Id).HasMaxLength(64);
        session.Property(s => s.UserId).HasMaxLength(450);
        session.Property(s => s.SecurityStamp).HasMaxLength(256);
        session.Property(s => s.Method).HasMaxLength(32);
        session.HasIndex(s => new { s.UserId, s.RevokedUtc });
        session.HasOne<IdentityUser>().WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Restrict);
    }
}

/// <summary>Persists session lifetime, elevation and revocation across process restarts.</summary>
public sealed class DurableSessions {
    private readonly IDbContextFactory<SiteIdentityDbContext> _factory;
    private readonly TimeProvider _clock;

    public DurableSessions(IDbContextFactory<SiteIdentityDbContext> factory, TimeProvider clock) {
        _factory = factory; _clock = clock;
    }

    public async Task<string> CreateAsync(IdentityUser user, string method) {
        if (method is not (AdminSessions.Passkey or AdminSessions.EmailLink or AdminSessions.RecoveryCode)) {
            throw new ArgumentException("Unknown sign-in method.", nameof(method));
        }
        await using var db = await _factory.CreateDbContextAsync();
        return await CreateAsync(db, user, method, _clock.GetUtcNow().UtcDateTime);
    }

    internal static async Task<string> CreateAsync(SiteIdentityDbContext db, IdentityUser user, string method, DateTime now) {
        var stamp = await db.Users.Where(u => u.Id == user.Id && u.EmailConfirmed &&
            !db.AccountProfiles.Any(p => p.UserId == u.Id && p.SuspendedUtc != null) &&
            (!u.LockoutEnabled || u.LockoutEnd == null || u.LockoutEnd <= new DateTimeOffset(now)))
            .Select(u => u.SecurityStamp).SingleOrDefaultAsync();
        if (string.IsNullOrEmpty(stamp)) { throw new InvalidOperationException("Account cannot start a session."); }
        var id = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        db.SiteSessions.Add(new SiteSession {
            Id = id, UserId = user.Id, SecurityStamp = stamp, Method = method,
            StartedUtc = now, LastSeenUtc = now, ConfirmedUtc = method == AdminSessions.Passkey ? now : null
        });
        await db.SaveChangesAsync();
        return id;
    }

    private IQueryable<SiteSession> Active(SiteIdentityDbContext db, ClaimsPrincipal principal, Timeouts limits, DateTime now) {
        var id = principal.FindFirstValue(AdminSessions.SessionClaim);
        var userId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        var idleAfter = now.AddMinutes(-limits.IdleMinutes);
        var startedAfter = now.AddHours(-limits.AbsoluteHours);
        var offset = new DateTimeOffset(now);
        return db.SiteSessions.Where(s => s.Id == id && s.UserId == userId && s.RevokedUtc == null &&
            s.StartedUtc > startedAfter && s.StartedUtc <= now && s.LastSeenUtc > idleAfter &&
            db.Users.Any(u => u.Id == s.UserId && u.EmailConfirmed &&
                !db.AccountProfiles.Any(p => p.UserId == u.Id && p.SuspendedUtc != null) && u.SecurityStamp == s.SecurityStamp &&
                (!u.LockoutEnabled || u.LockoutEnd == null || u.LockoutEnd <= offset)));
    }

    public async Task<bool> ValidAsync(ClaimsPrincipal principal, Timeouts limits, bool touch = false) {
        await using var db = await _factory.CreateDbContextAsync();
        var now = _clock.GetUtcNow().UtcDateTime;
        var active = Active(db, principal, limits, now);
        // The predicate and activity update execute together. An expired or revoked row cannot be revived.
        return touch ? await active.ExecuteUpdateAsync(update => update.SetProperty(s => s.LastSeenUtc, s => s.LastSeenUtc > now ? s.LastSeenUtc : now)) == 1 :
            await active.AnyAsync();
    }

    /// <summary>How long the session has before its idle limit or its
    /// absolute lifetime ends it, whichever comes first, without counting as
    /// activity; null when it has already ended.</summary>
    public async Task<TimeSpan?> LeftAsync(ClaimsPrincipal principal, Timeouts limits) {
        await using var db = await _factory.CreateDbContextAsync();
        var now = _clock.GetUtcNow().UtcDateTime;
        var times = await Active(db, principal, limits, now).Select(s => new { s.LastSeenUtc, s.StartedUtc }).SingleOrDefaultAsync();
        if (times is null) { return null; }
        var ends = times.LastSeenUtc.AddMinutes(limits.IdleMinutes);
        var absolute = times.StartedUtc.AddHours(limits.AbsoluteHours);
        return (ends < absolute ? ends : absolute) - now;
    }

    public async Task<bool> ConfirmAsync(ClaimsPrincipal principal, Timeouts limits) {
        await using var db = await _factory.CreateDbContextAsync();
        var now = _clock.GetUtcNow().UtcDateTime;
        return await Active(db, principal, limits, now).ExecuteUpdateAsync(update =>
            update.SetProperty(s => s.ConfirmedUtc, (DateTime?)now)) == 1;
    }

    public async Task<bool> ConfirmedAsync(ClaimsPrincipal principal, Timeouts limits, bool destructive) {
        await using var db = await _factory.CreateDbContextAsync();
        var now = _clock.GetUtcNow().UtcDateTime;
        var after = now.AddMinutes(-(destructive ? limits.DestructiveConfirmMinutes : limits.ConfirmMinutes));
        return await Active(db, principal, limits, now).AnyAsync(s => s.ConfirmedUtc > after && s.ConfirmedUtc <= now);
    }

    public async Task RevokeAsync(ClaimsPrincipal principal) {
        var id = principal.FindFirstValue(AdminSessions.SessionClaim);
        var userId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        await using var db = await _factory.CreateDbContextAsync();
        var now = _clock.GetUtcNow().UtcDateTime;
        await db.SiteSessions.Where(s => s.Id == id && s.UserId == userId && s.RevokedUtc == null)
            .ExecuteUpdateAsync(update => update.SetProperty(s => s.RevokedUtc, (DateTime?)now));
    }
}
