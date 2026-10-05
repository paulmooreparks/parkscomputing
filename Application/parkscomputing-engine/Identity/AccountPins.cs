using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Identity;

/// <summary>An account's pins (Architecture/pins-design.md), kept as one
/// list, in order, since the reader edits it as a whole.</summary>
internal sealed class SiteAccountPins {
    public string UserId { get; set; } = "";
    public string Pins { get; set; } = "[]";
    public DateTime UpdatedUtc { get; set; }

    internal static void Configure(ModelBuilder builder) {
        var pins = builder.Entity<SiteAccountPins>();
        pins.ToTable("SiteAccountPins");
        pins.HasKey(p => p.UserId);
        pins.Property(p => p.UserId).HasMaxLength(450);
        pins.Property(p => p.Pins).HasMaxLength(AccountPins.MaxJson);
        pins.HasOne<IdentityUser>().WithOne().HasForeignKey<SiteAccountPins>(p => p.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

/// <summary>One pinned item: the window key, a book's chapter, and the title
/// and icon its window shows. The page it leads to is worked out from the key
/// and chapter, never stored.</summary>
public sealed record Pin(string Key, string? Chapter, string Title, string? Icon, bool Applet);

public sealed class AccountPins {
    public const int MaxPins = 50;
    public const int MaxJson = 32 * 1024;
    private static readonly Regex KeyShape = new("^[A-Za-z0-9_-]{1,100}$", RegexOptions.Compiled);
    private static readonly Regex IconShape = new("^/[A-Za-z0-9._/-]{1,300}$", RegexOptions.Compiled);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly IDbContextFactory<SiteIdentityDbContext> _factory;
    private readonly TimeProvider _clock;
    public AccountPins(IDbContextFactory<SiteIdentityDbContext> factory, TimeProvider clock) { _factory = factory; _clock = clock; }

    /// <summary>The pins a request offers, cleaned: each field checked, the
    /// title trimmed of control characters, a repeated item dropped, and at
    /// most MaxPins kept. Null when the list is not one of pins at all.</summary>
    public static IReadOnlyList<Pin>? Clean(IEnumerable<Pin?>? offered) {
        if (offered is null) { return null; }
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var list = new List<Pin>();
        foreach (var p in offered) {
            if (p is null || !KeyShape.IsMatch(p.Key ?? "")) { return null; }
            var chapter = string.IsNullOrEmpty(p.Chapter) ? null : p.Chapter;
            if (chapter is not null && (chapter.Length > 400 || !BookService.IsSafePath(chapter))) { return null; }
            var title = new string((p.Title ?? "").Where(c => !char.IsControl(c)).ToArray()).Trim();
            if (title.Length == 0) { title = p.Key!; }
            if (title.Length > 200) { title = title[..200]; }
            var icon = string.IsNullOrEmpty(p.Icon) ? null : p.Icon;
            if (icon is not null && (!IconShape.IsMatch(icon) || icon.StartsWith("//", StringComparison.Ordinal))) { icon = null; }
            if (!seen.Add(p.Key + "|" + chapter)) { continue; }
            list.Add(new Pin(p.Key!, chapter, title, icon, p.Applet));
            if (list.Count == MaxPins) { break; }
        }
        return list;
    }

    public async Task<IReadOnlyList<Pin>> GetAsync(string userId) {
        await using var db = await _factory.CreateDbContextAsync();
        var json = await db.AccountPins.AsNoTracking().Where(p => p.UserId == userId).Select(p => p.Pins).SingleOrDefaultAsync();
        try { return Clean(json is null ? null : JsonSerializer.Deserialize<List<Pin?>>(json, Json)) ?? Array.Empty<Pin>(); }
        catch (JsonException) { return Array.Empty<Pin>(); }
    }

    public async Task SetAsync(string userId, IReadOnlyList<Pin> pins) {
        var json = JsonSerializer.Serialize(pins, Json);
        if (json.Length > MaxJson) { throw new ArgumentException("Too many pins."); }
        await using var db = await _factory.CreateDbContextAsync();
        var row = await db.AccountPins.SingleOrDefaultAsync(p => p.UserId == userId);
        if (row is null) { row = new SiteAccountPins { UserId = userId }; db.AccountPins.Add(row); }
        row.Pins = json; row.UpdatedUtc = _clock.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync();
    }

    /// <summary>The pins as JSON for the page to carry.</summary>
    public static string ToJson(IReadOnlyList<Pin> pins) => JsonSerializer.Serialize(pins, Json);
}
