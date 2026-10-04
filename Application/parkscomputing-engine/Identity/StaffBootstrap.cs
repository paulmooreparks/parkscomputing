using System;
using System.Data;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
namespace ParksComputing.Engine.Identity;

internal sealed class SiteStaffBootstrap {
    public string UserId { get; set; } = "";
    public string SecurityStamp { get; set; } = "";
    public DateTime AuthorizedUtc { get; set; }
    public DateTime ExpiresUtc { get; set; }
    public DateTime? ActivatedUtc { get; set; }
    internal static void Configure(ModelBuilder builder) {
        var row = builder.Entity<SiteStaffBootstrap>();
        row.ToTable("SiteStaffBootstraps"); row.HasKey(x => x.UserId);
        row.Property(x => x.UserId).HasMaxLength(450);
        row.Property(x => x.SecurityStamp).HasMaxLength(256);
        row.HasOne<IdentityUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class StaffAccess {
    private readonly IDbContextFactory<SiteIdentityDbContext> _factory;
    private readonly SessionPolicy _policy;
    private readonly AccountOptions _options;
    public StaffAccess(IDbContextFactory<SiteIdentityDbContext> factory, SessionPolicy policy, IOptions<AccountOptions> options) {
        _factory = factory; _policy = policy; _options = options.Value;
    }
    public async Task<bool> AllowedAsync(ClaimsPrincipal principal, bool confirmed = true) {
        if (!_options.Enabled || !_options.StaffEnabled || !await _policy.ValidAsync(principal) ||
            (confirmed && !await _policy.ConfirmedAsync(principal))) { return false; }
        var id = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        await using var db = await _factory.CreateDbContextAsync();
        return await (from ur in db.UserRoles join role in db.Roles on ur.RoleId equals role.Id
            where ur.UserId == id && (role.Name == "Admin" || role.Name == "SuperAdmin") select ur).AnyAsync();
    }
}

public sealed class StaffBootstrap {
    private readonly IServiceScopeFactory _scopes;
    private readonly IDbContextFactory<SiteIdentityDbContext> _factory;
    private readonly SessionPolicy _policy;
    private readonly AccountOptions _options;
    private readonly TimeProvider _clock;
    public StaffBootstrap(IServiceScopeFactory scopes, IDbContextFactory<SiteIdentityDbContext> factory,
        SessionPolicy policy, IOptions<AccountOptions> options, TimeProvider clock) {
        _scopes = scopes; _factory = factory; _policy = policy; _options = options.Value; _clock = clock;
    }
    public async Task<bool> PendingAsync(string userId) {
        await using var db = await _factory.CreateDbContextAsync();
        var now = _clock.GetUtcNow().UtcDateTime;
        return _options.Enabled && _options.StaffEnabled && await db.StaffBootstraps.AnyAsync(x =>
            x.UserId == userId && x.ActivatedUtc == null && x.ExpiresUtc > now &&
            db.Users.Any(u => u.Id == userId && u.SecurityStamp == x.SecurityStamp));
    }
    /// <summary>When a pending authorization runs out, for the setup page to
    /// say; null when nothing is pending.</summary>
    public async Task<DateTime?> PendingUntilAsync(string userId) {
        if (!await PendingAsync(userId)) { return null; }
        await using var db = await _factory.CreateDbContextAsync();
        return await db.StaffBootstraps.Where(x => x.UserId == userId).Select(x => (DateTime?)x.ExpiresUtc).SingleOrDefaultAsync();
    }
    // The caller must have just completed an assertion by this account's passkey.
    public async Task<bool> ActivateAsync(ClaimsPrincipal principal) {
        if (!_options.Enabled || !_options.StaffEnabled || !await _policy.ConfirmedAsync(principal)) { return false; }
        var id = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        await using var execution = await _factory.CreateDbContextAsync();
        return await execution.Database.CreateExecutionStrategy().ExecuteAsync(async () => {
            using var scope = _scopes.CreateScope(); var sp = scope.ServiceProvider;
            var db = sp.GetRequiredService<SiteIdentityDbContext>();
            var users = sp.GetRequiredService<UserManager<IdentityUser>>();
            var roles = sp.GetRequiredService<RoleManager<IdentityRole>>();
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var user = id is null ? null : await users.FindByIdAsync(id);
            var now = _clock.GetUtcNow().UtcDateTime;
            var grant = user is null ? null : await db.StaffBootstraps.SingleOrDefaultAsync(x => x.UserId == id);
            if (user is null || grant is null || grant.ActivatedUtc != null || grant.ExpiresUtc <= now ||
                grant.SecurityStamp != user.SecurityStamp || !user.EmailConfirmed || await users.IsLockedOutAsync(user) ||
                await db.AccountProfiles.AnyAsync(x => x.UserId == id && x.SuspendedUtc != null) ||
                (await users.GetPasskeysAsync(user)).Count < 2 || !await _policy.ValidAsync(principal)) { return false; }
            foreach (var role in new[] { "Member", "Admin", "SuperAdmin" }) {
                if (!await roles.RoleExistsAsync(role) && !(await roles.CreateAsync(new IdentityRole(role))).Succeeded) { throw new InvalidOperationException("Role creation failed."); }
                if (!await users.IsInRoleAsync(user, role) && !(await users.AddToRoleAsync(user, role)).Succeeded) { throw new InvalidOperationException("Role activation failed."); }
            }
            grant.ActivatedUtc = now;
            if (!(await users.UpdateSecurityStampAsync(user)).Succeeded) { throw new InvalidOperationException("Session reset failed."); }
            await db.SiteSessions.Where(x => x.UserId == id && x.RevokedUtc == null).ExecuteUpdateAsync(x => x.SetProperty(r => r.RevokedUtc, (DateTime?)now));
            await db.AccountLinks.Where(x => x.UserId == id && x.SupersededUtc == null).ExecuteUpdateAsync(x => x.SetProperty(r => r.SupersededUtc, (DateTime?)now));
            await db.SaveChangesAsync(); await tx.CommitAsync(); return true;
        });
    }
    public static async Task<int> RunAsync(IServiceProvider root, string[] args) {
        if (args.Length != 3) { Console.Error.WriteLine("Usage: account-bootstrap <email> <display-name>"); return 2; }
        var options = root.GetRequiredService<IOptions<AccountOptions>>().Value;
        if (!options.Enabled || !options.StaffEnabled) { Console.Error.WriteLine("Account staff access is disabled."); return 1; }
        string email = AccountWorkflow.Email(args[1]), name = AccountWorkflow.DisplayName(args[2]);
        var factory = root.GetRequiredService<IDbContextFactory<SiteIdentityDbContext>>();
        await using var execution = await factory.CreateDbContextAsync();
        await execution.Database.CreateExecutionStrategy().ExecuteAsync(async () => {
            using var scope = root.CreateScope(); var sp = scope.ServiceProvider;
            var db = sp.GetRequiredService<SiteIdentityDbContext>(); var users = sp.GetRequiredService<UserManager<IdentityUser>>();
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var user = await users.FindByEmailAsync(email);
            if (user is null) {
                user = new IdentityUser { UserName = Guid.NewGuid().ToString("N"), Email = email };
                if (!(await users.CreateAsync(user)).Succeeded) { throw new InvalidOperationException("Account creation failed."); }
                db.AccountProfiles.Add(new SiteAccountProfile { UserId = user.Id, DisplayName = name, Version = Guid.NewGuid(), CreatedUtc = DateTime.UtcNow });
            }
            if (await users.IsLockedOutAsync(user) || await db.AccountProfiles.AnyAsync(x => x.UserId == user.Id && x.SuspendedUtc != null)) { throw new InvalidOperationException("Account is disabled."); }
            var existing = await db.StaffBootstraps.SingleOrDefaultAsync(x => x.UserId == user.Id);
            if (existing?.ActivatedUtc is not null || await users.IsInRoleAsync(user, "SuperAdmin")) { throw new InvalidOperationException("This account is already activated."); }
            if (existing is null) { existing = new SiteStaffBootstrap { UserId = user.Id }; db.StaffBootstraps.Add(existing); }
            existing.SecurityStamp = user.SecurityStamp!; existing.AuthorizedUtc = DateTime.UtcNow; existing.ExpiresUtc = DateTime.UtcNow.AddDays(7);
            await db.SaveChangesAsync(); await tx.CommitAsync();
        });
        Console.WriteLine("Super-user setup is authorized for " + email + " for seven days. Verify email, add two passkeys, then open " + options.Origin.TrimEnd('/') + "/account/superuser.");
        return 0;
    }
}
