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
            default:
                Console.Error.WriteLine("Usage: admin enroll <email> | admin list | admin revoke <email>");
                return 2;
        }
    }
}
