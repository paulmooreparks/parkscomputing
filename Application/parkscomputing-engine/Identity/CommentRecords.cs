using System;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace ParksComputing.Engine.Identity;

/// <summary>Where a comment is in its life. Withdrawn is its author's doing
/// and Removed a moderator's; neither shows its text again.</summary>
public enum CommentState { Active, Withdrawn, Removed }

/// <summary>Where one version of a comment's text is in moderation.
/// Superseded is an approved version a later approval replaced, and
/// Canceled a pending one its author replaced or withdrew.</summary>
public enum RevisionStatus { Pending, Approved, Rejected, Spam, Superseded, Canceled }

/// <summary>An article's discussion (Architecture/unified-identity-design.md,
/// step 2): made when the article's first comment is submitted, and keyed by
/// an ID of its own, so it can follow the article when the article store
/// gives articles IDs.</summary>
internal sealed class SiteDiscussion {
    public Guid Id { get; set; }
    public string Slug { get; set; } = "";
    public DateTime CreatedUtc { get; set; }
}

internal sealed class SiteComment {
    public Guid Id { get; set; }
    public Guid DiscussionId { get; set; }
    /// <summary>Null once the author's account is deleted.</summary>
    public string? AuthorId { get; set; }
    public Guid? ParentId { get; set; }
    public DateTime CreatedUtc { get; set; }
    public Guid? PublishedRevisionId { get; set; }
    public CommentState State { get; set; }
    public Guid Version { get; set; }
    /// <summary>The author's key for the request that made it, so a retried
    /// submission finds the comment it already made.</summary>
    public string IdempotencyKey { get; set; } = "";
}

internal sealed class SiteCommentRevision {
    public Guid Id { get; set; }
    public Guid CommentId { get; set; }
    public int Number { get; set; }
    /// <summary>The Markdown as written. Emptied, with Redacted set, when its
    /// author withdraws the comment or deletes the account.</summary>
    public string Source { get; set; } = "";
    public bool Redacted { get; set; }
    public RevisionStatus Status { get; set; }
    public DateTime CreatedUtc { get; set; }
    public DateTime? DecidedUtc { get; set; }
}

/// <summary>A moderation or author action on a comment, kept as a record of
/// who did what to which version, and why.</summary>
internal sealed class SiteCommentDecision {
    public Guid Id { get; set; }
    public Guid CommentId { get; set; }
    public Guid? RevisionId { get; set; }
    public string? ActorId { get; set; }
    public string Kind { get; set; } = "";
    public string? Reason { get; set; }
    public DateTime CreatedUtc { get; set; }
}

internal sealed class SiteCommentReport {
    public Guid Id { get; set; }
    public Guid CommentId { get; set; }
    public string ReporterId { get; set; } = "";
    public string Reason { get; set; } = "";
    public DateTime CreatedUtc { get; set; }
    public DateTime? ResolvedUtc { get; set; }
    public string? ResolvedBy { get; set; }
}

internal static class CommentRecords {
    public const int MaxSource = 10_000;
    public const int MaxReason = 1_000;

    public static void Configure(ModelBuilder model) {
        var discussion = model.Entity<SiteDiscussion>();
        discussion.ToTable("SiteDiscussions");
        discussion.HasKey(d => d.Id);
        discussion.Property(d => d.Slug).HasMaxLength(400).IsRequired();
        discussion.HasIndex(d => d.Slug).IsUnique();

        var comment = model.Entity<SiteComment>();
        comment.ToTable("SiteComments");
        comment.HasKey(c => c.Id);
        comment.Property(c => c.AuthorId).HasMaxLength(450);
        comment.Property(c => c.IdempotencyKey).HasMaxLength(64).IsRequired();
        comment.Property(c => c.Version).IsConcurrencyToken();
        comment.HasOne<SiteDiscussion>().WithMany().HasForeignKey(c => c.DiscussionId).OnDelete(DeleteBehavior.Restrict);
        comment.HasOne<IdentityUser>().WithMany().HasForeignKey(c => c.AuthorId).OnDelete(DeleteBehavior.Restrict);
        comment.HasOne<SiteComment>().WithMany().HasForeignKey(c => c.ParentId).OnDelete(DeleteBehavior.Restrict);
        comment.HasIndex(c => new { c.DiscussionId, c.CreatedUtc });
        comment.HasIndex(c => new { c.AuthorId, c.IdempotencyKey }).IsUnique().HasFilter("[AuthorId] IS NOT NULL");

        var revision = model.Entity<SiteCommentRevision>();
        revision.ToTable("SiteCommentRevisions");
        revision.HasKey(r => r.Id);
        revision.Property(r => r.Source).HasMaxLength(MaxSource);
        revision.HasOne<SiteComment>().WithMany().HasForeignKey(r => r.CommentId).OnDelete(DeleteBehavior.Restrict);
        revision.HasIndex(r => new { r.CommentId, r.Number }).IsUnique();
        revision.HasIndex(r => new { r.Status, r.CreatedUtc });

        var decision = model.Entity<SiteCommentDecision>();
        decision.ToTable("SiteCommentDecisions");
        decision.HasKey(d => d.Id);
        decision.Property(d => d.Kind).HasMaxLength(20).IsRequired();
        decision.Property(d => d.ActorId).HasMaxLength(450);
        decision.Property(d => d.Reason).HasMaxLength(MaxReason);
        decision.HasOne<SiteComment>().WithMany().HasForeignKey(d => d.CommentId).OnDelete(DeleteBehavior.Restrict);
        decision.HasOne<IdentityUser>().WithMany().HasForeignKey(d => d.ActorId).OnDelete(DeleteBehavior.Restrict);
        decision.HasIndex(d => new { d.CommentId, d.CreatedUtc });

        var report = model.Entity<SiteCommentReport>();
        report.ToTable("SiteCommentReports");
        report.HasKey(r => r.Id);
        report.Property(r => r.ReporterId).HasMaxLength(450).IsRequired();
        report.Property(r => r.Reason).HasMaxLength(MaxReason).IsRequired();
        report.Property(r => r.ResolvedBy).HasMaxLength(450);
        report.HasOne<SiteComment>().WithMany().HasForeignKey(r => r.CommentId).OnDelete(DeleteBehavior.Restrict);
        report.HasOne<IdentityUser>().WithMany().HasForeignKey(r => r.ReporterId).OnDelete(DeleteBehavior.Cascade);
        report.HasIndex(r => new { r.CommentId, r.ReporterId }).IsUnique();
        report.HasIndex(r => r.ResolvedUtc);
    }
}
