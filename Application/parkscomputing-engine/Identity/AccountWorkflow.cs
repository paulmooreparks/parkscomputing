using System;
using System.Data;
using System.Linq;
using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
namespace ParksComputing.Engine.Identity;
internal sealed class SiteEmailBudget {
    public string Bucket { get; set; } = "";
    public int Count { get; set; }
    public static void Configure(ModelBuilder builder) {
        var b = builder.Entity<SiteEmailBudget>(); b.ToTable("SiteEmailBudgets"); b.HasKey(x => x.Bucket);
        b.Property(x => x.Bucket).HasMaxLength(150);
    }
}
public sealed class AccountWorkflow {
    private readonly IServiceScopeFactory _scopes;
    private readonly IDbContextFactory<SiteIdentityDbContext> _factory;
    private readonly AccountLinks _links;
    private readonly TimeProvider _clock;
    private readonly AccountOptions _options;
    private readonly Microsoft.Extensions.Logging.ILogger<AccountWorkflow> _log;
    public AccountWorkflow(IServiceScopeFactory scopes, IDbContextFactory<SiteIdentityDbContext> factory,
        AccountLinks links, TimeProvider clock, IOptions<AccountOptions> options,
        Microsoft.Extensions.Logging.ILogger<AccountWorkflow>? log = null) {
        _scopes = scopes; _factory = factory; _links = links; _clock = clock; _options = options.Value;
        _log = log ?? Microsoft.Extensions.Logging.Abstractions.NullLogger<AccountWorkflow>.Instance;
    }

