using System;
using System.IO;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.UnitTests;

[TestClass]
public class DurableSessionTests {
    private string _file;
    private ServiceProvider _services;
    private IDbContextFactory<SiteIdentityDbContext> _factory;
    private DurableSessions _sessions;
    private readonly TestClock _clock = new();
    private static readonly Timeouts Limits = new(30, 12, 5, 2);
    private const string UserId = "member";

    private sealed class TestClock : TimeProvider {
        public DateTimeOffset Now = new(2026, 10, 3, 12, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }

    [TestInitialize]
    public async Task Setup() {
        _file = Path.Combine(Path.GetTempPath(), "pc-session-" + Guid.NewGuid().ToString("N") + ".db");
        var services = new ServiceCollection();
        services.Configure<IdentityOptions>(o => o.Stores.SchemaVersion = IdentitySchemaVersions.Version3);
        services.AddDbContextFactory<SiteIdentityDbContext>(o => o.UseSqlite("Data Source=" + _file).ReplaceService<IModelCustomizer, SessionTestModelCustomizer>());
        _services = services.BuildServiceProvider();
        _factory = _services.GetRequiredService<IDbContextFactory<SiteIdentityDbContext>>();
        _sessions = new DurableSessions(_factory, _clock);
        await using var db = await _factory.CreateDbContextAsync();
        await db.Database.EnsureCreatedAsync();
        db.Users.Add(new IdentityUser { Id = UserId, UserName = UserId, EmailConfirmed = true, SecurityStamp = "first", Email = "member@example.test", LockoutEnabled = false });
        await db.SaveChangesAsync();
    }

    [TestCleanup]
    public void Cleanup() {
        _services.Dispose();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        File.Delete(_file);
    }

    private async Task<ClaimsPrincipal> Start(string method = AdminSessions.EmailLink) {
        var id = await _sessions.CreateAsync(new IdentityUser { Id = UserId }, method);
        return new ClaimsPrincipal(new ClaimsIdentity(new[] {
            new Claim(ClaimTypes.NameIdentifier, UserId), new Claim(AdminSessions.SessionClaim, id)
        }, "test"));
    }

    [TestMethod]
    public async Task RestartPreservesIdleDeadlineAndExpiredTouchCannotReviveIt() {
        var principal = await Start();
        _clock.Now = _clock.Now.AddMinutes(31);
        var restarted = new DurableSessions(_factory, _clock);
        Assert.IsFalse(await restarted.ValidAsync(principal, Limits, touch: true));
        Assert.IsFalse(await restarted.ValidAsync(principal, Limits));
    }

    [TestMethod]
    public async Task ActivityExtendsIdleButNeverAbsoluteLifetime() {
        var principal = await Start();
        for (int n = 0; n < 35; n++) {
            _clock.Now = _clock.Now.AddMinutes(20);
            Assert.IsTrue(await _sessions.ValidAsync(principal, Limits, touch: true));
        }
        _clock.Now = _clock.Now.AddMinutes(20);
        Assert.IsFalse(await _sessions.ValidAsync(principal, Limits, touch: true));
    }

    [TestMethod]
    public async Task ConfirmationUsesStoredTimeInsteadOfCookieClaims() {
        var principal = await Start();
        ((ClaimsIdentity)principal.Identity).AddClaim(new Claim(AdminSessions.ConfirmedClaim, long.MaxValue.ToString()));
        Assert.IsFalse(await _sessions.ConfirmedAsync(principal, Limits, false));
        Assert.IsTrue(await _sessions.ConfirmAsync(principal, Limits));
        _clock.Now = _clock.Now.AddMinutes(3);
        Assert.IsTrue(await _sessions.ConfirmedAsync(principal, Limits, false));
        Assert.IsFalse(await _sessions.ConfirmedAsync(principal, Limits, true));
        _clock.Now = _clock.Now.AddMinutes(2);
        Assert.IsFalse(await _sessions.ConfirmedAsync(principal, Limits, false));
    }

    [TestMethod]
    public async Task RevokedSessionCannotTouchOrConfirmAfterRestart() {
        var principal = await Start(AdminSessions.Passkey);
        await _sessions.RevokeAsync(principal);
        var restarted = new DurableSessions(_factory, _clock);
        Assert.IsFalse(await restarted.ValidAsync(principal, Limits, true));
        Assert.IsFalse(await restarted.ConfirmAsync(principal, Limits));
        Assert.IsFalse(await restarted.ConfirmedAsync(principal, Limits, false));
    }

