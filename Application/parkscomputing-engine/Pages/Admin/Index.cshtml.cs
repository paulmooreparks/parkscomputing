using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.AspNetCore.WebUtilities;

using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.Pages.Admin;

/// <summary>The admin's own account: passkeys and recovery codes.</summary>
[Authorize(Roles = AdminOptions.Role)]
public sealed class IndexModel : PageModel {
    private readonly UserManager<IdentityUser> _users;
    private readonly AdminSessions _sessions;

    public IndexModel(UserManager<IdentityUser> users, AdminSessions sessions) {
        _users = users; _sessions = sessions;
    }

    public sealed record PasskeyRow(string Id, string Name, DateTimeOffset Created);

    public string Email { get; private set; } = "";
    public string Method { get; private set; } = "";
    public bool Fallback { get; private set; }
    public IReadOnlyList<PasskeyRow> Passkeys { get; private set; } = Array.Empty<PasskeyRow>();
    public int RecoveryCodesLeft { get; private set; }

    public async Task<IActionResult> OnGetAsync() {
        var me = await _users.GetUserAsync(User);
        if (me is null) {
            return Redirect("/admin/signin");
        }
        Email = me.Email ?? me.UserName ?? "";
        var method = User.FindFirst(AdminSessions.MethodClaim)?.Value;
        Method = AdminSessions.Describe(method);
        Fallback = method != AdminSessions.Passkey;
        Passkeys = (await _users.GetPasskeysAsync(me))
            .OrderBy(p => p.CreatedAt)
            .Select(p => new PasskeyRow(WebEncoders.Base64UrlEncode(p.CredentialId), string.IsNullOrWhiteSpace(p.Name) ? "Passkey" : p.Name!, p.CreatedAt))
            .ToList();
        RecoveryCodesLeft = await _users.CountRecoveryCodesAsync(me);
        return Page();
    }
}