    /* A request that ends without an email says why in the log, by reason
       alone, never with the address, so a reader's "nothing arrived" can be
       answered from the server. The reader is still told the same thing
       either way, so the form cannot reveal who has an account. */
    private void NotSent(bool signUp, string reason) =>
        Microsoft.Extensions.Logging.LoggerExtensions.LogWarning(_log, "Account email not sent ({Form}): {Reason}", signUp ? "create account" : "sign in", reason);
    public static string DisplayName(string name) {
        name = (name ?? "").Trim();
        if (name.Length is < 1 or > 80 || name.Any(char.IsControl)) { throw new ArgumentException("Use a display name of 1 to 80 characters."); }
        return name;
    }
    public static string Email(string value) {
        value = (value ?? "").Trim();
        if (value.Length > 254 || !MailAddress.TryCreate(value, out var parsed) || parsed.Address != value ||
            value.Any(char.IsControl)) { throw new ArgumentException("Enter a valid email address."); }
        return value;
    }
    private async Task<bool> BudgetAsync(string email, string ip) {
        var now = _clock.GetUtcNow();
        string Hash(string s) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s)));
        var buckets = new[] { ("global:" + now.ToString("yyyyMMdd"), 500),
            ("email:" + now.ToString("yyyyMMddHH") + ":" + Hash(email.ToUpperInvariant()), 5),
            ("ip:" + now.ToString("yyyyMMddHH") + ":" + Hash(ip), 30) };
        await using var execution = await _factory.CreateDbContextAsync();
        return await execution.Database.CreateExecutionStrategy().ExecuteAsync(async () => {
            await using var db = await _factory.CreateDbContextAsync();
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            foreach (var (key, limit) in buckets) {
                var row = await db.EmailBudgets.SingleOrDefaultAsync(b => b.Bucket == key);
                if (row is null) { db.EmailBudgets.Add(new SiteEmailBudget { Bucket = key, Count = 1 }); }
                else { if (row.Count >= limit) { return false; } row.Count++; }
            }
            await db.SaveChangesAsync(); await transaction.CommitAsync(); return true;
        });
    }
    /// <summary>Sends a sign-in or verification link. returnUrl, a local
    /// address the caller has already checked, rides in the link, so that
    /// following it brings the reader back to the page they asked from, such
    /// as their window view with its windows, rather than to a page of ours.</summary>
    /// <param name="agreed">For a new account, the versions of the terms and
    /// privacy notice the reader agreed to on the form, recorded with it.</param>
    public async Task RequestAsync(string email, string? displayName, string ip, string? returnUrl = null, PolicyVersions? agreed = null) {
        email = Email(email);
        if (displayName is not null) { displayName = DisplayName(displayName); }
        bool signUp = displayName is not null;
        if (!await BudgetAsync(email, ip)) { NotSent(signUp, "too many requests for this address or network this hour"); return; }
        string? userId = null, reason = null;
        AccountLinkPurpose purpose = AccountLinkPurpose.SignIn;
        await using var execution = await _factory.CreateDbContextAsync();
        await execution.Database.CreateExecutionStrategy().ExecuteAsync(async () => {
            userId = null; reason = null;
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var user = await users.FindByEmailAsync(email);
            // A new account only while registration is open; otherwise the
            // request is answered as for any unknown address, with nothing sent.
            if (user is null && displayName is not null && _options.Registration) {
                user = new IdentityUser { UserName = Guid.NewGuid().ToString("N"), Email = email, EmailConfirmed = false };
                var result = await users.CreateAsync(user);
                if (!result.Succeeded) {
                    reason = "the account could not be created (" + string.Join(", ", result.Errors.Select(e => e.Code)) + ")";
                    return;
                }
                db.AccountProfiles.Add(new SiteAccountProfile {
                    UserId = user.Id, DisplayName = displayName, Version = Guid.NewGuid(), CreatedUtc = _clock.GetUtcNow().UtcDateTime,
                    TermsVersion = agreed?.Terms, PrivacyVersion = agreed?.Privacy,
                    PoliciesAcceptedUtc = agreed?.Any == true ? _clock.GetUtcNow().UtcDateTime : null
                });
                await db.SaveChangesAsync();
            }
            if (user is null) {
                reason = signUp ? "registration is closed" : "no account has that address (Create account makes one)";
                return;
            }
            if (await users.IsLockedOutAsync(user)) { reason = "the account is locked out"; return; }
            if (await db.AccountProfiles.AnyAsync(p => p.UserId == user.Id && p.SuspendedUtc != null)) { reason = "the account is suspended"; return; }
            // A registration request never replaces the profile or grants roles to an existing account.
            userId = user.Id; purpose = user.EmailConfirmed ? AccountLinkPurpose.SignIn : AccountLinkPurpose.VerifyEmail;
            await transaction.CommitAsync();
        });
        if (userId is null) { NotSent(signUp, reason ?? "unknown"); return; }
        string token;
        try { token = await _links.IssueAsync(userId, purpose); }
        catch (InvalidOperationException) { NotSent(signUp, "the account cannot receive a link now"); return; }
        var url = _options.Origin.TrimEnd('/') + "/account/link?uid=" + Uri.EscapeDataString(userId) +
            "&purpose=" + purpose + "&token=" + Uri.EscapeDataString(token) +
            (string.IsNullOrEmpty(returnUrl) || returnUrl == "/" ? "" : "&return=" + Uri.EscapeDataString(returnUrl));
        using var mailScope = _scopes.CreateScope();
        var sent = await mailScope.ServiceProvider.GetRequiredService<ResendMailer>().SendAsync(email,
            purpose == AccountLinkPurpose.VerifyEmail ? "Verify your " + _options.SiteName + " account" : "Sign in to " + _options.SiteName,
            "Open this link within 15 minutes, then press the confirmation button:\n\n" + url +
            "\n\nIf you did not request this email, ignore it.");
        if (!sent) { await _links.CancelAsync(userId, purpose, token); NotSent(signUp, "the mail service did not take the message"); }
        else {
            Microsoft.Extensions.Logging.LoggerExtensions.LogInformation(_log, "Account email sent ({Form}): {Purpose} link",
                signUp ? "create account" : "sign in", purpose == AccountLinkPurpose.VerifyEmail ? "verification" : "sign-in");
        }
    }
    public async Task<(string UserId, string SessionId)?> RedeemAsync(string userId, AccountLinkPurpose purpose, string token) {
        if (purpose is not (AccountLinkPurpose.VerifyEmail or AccountLinkPurpose.SignIn)) { return null; }
        await using var execution = await _factory.CreateDbContextAsync();
        return await execution.Database.CreateExecutionStrategy().ExecuteAsync(async () => {
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
            var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            if (!await _links.RedeemAsync(db, userId, purpose, token)) { return ((string, string)?)null; }
            var user = await users.FindByIdAsync(userId);
            if (user is null) { return null; }
            if (purpose == AccountLinkPurpose.VerifyEmail) {
                user.EmailConfirmed = true;
                if (!(await users.UpdateAsync(user)).Succeeded) { throw new InvalidOperationException("Verification failed."); }
                if (!await roles.RoleExistsAsync("Member") && !(await roles.CreateAsync(new IdentityRole("Member"))).Succeeded) {
                    throw new InvalidOperationException("Membership could not be created.");
                }
                if (!await users.IsInRoleAsync(user, "Member") && !(await users.AddToRoleAsync(user, "Member")).Succeeded) {
                    throw new InvalidOperationException("Membership could not be granted.");
                }
            }
            var sessionId = await DurableSessions.CreateAsync(db, user, AdminSessions.EmailLink, _clock.GetUtcNow().UtcDateTime);
            await transaction.CommitAsync();
            return ((string, string)?)(userId, sessionId);
        });
    }
}
