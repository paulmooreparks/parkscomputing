using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// The automated readers the site counted (SiteAiVisits, Identity/AiVisits.cs)
/// over a period, as the Visits panel shows them
/// (Pages/Shared/_VisitsContent.cshtml): totals, each day, each reader and
/// each page. One report serves the Visits applet and page on any site and a
/// brochure site's /admin/stats.
/// </summary>
public sealed class VisitReport {
    private readonly IDbContextFactory<SiteIdentityDbContext> _db;
    public VisitReport(IDbContextFactory<SiteIdentityDbContext> db) { _db = db; }

    /// <summary>The periods a report covers, in days.</summary>
    public static readonly int[] Ranges = { 7, 30, 90, 365 };

    public static string RangeLabel(int days) => days == 365 ? "The last year" : $"The last {days} days";

    public sealed record AgentRow(string Agent, string Kind, int Count, int Pages, DateOnly Last);
    public sealed record PageRow(string Path, int Ai, int Search, string Top);
    public sealed record DayRow(DateOnly Day, int Ai, int Search);

    public sealed record Report(int Days, int AiTotal, int SearchTotal, int ForAi, int NotFound,
        IReadOnlyList<AgentRow> Agents, IReadOnlyList<PageRow> Pages, IReadOnlyList<DayRow> EachDay) {
        public int MaxDay => Math.Max(1, EachDay.Count == 0 ? 0 : EachDay.Max(d => d.Ai + d.Search));
    }

    /// <summary>The report for the last days (7, 30, 90 or 365; anything
    /// else is taken as 30), by UTC day.</summary>
    public async Task<Report> ForAsync(int days) {
        if (!Ranges.Contains(days)) { days = 30; }
        var since = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1 - days);
        await using var db = await _db.CreateDbContextAsync();
        var rows = await db.AiVisits.Where(v => v.Day >= since).ToListAsync();
        bool IsAi(SiteAiVisit v) => AiAgents.KindOf(v.Agent) == AiAgents.Ai;
        const string missing = "(not found)";

        var agents = rows.GroupBy(v => v.Agent)
            .Select(g => new AgentRow(g.Key, AiAgents.KindOf(g.Key), g.Sum(v => v.Count),
                g.Where(v => v.Path != missing).Select(v => v.Path).Distinct().Count(), g.Max(v => v.Day)))
            .OrderByDescending(a => a.Count).ToList();
        var pages = rows.Where(v => v.Path != missing).GroupBy(v => v.Path)
            .Select(g => new PageRow(g.Key, g.Where(IsAi).Sum(v => v.Count), g.Where(v => !IsAi(v)).Sum(v => v.Count),
                g.GroupBy(v => v.Agent).OrderByDescending(a => a.Sum(v => v.Count)).First().Key))
            .OrderByDescending(p => p.Ai + p.Search).Take(40).ToList();
        // Every day of the period, the quiet ones too, so a chart keeps time.
        var byDay = rows.GroupBy(v => v.Day).ToDictionary(g => g.Key, g => (Ai: g.Where(IsAi).Sum(v => v.Count), Search: g.Where(v => !IsAi(v)).Sum(v => v.Count)));
        var eachDay = Enumerable.Range(0, days).Select(i => since.AddDays(i))
            .Select(d => byDay.TryGetValue(d, out var c) ? new DayRow(d, c.Ai, c.Search) : new DayRow(d, 0, 0)).ToList();

        return new Report(days, rows.Where(IsAi).Sum(v => v.Count), rows.Where(v => !IsAi(v)).Sum(v => v.Count),
            rows.Where(v => AiAgents.IsForAi(v.Path)).Sum(v => v.Count), rows.Where(v => v.Path == missing).Sum(v => v.Count),
            agents, pages, eachDay);
    }
}

/// <summary>What the Visits panel draws: the report, where its period form
/// goes, and where the site's analytics count people.</summary>
public sealed record VisitsView(VisitReport.Report? Report, string FormAction, string? AnalyticsUrl, string Stage = "ready");
