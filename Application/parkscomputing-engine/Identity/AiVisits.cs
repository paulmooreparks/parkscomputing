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
/// Which automated agent a request comes from, AI or search engine, by the
/// name each operator publishes for its crawlers and assistants in their
/// user-agent strings. The list is the operators' documented names; an
/// agent that hides its name is not counted as one, and a request for the
/// site's Markdown or llms.txt from an agent not on the list is counted as
/// "Unlisted", an AI reader. People are not counted here at all: that is
/// the site's analytics' work.
/// </summary>
public static class AiAgents {
    public const string Ai = "AI";
    public const string Search = "Search";

    // Each pattern is the token the operator documents, matched as a word.
    private static readonly (string Name, string Kind, Regex Pattern)[] Known = new[] {
        ("OpenAI GPTBot", Ai, "GPTBot"), ("OpenAI ChatGPT-User", Ai, "ChatGPT-User"), ("OpenAI OAI-SearchBot", Ai, "OAI-SearchBot"),
        ("Anthropic ClaudeBot", Ai, "ClaudeBot"), ("Anthropic Claude-User", Ai, "Claude-User"), ("Anthropic Claude-SearchBot", Ai, "Claude-SearchBot"),
        ("Anthropic", Ai, "anthropic-ai"),
        ("Perplexity PerplexityBot", Ai, "PerplexityBot"), ("Perplexity-User", Ai, "Perplexity-User"),
        ("Google-CloudVertexBot", Ai, "Google-CloudVertexBot"), ("Google GoogleOther", Ai, "GoogleOther"),
        ("Meta ExternalAgent", Ai, "meta-externalagent"), ("Meta ExternalFetcher", Ai, "meta-externalfetcher"),
        ("Amazonbot", Ai, "Amazonbot"),
        ("ByteDance Bytespider", Ai, "Bytespider"), ("Common Crawl CCBot", Ai, "CCBot"),
        ("Cohere", Ai, "cohere-ai|cohere-training-data-crawler"), ("Mistral MistralAI-User", Ai, "MistralAI-User"),
        ("DuckDuckGo DuckAssistBot", Ai, "DuckAssistBot"), ("You.com YouBot", Ai, "YouBot"),
        ("Diffbot", Ai, "Diffbot"), ("Timpibot", Ai, "Timpibot"), ("AI2Bot", Ai, "AI2Bot"),
        ("Google Googlebot", Search, "Googlebot"), ("Microsoft Bingbot", Search, "bingbot"), ("Apple Applebot", Search, "Applebot"),
        ("DuckDuckGo DuckDuckBot", Search, "DuckDuckBot"), ("Yandex", Search, "YandexBot"), ("Baidu", Search, "Baiduspider"),
        ("Seznam", Search, "SeznamBot"), ("Huawei PetalBot", Search, "PetalBot"),
    }.Select(k => (k.Item1, k.Item2, new Regex(@"(?<![A-Za-z0-9])(?:" + k.Item3 + @")(?![A-Za-z0-9])", RegexOptions.IgnoreCase | RegexOptions.Compiled))).ToArray();

    public const string Unlisted = "Unlisted";

    /// <summary>The agent's name, or null when the user agent is none of
    /// the known ones.</summary>
    public static string? Of(string? userAgent) {
        if (string.IsNullOrEmpty(userAgent)) { return null; }
        foreach (var (name, _, pattern) in Known) {
            if (pattern.IsMatch(userAgent)) { return name; }
        }
        return null;
    }

    /// <summary>Whether a counted agent is an AI reader or a search
    /// engine's crawler.</summary>
    public static string KindOf(string agent) =>
        Known.FirstOrDefault(k => k.Name == agent).Kind ?? Ai;

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
        // The address as asked, before anything later rewrites it (a
        // brochure site serves / as /home).
        var path = ctx.Request.Path.Value ?? "/";
        await next();
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
