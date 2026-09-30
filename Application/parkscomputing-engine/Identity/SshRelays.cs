using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;

using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// The relay's bookkeeping (A16): one-time tickets, and the relays open now,
/// by admin session, so signing out ends them.
/// </summary>
public sealed class SshRelays {
    private readonly IMemoryCache _cache;
    private readonly IOptionsMonitor<SshOptions> _options;
    private readonly ConcurrentDictionary<Guid, Open> _open = new();

    public SshRelays(IMemoryCache cache, IOptionsMonitor<SshOptions> options) {
        _cache = cache; _options = options;
    }

    /// <summary>What a ticket allows: this admin's session, to this destination, once.</summary>
    public sealed record Ticket(string UserId, string SessionId, string Target);

    private sealed record Open(string UserId, string SessionId, CancellationTokenSource Stop);

    public string Issue(Ticket t) {
        var id = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
        _cache.Set(Key(id), t, TimeSpan.FromSeconds(Math.Max(5, _options.CurrentValue.TicketSeconds)));
        return id;
    }

    /// <summary>Takes a ticket, which then no longer exists.</summary>
    public Ticket? Redeem(string? id) {
        if (string.IsNullOrEmpty(id) || id.Length != 48) {
            return null;
        }
        lock (_cache) {
            if (_cache.TryGetValue(Key(id), out Ticket? t)) {
                _cache.Remove(Key(id));
                return t;
            }
        }
        return null;
    }

    public int OpenFor(string userId) => _open.Values.Count(o => o.UserId == userId);

    /// <summary>Records a relay; disposing the result forgets it.</summary>
    public IDisposable Track(string userId, string sessionId, CancellationTokenSource stop) {
        var id = Guid.NewGuid();
        _open[id] = new Open(userId, sessionId, stop);
        return new Forget(() => _open.TryRemove(id, out _));
    }

    /// <summary>Ends every relay a session holds, as signing out does.</summary>
    public void EndSession(string? sessionId) {
        if (string.IsNullOrEmpty(sessionId)) {
            return;
        }
        foreach (var o in _open.Values.Where(o => o.SessionId == sessionId).ToList()) {
            try { o.Stop.Cancel(); } catch (ObjectDisposedException) { }
        }
    }

    private static string Key(string id) => "pc-ssh-ticket:" + id;

    private sealed class Forget : IDisposable {
        private Action? _a;
        public Forget(Action a) { _a = a; }
        public void Dispose() { Interlocked.Exchange(ref _a, null)?.Invoke(); }
    }
}
