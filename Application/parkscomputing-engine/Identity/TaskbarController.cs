using System;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Identity;

public sealed record TaskbarReference(string Id, string Provider);
public sealed record TaskbarPreferences(int Version, string[] Pins, string[] Order, TaskbarReference[]? References = null);

[ApiController, Route("api/account/taskbar"), AutoValidateAntiforgeryToken]
public sealed class TaskbarController : ControllerBase {
    private readonly IDbContextFactory<SiteIdentityDbContext> _factory;
    private readonly UserManager<IdentityUser> _users;
    private readonly AccountOptions _options;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly Regex Key = new("^[A-Za-z0-9_-]{1,100}$", RegexOptions.Compiled);
    private static readonly Regex Destination = new("^(?:[A-Za-z0-9_-]{1,100}|pudl-menu-(?:[a-f0-9]{4})+)$", RegexOptions.Compiled);
    private static readonly Regex Entry = new("^(pin:)?(?:[A-Za-z0-9_-]{1,100}|pudl-menu-(?:[a-f0-9]{4})+)$", RegexOptions.Compiled);

    public TaskbarController(IDbContextFactory<SiteIdentityDbContext> factory, UserManager<IdentityUser> users, IOptions<AccountOptions> options) {
        _factory = factory; _users = users; _options = options.Value;
    }

    public sealed record Body(string Scope, TaskbarPreferences Preferences);

    public static bool Valid(TaskbarPreferences? preferences) => preferences is { Version: 1 or 2, Pins: not null, Order: not null }
        && preferences.Pins.Length <= 50 && preferences.Order.Length <= 200
        && preferences.Pins.All(p => p is not null && Destination.IsMatch(p))
        && preferences.Order.All(p => p is not null && Entry.IsMatch(p))
        && preferences.Pins.Distinct().Count() == preferences.Pins.Length
        && preferences.Order.Distinct().Count() == preferences.Order.Length
        && (preferences.Version == 1 ? preferences.References is null or { Length: 0 }
            : preferences.References is { Length: <= 50 } references
                && references.All(r => r is not null && r.Id is not null && r.Provider is not null
                    && Destination.IsMatch(r.Id) && Key.IsMatch(r.Provider) && preferences.Pins.Contains(r.Id))
                && references.Select(r => r.Id).Distinct().Count() == references.Length)
        && JsonSerializer.Serialize(preferences, Json).Length <= 32768;

    [HttpGet]
    public async Task<IActionResult> Get() {
        var id = _options.Enabled ? _users.GetUserId(User) : null;
        if (id is null) { return Unauthorized(new { signin = true }); }
        Response.Headers.CacheControl = "no-store";
        await using var db = await _factory.CreateDbContextAsync();
        var text = await db.AccountPins.AsNoTracking().Where(p => p.UserId == id).Select(p => p.Taskbar).SingleOrDefaultAsync();
        TaskbarPreferences? preferences = null;
        try { preferences = JsonSerializer.Deserialize<TaskbarPreferences>(text ?? "{}", Json); }
        catch (JsonException) { }
        return Ok(new { scope = id, preferences = Valid(preferences) ? preferences : new TaskbarPreferences(1, Array.Empty<string>(), Array.Empty<string>()) });
    }

    [HttpPut]
    public async Task<IActionResult> Put([FromBody] Body body) {
        var id = _options.Enabled ? _users.GetUserId(User) : null;
        if (id is null) { return Unauthorized(new { signin = true }); }
        if (body.Scope != id) { return Conflict(new { error = "The signed-in account changed. Reload before saving taskbar preferences." }); }
        if (!Valid(body.Preferences)) { return BadRequest(new { error = "Invalid taskbar preferences." }); }
        await using var db = await _factory.CreateDbContextAsync();
        var row = await db.AccountPins.SingleOrDefaultAsync(p => p.UserId == id);
        if (row is null) { row = new SiteAccountPins { UserId = id }; db.AccountPins.Add(row); }
        row.Taskbar = JsonSerializer.Serialize(body.Preferences, Json);
        row.UpdatedUtc = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(new { scope = id, preferences = body.Preferences });
    }
}
