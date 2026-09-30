using System;
using System.Linq;

using Microsoft.AspNetCore.Http;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// Where admin work happens and how long its sessions last
/// (Architecture/admin-and-identity-design.md, A5, A8 and A9). Bound from the
/// "Admin" configuration section, so ADMIN__EDITORIGIN sets the origin.
/// </summary>
public sealed class AdminOptions {
    public const string Role = "Admin";

    /// <summary>The edit origin, scheme and host (and port, off the default).</summary>
    public string EditOrigin { get; set; } = "https://edit.parkscomputing.com";

    /// <summary>An admin session ends after this long without a request.</summary>
    public int IdleMinutes { get; set; } = 30;

    /// <summary>An admin session ends this long after sign-in, whatever happens.</summary>
    public int AbsoluteHours { get; set; } = 12;

    /// <summary>Changing sign-in methods needs a passkey tap this recent.</summary>
    public int ConfirmMinutes { get; set; } = 5;

    /// <summary>Deleting, or changing js/, css/ or pudl/, needs a passkey tap this recent (A8).</summary>
    public int DestructiveConfirmMinutes { get; set; } = 15;

    /// <summary>The public site, where pages are viewed and previews shown.</summary>
    public string PublicOrigin { get; set; } = "https://parkscomputing.com";

    /// <summary>The admins' home directories on the server, one each, outside the web root (A10).</summary>
    public string HomeRoot { get; set; } = "/app/home";

    /// <summary>Previous versions of changed files, and the audit log, outside the web root (A7).</summary>
    public string HistoryRoot { get; set; } = "/app/history";

    /// <summary>Previous versions are kept this long.</summary>
    public int HistoryDays { get; set; } = 30;

    /// <summary>The largest file the mount writes.</summary>
    public long MaxFileBytes { get; set; } = 10 * 1024 * 1024;

    public string EditHost => new Uri(EditOrigin).Host;

    public string EditScheme => new Uri(EditOrigin).Scheme;

    /// <summary>
    /// Whether the edit origin is HTTPS, as it is in production, where
    /// Cloudflare ends TLS. Plain HTTP is allowed only for a localhost test
    /// origin (Validate), and there the cookies can't carry __Host- or Secure.
    /// </summary>
    public bool Secure => EditScheme == Uri.UriSchemeHttps;

    public string CookieName(string name) => Secure ? "__Host-" + name : name;

    public void Validate() {
        if (!Uri.TryCreate(EditOrigin, UriKind.Absolute, out var u) || (u.Scheme != Uri.UriSchemeHttps && u.Scheme != Uri.UriSchemeHttp)) {
            throw new InvalidOperationException($"Admin:EditOrigin \"{EditOrigin}\" is not an http(s) origin.");
        }
        if (!Secure && !(u.Host == "localhost" || u.Host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase))) {
            throw new InvalidOperationException($"Admin:EditOrigin \"{EditOrigin}\" must be https; plain http is only for a localhost test origin.");
        }
    }

    public bool IsEditHost(HttpContext ctx) =>
        string.Equals(ctx.Request.Host.Host, EditHost, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// The reader's address. Requests reach the site only through the
    /// cloudflared tunnel (the port is bound to loopback), so Cloudflare's
    /// CF-Connecting-IP is the reader's; without it the request came from this
    /// host, and the socket's address is used.
    /// </summary>
    public static string ClientIp(HttpContext ctx) {
        var cf = ctx.Request.Headers["CF-Connecting-IP"].FirstOrDefault();
        return !string.IsNullOrWhiteSpace(cf) ? cf.Trim() : ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    }
}

/// <summary>Sending mail through Resend, from the environment's RESEND_API_KEY, EMAIL_FROM and EMAIL_REPLY_TO.</summary>
public sealed class EmailOptions {
    public string? ApiKey { get; set; }
    public string? From { get; set; }
    public string? ReplyTo { get; set; }
}
