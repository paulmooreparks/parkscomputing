using System;
using System.Collections.Generic;
using System.Data;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// An account's end and its paperwork (Architecture/unified-identity-design.md,
/// "Gaps closed before sign-up opens", and Architecture/privacy-and-terms.md):
/// everything the site holds about a member, as a download; deleting the
/// account; and the housekeeping that keeps nothing longer than the privacy
/// notice says.
/// </summary>
public sealed class AccountLifecycle {
    private static readonly string[] StaffRoles = { "Moderator", "Admin", "SuperAdmin" };
    private readonly IServiceScopeFactory _scopes;
    private readonly IDbContextFactory<SiteIdentityDbContext> _factory;
    private readonly AccountLinks _links;
    private readonly TimeProvider _clock;
    private readonly AccountOptions _options;
    private readonly AdminOptions _admin;

    public AccountLifecycle(IServiceScopeFactory scopes, IDbContextFactory<SiteIdentityDbContext> factory, AccountLinks links,
        TimeProvider clock, IOptions<AccountOptions> options, IOptions<AdminOptions> admin) {
        _scopes = scopes; _factory = factory; _links = links; _clock = clock; _options = options.Value; _admin = admin.Value;
    }

    private DateTime Now => _clock.GetUtcNow().UtcDateTime;

    /// <summary>Retention periods, as the privacy policy states them
    /// (Legal/privacy.md; change them together). Short-lived
    /// records go within an hour of ending, since the housekeeping runs
    /// hourly.</summary>
    public static readonly TimeSpan UnverifiedFor = TimeSpan.FromDays(7);
    public static readonly TimeSpan EndedFor = TimeSpan.FromHours(1);
    public static readonly TimeSpan ModerationTextFor = TimeSpan.FromDays(90);

    /// <summary>Whether this account may delete itself from a browser. A
    /// staff account is deleted from the host, so a browser can never remove
    /// the last super-user.</summary>
    public async Task<string?> DeletionRefusalAsync(string userId) {
        await using var db = await _factory.CreateDbContextAsync();
        var roles = await (from ur in db.UserRoles join r in db.Roles on ur.RoleId equals r.Id where ur.UserId == userId select r.Name).ToListAsync();
        return roles.Any(r => StaffRoles.Contains(r)) ? "A staff account is deleted by the site's operator. Ask for it to be deleted, or have your staff role removed first." : null;
    }

    /// <summary>Emails the member a link that confirms deleting the account.</summary>
    public async Task<bool> RequestDeletionAsync(string userId) {
        if (await DeletionRefusalAsync(userId) is not null) { return false; }
        await using var db = await _factory.CreateDbContextAsync();
        var email = await db.Users.Where(u => u.Id == userId).Select(u => u.Email).SingleOrDefaultAsync();
        if (string.IsNullOrEmpty(email)) { return false; }
        string token;
        try { token = await _links.IssueAsync(userId, AccountLinkPurpose.DeleteAccount); }
        catch (InvalidOperationException) { return false; }
        var url = _options.Origin.TrimEnd('/') + "/account/delete?uid=" + Uri.EscapeDataString(userId) + "&token=" + Uri.EscapeDataString(token);
        using var scope = _scopes.CreateScope();
        var sent = await scope.ServiceProvider.GetRequiredService<ResendMailer>().SendAsync(email,
            "Confirm deleting your Parks Computing account",
            "Someone, probably you, asked to delete your Parks Computing account. To delete it, open this link within 15 minutes and press the button on the page:\n\n" + url +
            "\n\nDeleting the account removes your email address, passkeys, sessions, pins and picture, and erases the text of your comments. It can't be undone.\n\nIf you didn't ask for this, ignore this email; nothing changes.");
        if (!sent) { await _links.CancelAsync(userId, AccountLinkPurpose.DeleteAccount, token); }
        return sent;
    }

    public Task<bool> DeletionLinkValidAsync(string userId, string token) => _links.ValidAsync(userId, AccountLinkPurpose.DeleteAccount, token);

    /// <summary>Spends the emailed link and deletes the account in one transaction.</summary>
    public async Task<bool> ConfirmDeletionAsync(string userId, string token) {
        if (await DeletionRefusalAsync(userId) is not null) { return false; }
        return await DeleteAsync(userId, db => _links.RedeemAsync(db, userId, AccountLinkPurpose.DeleteAccount, token));
    }

