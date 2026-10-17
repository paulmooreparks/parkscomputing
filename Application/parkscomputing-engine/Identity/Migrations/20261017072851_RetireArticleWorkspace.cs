using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ParksComputing.Engine.Identity.Migrations
{
    /// <inheritdoc />
    public partial class RetireArticleWorkspace : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SiteArticleAliases");

            migrationBuilder.DropTable(
                name: "SiteArticleEvents");

            migrationBuilder.DropTable(
                name: "SiteArticleImports");

            migrationBuilder.DropTable(
                name: "SiteArticlePublications");

            migrationBuilder.DropTable(
                name: "SiteArticleOperations");

            migrationBuilder.DropTable(
                name: "SiteArticleRevisions");

            migrationBuilder.DropTable(
                name: "SiteArticles");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SiteArticleOperations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    CreatedUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    RequestHash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ResultJson = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SiteArticleOperations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SiteArticleOperations_AspNetUsers_ActorId",
                        column: x => x.ActorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SiteArticles",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CreatedUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    HeadRevision = table.Column<int>(type: "int", nullable: false),
                    Slug = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: false),
                    Trust = table.Column<int>(type: "int", nullable: false),
                    Version = table.Column<Guid>(type: "uniqueidentifier", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SiteArticles", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "SiteArticleAliases",
                columns: table => new
                {
                    Slug = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: false),
                    ArticleId = table.Column<Guid>(type: "uniqueidentifier", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SiteArticleAliases", x => x.Slug);
                    table.ForeignKey(
                        name: "FK_SiteArticleAliases_SiteArticles_ArticleId",
                        column: x => x.ArticleId,
                        principalTable: "SiteArticles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SiteArticleEvents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    AfterVersion = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ArticleId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    BeforeVersion = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CreatedUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    OperationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    RevisionNumber = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SiteArticleEvents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SiteArticleEvents_AspNetUsers_ActorId",
                        column: x => x.ActorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SiteArticleEvents_SiteArticleOperations_OperationId",
                        column: x => x.OperationId,
                        principalTable: "SiteArticleOperations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SiteArticleEvents_SiteArticles_ArticleId",
                        column: x => x.ArticleId,
                        principalTable: "SiteArticles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SiteArticleRevisions",
                columns: table => new
                {
                    ArticleId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Number = table.Column<int>(type: "int", nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    CommentPolicy = table.Column<int>(type: "int", nullable: false),
                    CreatedUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Format = table.Column<int>(type: "int", nullable: false),
                    ImportSourcesJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Source = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    SourceHash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Title = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SiteArticleRevisions", x => new { x.ArticleId, x.Number });
                    table.ForeignKey(
                        name: "FK_SiteArticleRevisions_AspNetUsers_ActorId",
                        column: x => x.ActorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SiteArticleRevisions_SiteArticles_ArticleId",
                        column: x => x.ArticleId,
                        principalTable: "SiteArticles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SiteArticleImports",
                columns: table => new
                {
                    Path = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                    AlternateSourcesJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    ArticleId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    FileHash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    RevisionNumber = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SiteArticleImports", x => x.Path);
                    table.ForeignKey(
                        name: "FK_SiteArticleImports_SiteArticleRevisions_ArticleId_RevisionNumber",
                        columns: x => new { x.ArticleId, x.RevisionNumber },
                        principalTable: "SiteArticleRevisions",
                        principalColumns: new[] { "ArticleId", "Number" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SiteArticlePublications",
                columns: table => new
                {
                    ArticleId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    BodyHtml = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    PublishedUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    RenderPolicy = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    RevisionNumber = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SiteArticlePublications", x => x.ArticleId);
                    table.ForeignKey(
                        name: "FK_SiteArticlePublications_SiteArticleRevisions_ArticleId_RevisionNumber",
                        columns: x => new { x.ArticleId, x.RevisionNumber },
                        principalTable: "SiteArticleRevisions",
                        principalColumns: new[] { "ArticleId", "Number" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SiteArticleAliases_ArticleId",
                table: "SiteArticleAliases",
                column: "ArticleId");

            migrationBuilder.CreateIndex(
                name: "IX_SiteArticleEvents_ActorId",
                table: "SiteArticleEvents",
                column: "ActorId");

            migrationBuilder.CreateIndex(
                name: "IX_SiteArticleEvents_ArticleId_CreatedUtc",
                table: "SiteArticleEvents",
                columns: new[] { "ArticleId", "CreatedUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_SiteArticleEvents_OperationId",
                table: "SiteArticleEvents",
                column: "OperationId");

            migrationBuilder.CreateIndex(
                name: "IX_SiteArticleImports_ArticleId_RevisionNumber",
                table: "SiteArticleImports",
                columns: new[] { "ArticleId", "RevisionNumber" });

            migrationBuilder.CreateIndex(
                name: "IX_SiteArticleOperations_ActorId",
                table: "SiteArticleOperations",
                column: "ActorId");

            migrationBuilder.CreateIndex(
                name: "IX_SiteArticlePublications_ArticleId_RevisionNumber",
                table: "SiteArticlePublications",
                columns: new[] { "ArticleId", "RevisionNumber" });

            migrationBuilder.CreateIndex(
                name: "IX_SiteArticleRevisions_ActorId",
                table: "SiteArticleRevisions",
                column: "ActorId");

            migrationBuilder.CreateIndex(
                name: "IX_SiteArticles_Slug",
                table: "SiteArticles",
                column: "Slug",
                unique: true);
        }
    }
}
