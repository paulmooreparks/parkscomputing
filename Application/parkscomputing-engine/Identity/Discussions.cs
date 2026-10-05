using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ParksComputing.Engine.Publishing;

namespace ParksComputing.Engine.Identity;

/// <summary>The operating limits on comments (Architecture/unified-identity-design.md),
/// from the Comments section of configuration.</summary>
public sealed class CommentOptions {
    public int MaxPerTenMinutes { get; set; } = 5;
    public int MaxPendingPerAccount { get; set; } = 20;
    public int MaxPendingSite { get; set; } = 500;
    public int MaxReportsPerHour { get; set; } = 20;
}

public sealed record CommentAuthor(string Name, string? Avatar, bool Staff, bool Deleted);

/// <summary>One comment as a reader sees it. Html is its approved text, or
/// null for a placeholder (State withdrawn or removed). Pending is the
/// reader's own newer text and its moderation status, which only its author
/// sees. Actions are what this reader may do to it.</summary>
public sealed record CommentView(Guid Id, Guid? ParentId, CommentAuthor? Author, DateTime CreatedUtc,
    string State, string? Html, bool Edited, bool Mine, string? PendingHtml, string? PendingStatus,
    string? PendingSource, string Version, IReadOnlyList<string> Actions, IReadOnlyList<CommentView> Replies);

/// <summary>An article's discussion as one reader sees it. CanComment says
/// whether this reader may start a comment, and Reason why not.</summary>
public sealed record DiscussionView(string Slug, string Title, string Policy, bool SignedIn, bool CanComment,
    string? Reason, int Count, IReadOnlyList<CommentView> Comments);

public sealed record QueueItem(Guid RevisionId, Guid CommentId, string Slug, string Title, CommentAuthor? Author,
    DateTime SubmittedUtc, string Html, string? PublishedHtml, bool IsReply, string Version);
public sealed record ReportItem(Guid ReportId, Guid CommentId, string Slug, string Title, CommentAuthor? Author,
    string Html, string Reason, DateTime ReportedUtc, string Version);
public sealed record ModerationQueue(IReadOnlyList<QueueItem> Pending, IReadOnlyList<ReportItem> Reports);

public sealed record MyComment(Guid Id, string Slug, string Title, DateTime CreatedUtc, string State, string Status, string? Html);

/// <summary>What a change to a comment came to: Status is the HTTP status
/// it is answered with, Error the sentence a reader is shown.</summary>
public sealed record CommentOutcome(int Status, string? Error = null, Guid? Id = null) {
    public bool Ok => Status is >= 200 and < 300;
    public static CommentOutcome Done(Guid id, int status = 200) => new(status, null, id);
    public static CommentOutcome NotFound => new(404, "That comment or article isn't here.");
    public static CommentOutcome Fail(int status, string error) => new(status, error);
}

/// <summary>
/// Article discussions (Architecture/unified-identity-design.md, step 2 and
/// Article comments). Every comment and every edit waits for a moderator;
/// readers see approved text only, and an author sees their own waiting or
/// declined text beside it. The article's file decides whether it takes
/// comments, read again on every change.
/// </summary>
public sealed class Discussions {
    private static readonly Regex KeyShape = new("^[A-Za-z0-9_-]{8,64}$", RegexOptions.Compiled);
    private static readonly string[] StaffRoles = { "Moderator", "Admin", "SuperAdmin" };

    private readonly IDbContextFactory<SiteIdentityDbContext> _factory;
    private readonly CommentPolicies _policies;
    private readonly TimeProvider _clock;
    private readonly CommentOptions _options;

    public Discussions(IDbContextFactory<SiteIdentityDbContext> factory, CommentPolicies policies, TimeProvider clock, IOptions<CommentOptions> options) {
        _factory = factory; _policies = policies; _clock = clock; _options = options.Value;
    }

    private DateTime Now => _clock.GetUtcNow().UtcDateTime;

