using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ParksComputing.Engine.Identity.Migrations
{
    /// <inheritdoc />
    public partial class Comments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SiteDiscussions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Slug = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SiteDiscussions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "SiteComments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    DiscussionId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    AuthorId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: true),
                    ParentId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    CreatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    PublishedRevisionId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    State = table.Column<int>(type: "int", nullable: false),
                    Version = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    IdempotencyKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SiteComments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SiteComments_AspNetUsers_AuthorId",
                        column: x => x.AuthorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SiteComments_SiteComments_ParentId",
                        column: x => x.ParentId,
                        principalTable: "SiteComments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SiteComments_SiteDiscussions_DiscussionId",
                        column: x => x.DiscussionId,
                        principalTable: "SiteDiscussions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SiteCommentDecisions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CommentId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    RevisionId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    ActorId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: true),
                    Kind = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Reason = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    CreatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SiteCommentDecisions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SiteCommentDecisions_AspNetUsers_ActorId",
                        column: x => x.ActorId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SiteCommentDecisions_SiteComments_CommentId",
                        column: x => x.CommentId,
                        principalTable: "SiteComments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SiteCommentReports",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CommentId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ReporterId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                    Reason = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    ResolvedUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    ResolvedBy = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SiteCommentReports", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SiteCommentReports_AspNetUsers_ReporterId",
                        column: x => x.ReporterId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_SiteCommentReports_SiteComments_CommentId",
                        column: x => x.CommentId,
                        principalTable: "SiteComments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SiteCommentRevisions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CommentId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Number = table.Column<int>(type: "int", nullable: false),
                    Source = table.Column<string>(type: "nvarchar(max)", maxLength: 10000, nullable: false),
                    Redacted = table.Column<bool>(type: "bit", nullable: false),
                    Status = table.Column<int>(type: "int", nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    DecidedUtc = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SiteCommentRevisions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SiteCommentRevisions_SiteComments_CommentId",
                        column: x => x.CommentId,
                        principalTable: "SiteComments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SiteCommentDecisions_ActorId",
                table: "SiteCommentDecisions",
                column: "ActorId");

            migrationBuilder.CreateIndex(
                name: "IX_SiteCommentDecisions_CommentId_CreatedUtc",
                table: "SiteCommentDecisions",
                columns: new[] { "CommentId", "CreatedUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_SiteCommentReports_CommentId_ReporterId",
                table: "SiteCommentReports",
                columns: new[] { "CommentId", "ReporterId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SiteCommentReports_ReporterId",
                table: "SiteCommentReports",
                column: "ReporterId");

            migrationBuilder.CreateIndex(
                name: "IX_SiteCommentReports_ResolvedUtc",
                table: "SiteCommentReports",
                column: "ResolvedUtc");

            migrationBuilder.CreateIndex(
                name: "IX_SiteCommentRevisions_CommentId_Number",
                table: "SiteCommentRevisions",
                columns: new[] { "CommentId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SiteCommentRevisions_Status_CreatedUtc",
                table: "SiteCommentRevisions",
                columns: new[] { "Status", "CreatedUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_SiteComments_AuthorId_IdempotencyKey",
                table: "SiteComments",
                columns: new[] { "AuthorId", "IdempotencyKey" },
                unique: true,
                filter: "[AuthorId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_SiteComments_DiscussionId_CreatedUtc",
                table: "SiteComments",
                columns: new[] { "DiscussionId", "CreatedUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_SiteComments_ParentId",
                table: "SiteComments",
                column: "ParentId");

            migrationBuilder.CreateIndex(
                name: "IX_SiteDiscussions_Slug",
                table: "SiteDiscussions",
                column: "Slug",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SiteCommentDecisions");

            migrationBuilder.DropTable(
                name: "SiteCommentReports");

            migrationBuilder.DropTable(
                name: "SiteCommentRevisions");

            migrationBuilder.DropTable(
                name: "SiteComments");

            migrationBuilder.DropTable(
                name: "SiteDiscussions");
        }
    }
}