    [TestMethod]
    public async Task ChangedStampAndUnverifiedEmailEndSessionsImmediately() {
        var principal = await Start();
        await using var db = await _factory.CreateDbContextAsync();
        await db.Users.Where(u => u.Id == UserId).ExecuteUpdateAsync(u => u.SetProperty(x => x.SecurityStamp, "second"));
        Assert.IsFalse(await _sessions.ValidAsync(principal, Limits, true));
        var fresh = await Start();
        await db.Users.Where(u => u.Id == UserId).ExecuteUpdateAsync(u => u.SetProperty(x => x.EmailConfirmed, false));
        Assert.IsFalse(await _sessions.ValidAsync(fresh, Limits));
    }

    [TestMethod]
    public async Task AnotherUserCannotReuseOrRevokeTheSession() {
        var principal = await Start();
        var impostor = new ClaimsPrincipal(new ClaimsIdentity(new[] {
            new Claim(ClaimTypes.NameIdentifier, "other"), new Claim(AdminSessions.SessionClaim, principal.FindFirstValue(AdminSessions.SessionClaim))
        }, "test"));
        Assert.IsFalse(await _sessions.ValidAsync(impostor, Limits, true));
        await _sessions.RevokeAsync(impostor);
        Assert.IsTrue(await _sessions.ValidAsync(principal, Limits));
    }

    [TestMethod]
    public async Task EmailLinksArePurposeBoundSingleUseAndNeverStoredAsSecrets() {
        var links = new AccountLinks(_factory, _clock);
        var token = await links.IssueAsync(UserId, AccountLinkPurpose.SignIn);
        Assert.IsTrue(await links.ValidAsync(UserId, AccountLinkPurpose.SignIn, token));
        Assert.IsTrue(await links.ValidAsync(UserId, AccountLinkPurpose.SignIn, token));
        Assert.IsFalse(await links.ValidAsync(UserId, AccountLinkPurpose.VerifyEmail, token));
        Assert.IsFalse(await links.ValidAsync("other", AccountLinkPurpose.SignIn, token));
        await using var db = await _factory.CreateDbContextAsync();
        Assert.AreNotEqual(token, (await db.AccountLinks.SingleAsync()).TokenHash);
        Assert.IsTrue(await links.RedeemAsync(UserId, AccountLinkPurpose.SignIn, token));
        Assert.IsFalse(await links.RedeemAsync(UserId, AccountLinkPurpose.SignIn, token));
    }

    [TestMethod]
    public async Task ReissueSupersedesOldLinkAndOldDeliveryFailureCannotCancelNewLink() {
        var links = new AccountLinks(_factory, _clock);
        var old = await links.IssueAsync(UserId, AccountLinkPurpose.SignIn);
        var next = await links.IssueAsync(UserId, AccountLinkPurpose.SignIn);
        Assert.IsFalse(await links.RedeemAsync(UserId, AccountLinkPurpose.SignIn, old));
        await links.CancelAsync(UserId, AccountLinkPurpose.SignIn, old);
        Assert.IsTrue(await links.ValidAsync(UserId, AccountLinkPurpose.SignIn, next));
        await links.CancelAsync(UserId, AccountLinkPurpose.SignIn, next);
        Assert.IsFalse(await links.RedeemAsync(UserId, AccountLinkPurpose.SignIn, next));
    }

    [TestMethod]
    public async Task EmailLinkExpiresAndStampOrMailboxChangesInvalidateIt() {
        var links = new AccountLinks(_factory, _clock);
        var token = await links.IssueAsync(UserId, AccountLinkPurpose.SignIn);
        _clock.Now = _clock.Now.AddMinutes(15);
        Assert.IsFalse(await links.RedeemAsync(UserId, AccountLinkPurpose.SignIn, token));
        token = await links.IssueAsync(UserId, AccountLinkPurpose.SignIn);
        await using var db = await _factory.CreateDbContextAsync();
        await db.Users.Where(u => u.Id == UserId).ExecuteUpdateAsync(u => u.SetProperty(x => x.Email, "changed@example.test"));
        Assert.IsFalse(await links.RedeemAsync(UserId, AccountLinkPurpose.SignIn, token));
        token = await links.IssueAsync(UserId, AccountLinkPurpose.SignIn);
        await db.Users.Where(u => u.Id == UserId).ExecuteUpdateAsync(u => u.SetProperty(x => x.SecurityStamp, "changed"));
        Assert.IsFalse(await links.RedeemAsync(UserId, AccountLinkPurpose.SignIn, token));
    }

