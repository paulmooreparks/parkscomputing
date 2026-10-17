using System;
using System.Linq;
using System.Threading.Tasks;

using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// The only way to make an admin (Architecture/admin-and-identity-design.md, A3):
/// a command run on the server, never a page a browser can reach.
///
///   docker exec parkscomputing-dev dotnet ParksComputing.Engine.dll admin enroll you@example.com
///   docker exec parkscomputing-dev dotnet ParksComputing.Engine.dll admin list
///   docker exec parkscomputing-dev dotnet ParksComputing.Engine.dll admin revoke you@example.com
///
/// enroll makes the account an admin if it isn't one and prints a link, valid
/// for fifteen minutes and good once, that registers a passkey and signs in.
/// It is also how an admin who has lost every passkey gets back in.
/// </summary>
public static class AdminCommand {
    public static bool Matches(string[] args) => args.Length > 0 && args[0] == "admin";

    public static async Task<int> RunAsync(IServiceProvider root, string[] args) {
        using var scope = root.CreateScope();
        var sp = scope.ServiceProvider;
        await sp.GetRequiredService<SiteIdentityDbContext>().Database.MigrateAsync();
        var users = sp.GetRequiredService<UserManager<IdentityUser>>();
        var roles = sp.GetRequiredService<RoleManager<IdentityRole>>();
        var options = sp.GetRequiredService<IOptions<AdminOptions>>().Value;

        string verb = args.Length > 1 ? args[1] : "";
        string? email = args.Length > 2 ? args[2].Trim() : null;

        switch (verb) {
            case "enroll" when !string.IsNullOrEmpty(email): {
                if (!await roles.RoleExistsAsync(AdminOptions.Role)) {
                    await roles.CreateAsync(new IdentityRole(AdminOptions.Role));
                }
                var user = await users.FindByEmailAsync(email);
                if (user is null) {
                    user = new IdentityUser { UserName = email, Email = email, EmailConfirmed = true };
                    var created = await users.CreateAsync(user);
                    if (!created.Succeeded) {
                        Console.Error.WriteLine("Could not create the account: " + string.Join("; ", created.Errors.Select(e => e.Description)));
                        return 1;
                    }
                }
                if (!await users.IsInRoleAsync(user, AdminOptions.Role)) {
                    await users.AddToRoleAsync(user, AdminOptions.Role);
                }
                await users.SetLockoutEndDateAsync(user, null);
                var token = await users.GenerateUserTokenAsync(user, EmailLinkTokenProvider<IdentityUser>.ProviderName, EmailLinkTokenProvider<IdentityUser>.EnrollPurpose);
                var url = $"{options.EditOrigin.TrimEnd('/')}/admin/enroll?uid={Uri.EscapeDataString(user.Id)}&token={Uri.EscapeDataString(token)}";
                Console.WriteLine($"{email} is an admin. Open this within 15 minutes to register a passkey:");
                Console.WriteLine(url);
                return 0;
            }
            case "list": {
                var admins = await users.GetUsersInRoleAsync(AdminOptions.Role);
                if (admins.Count == 0) {
                    Console.WriteLine("No admins.");
                }
                foreach (var a in admins) {
                    var keys = await users.GetPasskeysAsync(a);
                    Console.WriteLine($"{a.Email}  passkeys: {keys.Count}  recovery codes left: {await users.CountRecoveryCodesAsync(a)}");
                }
                return 0;
            }
            case "revoke" when !string.IsNullOrEmpty(email): {
                var user = await users.FindByEmailAsync(email);
                if (user is null || !await users.IsInRoleAsync(user, AdminOptions.Role)) {
                    Console.Error.WriteLine($"{email} is not an admin.");
                    return 1;
                }
                await users.RemoveFromRoleAsync(user, AdminOptions.Role);
                // A new stamp ends every session and voids every link.
                await users.UpdateSecurityStampAsync(user);
                Console.WriteLine($"{email} is no longer an admin, and every session it had has ended.");
                return 0;
            }
            // AI agents' visits over the last N days (30 unless given), by
            // agent and then by address (Identity/AiVisits.cs).
            case "ai-visits": {
                int days = int.TryParse(email, out var d) && d > 0 ? d : 30;
                var since = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1 - days);
                var rows = await sp.GetRequiredService<SiteIdentityDbContext>().AiVisits
                    .Where(v => v.Day >= since).ToListAsync();
                Console.WriteLine($"AI visits in the last {days} days: {rows.Sum(r => r.Count)}");
                foreach (var agent in rows.GroupBy(r => r.Agent).OrderByDescending(g => g.Sum(r => r.Count))) {
                    Console.WriteLine();
                    Console.WriteLine($"{agent.Key}: {agent.Sum(r => r.Count)}");
                    foreach (var path in agent.GroupBy(r => r.Path).OrderByDescending(g => g.Sum(r => r.Count)).Take(15)) {
                        Console.WriteLine($"  {path.Sum(r => r.Count),6}  {path.Key}");
                    }
                }
                return 0;
            }
            // A personal access token for /mcp (Identity/AccessTokens.cs),
            // made on the server as enroll's link is, for an operator without
            // a browser at hand and for tests:
            //   admin token <email> <name> <capability,capability…> [days]
            // The account must be the super-user; the secret is printed once.
            case "token" when !string.IsNullOrEmpty(email) && args.Length >= 5: {
                var user = await users.FindByEmailAsync(email);
                if (user is null || !await sp.GetRequiredService<AdminSessions>().MaySignInAsync(user)) {
                    Console.Error.WriteLine($"{email} can't use the server's tools, so it can't have a token.");
                    return 1;
                }
                int days = args.Length > 5 && int.TryParse(args[5], out var td) ? td : 30;
                try {
                    var (secret, token) = await sp.GetRequiredService<AccessTokens>().CreateAsync(user.Id, args[3], days, args[4].Split(','));
                    Console.WriteLine($"Token \"{token.Name}\" for {email}, until {token.ExpiresUtc:yyyy-MM-dd HH:mm} UTC, with {string.Join(", ", token.Capabilities)}:");
                    Console.WriteLine(secret);
                    return 0;
                } catch (ArgumentException ex) {
                    Console.Error.WriteLine(ex.Message);
                    return 1;
                }
            }
            case "tokens" when !string.IsNullOrEmpty(email): {
                var user = await users.FindByEmailAsync(email);
                if (user is null) {
                    Console.Error.WriteLine($"There is no account {email}.");
                    return 1;
                }
                var now = DateTime.UtcNow;
                foreach (var t in await sp.GetRequiredService<AccessTokens>().ListAsync(user.Id)) {
                    var state = t.RevokedUtc is not null ? "revoked" : t.ExpiresUtc <= now ? "expired" : "active until " + t.ExpiresUtc.ToString("yyyy-MM-dd");
                    Console.WriteLine($"{t.Id}  {t.Prefix}…  {t.Name}  {state}  {string.Join(",", t.Capabilities)}  last used {(t.LastUsedUtc is { } u ? u.ToString("yyyy-MM-dd HH:mm") : "never")}");
                }
                return 0;
            }
            case "token-revoke" when !string.IsNullOrEmpty(email) && args.Length >= 4: {
                var user = await users.FindByEmailAsync(email);
                if (user is null || !await sp.GetRequiredService<AccessTokens>().RevokeAsync(user.Id, args[3])) {
                    Console.Error.WriteLine("No active token by that id.");
                    return 1;
                }
                Console.WriteLine("Revoked.");
                return 0;
            }
            default:
                Console.Error.WriteLine("Usage: admin enroll <email> | admin list | admin revoke <email> | admin ai-visits [days] | " +
                    "admin token <email> <name> <capabilities> [days] | admin tokens <email> | admin token-revoke <email> <id>");
                return 2;
        }
    }
}
