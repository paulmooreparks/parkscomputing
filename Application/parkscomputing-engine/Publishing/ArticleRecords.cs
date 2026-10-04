using System;
using System.Runtime.CompilerServices;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

[assembly: InternalsVisibleTo("ParksComputing.Engine.UnitTests")]

namespace ParksComputing.Engine.Publishing;

public enum ArticleFormat { Markdown, Html }
public enum ArticleTrust { Restricted, TrustedExecutable }
public enum ArticleCommentPolicy { Disabled, Open, Closed }

internal sealed class SiteArticle {
    public Guid Id { get; set; }
    public string Slug { get; set; } = "";
    public Guid Version { get; set; }
    public int HeadRevision { get; set; }
    public ArticleTrust Trust { get; set; }
    public DateTimeOffset CreatedUtc { get; set; }
}

internal sealed class SiteArticleRevision {
    public Guid ArticleId { get; set; }
    public int Number { get; set; }
    public string Title { get; set; } = "";
    public string Source { get; set; } = "";
    public string SourceHash { get; set; } = "";
    public string ImportSourcesJson { get; set; } = "[]";
    public ArticleFormat Format { get; set; }
    public ArticleCommentPolicy CommentPolicy { get; set; }
    public string ActorId { get; set; } = "";
    public DateTimeOffset CreatedUtc { get; set; }
}

internal sealed class SiteArticlePublication {
    public Guid ArticleId { get; set; }
    public int RevisionNumber { get; set; }
    public string BodyHtml { get; set; } = "";
    public string RenderPolicy { get; set; } = "";
    public DateTimeOffset PublishedUtc { get; set; }
}

internal sealed class SiteArticleAlias {
    public string Slug { get; set; } = "";
    public Guid ArticleId { get; set; }
}

internal sealed class SiteArticleEvent {
    public Guid Id { get; set; }
    public Guid ArticleId { get; set; }
    public Guid OperationId { get; set; }
    public string ActorId { get; set; } = "";
    public string Kind { get; set; } = "";
    public int? RevisionNumber { get; set; }
    public Guid BeforeVersion { get; set; }
    public Guid AfterVersion { get; set; }
    public DateTimeOffset CreatedUtc { get; set; }
}

internal sealed class SiteArticleOperation {
    public Guid Id { get; set; }
    public string ActorId { get; set; } = "";
    public string RequestHash { get; set; } = "";
    public string ResultJson { get; set; } = "";
    public DateTimeOffset CreatedUtc { get; set; }
}

internal sealed class SiteArticleImport {
    public string Path { get; set; } = "";
    public string FileHash { get; set; } = "";
    public Guid ArticleId { get; set; }
    public int RevisionNumber { get; set; }
    public string AlternateSourcesJson { get; set; } = "[]";
}

internal static class ArticleRecords {
    public static void Configure(ModelBuilder model) {
        var article = model.Entity<SiteArticle>();
        article.ToTable("SiteArticles");
        article.HasKey(x => x.Id);
        article.Property(x => x.Slug).HasMaxLength(400).IsRequired();
        article.Property(x => x.Version).IsConcurrencyToken();
        article.HasIndex(x => x.Slug).IsUnique();

        var revision = model.Entity<SiteArticleRevision>();
        revision.ToTable("SiteArticleRevisions", t => t.UseSqlOutputClause(false));
        revision.HasKey(x => new { x.ArticleId, x.Number });
        revision.Property(x => x.Title).HasMaxLength(300).IsRequired();
        revision.Property(x => x.Source).IsRequired();
        revision.Property(x => x.SourceHash).HasMaxLength(64).IsRequired();
        revision.HasOne<SiteArticle>().WithMany().HasForeignKey(x => x.ArticleId).OnDelete(DeleteBehavior.Restrict);
        revision.HasOne<IdentityUser>().WithMany().HasForeignKey(x => x.ActorId).OnDelete(DeleteBehavior.Restrict);

        var publication = model.Entity<SiteArticlePublication>();
        publication.ToTable("SiteArticlePublications");
        publication.HasKey(x => x.ArticleId);
        publication.Property(x => x.RenderPolicy).HasMaxLength(100).IsRequired();
        publication.HasOne<SiteArticleRevision>().WithMany()
            .HasForeignKey(x => new { x.ArticleId, Number = x.RevisionNumber }).OnDelete(DeleteBehavior.Restrict);

        var alias = model.Entity<SiteArticleAlias>();
        alias.ToTable("SiteArticleAliases");
        alias.HasKey(x => x.Slug);
        alias.Property(x => x.Slug).HasMaxLength(400);
        alias.HasOne<SiteArticle>().WithMany().HasForeignKey(x => x.ArticleId).OnDelete(DeleteBehavior.Restrict);

        var operation = model.Entity<SiteArticleOperation>();
        operation.ToTable("SiteArticleOperations", t => t.UseSqlOutputClause(false));
        operation.HasKey(x => x.Id);
        operation.Property(x => x.RequestHash).HasMaxLength(64).IsRequired();
        operation.HasOne<IdentityUser>().WithMany().HasForeignKey(x => x.ActorId).OnDelete(DeleteBehavior.Restrict);

        var audit = model.Entity<SiteArticleEvent>();
        audit.ToTable("SiteArticleEvents", t => t.UseSqlOutputClause(false));
        audit.HasKey(x => x.Id);
        audit.Property(x => x.Kind).HasMaxLength(40).IsRequired();
        audit.HasOne<SiteArticle>().WithMany().HasForeignKey(x => x.ArticleId).OnDelete(DeleteBehavior.Restrict);
        audit.HasOne<SiteArticleOperation>().WithMany().HasForeignKey(x => x.OperationId).OnDelete(DeleteBehavior.Restrict);
        audit.HasOne<IdentityUser>().WithMany().HasForeignKey(x => x.ActorId).OnDelete(DeleteBehavior.Restrict);
        audit.HasIndex(x => new { x.ArticleId, x.CreatedUtc });

        var import = model.Entity<SiteArticleImport>();
        import.ToTable("SiteArticleImports");
        import.HasKey(x => x.Path);
        import.Property(x => x.Path).HasMaxLength(450);
        import.Property(x => x.FileHash).HasMaxLength(64).IsRequired();
        import.HasOne<SiteArticleRevision>().WithMany()
            .HasForeignKey(x => new { x.ArticleId, Number = x.RevisionNumber }).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed record ArticleState(Guid Id, string Slug, Guid Version, int HeadRevision,
    int? PublishedRevision, ArticleTrust Trust);
internal sealed record ArticleSource(ArticleState Article, int Number, string Title, string Source,
    ArticleFormat Format, ArticleCommentPolicy CommentPolicy);
internal sealed record PublishedArticle(Guid Id, string Slug, int Number, string Title, string BodyHtml,
    ArticleCommentPolicy CommentPolicy, ArticleTrust Trust, string RenderPolicy);
internal sealed record DraftInput(string Title, string Source, ArticleFormat Format, ArticleCommentPolicy CommentPolicy);
internal sealed record AlternateImportSource(string Path, string Hash, string Source);
internal sealed record ImportInput(string Path, string FileHash, string Slug, DraftInput Draft,
    Guid? ExpectedVersion, AlternateImportSource[] AlternateSources);

internal sealed class ArticleConflictException : Exception {
    public ArticleState Current { get; }
    public ArticleConflictException(ArticleState current) : base("The article changed. Reload it before saving or publishing.") { Current = current; }
}
