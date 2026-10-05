using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ParksComputing.Engine.Identity;

/// <summary>How often an AI agent fetched one address on one day
/// (Architecture/padmajairam-port-design.md, "Readable by AI"). Only the
/// agent's name and the address are kept, never who or where from.</summary>
internal sealed class SiteAiVisit {
    public DateOnly Day { get; set; }
    public string Agent { get; set; } = "";
    public string Path { get; set; } = "";
    public int Count { get; set; }

    internal static void Configure(ModelBuilder builder) {
        var v = builder.Entity<SiteAiVisit>();
        v.ToTable("SiteAiVisits");
        v.HasKey(x => new { x.Day, x.Agent, x.Path });
        v.Property(x => x.Agent).HasMaxLength(64);
        v.Property(x => x.Path).HasMaxLength(256);
    }
}

/// <summary>
/// Which AI agent a request comes from, by the name each operator publishes
/// for its crawlers and assistants in their user-agent strings. The list is
/// the operators' documented names; an agent that hides its name is not
/// counted as one, and a request for the site's Markdown or llms.txt from
/// an agent not on the list is counted as "Unlisted".
/// </summary>
public static class AiAgents {
    // Each pattern is the token the operator documents, matched as a word.
    private static readonly (string Name, Regex Pattern)[] Known = new[] {
        ("OpenAI GPTBot", "GPTBot"), ("OpenAI ChatGPT-User", "ChatGPT-User"), ("OpenAI OAI-SearchBot", "OAI-SearchBot"),
        ("Anthropic ClaudeBot", "ClaudeBot"), ("Anthropic Claude-User", "Claude-User"), ("Anthropic Claude-SearchBot", "Claude-SearchBot"),
        ("Anthropic", "anthropic-ai"),
        ("Perplexity PerplexityBot", "PerplexityBot"), ("Perplexity-User", "Perplexity-User"),
        ("Google-CloudVertexBot", "Google-CloudVertexBot"), ("Google GoogleOther", "GoogleOther"),
        ("Meta ExternalAgent", "meta-externalagent"), ("Meta ExternalFetcher", "meta-externalfetcher"),
        ("Amazonbot", "Amazonbot"), ("Applebot", "Applebot"),
        ("ByteDance Bytespider", "Bytespider"), ("Common Crawl CCBot", "CCBot"),
        ("Cohere", "cohere-ai|cohere-training-data-crawler"), ("Mistral MistralAI-User", "MistralAI-User"),
        ("DuckDuckGo DuckAssistBot", "DuckAssistBot"), ("You.com YouBot", "YouBot"),
        ("Diffbot", "Diffbot"), ("Timpibot", "Timpibot"), ("AI2Bot", "AI2Bot"),
    }.Select(k => (k.Item1, new Regex(@"(?<![A-Za-z0-9])(?:" + k.Item2 + @")(?![A-Za-z0-9])", RegexOptions.IgnoreCase | RegexOptions.Compiled))).ToArray();

    public const string Unlisted = "Unlisted";

    /// <summary>The agent's name, or null when the user agent is none of
    /// the known ones.</summary>
    public static string? Of(string? userAgent) {
        if (string.IsNullOrEmpty(userAgent)) { return null; }
        foreach (var (name, pattern) in Known) {
            if (pattern.IsMatch(userAgent)) { return name; }
        }
        return null;
    }

    /// <summary>Whether a path is one of the site's addresses made for AI
    /// readers: llms.txt or a page's Markdown.</summary>
    public static bool IsForAi(string path) =>
        path.Equals("/llms.txt", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".md", StringComparison.OrdinalIgnoreCase);
}

/// <summary>
/// Counts AI agents' requests as they happen, in memory, and hands the
/// totals to AiVisitWriter, which adds them to SiteAiVisits once a minute,
/// so counting costs a request nothing but a dictionary update.
/// </summary>
public sealed class AiVisitCounter {
    private ConcurrentDictionary<(DateOnly Day, string Agent, string Path), int> _counts = new();

    internal void Add(string agent, string path) {
        var key = (DateOnly.FromDateTime(DateTime.UtcNow), agent, path);
        _counts.AddOrUpdate(key, 1, (_, n) => n + 1);
    }

    internal IReadOnlyDictionary<(DateOnly Day, string Agent, string Path), int> Take() =>
        Interlocked.Exchange(ref _counts, new());

    /// <summary>The middleware: after the response, a request from a known
    /// AI agent, or for llms.txt or a page's Markdown from anyone, is
    /// counted under its address, or under "(not found)" when it failed, so
    /// guesses at addresses do not each add a row.</summary>
    public static async Task Middleware(HttpContext ctx, Func<Task> next) {
        await next();
        var path = ctx.Request.Path.Value ?? "/";
        var agent = AiAgents.Of(ctx.Request.Headers.UserAgent.ToString())
            ?? (AiAgents.IsForAi(path) ? AiAgents.Unlisted : null);
        if (agent is null) { return; }
        var counted = ctx.Response.StatusCode < 400 ? path.ToLowerInvariant() : "(not found)";
        if (counted.Length > 256) { counted = counted[..256]; }
        ctx.RequestServices.GetRequiredService<AiVisitCounter>().Add(agent, counted);
    }
}

/// <summary>Adds the counted visits to the database once a minute, and once
/// more as the site stops.</summary>
internal sealed class AiVisitWriter : BackgroundService {
    private readonly AiVisitCounter _counter;
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<AiVisitWriter> _log;

    public AiVisitWriter(AiVisitCounter counter, IServiceScopeFactory scopes, ILogger<AiVisitWriter> log) {
        _counter = counter; _scopes = scopes; _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stop) {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        try {
            while (await timer.WaitForNextTickAsync(stop)) { await WriteAsync(CancellationToken.None); }
        } catch (OperationCanceledException) { }
        await WriteAsync(CancellationToken.None);
    }

    private async Task WriteAsync(CancellationToken ct) {
        var counts = _counter.Take();
        if (counts.Count == 0) { return; }
        try {
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<SiteIdentityDbContext>();
            foreach (var ((day, agent, path), n) in counts) {
                var row = await db.AiVisits.FindAsync(new object[] { day, agent, path }, ct);
                if (row is null) { db.AiVisits.Add(new SiteAiVisit { Day = day, Agent = agent, Path = path, Count = n }); }
                else { row.Count += n; }
            }
            await db.SaveChangesAsync(ct);
        } catch (Exception ex) {
            // A count lost to a database hiccup is not worth failing over.
            _log.LogWarning(ex, "AI visits could not be written ({Rows} rows).", counts.Count);
        }
    }
}