    /// <summary>
    /// Deletes an account and everything that is only its: profile, picture,
    /// pins, passkeys, sessions, links and reports it made. Its comments are
    /// withdrawn with their text erased, and keep no author, so a reply that
    /// depends on one still has its placeholder. The moderation record keeps
    /// what was decided, without the account. gate runs first in the same
    /// transaction; when it says no, nothing changes.
    /// </summary>
    internal async Task<bool> DeleteAsync(string userId, Func<SiteIdentityDbContext, Task<bool>>? gate = null) {
        await using var execution = await _factory.CreateDbContextAsync();
        return await execution.Database.CreateExecutionStrategy().ExecuteAsync(async () => {
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            if (gate is not null && !await gate(db)) { return false; }
            var user = await users.FindByIdAsync(userId);
            if (user is null) { return false; }
            var now = Now;
            var comments = await db.Comments.Where(c => c.AuthorId == userId).ToListAsync();
            var ids = comments.Select(c => c.Id).ToList();
            foreach (var r in await db.CommentRevisions.Where(r => ids.Contains(r.CommentId)).ToListAsync()) {
                if (r.Status == RevisionStatus.Pending) { r.Status = RevisionStatus.Canceled; r.DecidedUtc = now; }
                r.Source = ""; r.Redacted = true;
            }
            foreach (var c in comments) {
                if (c.State == CommentState.Active) {
                    c.State = CommentState.Withdrawn;
                    db.CommentDecisions.Add(new SiteCommentDecision { Id = Guid.NewGuid(), CommentId = c.Id, Kind = "account-deleted", CreatedUtc = now });
                }
                c.AuthorId = null; c.Version = Guid.NewGuid();
            }
            await db.SaveChangesAsync();
            await db.CommentDecisions.Where(d => d.ActorId == userId).ExecuteUpdateAsync(u => u.SetProperty(d => d.ActorId, (string?)null));
            await db.CommentReports.Where(r => r.ResolvedBy == userId).ExecuteUpdateAsync(u => u.SetProperty(r => r.ResolvedBy, (string?)null));
            await db.CommentReports.Where(r => r.ReporterId == userId).ExecuteDeleteAsync();
            await db.AccountLinks.Where(l => l.UserId == userId).ExecuteDeleteAsync();
            await db.SiteSessions.Where(s => s.UserId == userId).ExecuteDeleteAsync();
            await db.StaffBootstraps.Where(s => s.UserId == userId).ExecuteDeleteAsync();
            await db.AccountProfiles.Where(p => p.UserId == userId).ExecuteDeleteAsync();
            var result = await users.DeleteAsync(user);
            if (!result.Succeeded) { throw new InvalidOperationException("The account could not be deleted."); }
            await transaction.CommitAsync();
            return true;
        });
    }

    /// <summary>Everything the site holds about one account, for the member
    /// to keep (Architecture/privacy-and-terms.md).</summary>
    public async Task<object?> ExportAsync(string userId) {
        using var scope = _scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
        var user = await users.FindByIdAsync(userId);
        if (user is null) { return null; }
        var profile = await db.AccountProfiles.AsNoTracking().SingleOrDefaultAsync(p => p.UserId == userId);
        var avatar = await db.AccountAvatars.AsNoTracking().SingleOrDefaultAsync(a => a.UserId == userId);
        var pins = await db.AccountPins.AsNoTracking().Where(p => p.UserId == userId).Select(p => p.Pins).SingleOrDefaultAsync();
        var sessions = await db.SiteSessions.AsNoTracking().Where(s => s.UserId == userId)
            .Select(s => new { s.StartedUtc, s.LastSeenUtc, s.Method, s.RevokedUtc }).ToListAsync();
        var comments = await (from c in db.Comments.AsNoTracking() join d in db.Discussions.AsNoTracking() on c.DiscussionId equals d.Id
                              where c.AuthorId == userId select new { c.Id, d.Slug, c.ParentId, c.CreatedUtc, c.State }).ToListAsync();
        var ids = comments.Select(c => c.Id).ToList();
        var revisions = await db.CommentRevisions.AsNoTracking().Where(r => ids.Contains(r.CommentId)).ToListAsync();
        var reports = await db.CommentReports.AsNoTracking().Where(r => r.ReporterId == userId)
            .Select(r => new { comment = r.CommentId, r.Reason, reported = r.CreatedUtc, settled = r.ResolvedUtc }).ToListAsync();
        return new {
            exported = Now,
            site = _options.Origin,
            account = new {
                id = user.Id, email = user.Email, emailVerified = user.EmailConfirmed,
                displayName = profile?.DisplayName, created = profile?.CreatedUtc,
                acceptedTerms = profile?.TermsVersion, acceptedPrivacy = profile?.PrivacyVersion, accepted = profile?.PoliciesAcceptedUtc,
                roles = await users.GetRolesAsync(user)
            },
            passkeys = (await users.GetPasskeysAsync(user)).Select(k => new { name = k.Name, created = k.CreatedAt }),
            sessions,
            picture = avatar is null ? null : new { type = avatar.ContentType, data = Convert.ToBase64String(avatar.Image) },
            pins = pins is null ? (JsonElement?)null : JsonSerializer.Deserialize<JsonElement>(pins),
            comments = comments.Select(c => new {
                id = c.Id, article = c.Slug, replyTo = c.ParentId, created = c.CreatedUtc, state = c.State.ToString().ToLowerInvariant(),
                versions = revisions.Where(r => r.CommentId == c.Id).OrderBy(r => r.Number).Select(r => new {
                    number = r.Number, status = r.Status.ToString().ToLowerInvariant(), written = r.CreatedUtc, decided = r.DecidedUtc,
                    text = r.Redacted ? null : r.Source
                })
            }),
            reports
        };
    }

