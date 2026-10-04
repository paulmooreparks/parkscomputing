using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ParksComputing.Engine.Identity.Migrations
{
    /// <inheritdoc />
    public partial class AccountAvatars : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SiteAccountAvatars",
                columns: table => new
                {
                    UserId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                    ContentType = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Image = table.Column<byte[]>(type: "varbinary(max)", maxLength: 204800, nullable: false),
                    Version = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UpdatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SiteAccountAvatars", x => x.UserId);
                    table.ForeignKey(
                        name: "FK_SiteAccountAvatars_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SiteAccountAvatars");
        }
    }
}
