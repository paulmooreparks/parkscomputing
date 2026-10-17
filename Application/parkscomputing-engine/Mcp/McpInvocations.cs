using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace ParksComputing.Engine.Mcp;

/// <summary>
/// The applet invocations MCP has run (Mcp/AppletTools.cs), each kept with
/// the token that made it, so applet_status and applet_artifact show a token
/// only its own. They live in memory, the most recent 500: a pure action
/// finishes before applet_invoke answers, so nothing waits on a record that
/// a restart would lose. The queue for the admin's desktop, whose actions
/// wait, will keep its records in the database.
/// </summary>
public sealed class McpInvocations {
    public const int Keep = 500;

    public sealed record Entry(string Id, string TokenId, string Action, string InputJson, string Status, JsonObject? Output,
        string? Error, DateTime Created, IReadOnlyList<AppletRunner.Artifact> Artifacts) {
        /// <summary>The record as a caller sees it: artifacts as their descriptors.</summary>
        public JsonObject View() {
            var o = new JsonObject {
                ["id"] = Id, ["action"] = Action, ["status"] = Status,
                ["input"] = JsonNode.Parse(InputJson), ["created"] = Created.ToString("O")
            };
            if (Output is not null) { o["output"] = Output.DeepClone(); }
            if (Error is not null) { o["error"] = Error; }
            o["artifacts"] = new JsonArray(Artifacts.Select(a => (JsonNode)a.Descriptor.DeepClone()).ToArray());
            return o;
        }
    }

    private readonly ConcurrentDictionary<string, Entry> _entries = new();
    private readonly ConcurrentQueue<string> _order = new();

    public void Add(Entry e) {
        _entries[e.Id] = e;
        _order.Enqueue(e.Id);
        while (_order.Count > Keep && _order.TryDequeue(out var old)) {
            _entries.TryRemove(old, out _);
        }
    }

    /// <summary>The token's own invocation by its id, or null.</summary>
    public Entry? Get(string id, string tokenId) =>
        _entries.TryGetValue(id ?? "", out var e) && e.TokenId == tokenId ? e : null;
}
