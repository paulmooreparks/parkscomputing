using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ParksComputing.Engine.Identity.Migrations
{
    /// <inheritdoc />
    public partial class AccountLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SiteAccountLinks",
                columns: table => new
                {
                    TokenHash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    UserId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                    Purpose = table.Column<int>(type: "int", nullable: false),
                    SecurityStamp = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    Email = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    IssuedUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    ExpiresUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    ConsumedUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    SupersededUtc = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SiteAccountLinks", x => x.TokenHash);
                    table.ForeignKey(
                        name: "FK_SiteAccountLinks_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SiteAccountLinks_UserId_Purpose_SupersededUtc",
                table: "SiteAccountLinks",
                columns: new[] { "UserId", "Purpose", "SupersededUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SiteAccountLinks");
        }
    }
}
