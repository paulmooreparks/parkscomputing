using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ParksComputing.Engine.Identity.Migrations
{
    /// <inheritdoc />
    public partial class PolicyAgreement : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "PoliciesAcceptedUtc",
                table: "SiteAccountProfiles",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PrivacyVersion",
                table: "SiteAccountProfiles",
                type: "nvarchar(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TermsVersion",
                table: "SiteAccountProfiles",
                type: "nvarchar(40)",
                maxLength: 40,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PoliciesAcceptedUtc",
                table: "SiteAccountProfiles");

            migrationBuilder.DropColumn(
                name: "PrivacyVersion",
                table: "SiteAccountProfiles");

            migrationBuilder.DropColumn(
                name: "TermsVersion",
                table: "SiteAccountProfiles");
        }
    }
}
