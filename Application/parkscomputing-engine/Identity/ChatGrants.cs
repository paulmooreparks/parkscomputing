using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Security.Cryptography;

using Microsoft.AspNetCore.Identity;

namespace ParksComputing.Engine.Identity;

/// <summary>
/// The chat's own access to /mcp (Chat/ChatTools.cs): a grant made in this
/// process for one turn of a conversation, for the account that started it,
/// with the capabilities it may use. It reaches the site's tools exactly as
/// a personal access token does (AccessTokenAuthentication), so they check
/// and log it the same way, but it is never stored, never shown, and goes
/// when the turn ends or the process does. Its secret starts pcchat_.
/// </summary>
public sealed class ChatGrants {
    public const string Prefix = "pcchat_";
    private readonly ConcurrentDictionary<string, (AccessTokenGrant Grant, DateTimeOffset Expires)> _grants = new();
    private readonly TimeProvider _clock;

    public ChatGrants(TimeProvider clock) { _clock = clock; }

    /* The conversation a grant belongs to (its reader's home and the chat's
       id), by the grant's id, so the site's MCP server can route an agent's
       applet action to that conversation's desktop. */
    private readonly ConcurrentDictionary<string, (string Home, string Id)> _conversations = new();

    public string Create(IdentityUser user, string name, IReadOnlyList<string> capabilities, TimeSpan lifetime, (string Home, string Id)? conversation = null) {
        var secret = Prefix + Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var id = "chat:" + Convert.ToHexString(RandomNumberGenerator.GetBytes(6)).ToLowerInvariant();
        _grants[secret] = (new AccessTokenGrant(id, name, user, capabilities), _clock.GetUtcNow() + lifetime);
        if (conversation is { } c) { _conversations[id] = c; }
        return secret;
    }

    public (string Home, string Id)? ConversationOf(string tokenId) => _conversations.TryGetValue(tokenId, out var c) ? c : null;

    public AccessTokenGrant? Find(string secret) {
        if (!secret.StartsWith(Prefix, StringComparison.Ordinal) || !_grants.TryGetValue(secret, out var g)) { return null; }
        if (g.Expires <= _clock.GetUtcNow()) { _grants.TryRemove(secret, out _); return null; }
        return g.Grant;
    }

    public void Revoke(string secret) {
        if (_grants.TryRemove(secret, out var g)) { _conversations.TryRemove(g.Grant.TokenId, out _); }
    }
}
