using System;
namespace ParksComputing.Engine.Identity;
public sealed class AccountOptions {
    public bool Enabled { get; set; }
    public bool StaffEnabled { get; set; }
    public string Origin { get; set; } = "https://parkscomputing.com";
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
