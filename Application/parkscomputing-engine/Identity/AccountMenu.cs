using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Identity;

/// <summary>What the reader's account offers them, as the site's chrome
/// needs it: whether accounts exist on this site at all, who is signed in,
/// and which of the account's places they may go.</summary>
public sealed record AccountMenuState(bool Enabled, bool SignedIn, string? Name, bool SetupPending, bool Staff,
    bool ServerTools = false, string? HomeName = null, string? AvatarUrl = null, bool Registration = false) {
    public static readonly AccountMenuState Off = new(false, false, null, false, false);
    /// <summary>The role words a menu entry's when may name that this
    /// reader holds (MenuBuilder.Audiences): member, moderator, admin and
    /// superuser, each held by the roles above it too.</summary>
    public IReadOnlyCollection<string> Roles { get; init; } = Array.Empty<string>();
    /// <summary>Whether the account menu offers the moderation queue: the
    /// site has comments and the reader may moderate them.</summary>
    public bool Moderation { get; init; }
    /// <summary>How much is waiting for moderation, when Moderation.</summary>
    public int ModerationCount { get; init; }
}

/// <summary>
/// The account's commands in the logo menu (Architecture/unified-identity-design.md,
/// "Beta site with accounts"). PUDL's menu bar guidance puts account and
/// sign-in commands in the site's identity menu, apart from navigation, and
/// leaves out what the reader cannot do, so a reader who is not signed in
/// sees Sign in and Create account, and one who is sees their name, their
/// account, the places their roles open and Sign out.
/// </summary>
public sealed class AccountMenu {
    /// <summary>The id of the hidden sign-out form the layout renders, which
    /// the Sign out command submits, since signing out is a POST.</summary>
    public const string SignOutForm = "pc-signout";

    private readonly AccountOptions _options;
    private readonly StaffAccess _staff;
    private readonly StaffBootstrap _bootstrap;
    private readonly IDbContextFactory<SiteIdentityDbContext> _factory;
    private readonly CommentOptions _comments;
    private readonly ModerationNotices _notices;

    public AccountMenu(IOptions<AccountOptions> options, StaffAccess staff, StaffBootstrap bootstrap, IDbContextFactory<SiteIdentityDbContext> factory,
        IOptions<CommentOptions> comments, ModerationNotices notices) {
        _options = options.Value; _staff = staff; _bootstrap = bootstrap; _factory = factory; _comments = comments.Value; _notices = notices;
    }

    /// <summary>The reader's state, worked out once per request, since the
    /// layout, an article and each window on the page all ask.</summary>
    public async Task<AccountMenuState> StateAsync(Microsoft.AspNetCore.Http.HttpContext ctx) {
        if (ctx.Items[typeof(AccountMenuState)] is AccountMenuState known) { return known; }
        var state = await StateAsync(ctx.User);
        ctx.Items[typeof(AccountMenuState)] = state;
        return state;
    }

