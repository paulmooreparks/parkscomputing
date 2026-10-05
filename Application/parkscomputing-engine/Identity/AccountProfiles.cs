using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace ParksComputing.Engine.Identity;

internal sealed class SiteAccountProfile {
    public string UserId { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public Guid Version { get; set; }
    public DateTime CreatedUtc { get; set; }
    public DateTime? SuspendedUtc { get; set; }
    public string? SuspensionReason { get; set; }
    /// <summary>The versions of the terms of use and the privacy notice the
    /// member last agreed to, and when (Architecture/privacy-and-terms.md).</summary>
    public string? TermsVersion { get; set; }
    public string? PrivacyVersion { get; set; }
    public DateTime? PoliciesAcceptedUtc { get; set; }

    internal static void Configure(ModelBuilder builder) {
        var profile = builder.Entity<SiteAccountProfile>();
        profile.ToTable("SiteAccountProfiles");
        profile.HasKey(p => p.UserId);
        profile.Property(p => p.UserId).HasMaxLength(450);
        profile.Property(p => p.DisplayName).HasMaxLength(80);
        profile.Property(p => p.SuspensionReason).HasMaxLength(1000);
        profile.Property(p => p.TermsVersion).HasMaxLength(40);
        profile.Property(p => p.PrivacyVersion).HasMaxLength(40);
        profile.Property(p => p.Version).IsConcurrencyToken();
        profile.HasOne<IdentityUser>().WithOne().HasForeignKey<SiteAccountProfile>(p => p.UserId).OnDelete(DeleteBehavior.Restrict);
    }
}

/// <summary>Checks suspension independently of roles, transient lockout and cached cookie claims.</summary>
public sealed class AccountStatus {
    private readonly IDbContextFactory<SiteIdentityDbContext> _factory;
    public AccountStatus(IDbContextFactory<SiteIdentityDbContext> factory) { _factory = factory; }

    public async Task<bool> SuspendedAsync(string userId) {
        await using var db = await _factory.CreateDbContextAsync();
        return await db.AccountProfiles.AnyAsync(p => p.UserId == userId && p.SuspendedUtc != null);
    }
}
