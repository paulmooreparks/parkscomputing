using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SmartSam.Comments.Data.Migrations
{
    /// <inheritdoc />
    public partial class InitialDbCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Users",
                columns: table => new
                {
                    UserId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    Domain = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Email = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CreateDateTime = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Users", x => new { x.UserId, x.Domain });
                });

            migrationBuilder.CreateTable(
                name: "Comments",
                columns: table => new
                {
                    CommentId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    Domain = table.Column<string>(type: "nvarchar(450)", nullable: true),
                    PageId = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Title = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Name = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Email = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CommentText = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CreateDateTime = table.Column<DateTime>(type: "datetime2", nullable: false),
                    Edited = table.Column<bool>(type: "bit", nullable: false),
                    IsFlagged = table.Column<bool>(type: "bit", nullable: false),
                    Status = table.Column<int>(type: "int", nullable: true),
                    UserId = table.Column<string>(type: "nvarchar(450)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Comments", x => x.CommentId);
                    table.ForeignKey(
                        name: "FK_Comments_Users_UserId_Domain",
                        columns: x => new { x.UserId, x.Domain },
                        principalTable: "Users",
                        principalColumns: new[] { "UserId", "Domain" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Comments_Domain",
                table: "Comments",
                column: "Domain");

            migrationBuilder.CreateIndex(
                name: "IX_Comments_UserId_Domain",
                table: "Comments",
                columns: new[] { "UserId", "Domain" });

            migrationBuilder.CreateIndex(
                name: "IX_Users_Domain",
                table: "Users",
                column: "Domain");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Comments");

            migrationBuilder.DropTable(
                name: "Users");
        }
    }
}
