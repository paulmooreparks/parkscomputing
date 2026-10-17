using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// A personal access token (Architecture/applet-platform-design.md, P3): a
/// secret the super-user mints in Account after a passkey tap and gives to an
/// MCP client, which sends it as a bearer token to /mcp. Only its SHA-256 is
/// kept, so the secret is shown once and can't be read back. The token acts
/// for the account that made it, and only within the capabilities it was
/// given; it stops working when it expires, is revoked, or its account can no
/// longer use the server's tools.
/// </summary>
internal sealed class SiteAccessToken {
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Name { get; set; } = "";
    /// <summary>The secret's first characters, so a token can be recognised in a list.</summary>
    public string Prefix { get; set; } = "";
    public string Hash { get; set; } = "";
    /// <summary>The capabilities, separated by spaces.</summary>
    public string Capabilities { get; set; } = "";
    public DateTime CreatedUtc { get; set; }
    public DateTime ExpiresUtc { get; set; }
    public DateTime? LastUsedUtc { get; set; }
    public string? LastUsedIp { get; set; }
    public DateTime? RevokedUtc { get; set; }

    internal static void Configure(ModelBuilder builder) {
        var token = builder.Entity<SiteAccessToken>();
        token.ToTable("SiteAccessTokens");
        token.HasKey(t => t.Id);
        token.Property(t => t.Id).HasMaxLength(32);
        token.Property(t => t.UserId).HasMaxLength(450);
        token.Property(t => t.Name).HasMaxLength(80);
        token.Property(t => t.Prefix).HasMaxLength(16);
        token.Property(t => t.Hash).HasMaxLength(64);
        token.Property(t => t.Capabilities).HasMaxLength(400);
        token.Property(t => t.LastUsedIp).HasMaxLength(64);
        token.HasIndex(t => t.Hash).IsUnique();
        token.HasIndex(t => t.UserId);
        token.HasOne<IdentityUser>().WithMany().HasForeignKey(t => t.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

/// <summary>
/// The capabilities a token can be given: a closed list. The first five are
/// the server's own tools; the last four are what applets' actions may need
/// (js/applet-actions.js keeps the same names), which matter once applet
/// actions run over MCP.
/// </summary>
public static class TokenCapabilities {
    public const string FilesRead = "files.read";
    public const string FilesWrite = "files.write";
    public const string SitePublish = "site.publish";
    public const string CommentsModerate = "comments.moderate";
    public const string LogsRead = "logs.read";

    public static readonly IReadOnlyList<(string Name, string Description)> All = new[] {
        (FilesRead, "Read the site's files, your home folder (~) and /etc, and the site's page tree."),
        (FilesWrite, "Write files in your home folder (~)."),
        (SitePublish, "Write the site's own files under /wwwroot, which changes the live site at once. Never js/, css/ or pudl/."),
        (CommentsModerate, "List the comments waiting for a moderator, and approve or reject them."),
        (LogsRead, "Read the server log."),
        ("artifact.create", "Let applet actions make files, such as a barcode's picture."),
        ("attention.request", "Let applet actions ask you a question on your open desktop."),
        ("notification.post", "Let applet actions show you a notice on your open desktop."),
        ("window.open", "Let applet actions open windows on your open desktop.")
    };

    public static bool Known(string name) => All.Any(c => c.Name == name);
}

/// <summary>A token as its owner sees it in a list.</summary>
public sealed record AccessTokenInfo(string Id, string Name, string Prefix, IReadOnlyList<string> Capabilities,
    DateTime CreatedUtc, DateTime ExpiresUtc, DateTime? LastUsedUtc, string? LastUsedIp, DateTime? RevokedUtc) {
    public bool Active(DateTime now) => RevokedUtc is null && ExpiresUtc > now;
}

/// <summary>A token that checked out: whose it is and what it may do.</summary>
public sealed record AccessTokenGrant(string TokenId, string TokenName, IdentityUser User, IReadOnlyList<string> Capabilities);

public sealed class AccessTokens {
    public const string SecretPrefix = "pcmcp_";
    public static readonly int[] LifetimeDays = { 7, 30, 90, 365 };

    private readonly IDbContextFactory<SiteIdentityDbContext> _factory;
    private readonly TimeProvider _clock;

    public AccessTokens(IDbContextFactory<SiteIdentityDbContext> factory, TimeProvider clock) {
        _factory = factory; _clock = clock;
    }

    private static string HashOf(string secret) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(secret))).ToLowerInvariant();

    /// <summary>Makes a token and gives its secret, the only time it is ever seen.</summary>
    public async Task<(string Secret, AccessTokenInfo Token)> CreateAsync(string userId, string name, int days, IEnumerable<string> capabilities) {
        name = (name ?? "").Trim();
        if (name.Length is 0 or > 80) { throw new ArgumentException("Give the token a name of up to 80 characters."); }
        if (!LifetimeDays.Contains(days)) { throw new ArgumentException("Choose how long the token lasts."); }
        var caps = capabilities.Select(c => c.Trim()).Where(c => c.Length > 0).Distinct().ToList();
        var unknown = caps.FirstOrDefault(c => !TokenCapabilities.Known(c));
        if (unknown is not null) { throw new ArgumentException(unknown + " isn't a capability a token can have."); }
        if (caps.Count == 0) { throw new ArgumentException("Give the token at least one capability."); }

        var secret = SecretPrefix + WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var now = _clock.GetUtcNow().UtcDateTime;
        var row = new SiteAccessToken {
            Id = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant(),
            UserId = userId, Name = name, Prefix = secret[..(SecretPrefix.Length + 6)], Hash = HashOf(secret),
            Capabilities = string.Join(' ', caps), CreatedUtc = now, ExpiresUtc = now.AddDays(days)
        };
        await using var db = await _factory.CreateDbContextAsync();
        db.AccessTokens.Add(row);
        await db.SaveChangesAsync();
        return (secret, Info(row));
    }

    public async Task<IReadOnlyList<AccessTokenInfo>> ListAsync(string userId) {
        await using var db = await _factory.CreateDbContextAsync();
        var rows = await db.AccessTokens.AsNoTracking().Where(t => t.UserId == userId).OrderByDescending(t => t.CreatedUtc).ToListAsync();
        return rows.Select(Info).ToList();
    }

    /// <summary>Revokes one of the account's tokens; false when it has none by that id still active.</summary>
    public async Task<bool> RevokeAsync(string userId, string id) {
        await using var db = await _factory.CreateDbContextAsync();
        var now = _clock.GetUtcNow().UtcDateTime;
        return await db.AccessTokens.Where(t => t.UserId == userId && t.Id == id && t.RevokedUtc == null)
            .ExecuteUpdateAsync(t => t.SetProperty(x => x.RevokedUtc, (DateTime?)now)) == 1;
    }

    /// <summary>
    /// The token a secret belongs to, if it is current: not revoked, not
    /// expired, and its account confirmed, not suspended and not locked out.
    /// Whether the account may still use the server's tools is the caller's
    /// check, since that needs the account's roles. Its last use is noted at
    /// most once a minute.
    /// </summary>
    public async Task<AccessTokenGrant?> FindAsync(string secret, string ip) {
        if (string.IsNullOrEmpty(secret) || !secret.StartsWith(SecretPrefix, StringComparison.Ordinal) || secret.Length > 128) { return null; }
        var hash = HashOf(secret);
        var now = _clock.GetUtcNow().UtcDateTime;
        await using var db = await _factory.CreateDbContextAsync();
        var found = await (from t in db.AccessTokens
                           join u in db.Users on t.UserId equals u.Id
                           where t.Hash == hash && t.RevokedUtc == null && t.ExpiresUtc > now
                           select new { t, u }).SingleOrDefaultAsync();
        if (found is null) { return null; }
        if (found.t.LastUsedUtc is null || found.t.LastUsedUtc < now.AddMinutes(-1) || found.t.LastUsedIp != ip) {
            await db.AccessTokens.Where(t => t.Id == found.t.Id)
                .ExecuteUpdateAsync(t => t.SetProperty(x => x.LastUsedUtc, (DateTime?)now).SetProperty(x => x.LastUsedIp, ip));
        }
        return new AccessTokenGrant(found.t.Id, found.t.Name, found.u, found.t.Capabilities.Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    private static AccessTokenInfo Info(SiteAccessToken t) => new(t.Id, t.Name, t.Prefix,
        t.Capabilities.Split(' ', StringSplitOptions.RemoveEmptyEntries), t.CreatedUtc, t.ExpiresUtc, t.LastUsedUtc, t.LastUsedIp, t.RevokedUtc);
}