    public async Task<AccountMenuState> StateAsync(ClaimsPrincipal user) {
        if (!_options.Enabled) { return AccountMenuState.Off; }
        var id = user.Identity?.IsAuthenticated == true ? user.FindFirstValue(ClaimTypes.NameIdentifier) : null;
        if (id is null) { return new(true, false, null, false, false, Registration: _options.Registration); }
        await using var db = await _factory.CreateDbContextAsync();
        var name = await db.AccountProfiles.AsNoTracking().Where(p => p.UserId == id).Select(p => p.DisplayName).SingleOrDefaultAsync();
        bool staff = await _staff.AllowedAsync(user, false);
        // The server's tools go to the role AdminSessions gives them; the
        // tools' own API checks again on every request.
        var serverRole = AdminSessions.ServerRole(_options);
        var account = staff ? await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == id) : null;
        bool serverTools = account is not null && account.EmailConfirmed && await (from ur in db.UserRoles join r in db.Roles on ur.RoleId equals r.Id
            where ur.UserId == id && r.Name == serverRole select ur).AnyAsync();
        var avatar = await db.AccountAvatars.AsNoTracking().Where(a => a.UserId == id).Select(a => (Guid?)a.Version).SingleOrDefaultAsync();
        var held = await (from ur in db.UserRoles join r in db.Roles on ur.RoleId equals r.Id where ur.UserId == id select r.Name).ToListAsync();
        var roles = RolesOf(held);
        bool moderation = _comments.Enabled && _options.StaffEnabled && roles.Contains("moderator");
        return new(true, true, string.IsNullOrWhiteSpace(name) ? null : name,
            await _bootstrap.PendingAsync(id), staff, serverTools, serverTools ? ServerFiles.HomeNameOf(account!) : null,
            avatar is { } v ? AccountAvatars.UrlOf(id, v) : null, _options.Registration) {
            Roles = roles, Moderation = moderation, ModerationCount = moderation ? (await _notices.CountAsync()).Total : 0
        };
    }

    /// <summary>The role words an account's roles give it, each role
    /// including those below it.</summary>
    public static IReadOnlyCollection<string> RolesOf(IEnumerable<string?> roles) {
        var r = roles.OfType<string>().ToHashSet(StringComparer.OrdinalIgnoreCase);
        var words = new List<string>();
        bool super = r.Contains("SuperAdmin"), admin = super || r.Contains("Admin"), mod = admin || r.Contains("Moderator");
        if (mod || r.Contains("Member")) { words.Add("member"); }
        if (mod) { words.Add("moderator"); }
        if (admin) { words.Add("admin"); }
        if (super) { words.Add("superuser"); }
        return words;
    }

    /// <summary>The entries, in the logo menu's terms. A sign-in or sign-up
    /// command ends in an ellipsis, because it asks for more before it acts,
    /// and opens over the page the reader is on (js/accounts.js); its
    /// address is the page of its own that works without script.</summary>
    public static IReadOnlyList<MenuEntry> Entries(AccountMenuState state, bool desktop) {
        if (!state.Enabled) { return Array.Empty<MenuEntry>(); }
        if (!state.SignedIn) {
            // Create account only while registration is open.
            var signedOut = new List<MenuEntry> { Item("Sign in…", MenuBuilder.Link("/account/signin", ("data-account-dialog", ""))) };
            if (state.Registration) { signedOut.Add(Item("Create account…", MenuBuilder.Link("/account/register", ("data-account-dialog", "")))); }
            return signedOut;
        }
        var account = desktop
            ? MenuBuilder.Link("/?open=account&top=account", ("data-win-open", "account"))
            : MenuBuilder.Link("/account");
        var items = new List<MenuEntry> { Item("Your account", account) };
        if (state.SetupPending) { items.Add(Item("Finish super-user setup", MenuBuilder.Link("/account/superuser", ("data-return-here", "")))); }
        // The moderation queue, a place a moderator's role opens
        // (Architecture/unified-identity-design.md, step 2).
        if (state.Moderation) {
            // Without a count: the status area carries it (Architecture/status-area-design.md).
            items.Add(Item("Moderation", desktop
                ? MenuBuilder.Link("/?open=moderation&top=moderation", ("data-win-open", "moderation"))
                : MenuBuilder.Link("/moderation")));
        }
        items.Add(Item("Sign out", new SiteCommands.Rendered("button", new[] {
            new KeyValuePair<string, string?>("type", "submit"), new KeyValuePair<string, string?>("form", SignOutForm)
        })));
        return new[] { new MenuEntry(MenuEntryKind.Heading, "Signed in as " + (state.Name ?? "you"), Entries: items) };
    }

    private static MenuEntry Item(string label, SiteCommands.Rendered element) => new(MenuEntryKind.Item, label, element);

    /// <summary>A reader's avatar, PUDL's (0.74.0): their picture, or their
    /// initials on a tint taken from their name, in a circle of the size
    /// given ("sm" 24px, "" 32px, "lg" 40px, "xl" 64px). Decorative, since
    /// the name is always beside it, so it is hidden from assistive
    /// technology; it keeps the name in its aria-label because PUDL takes
    /// the tint, and the initials of a picture that fails, from there.</summary>
    public static Microsoft.AspNetCore.Html.IHtmlContent Avatar(string? url, string? name, string size = "") {
        static string enc(string s) => System.Net.WebUtility.HtmlEncode(s);
        var label = string.IsNullOrWhiteSpace(name) ? "Reader" : name.Trim();
        var inside = url is null ? enc(Initials(label)) : "<img src=\"" + enc(url) + "\" alt=\"\" />";
        return new Microsoft.AspNetCore.Html.HtmlString("<span class=\"avatar tint" + (size.Length > 0 ? " " + size : "") + "\" aria-hidden=\"true\" aria-label=\"" + enc(label) + "\">" + inside + "</span>");
    }

    /// <summary>A name's initials as PUDL writes them for an avatar: the
    /// first character of its first and last words, in capitals.</summary>
    public static string Initials(string name) {
        var parts = name.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0) { return ""; }
        static string First(string word) => word.EnumerateRunes().First().ToString();
        return (First(parts[0]) + (parts.Length > 1 ? First(parts[^1]) : "")).ToUpperInvariant();
    }
}
