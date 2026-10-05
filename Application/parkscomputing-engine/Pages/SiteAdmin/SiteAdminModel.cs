using System;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.Extensions.Options;
using ParksComputing.Engine.Identity;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Pages.SiteAdmin;

/// <summary>
/// What every page of a brochure site's editing shares
/// (Architecture/padmajairam-port-design.md, "Sign-in and editing"). The
/// pages exist only on a brochure site with staff accounts; anyone not
/// signed in is sent to sign in and brought back; a signed-in account that
/// is not staff finds nothing. Reading needs a live staff session, and
/// changing anything needs one confirmed with a passkey, which a page asks
/// for with its Confirm button.
/// </summary>
public abstract class SiteAdminModel : PageModel {
    protected readonly SiteEditor Editor;
    private readonly StaffAccess _staff;
    private readonly AccountOptions _accounts;
    private readonly SiteOptions _site;

    protected SiteAdminModel(SiteEditor editor, StaffAccess staff, IOptions<AccountOptions> accounts, IOptions<SiteOptions> site) {
        Editor = editor; _staff = staff; _accounts = accounts.Value; _site = site.Value;
    }

    public bool Superuser { get; private set; }
    /// <summary>Whether the session is confirmed with a passkey, which any
    /// change needs.</summary>
    public bool Confirmed { get; private set; }
    public string Who => User.FindFirstValue(ClaimTypes.Email) ?? User.Identity?.Name ?? "staff";

    /// <summary>Null when the reader may be here; otherwise where they go
    /// instead: to sign in, or nowhere.</summary>
    protected async Task<IActionResult?> GateAsync() {
        if (!_site.Brochure || !_accounts.Enabled || !_accounts.StaffEnabled) { return NotFound(); }
        if (User.Identity?.IsAuthenticated != true) {
            return Redirect("/account/signin?returnUrl=" + Uri.EscapeDataString(Request.Path + Request.QueryString));
        }
        if (!await _staff.AllowedAsync(User, confirmed: false)) { return NotFound(); }
        Superuser = await _staff.SuperuserAsync(User, confirmed: false);
        Confirmed = await _staff.AllowedAsync(User, confirmed: true);
        ViewData["Workspace"] = true;
        return null;
    }

    protected string ClientIp => AdminOptions.ClientIp(HttpContext);

    /// <summary>A time as the site's readers keep it (Site:TimeZone), or UTC.</summary>
    public string When(DateTime utc) {
        var zone = TimeZoneInfo.Utc;
        if (!string.IsNullOrWhiteSpace(_site.TimeZone)) {
            try { zone = TimeZoneInfo.FindSystemTimeZoneById(_site.TimeZone!); } catch (TimeZoneNotFoundException) { }
        }
        var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), zone);
        return local.ToString("d MMMM yyyy, h:mm tt") + (zone == TimeZoneInfo.Utc ? " UTC" : "");
    }
}