    /// <summary>
    /// Keeps nothing longer than the privacy policy says: unverified sign-ups
    /// after seven days; the hashed email limits, spent or expired links and
    /// ended sessions within an hour of ending; and the text of declined,
    /// spam and removed comments, and settled reports, after 90 days.
    /// </summary>
    public async Task HousekeepAsync(CancellationToken cancel = default) {
        var now = Now;
        await using (var db = await _factory.CreateDbContextAsync(cancel)) {
            var since = now - UnverifiedFor;
            var stale = await (from u in db.Users
                               where !u.EmailConfirmed && !db.UserRoles.Any(ur => ur.UserId == u.Id)
                                   && !db.StaffBootstraps.Any(b => b.UserId == u.Id)
                                   && !db.AccountProfiles.Any(p => p.UserId == u.Id && p.CreatedUtc > since)
                               orderby u.Id
                               select u.Id).Take(500).ToListAsync(cancel);
            foreach (var id in stale) { await DeleteAsync(id); }

            var gone = now - EndedFor;
            var buckets = await db.EmailBudgets.Select(b => b.Bucket).ToListAsync(cancel);
            var old = buckets.Where(b => BucketEnd(b) is { } end && end < gone).ToList();
            foreach (var chunk in old.Chunk(500)) {
                await db.EmailBudgets.Where(b => chunk.Contains(b.Bucket)).ExecuteDeleteAsync(cancel);
            }

            await db.AccountLinks.Where(l => l.ExpiresUtc < gone).ExecuteDeleteAsync(cancel);

            // A session ends when it is signed out or revoked, or at the
            // longest absolute lifetime any account may choose.
            var outlived = gone.AddHours(-_admin.AbsoluteHoursMax);
            await db.SiteSessions.Where(s => (s.RevokedUtc != null && s.RevokedUtc < gone) || s.StartedUtc < outlived).ExecuteDeleteAsync(cancel);

            var textCutoff = now - ModerationTextFor;
            await db.CommentRevisions.Where(r => !r.Redacted && (r.Status == RevisionStatus.Rejected || r.Status == RevisionStatus.Spam) && r.DecidedUtc < textCutoff)
                .ExecuteUpdateAsync(u => u.SetProperty(r => r.Source, "").SetProperty(r => r.Redacted, true), cancel);
            var removed = db.CommentDecisions.Where(d => d.Kind == "remove" && d.CreatedUtc < textCutoff).Select(d => d.CommentId);
            await db.CommentRevisions.Where(r => !r.Redacted && removed.Contains(r.CommentId) && db.Comments.Any(c => c.Id == r.CommentId && c.State == CommentState.Removed))
                .ExecuteUpdateAsync(u => u.SetProperty(r => r.Source, "").SetProperty(r => r.Redacted, true), cancel);
            await db.CommentReports.Where(r => r.ResolvedUtc != null && r.ResolvedUtc < textCutoff).ExecuteDeleteAsync(cancel);
        }
    }

    /// <summary>When the hour or day an email-limit bucket counts ends
    /// (global:yyyyMMdd, email:yyyyMMddHH:hash, ip:yyyyMMddHH:hash).</summary>
    internal static DateTime? BucketEnd(string bucket) {
        var parts = bucket.Split(':');
        if (parts.Length < 2) { return null; }
        const DateTimeStyles utc = DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal;
        if (DateTime.TryParseExact(parts[1], "yyyyMMddHH", CultureInfo.InvariantCulture, utc, out var hour)) { return hour.AddHours(1); }
        if (DateTime.TryParseExact(parts[1], "yyyyMMdd", CultureInfo.InvariantCulture, utc, out var day)) { return day.AddDays(1); }
        return null;
    }
}

/// <summary>Runs the account housekeeping once an hour.</summary>
public sealed class AccountHousekeeping : BackgroundService {
    private readonly AccountLifecycle _lifecycle; private readonly AccountOptions _options; private readonly ILogger<AccountHousekeeping> _log;
    public AccountHousekeeping(AccountLifecycle lifecycle, IOptions<AccountOptions> options, ILogger<AccountHousekeeping> log) {
        _lifecycle = lifecycle; _options = options.Value; _log = log;
    }
    protected override async Task ExecuteAsync(CancellationToken stop) {
        if (!_options.Enabled) { return; }
        try { await Task.Delay(TimeSpan.FromMinutes(1), stop); } catch (OperationCanceledException) { return; }
        while (!stop.IsCancellationRequested) {
            try { await _lifecycle.HousekeepAsync(stop); }
            catch (OperationCanceledException) { return; }
            catch (Exception ex) { _log.LogWarning(ex, "Account housekeeping failed; it runs again in an hour."); }
            try { await Task.Delay(TimeSpan.FromHours(1), stop); } catch (OperationCanceledException) { return; }
        }
    }
}
