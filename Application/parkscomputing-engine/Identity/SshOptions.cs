using System;
using System.Collections.Generic;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// Where the web terminal's SSH may go (Architecture/admin-and-identity-design.md,
/// A16), bound from "Admin:Ssh". The list lives in the server's own
/// configuration, /app/config/ssh.json in production, which nothing on the
/// admin mount can reach, so a stolen admin session cannot point the relay
/// anywhere new. Each destination is pinned to its host keys, which the
/// browser checks during the SSH handshake.
/// </summary>
public sealed class SshOptions {
    public List<SshTarget> Targets { get; set; } = new();

    /// <summary>Where the WebAssembly client and its loader are, outside the web root.</summary>
    public string AssetsRoot { get; set; } = "/app/ssh";

    /// <summary>How long a ticket from POST /api/admin/ssh/ticket stays good, unused.</summary>
    public int TicketSeconds { get; set; } = 30;

    /// <summary>How many relays one admin may have open at once.</summary>
    public int MaxSessionsPerAdmin { get; set; } = 8;

    public SshTarget? Find(string? name) =>
        Targets.Find(t => string.Equals(t.Name, name, StringComparison.OrdinalIgnoreCase));
}

/// <summary>One destination the relay will connect to.</summary>
public sealed class SshTarget {
    /// <summary>What the admin types after ssh, such as "server".</summary>
    public string Name { get; set; } = "";

    public string Host { get; set; } = "";

    public int Port { get; set; } = 22;

    /// <summary>The login name used when the admin gives none.</summary>
    public string? User { get; set; }

    public string? Description { get; set; }

    /// <summary>The destination's host keys, each a line as in known_hosts without the host name: "ssh-ed25519 AAAA...".</summary>
    public List<string> HostKeys { get; set; } = new();

    public bool Valid =>
        System.Text.RegularExpressions.Regex.IsMatch(Name, "^[a-z0-9][a-z0-9._-]{0,39}$")
        && !string.IsNullOrWhiteSpace(Host) && Port is > 0 and < 65536 && HostKeys.Count > 0;
}
