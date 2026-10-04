using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.Publishing;

internal static class ArticleImportCommand {
    public static bool Matches(string[] args) => args.Length > 0 && args[0] == "article-import";
    public static async Task<int> RunAsync(IServiceProvider services, string[] args) {
        if (args.Length != 3 && args.Length != 5 || args.Length < 3
            || (args[1] != "--plan" && args[1] != "--apply")
            || (args[1] == "--plan" && args.Length != 3)
            || (args[1] == "--apply" && (args.Length != 5 || args[3] != "--actor"))) {
            Console.Error.WriteLine("Usage: article-import --plan <content-root> | article-import --apply <plan.json> --actor <email>");
            return 2;
        }
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>();
        await db.Database.OpenConnectionAsync();
        await using var command = db.Database.GetDbConnection().CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'SiteArticles'";
        bool installed = Convert.ToInt32(await command.ExecuteScalarAsync()) == 1;
        var store = scope.ServiceProvider.GetRequiredService<ArticleStore>();
        var json = new JsonSerializerOptions { WriteIndented = true };
        if (args[1] == "--plan") {
            var plan = await ArticleImportPlanner.PlanAsync(args[2], slug => installed ? store.FindAsync(slug) : Task.FromResult<ArticleState?>(null));
            Console.WriteLine(JsonSerializer.Serialize(plan, json));
            return 0;
        }
        if (!installed) { Console.Error.WriteLine("The publishing schema must be installed before applying an import. No migrations were run."); return 1; }
        var input = JsonSerializer.Deserialize<ArticleImportPlan>(await File.ReadAllTextAsync(args[2]))
            ?? throw new ArgumentException("Invalid import plan.");
        ArticleImportPlanner.Verify(input);
        var user = await scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>().FindByEmailAsync(args[4]);
        if (user is null) { Console.Error.WriteLine("The selected operator account does not exist."); return 1; }
        var result = await store.ImportAsync(input.Articles, user.Id, input.OperationId);
        Console.WriteLine(JsonSerializer.Serialize(new { Imported = result.Length, PublicationChanged = false, Articles = result }, json));
        return 0;
    }
}
