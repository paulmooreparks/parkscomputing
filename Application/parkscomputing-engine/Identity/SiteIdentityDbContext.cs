using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.DependencyInjection;

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
