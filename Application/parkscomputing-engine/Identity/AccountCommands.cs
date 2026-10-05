using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// The operator's account commands, run on the host
/// (Architecture/padmajairam-port-design.md, "Sign-in and editing"). Host
/// access is the recovery authority, so these need no email and no browser:
///
///   account-link &lt;email&gt; [display-name]
///     prints a sign-in link, good once within 15 minutes. An account the
///     site does not have yet is made first, its address taken as verified,
///     since the operator vouches for it.
///   account-role &lt;email&gt; &lt;Admin|Moderator&gt; [--remove]
///     grants or removes a staff role. A staff account must hold two
///     passkeys, so a grant waits until it has them. Either way the
///     account's sessions end, so the change takes effect at its next
///     sign-in.
///
/// Super-user setup is account-bootstrap (Identity/StaffBootstrap.cs).
/// </summary>
public static class AccountCommands {
    public static bool Matches(string[] args) => args.Length > 0 && (args[0] == "account-link" || args[0] == "account-role");

    private static readonly string[] Roles = { "Admin", "Moderator" };

    public static async Task<int> RunAsync(IServiceProvider root, string[] args) {
        var options = root.GetRequiredService<IOptions<AccountOptions>>().Value;
        if (!options.Enabled) { Console.Error.WriteLine("This site has no accounts (Accounts:Enabled is off)."); return 1; }
        using var scope = root.CreateScope();
        var sp = scope.ServiceProvider;
        var db = sp.GetRequiredService<SiteIdentityDbContext>();
        await db.Database.MigrateAsync();
        var users = sp.GetRequiredService<UserManager<IdentityUser>>();

        if (args[0] == "account-link") {
            if (args.Length < 2 || args.Length > 3) { Console.Error.WriteLine("Usage: account-link <email> [display-name]"); return 2; }
            var email = AccountWorkflow.Email(args[1]);
            var user = await users.FindByEmailAsync(email);
            if (user is null) {
                var name = args.Length == 3 ? AccountWorkflow.DisplayName(args[2]) : email.Split('@')[0];
                user = new IdentityUser { UserName = Guid.NewGuid().ToString("N"), Email = email, EmailConfirmed = true };
                var made = await users.CreateAsync(user);
                if (!made.Succeeded) { Console.Error.WriteLine("The account could not be made: " + string.Join("; ", made.Errors.Select(e => e.Description))); return 1; }
                db.AccountProfiles.Add(new SiteAccountProfile { UserId = user.Id, DisplayName = name, Version = Guid.NewGuid(), CreatedUtc = DateTime.UtcNow });
                await db.SaveChangesAsync();
                Console.WriteLine($"Made an account for {email}.");
            } else if (!user.EmailConfirmed) {
                user.EmailConfirmed = true;
                await users.UpdateAsync(user);
            }
            if (await users.IsLockedOutAsync(user) || await db.AccountProfiles.AnyAsync(p => p.UserId == user.Id && p.SuspendedUtc != null)) {
                Console.Error.WriteLine("The account is locked out or suspended."); return 1;
            }
            var token = await sp.GetRequiredService<AccountLinks>().IssueAsync(user.Id, AccountLinkPurpose.SignIn);
            Console.WriteLine("Open this within 15 minutes to sign in, once:");
            Console.WriteLine(options.Origin.TrimEnd('/') + "/account/link?uid=" + Uri.EscapeDataString(user.Id) +
                "&purpose=" + AccountLinkPurpose.SignIn + "&token=" + Uri.EscapeDataString(token));
            return 0;
        }

        // account-role
        if (args.Length < 3 || args.Length > 4 || (args.Length == 4 && args[3] != "--remove")) {
            Console.Error.WriteLine("Usage: account-role <email> <Admin|Moderator> [--remove]"); return 2;
        }
        var role = Roles.FirstOrDefault(r => string.Equals(r, args[2], StringComparison.OrdinalIgnoreCase));
        if (role is null) { Console.Error.WriteLine("The role must be Admin or Moderator; the super-user is set up with account-bootstrap."); return 2; }
        var who = await users.FindByEmailAsync(AccountWorkflow.Email(args[1]));
        if (who is null) { Console.Error.WriteLine("There is no account with that address; account-link makes one."); return 1; }
        bool remove = args.Length == 4;
        if (remove) {
            if (!await users.IsInRoleAsync(who, role)) { Console.WriteLine($"{args[1]} is not {role}."); return 0; }
            await users.RemoveFromRoleAsync(who, role);
        } else {
            var keys = (await users.GetPasskeysAsync(who)).Count;
            if (keys < 2) {
                Console.Error.WriteLine($"{args[1]} has {keys} passkey{(keys == 1 ? "" : "s")}; staff accounts need two. Sign in (account-link) and add them on /account first.");
                return 1;
            }
            var roles = sp.GetRequiredService<RoleManager<IdentityRole>>();
            foreach (var r in new[] { "Member", role }) {
                if (!await roles.RoleExistsAsync(r)) { await roles.CreateAsync(new IdentityRole(r)); }
                if (!await users.IsInRoleAsync(who, r)) { await users.AddToRoleAsync(who, r); }
            }
        }
        // A new stamp ends the account's sessions, so the role applies from its next sign-in.
        await users.UpdateSecurityStampAsync(who);
        await db.SiteSessions.Where(s => s.UserId == who.Id && s.RevokedUtc == null)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedUtc, (DateTime?)DateTime.UtcNow));
        Console.WriteLine(remove ? $"{args[1]} is no longer {role}; its sessions have ended."
            : $"{args[1]} is now {role}. It signs in again with a passkey for the role to apply.");
        return 0;
    }
}
