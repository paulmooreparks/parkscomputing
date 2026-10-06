using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.Extensions.Options;
using ParksComputing.Engine.Identity;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Pages;

/// <summary>
/// Visits (Identity/VisitReport.cs): the automated readers the site counts,
/// for its staff, an Admin or the super-user. The classic page is /visits;
/// the visits applet (js/visits.js) shows the same panel in a window
/// (?handler=Applet). The period is the address's query, so a view can be
/// bookmarked, and it works without script. The counts hold nothing about a
/// person, so reading them needs no fresh passkey tap. Anyone else finds
/// nothing; a brochure site has the same panel at /admin/stats.
/// </summary>
public sealed class VisitsModel : PageModel {
    private readonly VisitReport _report; private readonly StaffAccess _staff; private readonly SiteOptions _site;
    public VisitsModel(VisitReport report, StaffAccess staff, IOptions<SiteOptions> site) { _report = report; _staff = staff; _site = site.Value; }

    [BindProperty(SupportsGet = true, Name = "days")] public int Days { get; set; } = 30;
    public VisitsView View { get; private set; } = new(null, "/visits", null, "signin");

    private async Task<bool> LoadAsync() {
        Response.Headers.CacheControl = "no-cache, no-store";
        ViewData["Title"] = "Visits";
        if (User.Identity?.IsAuthenticated != true) { return true; }
        if (!await _staff.AllowedAsync(User, confirmed: false)) { return false; }
        View = new VisitsView(await _report.ForAsync(Days), "/visits", _site.AnalyticsUrl);
        return true;
    }

    public async Task<IActionResult> OnGetAsync() {
        if (_site.Brochure) { return Redirect("/admin/stats" + Request.QueryString); }
        return await LoadAsync() ? Page() : NotFound();
    }
    public async Task<IActionResult> OnGetAppletAsync() => await LoadAsync() ? Partial("_VisitsContent", View) : NotFound();
}
