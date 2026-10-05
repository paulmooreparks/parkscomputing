using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ParksComputing.Engine.Identity;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Pages.SiteAdmin;

/// <summary>
/// /admin/stats?days=…: the automated readers the site counts itself (AI
/// agents and search engines, Identity/AiVisits.cs) over the last 7, 30, 90
/// or 365 days: totals, day by day, by agent and by page. Visits by people
/// are the analytics' (Site:AnalyticsUrl), which the page links to.
/// </summary>
public sealed class StatsModel : SiteAdminModel {
    private readonly IDbContextFactory<SiteIdentityDbContext> _db;
    public StatsModel(SiteEditor editor, StaffAccess staff, IOptions<AccountOptions> accounts, IOptions<SiteOptions> site,
        IDbContextFactory<SiteIdentityDbContext> db) : base(editor, staff, accounts, site) { _db = db; AnalyticsUrl = site.Value.AnalyticsUrl; }

    public static readonly int[] Ranges = { 7, 30, 90, 365 };
    [BindProperty(SupportsGet = true, Name = "days")] public int Days { get; set; } = 30;
    public string? AnalyticsUrl { get; }

    public sealed record AgentRow(string Agent, string Kind, int Count, int Pages, DateOnly Last);
    public sealed record PageRow(string Path, int Ai, int Search, string Top);
    public sealed record DayRow(DateOnly Day, int Ai, int Search);

    public int AiTotal { get; private set; }
    public int SearchTotal { get; private set; }
    public int ForAi { get; private set; }
    public int NotFound { get; private set; }
    public IReadOnlyList<AgentRow> Agents { get; private set; } = Array.Empty<AgentRow>();
    public IReadOnlyList<PageRow> PagesRead { get; private set; } = Array.Empty<PageRow>();
    public IReadOnlyList<DayRow> DaysRead { get; private set; } = Array.Empty<DayRow>();
    public int MaxDay { get; private set; }

    public async Task<IActionResult> OnGetAsync() {
        if (await GateAsync() is { } away) { return away; }
        ViewData["Crumb"] = null;
        if (!Ranges.Contains(Days)) { Days = 30; }
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var since = today.AddDays(1 - Days);
        await using var db = await _db.CreateDbContextAsync();
        var rows = await db.AiVisits.Where(v => v.Day >= since).ToListAsync();
        bool IsAi(SiteAiVisit v) => AiAgents.KindOf(v.Agent) == AiAgents.Ai;

        AiTotal = rows.Where(IsAi).Sum(v => v.Count);
        SearchTotal = rows.Where(v => !IsAi(v)).Sum(v => v.Count);
        ForAi = rows.Where(v => AiAgents.IsForAi(v.Path)).Sum(v => v.Count);
        NotFound = rows.Where(v => v.Path == "(not found)").Sum(v => v.Count);

        Agents = rows.GroupBy(v => v.Agent)
            .Select(g => new AgentRow(g.Key, AiAgents.KindOf(g.Key), g.Sum(v => v.Count),
                g.Where(v => v.Path != "(not found)").Select(v => v.Path).Distinct().Count(), g.Max(v => v.Day)))
            .OrderByDescending(a => a.Count).ToList();

        PagesRead = rows.Where(v => v.Path != "(not found)").GroupBy(v => v.Path)
            .Select(g => new PageRow(g.Key, g.Where(IsAi).Sum(v => v.Count), g.Where(v => !IsAi(v)).Sum(v => v.Count),
                g.GroupBy(v => v.Agent).OrderByDescending(a => a.Sum(v => v.Count)).First().Key))
            .OrderByDescending(p => p.Ai + p.Search).Take(40).ToList();

        // Every day of the range, the quiet ones too, so the chart keeps time.
        var byDay = rows.GroupBy(v => v.Day).ToDictionary(g => g.Key, g => (Ai: g.Where(IsAi).Sum(v => v.Count), Search: g.Where(v => !IsAi(v)).Sum(v => v.Count)));
        DaysRead = Enumerable.Range(0, Days).Select(i => since.AddDays(i))
            .Select(d => byDay.TryGetValue(d, out var c) ? new DayRow(d, c.Ai, c.Search) : new DayRow(d, 0, 0)).ToList();
        MaxDay = Math.Max(1, DaysRead.Max(d => d.Ai + d.Search));
        return Page();
    }
}
