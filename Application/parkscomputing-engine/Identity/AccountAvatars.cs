using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace ParksComputing.Engine.Identity;

/// <summary>An account's profile picture: one small square image, stored
/// with the account rather than in the web root, and served by
/// AvatarController. Version changes with every new picture, so its address
/// can be cached for good.</summary>
internal sealed class SiteAccountAvatar {
    public string UserId { get; set; } = "";
    public string ContentType { get; set; } = "";
    public byte[] Image { get; set; } = Array.Empty<byte>();
    public Guid Version { get; set; }
    public DateTime UpdatedUtc { get; set; }

    internal static void Configure(ModelBuilder builder) {
        var avatar = builder.Entity<SiteAccountAvatar>();
        avatar.ToTable("SiteAccountAvatars");
        avatar.HasKey(a => a.UserId);
        avatar.Property(a => a.UserId).HasMaxLength(450);
        avatar.Property(a => a.ContentType).HasMaxLength(32);
        avatar.Property(a => a.Image).HasMaxLength(AccountAvatars.MaxBytes);
        avatar.HasOne<IdentityUser>().WithOne().HasForeignKey<SiteAccountAvatar>(a => a.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

/// <summary>
/// Profile pictures (Architecture/unified-identity-design.md, "Profile
/// pictures"). The browser crops and scales a chosen picture to a small
/// square and re-encodes it, which also drops its metadata; the server takes
/// only a PNG, JPEG or WebP, recognised by its own leading bytes rather than
/// by any name or type the request claims, and no larger than MaxBytes. It
/// never decodes the image; it serves the bytes back with the type it
/// recognised, nosniff and a sandbox, so a file that is not really a
/// picture can do nothing as a page. OWASP's file-upload guidance is the
/// model.
/// </summary>
public sealed class AccountAvatars {
    /// <summary>The largest picture taken, generous for a 256-pixel square.</summary>
    public const int MaxBytes = 200 * 1024;

    private readonly IDbContextFactory<SiteIdentityDbContext> _factory;
    private readonly TimeProvider _clock;

    public AccountAvatars(IDbContextFactory<SiteIdentityDbContext> factory, TimeProvider clock) {
        _factory = factory; _clock = clock;
    }

    /// <summary>The type an image's own bytes say it is, or null when they
    /// are not a PNG, JPEG or WebP.</summary>
    public static string? TypeOf(ReadOnlySpan<byte> b) {
        if (b.Length >= 8 && b[..8].SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A })) { return "image/png"; }
        if (b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) { return "image/jpeg"; }
        if (b.Length >= 12 && b[..4].SequenceEqual("RIFF"u8) && b[8..12].SequenceEqual("WEBP"u8)) { return "image/webp"; }
        return null;
    }

    public const string Missing = "Choose a picture first.";
    public const string TooLarge = "That picture is too large. Choose a smaller one, or use a browser with JavaScript, which shrinks it for you.";

    /// <summary>Why a picture is refused, in words for the reader, or null.</summary>
    public static string? Refusal(ReadOnlySpan<byte> image) =>
        image.Length == 0 ? Missing :
        image.Length > MaxBytes ? TooLarge :
        TypeOf(image) is null ? "That isn't a PNG, JPEG or WebP picture." : null;

    /// <summary>The current picture's version, or null when there is none.</summary>
    public async Task<Guid?> VersionAsync(string userId) {
        await using var db = await _factory.CreateDbContextAsync();
        return await db.AccountAvatars.AsNoTracking().Where(a => a.UserId == userId).Select(a => (Guid?)a.Version).SingleOrDefaultAsync();
    }

    public async Task<(byte[] Image, string Type, Guid Version)?> GetAsync(string userId) {
        await using var db = await _factory.CreateDbContextAsync();
        var a = await db.AccountAvatars.AsNoTracking().SingleOrDefaultAsync(x => x.UserId == userId);
        return a is null ? null : (a.Image, a.ContentType, a.Version);
    }

    /// <summary>Replaces the account's picture; throws ArgumentException,
    /// with the reader's reason, for one it refuses.</summary>
    public async Task SetAsync(string userId, byte[] image) {
        if (Refusal(image) is { } why) { throw new ArgumentException(why); }
        await using var db = await _factory.CreateDbContextAsync();
        var a = await db.AccountAvatars.SingleOrDefaultAsync(x => x.UserId == userId);
        if (a is null) { a = new SiteAccountAvatar { UserId = userId }; db.AccountAvatars.Add(a); }
        a.Image = image; a.ContentType = TypeOf(image)!; a.Version = Guid.NewGuid(); a.UpdatedUtc = _clock.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync();
    }

    public async Task RemoveAsync(string userId) {
        await using var db = await _factory.CreateDbContextAsync();
        await db.AccountAvatars.Where(x => x.UserId == userId).ExecuteDeleteAsync();
    }

    /// <summary>A picture's address, which changes with every new picture.</summary>
    public static string UrlOf(string userId, Guid version) => "/avatars/" + Uri.EscapeDataString(userId) + "?v=" + version.ToString("N");
}
