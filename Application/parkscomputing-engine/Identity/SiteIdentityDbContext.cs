using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.DependencyInjection;
using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ParksComputing.Engine.Publishing;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// The site's accounts (Architecture/admin-and-identity-design.md, A3):
/// ASP.NET Core Identity's tables at schema version 3, which adds passkeys,
/// and the data-protection keys. The keys live here rather than in the
/// container, so sign-in cookies and emailed links survive a rebuild, and the
/// server-side admin command issues links the running site accepts.
/// </summary>
public sealed class SiteIdentityDbContext : IdentityDbContext<IdentityUser, IdentityRole, string>, IDataProtectionKeyContext {
    public SiteIdentityDbContext(DbContextOptions<SiteIdentityDbContext> options) : base(options) { }

    public DbSet<DataProtectionKey> DataProtectionKeys { get; set; } = default!;

    internal DbSet<SiteArticle> Articles => Set<SiteArticle>();
    internal DbSet<SiteArticleRevision> ArticleRevisions => Set<SiteArticleRevision>();
    internal DbSet<SiteArticlePublication> ArticlePublications => Set<SiteArticlePublication>();
    internal DbSet<SiteArticleAlias> ArticleAliases => Set<SiteArticleAlias>();
    internal DbSet<SiteArticleEvent> ArticleEvents => Set<SiteArticleEvent>();
    internal DbSet<SiteArticleOperation> ArticleOperations => Set<SiteArticleOperation>();
    internal DbSet<SiteArticleImport> ArticleImports => Set<SiteArticleImport>();

    internal DbSet<SiteEmailBudget> EmailBudgets => Set<SiteEmailBudget>();
    internal DbSet<SiteStaffBootstrap> StaffBootstraps => Set<SiteStaffBootstrap>();

    internal DbSet<SiteAccountProfile> AccountProfiles => Set<SiteAccountProfile>();
    internal DbSet<SiteAccountAvatar> AccountAvatars => Set<SiteAccountAvatar>();
    internal DbSet<SiteAccountPins> AccountPins => Set<SiteAccountPins>();

    internal DbSet<SiteAccountLink> AccountLinks => Set<SiteAccountLink>();

    internal DbSet<SiteSession> SiteSessions => Set<SiteSession>();

    internal DbSet<SiteDiscussion> Discussions => Set<SiteDiscussion>();
    internal DbSet<SiteComment> Comments => Set<SiteComment>();
    internal DbSet<SiteCommentRevision> CommentRevisions => Set<SiteCommentRevision>();
    internal DbSet<SiteCommentDecision> CommentDecisions => Set<SiteCommentDecision>();
    internal DbSet<SiteCommentReport> CommentReports => Set<SiteCommentReport>();
    internal DbSet<SiteModeratorNotice> ModeratorNotices => Set<SiteModeratorNotice>();

    protected override void OnModelCreating(ModelBuilder builder) {
        base.OnModelCreating(builder);
        builder.Entity<IdentityUser>().HasIndex(u => u.NormalizedEmail).IsUnique();
        ArticleRecords.Configure(builder);
        SiteSession.Configure(builder);
        SiteAccountLink.Configure(builder);
        SiteAccountProfile.Configure(builder);
        SiteAccountAvatar.Configure(builder);
        SiteAccountPins.Configure(builder);
        SiteEmailBudget.Configure(builder);
        SiteStaffBootstrap.Configure(builder);
        CommentRecords.Configure(builder);
        SiteModeratorNotice.Configure(builder);
    }

    private void CheckImmutableRecords() {
        ChangeTracker.DetectChanges();
        if (ChangeTracker.Entries().Any(e =>
            (e.Entity is SiteArticleRevision or SiteArticleEvent or SiteArticleOperation)
            && e.State is EntityState.Modified or EntityState.Deleted)) {
            throw new InvalidOperationException("Article revisions, audit events and operation receipts are immutable.");
        }
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess) {
        CheckImmutableRecords();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default) {
        CheckImmutableRecords();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }
}

/// <summary>
/// Lets the EF tools build the model for migrations without the running
/// site's configuration. The connection string is never opened. Identity
/// reads its schema version from the application's options, so the tools get
/// the same version 3 the site configures (Startup.Identity.cs), or the
/// passkeys table would be left out.
/// </summary>
public sealed class SiteIdentityDbContextFactory : IDesignTimeDbContextFactory<SiteIdentityDbContext> {
    public SiteIdentityDbContext CreateDbContext(string[] args) {
        var services = new ServiceCollection();
        services.Configure<IdentityOptions>(o => o.Stores.SchemaVersion = IdentitySchemaVersions.Version3);
        var options = new DbContextOptionsBuilder<SiteIdentityDbContext>()
            .UseSqlServer("Server=design-time;Database=design-time;")
            .UseApplicationServiceProvider(services.BuildServiceProvider())
            .Options;
        return new SiteIdentityDbContext(options);
    }
}
