using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;

using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Identity;

/// <summary>Host-only, read-only migration inventory. Never migrates or starts the web host.</summary>
public static class IdentityInventoryCommand {
    public static bool Matches(string[] args) => args.Length > 0 && args[0] == "identity-inventory";

    public static async Task<int> RunAsync(IServiceProvider root, string[] args) {
        if (args.Length != 1) {
            Console.Error.WriteLine("Usage: identity-inventory");
            return 2;
        }
        using var scope = root.CreateScope();
        var services = scope.ServiceProvider;
        var db = services.GetRequiredService<SiteIdentityDbContext>();
        var options = services.GetRequiredService<IOptions<AdminOptions>>().Value;
        var env = services.GetRequiredService<IWebHostEnvironment>();
        // Project only migration facts. Credential material, tokens, security stamps
        // and data-protection keys must never enter the report or query output.
        var accounts = await db.Users.AsNoTracking().OrderBy(u => u.Id)
            .Select(u => new { u.Id, u.Email, u.EmailConfirmed, u.LockoutEnabled, u.LockoutEnd }).ToListAsync();
        var roles = await (from ur in db.UserRoles.AsNoTracking()
                           join r in db.Roles.AsNoTracking() on ur.RoleId equals r.Id
                           select new { ur.UserId, r.Name }).ToListAsync();
        var connection = db.Database.GetDbConnection();
        await db.Database.OpenConnectionAsync();
        var keyCounts = new Dictionary<string, int>(StringComparer.Ordinal);
        await using (var command = connection.CreateCommand()) {
            command.CommandText = "SELECT [UserId], COUNT(*) FROM [AspNetUserPasskeys] GROUP BY [UserId]";
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync()) { keyCounts.Add(reader.GetString(0), reader.GetInt32(1)); }
        }
        // Inventory table names only. Old comment bodies may contain personal data;
        // inspecting or importing them is a separate provenance review.
        var commentTables = new List<string>();
        await using (var command = connection.CreateCommand()) {
            command.CommandText = "SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES " +
                "WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME LIKE '%Comment%' ORDER BY TABLE_SCHEMA, TABLE_NAME";
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync()) { commentTables.Add(reader.GetString(0) + "." + reader.GetString(1)); }
        }
        var report = new {
            GeneratedUtc = DateTimeOffset.UtcNow,
            ReadOnly = true,
            Accounts = accounts.Select(u => new {
                u.Id, u.Email, u.EmailConfirmed,
                LockedOut = u.LockoutEnabled && u.LockoutEnd > DateTimeOffset.UtcNow,
                Roles = roles.Where(r => r.UserId == u.Id).Select(r => r.Name).OrderBy(n => n).ToArray(),
                PasskeyCount = keyCounts.GetValueOrDefault(u.Id),
                CredentialOrigin = "Not stored per credential; verify provenance before migration"
            }),
            ConfiguredPasskeyOrigin = options.EditOrigin,
            PublicOrigin = options.PublicOrigin,
            WebRoot = env.WebRootPath,
            LocalCommentTables = commentTables,
            LegacyCommentStatus = "External service and other databases have not been inventoried"
        };
        Console.WriteLine(JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
        return 0;
    }
}
