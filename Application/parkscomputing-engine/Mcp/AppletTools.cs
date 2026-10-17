using System;
using System.ComponentModel;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using ModelContextProtocol;
using ModelContextProtocol.Server;

namespace ParksComputing.Engine.Mcp;

/// <summary>
/// GK Companion's five generic applet tools (Architecture/applet-platform-design.md,
/// P2 and P3). applet_discover reads the manifests the site's applets publish
/// (wwwroot/js/actions/*.json), the same files the page's broker reads.
/// applet_invoke runs a pure action on the server (Mcp/AppletRunner.cs), from
/// the same module and with the same checks as the page. An action that needs
/// a window, a person or the page's files waits for the queue to the admin's
/// open desktop, a later step, and applet_invoke says so. A token runs only
/// actions whose capabilities it was given, and sees only its own invocations.
/// </summary>
[McpServerToolType]
public sealed class AppletTools {
    private static readonly Regex InvocationId = new("^[A-Za-z0-9_-]{1,128}$", RegexOptions.Compiled);

    private readonly AppletRunner _runner;
    private readonly McpInvocations _invocations;
    private readonly McpCaller _caller;

    public AppletTools(AppletRunner runner, McpInvocations invocations, McpCaller caller) {
        _runner = runner; _invocations = invocations; _caller = caller;
    }

    [McpServerTool(Name = "applet_discover", Title = "Discover applet actions", ReadOnly = true, Idempotent = true, OpenWorld = false)]
    [Description("The actions the site's applets publish, by provider: each with its reference (such as parks.dice/roll@1), what it does, the JSON Schema of its input and output, the capabilities it needs and its replay policy (pure, once or human). Pure actions that need no capability beyond artifact.create run over MCP now; the others need the admin's open desktop, which comes later.")]
    public object Discover([Description("Only this provider's actions, such as parks.barcode.")] string? provider = null) {
        var all = _runner.Manifests().Select(x => x.Manifest.DeepClone().AsObject())
            .Where(m => provider is null || m["id"]?.GetValue<string>() == provider).ToList();
        if (provider is not null && all.Count == 0) {
            throw new McpException("There is no provider " + provider + ".");
        }
        foreach (var m in all) {
            foreach (var a in (m["actions"] as JsonArray ?? new JsonArray()).OfType<JsonObject>()) {
                a["runsOverMcp"] = AppletRunner.WhyNot(m, a) is null;
                a.Remove("handles");
            }
            // GK's shape: the site's own fields are left out, once they have been read.
            m.Remove("module");
        }
        return new { providers = all };
    }

    [McpServerTool(Name = "applet_invoke", Title = "Run an applet action", ReadOnly = false, Destructive = false, Idempotent = false, OpenWorld = false)]
    [Description("Run one of the actions applet_discover lists, with input its input schema accepts, and get the invocation's record: its id, status, output, and the descriptors of any files it made (applet_artifact fetches them). Give an id of your own to make a retry safe: the same id with the same call gives the first record instead of running again.")]
    public async Task<object> Invoke(
        [Description("The action's reference, such as parks.dice/roll@1.")] string action,
        [Description("The action's input, an object its input schema accepts.")] JsonElement? input = null,
        [Description("An id of your own for this invocation, 1 to 128 letters, digits, - and _.")] string? id = null,
        CancellationToken cancel = default) {
        var found = _runner.Find(action) ?? throw new McpException("There is no action " + action + ". applet_discover lists them.");
        var why = AppletRunner.WhyNot(found.Manifest, found.Action);
        if (why is not null) {
            throw new McpException(action + " " + why + ".");
        }
        var missing = AppletRunner.CapabilitiesOf(found.Action).Where(c => !_caller.Has(c)).ToList();
        if (missing.Count > 0) {
            throw new McpException(action + " needs " + string.Join(", ", missing) + ", which this token was not given.");
        }
        var inputJson = input is { ValueKind: not JsonValueKind.Undefined and not JsonValueKind.Null } ? input.Value.GetRawText() : "{}";
        if (id is not null) {
            if (!InvocationId.IsMatch(id)) {
                throw new McpException("An invocation id is 1 to 128 letters, digits, - and _.");
            }
            if (_invocations.Get(id, _caller.TokenId) is { } had) {
                if (had.Action != action || !JsonNode.DeepEquals(JsonNode.Parse(had.InputJson), JsonNode.Parse(inputJson))) {
                    throw new McpException("Invocation " + id + " was a different call.");
                }
                return had.View();
            }
        }
        var invocationId = id ?? Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        McpInvocations.Entry entry;
        try {
            var outcome = await _runner.RunAsync(found.Manifest, action, inputJson, invocationId, cancel);
            entry = new McpInvocations.Entry(invocationId, _caller.TokenId, action, inputJson, "done", outcome.Output, null, DateTime.UtcNow, outcome.Artifacts);
        }
        catch (AppletRunner.ActionFailed ex) {
            entry = new McpInvocations.Entry(invocationId, _caller.TokenId, action, inputJson, "failed", null, ex.Message, DateTime.UtcNow, Array.Empty<AppletRunner.Artifact>());
        }
        _invocations.Add(entry);
        if (entry.Status == "failed") {
            throw new McpException(action + " failed: " + entry.Error + " (invocation " + invocationId + ").");
        }
        return entry.View();
    }

    [McpServerTool(Name = "applet_status", Title = "An applet invocation's status", ReadOnly = true, Idempotent = true, OpenWorld = false)]
    [Description("The record of an invocation this token started with applet_invoke: its status (done or failed), output and artifacts.")]
    public object Status([Description("The invocation's id.")] string id) =>
        (_invocations.Get(id, _caller.TokenId) ?? throw new McpException("There is no invocation " + id + " for this token.")).View();

    [McpServerTool(Name = "applet_cancel", Title = "Cancel an applet invocation", ReadOnly = false, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("Stop an invocation that is running or waiting for a person. A pure action run over MCP has always finished by the time applet_invoke answers.")]
    public object Cancel([Description("The invocation's id.")] string id) {
        var e = _invocations.Get(id, _caller.TokenId) ?? throw new McpException("There is no invocation " + id + " for this token.");
        throw new McpException("Invocation " + e.Id + " has already finished (" + e.Status + ").");
    }

    [McpServerTool(Name = "applet_artifact", Title = "An applet action's file", ReadOnly = true, Idempotent = true, OpenWorld = false)]
    [Description("A file an action made, such as a barcode's SVG, by the id its descriptor in the output gives (the invocation's id, a dot, and the output's key). Text files come back as text.")]
    public object Artifact([Description("The artifact's id, such as 4f…e1.image.")] string id) {
        var dot = (id ?? "").LastIndexOf('.');
        var e = dot > 0 ? _invocations.Get(id![..dot], _caller.TokenId) : null;
        var a = e?.Artifacts.FirstOrDefault(x => x.Descriptor["id"]?.GetValue<string>() == id)
            ?? throw new McpException("There is no artifact " + id + " for this token.");
        var o = a.Descriptor.DeepClone().AsObject();
        o["text"] = a.Text;
        return o;
    }
}