    /// <summary>Whether this account may comment at all: a verified email,
    /// the Member role or a staff one, and no suspension.</summary>
    public async Task<string?> RefusalAsync(string? userId) {
        if (userId is null) { return "Sign in to comment."; }
        await using var db = await _factory.CreateDbContextAsync();
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == userId);
        if (user is null || !user.EmailConfirmed) { return "Verify your email address before commenting."; }
        if (await db.AccountProfiles.AnyAsync(p => p.UserId == userId && p.SuspendedUtc != null)) { return "This account can't comment."; }
        var roles = await (from ur in db.UserRoles join r in db.Roles on ur.RoleId equals r.Id where ur.UserId == userId select r.Name).ToListAsync();
        return roles.Any(r => r == "Member" || StaffRoles.Contains(r)) ? null : "Verify your email address before commenting.";
    }

    public async Task<DiscussionView?> ReadAsync(string slug, string? viewerId, bool moderator) {
        var info = _policies.Of(slug);
        if (info is null) { return null; }
        var policy = info.Policy;
        string? refusal = viewerId is null ? "Sign in to comment." : await RefusalAsync(viewerId);
        bool member = viewerId is not null && refusal is null;
        string? reason = policy switch {
            ArticleCommentPolicy.Disabled => "This article doesn't take comments.",
            ArticleCommentPolicy.Closed => "Comments on this article are closed.",
            _ => refusal
        };
        var view = new DiscussionView(info.Slug, info.Title, policy.ToString().ToLowerInvariant(), viewerId is not null,
            policy == ArticleCommentPolicy.Open && member, reason, 0, Array.Empty<CommentView>());
        if (policy == ArticleCommentPolicy.Disabled) { return view; }

        await using var db = await _factory.CreateDbContextAsync();
        var discussion = await db.Discussions.AsNoTracking().SingleOrDefaultAsync(d => d.Slug == info.Slug);
        if (discussion is null) { return view; }
        var comments = await db.Comments.AsNoTracking().Where(c => c.DiscussionId == discussion.Id).OrderBy(c => c.CreatedUtc).ToListAsync();
        var ids = comments.Select(c => c.Id).ToList();
        var revisions = await db.CommentRevisions.AsNoTracking()
            .Where(r => ids.Contains(r.CommentId) && r.Status != RevisionStatus.Superseded && r.Status != RevisionStatus.Canceled)
            .ToListAsync();
        var authors = await AuthorsAsync(db, comments.Select(c => c.AuthorId));
        bool open = policy == ArticleCommentPolicy.Open;

        CommentView? Build(SiteComment c, IReadOnlyList<CommentView> replies) {
            bool mine = viewerId is not null && c.AuthorId == viewerId;
            var mineRevs = revisions.Where(r => r.CommentId == c.Id).OrderByDescending(r => r.Number).ToList();
            var published = c.PublishedRevisionId is { } pid ? mineRevs.FirstOrDefault(r => r.Id == pid) : null;
            var latest = mineRevs.FirstOrDefault();
            bool active = c.State == CommentState.Active;
            bool visible = active && published is not null;
            // A comment the reader may not see shows only as a placeholder,
            // and only when a reply that can be seen depends on it.
            if (!visible && !(mine && active && latest is not null) && replies.Count == 0) { return null; }
            var pending = mine && active && latest is not null && latest != published ? latest : null;
            var actions = new List<string>();
            if (visible && open && member && c.ParentId is null) { actions.Add("reply"); }
            if (mine && active && open) { actions.Add("edit"); }
            if (mine && active) { actions.Add("withdraw"); }
            if (visible && member && !mine) { actions.Add("report"); }
            if (moderator && active) { actions.Add("remove"); }
            return new CommentView(c.Id, c.ParentId, active ? authors.GetValueOrDefault(c.AuthorId ?? "") ?? Gone : null,
                c.CreatedUtc, c.State.ToString().ToLowerInvariant(),
                visible ? CommentRenderer.Render(published!.Source) : null,
                published is not null && published.Number > 1, mine,
                pending is null ? null : CommentRenderer.Render(pending.Source),
                pending?.Status.ToString().ToLowerInvariant(), pending?.Source ?? (mine && published is not null ? published.Source : null),
                c.Version.ToString("N"), actions, replies);
        }

        var list = new List<CommentView>();
        int count = 0;
        foreach (var top in comments.Where(c => c.ParentId is null)) {
            var replies = comments.Where(c => c.ParentId == top.Id).Select(r => Build(r, Array.Empty<CommentView>())).OfType<CommentView>().ToList();
            var built = Build(top, replies);
            if (built is null) { continue; }
            list.Add(built);
            count += (built.Html is not null ? 1 : 0) + replies.Count(r => r.Html is not null);
        }
        return view with { Count = count, Comments = list };
    }

    private static readonly CommentAuthor Gone = new("A former member", null, false, true);

    private static async Task<Dictionary<string, CommentAuthor>> AuthorsAsync(SiteIdentityDbContext db, IEnumerable<string?> ids) {
        var list = ids.OfType<string>().Distinct().ToList();
        var names = await db.AccountProfiles.AsNoTracking().Where(p => list.Contains(p.UserId)).ToDictionaryAsync(p => p.UserId, p => p.DisplayName);
        var avatars = await db.AccountAvatars.AsNoTracking().Where(a => list.Contains(a.UserId)).ToDictionaryAsync(a => a.UserId, a => a.Version);
        var staff = (await (from ur in db.UserRoles join r in db.Roles on ur.RoleId equals r.Id
                            where list.Contains(ur.UserId) && StaffRoles.Contains(r.Name!) select ur.UserId).ToListAsync()).ToHashSet();
        return list.ToDictionary(id => id, id => new CommentAuthor(
            names.TryGetValue(id, out var n) && !string.IsNullOrWhiteSpace(n) ? n : "A member",
            avatars.TryGetValue(id, out var v) ? AccountAvatars.UrlOf(id, v) : null, staff.Contains(id), false));
    }

    private static string? CheckSource(ref string source) {
        source = (source ?? "").Replace("\r\n", "\n").Trim();
        if (source.Length == 0) { return "Write something first."; }
        if (source.Length > CommentRecords.MaxSource) { return $"A comment can be at most {CommentRecords.MaxSource:N0} characters."; }
        return null;
    }

    private async Task<string?> LimitAsync(SiteIdentityDbContext db, string userId) {
        var since = Now.AddMinutes(-10);
        var recent = await (from r in db.CommentRevisions join c in db.Comments on r.CommentId equals c.Id
                            where c.AuthorId == userId && r.CreatedUtc >= since select r).CountAsync();
        if (recent >= _options.MaxPerTenMinutes) { return "You've commented a lot in the last few minutes. Try again shortly."; }
        var pending = await (from r in db.CommentRevisions join c in db.Comments on r.CommentId equals c.Id
                             where c.AuthorId == userId && r.Status == RevisionStatus.Pending select r).CountAsync();
        if (pending >= _options.MaxPendingPerAccount) { return "You have many comments waiting for a moderator. Try again once some are reviewed."; }
        if (await db.CommentRevisions.CountAsync(r => r.Status == RevisionStatus.Pending) >= _options.MaxPendingSite) {
            return "Comments are paused while moderators catch up. Try again later.";
        }
        return null;
    }

    public async Task<CommentOutcome> SubmitAsync(string slug, string userId, Guid? parentId, string source, string key) {
        var info = _policies.Of(slug);
        if (info is null || info.Policy == ArticleCommentPolicy.Disabled) { return CommentOutcome.NotFound; }
        if (info.Policy != ArticleCommentPolicy.Open) { return CommentOutcome.Fail(409, "Comments on this article are closed."); }
        if (await RefusalAsync(userId) is { } refusal) { return CommentOutcome.Fail(403, refusal); }
        if (!KeyShape.IsMatch(key ?? "")) { return CommentOutcome.Fail(400, "The request was missing its key. Reload and try again."); }
        if (CheckSource(ref source) is { } bad) { return CommentOutcome.Fail(400, bad); }

        await using var db = await _factory.CreateDbContextAsync();
        if (await db.Comments.AsNoTracking().FirstOrDefaultAsync(c => c.AuthorId == userId && c.IdempotencyKey == key) is { } again) {
            return CommentOutcome.Done(again.Id);
        }
        if (await LimitAsync(db, userId) is { } limited) { return CommentOutcome.Fail(429, limited); }
        var discussion = await db.Discussions.SingleOrDefaultAsync(d => d.Slug == info.Slug);
        if (parentId is { } p) {
            var parent = discussion is null ? null : await db.Comments.AsNoTracking().SingleOrDefaultAsync(c => c.Id == p);
            if (parent is null || parent.DiscussionId != discussion!.Id || parent.ParentId is not null ||
                parent.State != CommentState.Active || parent.PublishedRevisionId is null) {
                return CommentOutcome.Fail(409, "That comment can't take a reply.");
            }
        }
        if (discussion is null) {
            discussion = new SiteDiscussion { Id = Guid.NewGuid(), Slug = info.Slug, CreatedUtc = Now };
            db.Discussions.Add(discussion);
            try { await db.SaveChangesAsync(); }
            catch (DbUpdateException) {
                // Another first comment made it at the same moment.
                db.ChangeTracker.Clear();
                discussion = await db.Discussions.SingleAsync(d => d.Slug == info.Slug);
            }
        }
        var comment = new SiteComment {
            Id = Guid.NewGuid(), DiscussionId = discussion.Id, AuthorId = userId, ParentId = parentId,
            CreatedUtc = Now, State = CommentState.Active, Version = Guid.NewGuid(), IdempotencyKey = key!
        };
        var revision = new SiteCommentRevision { Id = Guid.NewGuid(), CommentId = comment.Id, Number = 1, Source = source, Status = RevisionStatus.Pending, CreatedUtc = Now };
        db.Comments.Add(comment);
        db.CommentRevisions.Add(revision);
        db.CommentDecisions.Add(Decision(comment.Id, revision.Id, userId, "submit"));
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException) {
            db.ChangeTracker.Clear();
            if (await db.Comments.AsNoTracking().FirstOrDefaultAsync(c => c.AuthorId == userId && c.IdempotencyKey == key) is { } same) { return CommentOutcome.Done(same.Id); }
            throw;
        }
        return CommentOutcome.Done(comment.Id, 201);
    }

    private SiteCommentDecision Decision(Guid commentId, Guid? revisionId, string? actorId, string kind, string? reason = null) =>
        new() { Id = Guid.NewGuid(), CommentId = commentId, RevisionId = revisionId, ActorId = actorId, Kind = kind, Reason = reason, CreatedUtc = Now };

    private static bool SameVersion(SiteComment c, string? version) => Guid.TryParse(version, out var v) && v == c.Version;

    private async Task<(SiteComment? Comment, ArticleDiscussionInfo? Info)> FindAsync(SiteIdentityDbContext db, Guid commentId) {
        var comment = await db.Comments.SingleOrDefaultAsync(c => c.Id == commentId);
        if (comment is null) { return (null, null); }
        var slug = await db.Discussions.Where(d => d.Id == comment.DiscussionId).Select(d => d.Slug).SingleAsync();
        return (comment, _policies.Of(slug));
    }

    public async Task<CommentOutcome> EditAsync(Guid commentId, string userId, string source, string? version) {
        if (CheckSource(ref source) is { } bad) { return CommentOutcome.Fail(400, bad); }
        if (await RefusalAsync(userId) is { } refusal) { return CommentOutcome.Fail(403, refusal); }
        await using var db = await _factory.CreateDbContextAsync();
        var (comment, info) = await FindAsync(db, commentId);
        if (comment is null || comment.AuthorId != userId || comment.State != CommentState.Active) { return CommentOutcome.NotFound; }
        if (info?.Policy != ArticleCommentPolicy.Open) { return CommentOutcome.Fail(409, "Comments on this article are closed, so this comment can't be changed. You can still withdraw it."); }
        if (!SameVersion(comment, version)) { return CommentOutcome.Fail(409, "This comment changed since you opened it. Reload and try again."); }
        if (await LimitAsync(db, userId) is { } limited) { return CommentOutcome.Fail(429, limited); }
        var revs = await db.CommentRevisions.Where(r => r.CommentId == commentId).ToListAsync();
        foreach (var r in revs.Where(r => r.Status == RevisionStatus.Pending)) { r.Status = RevisionStatus.Canceled; r.DecidedUtc = Now; }
        var revision = new SiteCommentRevision {
            Id = Guid.NewGuid(), CommentId = commentId, Number = revs.Max(r => r.Number) + 1, Source = source, Status = RevisionStatus.Pending, CreatedUtc = Now
        };
        db.CommentRevisions.Add(revision);
        db.CommentDecisions.Add(Decision(commentId, revision.Id, userId, "edit"));
        comment.Version = Guid.NewGuid();
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateConcurrencyException) { return CommentOutcome.Fail(409, "This comment changed since you opened it. Reload and try again."); }
        return CommentOutcome.Done(commentId);
    }

    /// <summary>The author takes a comment back: its text goes at once,
    /// everywhere, and its waiting versions with it.</summary>
    public async Task<CommentOutcome> WithdrawAsync(Guid commentId, string userId) {
        await using var db = await _factory.CreateDbContextAsync();
        var (comment, _) = await FindAsync(db, commentId);
        if (comment is null || comment.AuthorId != userId || comment.State != CommentState.Active) { return CommentOutcome.NotFound; }
        await RetireAsync(db, comment, CommentState.Withdrawn, userId, "withdraw", null, redact: true);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateConcurrencyException) { return CommentOutcome.Fail(409, "This comment changed since you opened it. Reload and try again."); }
        return CommentOutcome.Done(commentId);
    }

    private async Task RetireAsync(SiteIdentityDbContext db, SiteComment comment, CommentState state, string? actorId, string kind, string? reason, bool redact) {
        foreach (var r in await db.CommentRevisions.Where(r => r.CommentId == comment.Id).ToListAsync()) {
            if (r.Status == RevisionStatus.Pending) { r.Status = RevisionStatus.Canceled; r.DecidedUtc = Now; }
            if (redact) { r.Source = ""; r.Redacted = true; }
        }
        foreach (var report in await db.CommentReports.Where(x => x.CommentId == comment.Id && x.ResolvedUtc == null).ToListAsync()) {
            report.ResolvedUtc = Now; report.ResolvedBy = actorId;
        }
        comment.State = state;
        comment.Version = Guid.NewGuid();
        db.CommentDecisions.Add(Decision(comment.Id, comment.PublishedRevisionId, actorId, kind, reason));
    }

    public async Task<CommentOutcome> ReportAsync(Guid commentId, string userId, string reason) {
        reason = (reason ?? "").Trim();
        if (reason.Length == 0) { return CommentOutcome.Fail(400, "Say what's wrong with it."); }
        if (reason.Length > CommentRecords.MaxReason) { reason = reason[..CommentRecords.MaxReason]; }
        if (await RefusalAsync(userId) is { } refusal) { return CommentOutcome.Fail(403, refusal); }
        await using var db = await _factory.CreateDbContextAsync();
        var (comment, _) = await FindAsync(db, commentId);
        if (comment is null || comment.State != CommentState.Active || comment.PublishedRevisionId is null) { return CommentOutcome.NotFound; }
        if (comment.AuthorId == userId) { return CommentOutcome.Fail(400, "You can't report your own comment. You can withdraw it."); }
        if (await db.CommentReports.AnyAsync(r => r.CommentId == commentId && r.ReporterId == userId)) { return CommentOutcome.Done(commentId); }
        var since = Now.AddHours(-1);
        if (await db.CommentReports.CountAsync(r => r.ReporterId == userId && r.CreatedUtc >= since) >= _options.MaxReportsPerHour) {
            return CommentOutcome.Fail(429, "You've sent many reports in the last hour. Try again later.");
        }
        db.CommentReports.Add(new SiteCommentReport { Id = Guid.NewGuid(), CommentId = commentId, ReporterId = userId, Reason = reason, CreatedUtc = Now });
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException) { /* the same report, sent twice at once */ }
        return CommentOutcome.Done(commentId, 201);
    }

    public async Task<ModerationQueue> QueueAsync() {
        await using var db = await _factory.CreateDbContextAsync();
        var pending = await (from r in db.CommentRevisions.AsNoTracking()
                             join c in db.Comments.AsNoTracking() on r.CommentId equals c.Id
                             join d in db.Discussions.AsNoTracking() on c.DiscussionId equals d.Id
                             where r.Status == RevisionStatus.Pending && c.State == CommentState.Active
                             orderby r.CreatedUtc
                             select new { r, c, d.Slug }).Take(200).ToListAsync();
        var publishedIds = pending.Where(x => x.c.PublishedRevisionId != null).Select(x => x.c.PublishedRevisionId!.Value).ToList();
        var published = await db.CommentRevisions.AsNoTracking().Where(r => publishedIds.Contains(r.Id)).ToDictionaryAsync(r => r.Id, r => r.Source);
        var reports = await (from rep in db.CommentReports.AsNoTracking()
                             join c in db.Comments.AsNoTracking() on rep.CommentId equals c.Id
                             join d in db.Discussions.AsNoTracking() on c.DiscussionId equals d.Id
                             join r in db.CommentRevisions.AsNoTracking() on c.PublishedRevisionId equals r.Id
                             where rep.ResolvedUtc == null && c.State == CommentState.Active
                             orderby rep.CreatedUtc
                             select new { rep, c, d.Slug, r.Source }).Take(200).ToListAsync();
        var authors = await AuthorsAsync(db, pending.Select(x => x.c.AuthorId).Concat(reports.Select(x => x.c.AuthorId)));
        string TitleOf(string slug) => _policies.Of(slug)?.Title ?? slug;
        return new ModerationQueue(
            pending.Select(x => new QueueItem(x.r.Id, x.c.Id, x.Slug, TitleOf(x.Slug), authors.GetValueOrDefault(x.c.AuthorId ?? "") ?? Gone,
                x.r.CreatedUtc, CommentRenderer.Render(x.r.Source),
                x.c.PublishedRevisionId is { } pid && published.TryGetValue(pid, out var old) ? CommentRenderer.Render(old) : null,
                x.c.ParentId is not null, x.c.Version.ToString("N"))).ToList(),
            reports.Select(x => new ReportItem(x.rep.Id, x.c.Id, x.Slug, TitleOf(x.Slug), authors.GetValueOrDefault(x.c.AuthorId ?? "") ?? Gone,
                CommentRenderer.Render(x.Source), x.rep.Reason, x.rep.CreatedUtc, x.c.Version.ToString("N"))).ToList());
    }

    /// <summary>A moderator's decision on one waiting version: approve
    /// publishes that exact text; reject and spam withhold it, leaving any
    /// earlier approved text as it was.</summary>
    public async Task<CommentOutcome> DecideAsync(Guid revisionId, string actorId, string kind, string? reason, string? version) {
        if (kind is not ("approve" or "reject" or "spam")) { return CommentOutcome.Fail(400, "That isn't a decision."); }
        await using var db = await _factory.CreateDbContextAsync();
        var revision = await db.CommentRevisions.SingleOrDefaultAsync(r => r.Id == revisionId);
        if (revision is null) { return CommentOutcome.NotFound; }
        var comment = await db.Comments.SingleAsync(c => c.Id == revision.CommentId);
        if (revision.Status != RevisionStatus.Pending || comment.State != CommentState.Active || !SameVersion(comment, version)) {
            return CommentOutcome.Fail(409, "This comment changed since the queue was read. Reload the queue.");
        }
        if (kind == "approve") {
            if (comment.PublishedRevisionId is { } old && await db.CommentRevisions.SingleOrDefaultAsync(r => r.Id == old) is { } previous) {
                previous.Status = RevisionStatus.Superseded;
            }
            revision.Status = RevisionStatus.Approved;
            comment.PublishedRevisionId = revision.Id;
        } else {
            revision.Status = kind == "spam" ? RevisionStatus.Spam : RevisionStatus.Rejected;
        }
        revision.DecidedUtc = Now;
        comment.Version = Guid.NewGuid();
        db.CommentDecisions.Add(Decision(comment.Id, revision.Id, actorId, kind, Trim(reason)));
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateConcurrencyException) { return CommentOutcome.Fail(409, "This comment changed since the queue was read. Reload the queue."); }
        return CommentOutcome.Done(comment.Id);
    }

    /// <summary>A moderator takes a published comment down, with a reason.
    /// The text is kept for the moderation record, never shown again.</summary>
    public async Task<CommentOutcome> RemoveAsync(Guid commentId, string actorId, string? reason, string? version) {
        await using var db = await _factory.CreateDbContextAsync();
        var (comment, _) = await FindAsync(db, commentId);
        if (comment is null || comment.State != CommentState.Active) { return CommentOutcome.NotFound; }
        if (!SameVersion(comment, version)) { return CommentOutcome.Fail(409, "This comment changed since you read it. Reload and try again."); }
        await RetireAsync(db, comment, CommentState.Removed, actorId, "remove", Trim(reason), redact: false);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateConcurrencyException) { return CommentOutcome.Fail(409, "This comment changed since you read it. Reload and try again."); }
        return CommentOutcome.Done(commentId);
    }

    public async Task<CommentOutcome> DismissReportAsync(Guid reportId, string actorId) {
        await using var db = await _factory.CreateDbContextAsync();
        var report = await db.CommentReports.SingleOrDefaultAsync(r => r.Id == reportId);
        if (report is null) { return CommentOutcome.NotFound; }
        if (report.ResolvedUtc is null) {
            report.ResolvedUtc = Now; report.ResolvedBy = actorId;
            db.CommentDecisions.Add(Decision(report.CommentId, null, actorId, "dismiss"));
            await db.SaveChangesAsync();
        }
        return CommentOutcome.Done(report.CommentId);
    }

    /// <summary>A member's own comments, newest first, with where each stands.</summary>
    public async Task<IReadOnlyList<MyComment>> MineAsync(string userId) {
        await using var db = await _factory.CreateDbContextAsync();
        var rows = await (from c in db.Comments.AsNoTracking()
                          join d in db.Discussions.AsNoTracking() on c.DiscussionId equals d.Id
                          where c.AuthorId == userId
                          orderby c.CreatedUtc descending
                          select new { c, d.Slug }).Take(500).ToListAsync();
        var ids = rows.Select(x => x.c.Id).ToList();
        var revs = await db.CommentRevisions.AsNoTracking().Where(r => ids.Contains(r.CommentId)).ToListAsync();
        return rows.Select(x => {
            var latest = revs.Where(r => r.CommentId == x.c.Id).OrderByDescending(r => r.Number).First();
            var status = x.c.State != CommentState.Active ? x.c.State.ToString().ToLowerInvariant()
                : latest.Status == RevisionStatus.Pending ? (x.c.PublishedRevisionId is null ? "pending" : "edit-pending")
                : latest.Status is RevisionStatus.Rejected or RevisionStatus.Spam ? "declined" : "published";
            return new MyComment(x.c.Id, x.Slug, _policies.Of(x.Slug)?.Title ?? x.Slug, x.c.CreatedUtc,
                x.c.State.ToString().ToLowerInvariant(), status, latest.Redacted ? null : CommentRenderer.Render(latest.Source));
        }).ToList();
    }

    private static string? Trim(string? reason) {
        reason = reason?.Trim();
        return string.IsNullOrEmpty(reason) ? null : reason.Length > CommentRecords.MaxReason ? reason[..CommentRecords.MaxReason] : reason;
    }
}
