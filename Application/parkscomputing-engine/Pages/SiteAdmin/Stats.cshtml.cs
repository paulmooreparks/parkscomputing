using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using ParksComputing.Engine.Identity;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Pages.SiteAdmin;

/// <summary>
/// /admin/stats?days=…: a brochure site's Visits, the same panel as the
/// Visits applet (Pages/Shared/_VisitsContent.cshtml, Identity/VisitReport.cs)
/// among the site's editing pages.
/// </summary>
public sealed class StatsModel : SiteAdminModel {
    private readonly VisitReport _report;
    private readonly string? _analytics;
    public StatsModel(SiteEditor editor, StaffAccess staff, IOptions<AccountOptions> accounts, IOptions<SiteOptions> site, VisitReport report)
        : base(editor, staff, accounts, site) { _report = report; _analytics = site.Value.AnalyticsUrl; }

    [BindProperty(SupportsGet = true, Name = "days")] public int Days { get; set; } = 30;
    public VisitsView? View { get; private set; }

    public async Task<IActionResult> OnGetAsync() {
        if (await GateAsync() is { } away) { return away; }
        View = new VisitsView(await _report.ForAsync(Days), "/admin/stats", _analytics);
        return Page();
    }
}
