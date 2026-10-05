using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Identity;

/// <summary>A moderator's digest setting and the two times it turns on: when
/// the last digest went, and when they last opened the queue.</summary>
internal sealed class SiteModeratorNotice {
    public string UserId { get; set; } = "";
    public int IntervalMinutes { get; set; } = ModerationNotices.DefaultInterval;
    public DateTime? LastNotifiedUtc { get; set; }
    public DateTime? LastViewedUtc { get; set; }

    internal static void Configure(ModelBuilder builder) {
        var n = builder.Entity<SiteModeratorNotice>();
        n.ToTable("SiteModeratorNotices");
        n.HasKey(x => x.UserId);
        n.Property(x => x.UserId).HasMaxLength(450);
        n.HasOne<IdentityUser>().WithOne().HasForeignKey<SiteModeratorNotice>(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

/// <summary>What is waiting for the moderators: comments and edits to
/// review, and open reports.</summary>
public sealed record ModerationCount(int Waiting, int Reports) {
    public int Total => Waiting + Reports;
}

/// <summary>
/// Telling moderators what is waiting (Architecture/unified-identity-design.md,
/// "Telling moderators what is waiting"): the count the site shows them, and
/// the email digest, which goes only when something has arrived since the
/// moderator's last digest and since they last opened the queue, and no more
/// often than they chose. A digest gives counts and article titles, never a
/// comment's text.
/// </summary>
public sealed class ModerationNotices {
    public const int DefaultInterval = 30;
    /// <summary>The choices a moderator has, in minutes; 0 is off.</summary>
    public static readonly (int Minutes, string Label)[] Intervals = {
        (0, "Off"), (30, "At most every 30 minutes"), (60, "At most every hour"), (1440, "At most once a day")
    };
    private static readonly string[] ModeratorRoles = { "Moderator", "Admin", "SuperAdmin" };

    private readonly IDbContextFactory<SiteIdentityDbContext> _factory;
    private readonly IServiceScopeFactory _scopes;
    private readonly CommentPolicies _policies;
    private readonly TimeProvider _clock;
    private readonly AccountOptions _options;

    public ModerationNotices(IDbContextFactory<SiteIdentityDbContext> factory, IServiceScopeFactory scopes, CommentPolicies policies,
        TimeProvider clock, IOptions<AccountOptions> options) {
        _factory = factory; _scopes = scopes; _policies = policies; _clock = clock; _options = options.Value;
    }

    private static IQueryable<SiteCommentRevision> WaitingRevisions(SiteIdentityDbContext db) =>
        db.CommentRevisions.Where(r => r.Status == RevisionStatus.Pending && db.Comments.Any(c => c.Id == r.CommentId && c.State == CommentState.Active));
    private static IQueryable<SiteCommentReport> OpenReports(SiteIdentityDbContext db) =>
        db.CommentReports.Where(r => r.ResolvedUtc == null && db.Comments.Any(c => c.Id == r.CommentId && c.State == CommentState.Active && c.PublishedRevisionId != null));

    public async Task<ModerationCount> CountAsync() {
        await using var db = await _factory.CreateDbContextAsync();
        return new(await WaitingRevisions(db).CountAsync(), await OpenReports(db).CountAsync());
    }

    /// <summary>The moderator has opened the queue, and so has seen what is in it.</summary>
    public async Task ViewedAsync(string userId) {
        await using var db = await _factory.CreateDbContextAsync();
        var row = await db.ModeratorNotices.SingleOrDefaultAsync(n => n.UserId == userId);
        if (row is null) { db.ModeratorNotices.Add(row = new SiteModeratorNotice { UserId = userId }); }
        row.LastViewedUtc = _clock.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync();
    }

    public async Task<int> IntervalAsync(string userId) {
        await using var db = await _factory.CreateDbContextAsync();
        return await db.ModeratorNotices.Where(n => n.UserId == userId).Select(n => (int?)n.IntervalMinutes).SingleOrDefaultAsync() ?? DefaultInterval;
    }

    public async Task<bool> SetIntervalAsync(string userId, int minutes) {
        if (!Intervals.Any(i => i.Minutes == minutes)) { return false; }
        await using var db = await _factory.CreateDbContextAsync();
        var row = await db.ModeratorNotices.SingleOrDefaultAsync(n => n.UserId == userId);
        if (row is null) { db.ModeratorNotices.Add(row = new SiteModeratorNotice { UserId = userId }); }
        row.IntervalMinutes = minutes;
        await db.SaveChangesAsync();
        return true;
    }

    /// <summary>One digest to send.</summary>
    public sealed record Digest(string UserId, string Email, string Subject, string Text);

    /// <summary>The digests due now, one for each moderator for whom
    /// something has arrived since both their last digest and their last
    /// look at the queue, and whose chosen interval has passed.</summary>
    public async Task<IReadOnlyList<Digest>> DueAsync() {
        var now = _clock.GetUtcNow().UtcDateTime;
        await using var db = await _factory.CreateDbContextAsync();
        var waiting = await (from r in WaitingRevisions(db) join c in db.Comments on r.CommentId equals c.Id join d in db.Discussions on c.DiscussionId equals d.Id
                             select new { d.Slug, r.CreatedUtc }).ToListAsync();
        var reports = await (from r in OpenReports(db) join c in db.Comments on r.CommentId equals c.Id join d in db.Discussions on c.DiscussionId equals d.Id
                             select new { d.Slug, r.CreatedUtc }).ToListAsync();
        if (waiting.Count == 0 && reports.Count == 0) { return Array.Empty<Digest>(); }
        var newest = waiting.Select(w => w.CreatedUtc).Concat(reports.Select(r => r.CreatedUtc)).Max();

        var moderators = await (from u in db.Users
                                where u.EmailConfirmed && u.Email != null
                                    && db.UserRoles.Any(ur => ur.UserId == u.Id && db.Roles.Any(r => r.Id == ur.RoleId && ModeratorRoles.Contains(r.Name!)))
                                    && !db.AccountProfiles.Any(p => p.UserId == u.Id && p.SuspendedUtc != null)
                                select new { u.Id, u.Email }).ToListAsync();
        var ids = moderators.Select(m => m.Id).ToList();
        var settings = await db.ModeratorNotices.AsNoTracking().Where(n => ids.Contains(n.UserId)).ToDictionaryAsync(n => n.UserId);

        var due = new List<Digest>();
        foreach (var m in moderators) {
            settings.TryGetValue(m.Id, out var s);
            int interval = s?.IntervalMinutes ?? DefaultInterval;
            if (interval <= 0) { continue; }
            var seen = new[] { s?.LastNotifiedUtc, s?.LastViewedUtc }.Max();
            if (seen is { } t && newest <= t) { continue; }
            if (s?.LastNotifiedUtc is { } last && now - last < TimeSpan.FromMinutes(interval)) { continue; }
            due.Add(Compose(m.Id, m.Email!, interval, waiting.Select(w => w.Slug).ToList(), reports.Select(r => r.Slug).ToList()));
        }
        return due;
    }

    private Digest Compose(string userId, string email, int interval, List<string> waiting, List<string> reports) {
        string Plural(int n, string one, string many) => n == 1 ? "1 " + one : n + " " + many;
        var parts = new List<string>();
        if (waiting.Count > 0) { parts.Add(Plural(waiting.Count, "comment", "comments") + " waiting for review"); }
        if (reports.Count > 0) { parts.Add(Plural(reports.Count, "report", "reports")); }
        var subject = string.Join(" and ", parts) + " on Parks Computing";
        var origin = _options.Origin.TrimEnd('/');
        var text = new StringBuilder();
        text.Append("Here is what is waiting for the moderators on Parks Computing.\n\n");
        foreach (var slug in waiting.Concat(reports).Distinct().OrderBy(s => s)) {
            var line = new List<string>();
            int w = waiting.Count(x => x == slug), r = reports.Count(x => x == slug);
            if (w > 0) { line.Add(Plural(w, "comment or edit waiting", "comments or edits waiting")); }
            if (r > 0) { line.Add(Plural(r, "report", "reports")); }
            text.Append("- ").Append(_policies.Of(slug)?.Title ?? slug).Append(": ").Append(string.Join(", ", line)).Append('\n');
        }
        var how = Intervals.FirstOrDefault(i => i.Minutes == interval).Label?.ToLowerInvariant() ?? "now and then";
        text.Append("\nOpen the moderation queue: ").Append(origin).Append("/moderation\n\n")
            .Append("You get this email ").Append(how).Append(", and only when something new has arrived since you last opened the queue. ")
            .Append("To change how often, or turn it off, go to Your comments on your account page: ").Append(origin).Append("/account#comments\n");
        return new Digest(userId, email, subject, text.ToString());
    }

    /// <summary>Sends the digests due now, and records each one sent.</summary>
    public async Task<int> SendDueAsync(CancellationToken cancel = default) {
        var due = await DueAsync();
        int sent = 0;
        foreach (var d in due) {
            if (cancel.IsCancellationRequested) { break; }
            using var scope = _scopes.CreateScope();
            if (!await scope.ServiceProvider.GetRequiredService<ResendMailer>().SendAsync(d.Email, d.Subject, d.Text)) { continue; }
            await using var db = await _factory.CreateDbContextAsync(cancel);
            var row = await db.ModeratorNotices.SingleOrDefaultAsync(n => n.UserId == d.UserId, cancel);
            if (row is null) { db.ModeratorNotices.Add(row = new SiteModeratorNotice { UserId = d.UserId }); }
            row.LastNotifiedUtc = _clock.GetUtcNow().UtcDateTime;
            await db.SaveChangesAsync(cancel);
            sent++;
        }
        return sent;
    }
}

/// <summary>Sends moderators' digests every five minutes, where the site has comments.</summary>
public sealed class ModerationNotifier : BackgroundService {
    private readonly ModerationNotices _notices; private readonly bool _on; private readonly ILogger<ModerationNotifier> _log;
    public ModerationNotifier(ModerationNotices notices, IOptions<AccountOptions> accounts, IOptions<CommentOptions> comments, ILogger<ModerationNotifier> log) {
        _notices = notices; _on = accounts.Value.Enabled && accounts.Value.StaffEnabled && comments.Value.Enabled; _log = log;
    }
    protected override async Task ExecuteAsync(CancellationToken stop) {
        if (!_on) { return; }
        while (!stop.IsCancellationRequested) {
            try { await Task.Delay(TimeSpan.FromMinutes(5), stop); } catch (OperationCanceledException) { return; }
            try { await _notices.SendDueAsync(stop); }
            catch (OperationCanceledException) { return; }
            catch (Exception ex) { _log.LogWarning(ex, "Sending moderation digests failed; it tries again in five minutes."); }
        }
    }
}