    [TestMethod]
    public async Task VerificationLinkDoesNotGrantAccessBeforeAccountIsVerified() {
        var links = new AccountLinks(_factory, _clock);
        await using var db = await _factory.CreateDbContextAsync();
        await db.Users.Where(u => u.Id == UserId).ExecuteUpdateAsync(u => u.SetProperty(x => x.EmailConfirmed, false));
        await Assert.ThrowsExceptionAsync<InvalidOperationException>(() => links.IssueAsync(UserId, AccountLinkPurpose.SignIn));
        var token = await links.IssueAsync(UserId, AccountLinkPurpose.VerifyEmail);
        Assert.IsTrue(await links.ValidAsync(UserId, AccountLinkPurpose.VerifyEmail, token));
        await using (var transaction = await db.Database.BeginTransactionAsync()) {
            Assert.IsTrue(await links.RedeemAsync(db, UserId, AccountLinkPurpose.VerifyEmail, token));
            await transaction.RollbackAsync();
        }
        Assert.IsTrue(await links.ValidAsync(UserId, AccountLinkPurpose.VerifyEmail, token));
        Assert.IsFalse((await db.Users.AsNoTracking().SingleAsync()).EmailConfirmed);
    }

    [TestMethod]
    public async Task SuspensionOverridesSessionAndEmailLinkAccessImmediately() {
        var principal = await Start(AdminSessions.Passkey);
        var links = new AccountLinks(_factory, _clock);
        var token = await links.IssueAsync(UserId, AccountLinkPurpose.SignIn);
        await using var db = await _factory.CreateDbContextAsync();
        db.AccountProfiles.Add(new SiteAccountProfile {
            UserId = UserId, DisplayName = "Member", Version = Guid.NewGuid(),
            CreatedUtc = _clock.Now.UtcDateTime, SuspendedUtc = _clock.Now.UtcDateTime,
            SuspensionReason = "Test suspension"
        });
        await db.SaveChangesAsync();
        Assert.IsTrue(await new AccountStatus(_factory).SuspendedAsync(UserId));
        Assert.IsFalse(await _sessions.ValidAsync(principal, Limits, touch: true));
        Assert.IsFalse(await _sessions.ConfirmedAsync(principal, Limits, false));
        Assert.IsFalse(await links.ValidAsync(UserId, AccountLinkPurpose.SignIn, token));
        Assert.IsFalse(await links.RedeemAsync(UserId, AccountLinkPurpose.SignIn, token));
        await Assert.ThrowsExceptionAsync<InvalidOperationException>(() => links.IssueAsync(UserId, AccountLinkPurpose.SignIn));
        await Assert.ThrowsExceptionAsync<InvalidOperationException>(() => _sessions.CreateAsync(new IdentityUser { Id = UserId }, AdminSessions.Passkey));
    }

    [TestMethod]
    public async Task MissingOrFutureDatedSessionFailsClosed() {
        var principal = await Start();
        Assert.IsFalse(await _sessions.ValidAsync(new ClaimsPrincipal(), Limits, true));
        _clock.Now = _clock.Now.AddSeconds(-1);
        Assert.IsFalse(await _sessions.ValidAsync(principal, Limits, true));
    }
}


// SQLite does not support ordered DateTimeOffset comparisons. SQL Server uses its native type.
public sealed class SessionTestModelCustomizer : ModelCustomizer {
    public SessionTestModelCustomizer(ModelCustomizerDependencies dependencies) : base(dependencies) { }
    public override void Customize(ModelBuilder modelBuilder, DbContext context) {
        base.Customize(modelBuilder, context);
        modelBuilder.Entity<IdentityUser>().Property(u => u.LockoutEnd)
            .HasConversion(v => v.HasValue ? (long?)v.Value.UtcTicks : null,
                v => v.HasValue ? (DateTimeOffset?)new DateTimeOffset(v.Value, TimeSpan.Zero) : null);
    }
}
