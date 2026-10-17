using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using ModelContextProtocol;
using ModelContextProtocol.Server;


namespace ParksComputing.Engine.Mcp;

/// <summary>
/// GK Companion's five generic applet tools (Architecture/applet-platform-design.md,
/// P2 and P3). applet_discover reads the manifests the site's applets publish
/// (wwwroot/js/actions/*.json), the same files the page's action broker
/// reads, so an MCP client sees every action. Running them over MCP comes in
/// two later steps: pure actions on the server in Jint, and actions that need
/// a window or a person queued for the admin's open desktop. Until then
/// applet_invoke says so, and no invocation exists for the other three to
/// find.
/// </summary>
[McpServerToolType]
public sealed class AppletTools {
    private const string NotYet = "isn't available over MCP yet. Applet actions run in the browser today; running them from MCP comes in a later step (Architecture/applet-platform-design.md, P3).";

    private readonly string _webRoot;

    public AppletTools(Microsoft.AspNetCore.Hosting.IWebHostEnvironment env) { _webRoot = env.WebRootPath; }

    /// <summary>Every manifest the site serves, in GK's shape: the site's own
    /// fields (module, and an action's handles) are left out.</summary>
    private List<JsonObject> Manifests() {
        var dir = Path.Combine(_webRoot, "js", "actions");
        var list = new List<JsonObject>();
        if (!Directory.Exists(dir)) {
            return list;
        }
        foreach (var file in Directory.EnumerateFiles(dir, "*.json").OrderBy(f => f, StringComparer.Ordinal)) {
            if (JsonNode.Parse(File.ReadAllText(file)) is not JsonObject m) {
                continue;
            }
            m.Remove("module");
            foreach (var a in (m["actions"] as JsonArray ?? new JsonArray()).OfType<JsonObject>()) {
                a.Remove("handles");
            }
            list.Add(m);
        }
        return list;
    }

    private static string? RefOf(JsonNode? a) => a?["ref"]?.GetValue<string>();

    [McpServerTool(Name = "applet_discover", Title = "Discover applet actions", ReadOnly = true, Idempotent = true, OpenWorld = false)]
    [Description("The actions the site's applets publish, by provider: each with its reference (such as parks.dice/roll@1), what it does, the JSON Schema of its input and output, the capabilities it needs and its replay policy (pure, once or human).")]
    public object Discover([Description("Only this provider's actions, such as parks.barcode.")] string? provider = null) {
        var all = Manifests().Where(m => provider is null || m["id"]?.GetValue<string>() == provider).ToList();
        if (provider is not null && all.Count == 0) {
            throw new McpException("There is no provider " + provider + ".");
        }
        return new { providers = all };
    }

    [McpServerTool(Name = "applet_invoke", Title = "Run an applet action", ReadOnly = false, Destructive = false, Idempotent = false, OpenWorld = false)]
    [Description("Run one of the actions applet_discover lists, with input its input schema accepts.")]
    public object Invoke(
        [Description("The action's reference, such as parks.dice/roll@1.")] string action,
        [Description("The action's input, an object its input schema accepts.")] JsonElement? input = null) {
        var known = Manifests().SelectMany(m => (m["actions"] as JsonArray ?? new JsonArray()).Select(RefOf)).Contains(action);
        if (!known) {
            throw new McpException("There is no action " + action + ". applet_discover lists them.");
        }
        throw new McpException(action + " " + NotYet);
    }

    [McpServerTool(Name = "applet_status", Title = "An applet invocation's status", ReadOnly = true, Idempotent = true, OpenWorld = false)]
    [Description("The record of an invocation applet_invoke started: running, waiting for a person, done, failed or cancelled, with its output.")]
    public object Status([Description("The invocation's id.")] string id) => throw new McpException("There is no invocation " + id + ". Applet actions " + NotYet);

    [McpServerTool(Name = "applet_cancel", Title = "Cancel an applet invocation", ReadOnly = false, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("Stop an invocation that is running or waiting for a person.")]
    public object Cancel([Description("The invocation's id.")] string id) => throw new McpException("There is no invocation " + id + ". Applet actions " + NotYet);

    [McpServerTool(Name = "applet_artifact", Title = "An applet action's file", ReadOnly = true, Idempotent = true, OpenWorld = false)]
    [Description("A file an action made, such as a barcode's SVG, by the id its output gives.")]
    public object Artifact([Description("The artifact's id.")] string id) => throw new McpException("There is no artifact " + id + ". Applet actions " + NotYet);
}
