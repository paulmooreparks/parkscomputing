using System;
namespace ParksComputing.Engine.Identity;
public sealed class AccountOptions {
    public bool Enabled { get; set; }
    public bool StaffEnabled { get; set; }
    /// <summary>Whether anyone may create an account. Off, the site has
    /// accounts only for those who already hold one, and the operator's
    /// setup command; Create account appears nowhere and its page and
    /// request answer 404. Opening sign-up waits for comments and the policy
    /// pages (Architecture/unified-identity-design.md).</summary>
    public bool Registration { get; set; }
    public string Origin { get; set; } = "https://parkscomputing.com";
    /// <summary>Other names for the site, such as www, which redirect to
    /// Origin keeping the path and query.</summary>
    public string[] RedirectHosts { get; set; } = Array.Empty<string>();
    /// <summary>Hosts the site no longer serves, such as the retired edit
    /// origin, which redirect to Origin's home page. Their path and query are
    /// dropped, since an old enrollment or sign-in link carries a credential
    /// that must not be forwarded.</summary>
    public string[] RetiredHosts { get; set; } = Array.Empty<string>();
    public string Host => new Uri(Origin).Host;
    public string Scheme => new Uri(Origin).Scheme;
    public void Validate() {
        if (!Uri.TryCreate(Origin, UriKind.Absolute, out var u) || u.AbsolutePath != "/" ||
            !string.IsNullOrEmpty(u.Query) || !string.IsNullOrEmpty(u.Fragment) || !string.IsNullOrEmpty(u.UserInfo) ||
            (u.Scheme != "https" && !(u.Scheme == "http" && u.Host == "localhost"))) {
            throw new InvalidOperationException("Accounts:Origin must be an HTTPS origin or HTTP localhost test origin.");
        }
    }
}
