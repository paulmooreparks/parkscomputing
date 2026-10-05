using System;
using System.Linq;
using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace ParksComputing.Engine.Identity;

public enum AccountLinkPurpose { VerifyEmail, SignIn, RecoverMember, EnrollStaff, DeleteAccount }

internal sealed class SiteAccountLink {
    public string UserId { get; set; } = "";
    public AccountLinkPurpose Purpose { get; set; }
    public string TokenHash { get; set; } = "";
    public string SecurityStamp { get; set; } = "";
    public string Email { get; set; } = "";
    public DateTime IssuedUtc { get; set; }
    public DateTime ExpiresUtc { get; set; }
    public DateTime? ConsumedUtc { get; set; }
    public DateTime? SupersededUtc { get; set; }

    internal static void Configure(ModelBuilder builder) {
        var link = builder.Entity<SiteAccountLink>();
        link.ToTable("SiteAccountLinks");
        link.HasKey(l => l.TokenHash);
        link.HasIndex(l => new { l.UserId, l.Purpose, l.SupersededUtc });
        link.Property(l => l.UserId).HasMaxLength(450);
        link.Property(l => l.TokenHash).HasMaxLength(64);
        link.Property(l => l.SecurityStamp).HasMaxLength(256);
        link.Property(l => l.Email).HasMaxLength(256);
        link.HasOne<IdentityUser>().WithMany().HasForeignKey(l => l.UserId).OnDelete(DeleteBehavior.Restrict);
    }
}

/// <summary>Issues account-bound links and consumes them with a conditional database update.</summary>
public sealed class AccountLinks {
    private readonly IDbContextFactory<SiteIdentityDbContext> _factory;
    private readonly TimeProvider _clock;

    public AccountLinks(IDbContextFactory<SiteIdentityDbContext> factory, TimeProvider clock) {
        _factory = factory; _clock = clock;
    }

    private static string? Hash(string? token) {
        if (token is null || token.Length != 43 || token.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '-' && c != '_')) {
            return null;
        }
        return Convert.ToHexString(SHA256.HashData(Encoding.ASCII.GetBytes(token)));
    }

    /// <summary>The caller authorizes issuance and sends the returned secret directly to the intended mailbox.</summary>
    public async Task<string> IssueAsync(string userId, AccountLinkPurpose purpose) {
        if (!Enum.IsDefined(purpose)) { throw new ArgumentOutOfRangeException(nameof(purpose)); }
        var token = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var hash = Hash(token)!;
        var now = _clock.GetUtcNow().UtcDateTime;
        var expires = now.AddMinutes(15);
        await using var execution = await _factory.CreateDbContextAsync();
        await execution.Database.CreateExecutionStrategy().ExecuteAsync(async () => {
            await using var db = await _factory.CreateDbContextAsync();
            // A retry after a lost commit acknowledgment must not revive a consumed or superseded token.
            if (await db.AccountLinks.AnyAsync(l => l.TokenHash == hash)) { return; }
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == userId);
            if (user is null || string.IsNullOrEmpty(user.SecurityStamp) || string.IsNullOrEmpty(user.Email) ||
                (purpose != AccountLinkPurpose.VerifyEmail && !user.EmailConfirmed) ||
                (user.LockoutEnabled && user.LockoutEnd > new DateTimeOffset(now)) ||
                await db.AccountProfiles.AnyAsync(p => p.UserId == userId && p.SuspendedUtc != null)) {
                throw new InvalidOperationException("Account cannot receive this link.");
            }
            await db.AccountLinks.Where(l => l.UserId == userId && l.Purpose == purpose && l.SupersededUtc == null)
                .ExecuteUpdateAsync(update => update.SetProperty(l => l.SupersededUtc, (DateTime?)now));
            db.AccountLinks.Add(new SiteAccountLink {
                UserId = userId, Purpose = purpose, TokenHash = hash, SecurityStamp = user.SecurityStamp,
                Email = user.Email, IssuedUtc = now, ExpiresUtc = expires
            });
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
        });
        return token;
    }

    internal IQueryable<SiteAccountLink> Eligible(SiteIdentityDbContext db, string userId,
        AccountLinkPurpose purpose, string token, DateTime now) {
        var hash = Hash(token);
        var offset = new DateTimeOffset(now);
        return db.AccountLinks.Where(l => hash != null && l.UserId == userId && l.Purpose == purpose &&
            l.TokenHash == hash && l.ConsumedUtc == null && l.SupersededUtc == null && l.IssuedUtc <= now && l.ExpiresUtc > now &&
            db.Users.Any(u => u.Id == l.UserId && !db.AccountProfiles.Any(p => p.UserId == u.Id && p.SuspendedUtc != null) && u.SecurityStamp == l.SecurityStamp && u.Email == l.Email &&
                (purpose == AccountLinkPurpose.VerifyEmail || u.EmailConfirmed) &&
                (!u.LockoutEnabled || u.LockoutEnd == null || u.LockoutEnd <= offset)));
    }

    /// <summary>Checks a link for a confirmation page without consuming it.</summary>
    public async Task<bool> ValidAsync(string userId, AccountLinkPurpose purpose, string token) {
        await using var db = await _factory.CreateDbContextAsync();
        return await Eligible(db, userId, purpose, token, _clock.GetUtcNow().UtcDateTime).AnyAsync();
    }

    /// <summary>Consumes the link once. HTTP callers must require POST and antiforgery validation.</summary>
    public async Task<bool> RedeemAsync(string userId, AccountLinkPurpose purpose, string token) {
        await using var db = await _factory.CreateDbContextAsync();
        return await RedeemAsync(db, userId, purpose, token);
    }

    // Account workflows use their own transaction to commit the resulting account change with redemption.
    internal Task<int> ConsumeAsync(SiteIdentityDbContext db, string userId, AccountLinkPurpose purpose, string token, DateTime now) =>
        Eligible(db, userId, purpose, token, now).ExecuteUpdateAsync(update => update.SetProperty(l => l.ConsumedUtc, (DateTime?)now));

    internal async Task<bool> RedeemAsync(SiteIdentityDbContext db, string userId, AccountLinkPurpose purpose, string token) =>
        await ConsumeAsync(db, userId, purpose, token, _clock.GetUtcNow().UtcDateTime) == 1;

    /// <summary>Invalidates a specific undelivered link without cancelling a newer issuance.</summary>
    public async Task CancelAsync(string userId, AccountLinkPurpose purpose, string token) {
        await using var db = await _factory.CreateDbContextAsync();
        var hash = Hash(token);
        var now = _clock.GetUtcNow().UtcDateTime;
        await db.AccountLinks.Where(l => hash != null && l.UserId == userId && l.Purpose == purpose && l.TokenHash == hash && l.ConsumedUtc == null)
            .ExecuteUpdateAsync(update => update.SetProperty(l => l.ConsumedUtc, (DateTime?)now));
    }
}
