using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Jint;
using Jint.Native;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Logging;

namespace ParksComputing.Engine.Mcp;

/// <summary>
/// Runs applets' pure actions on the server, for MCP
/// (Architecture/applet-platform-design.md, P3). An action runs from the same
/// files the page's broker uses: its manifest and module in wwwroot/js/actions,
/// the shared rules in wwwroot/js/applet-actions-core.js and the schema
/// library in wwwroot/js/vendor/cfworker-json-schema-4.1.1, so input and
/// output are checked as the page checks them. Each run has an engine of its
/// own (Jint), with no access to .NET but the four functions
/// Mcp/AppletRunner.js documents, and limits on time, memory, statements and
/// recursion.
///
/// Only an action that is pure and needs nothing but artifact.create runs
/// here. One that opens a window, asks a person or reads the reader's files
/// needs the admin's open desktop, which comes later; it is refused with
/// that reason.
/// </summary>
public sealed class AppletRunner {
    /// <summary>The capabilities an action may need and still run on the server.</summary>
    public static readonly string[] ServerCapabilities = { "artifact.create" };

    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
    private const long MemoryLimit = 256L * 1024 * 1024;
    private const int MaxStatements = 50_000_000;

    private readonly string _root;
    private readonly string _js;
    private readonly Pages.Services.AppletCatalog? _catalog;
    private readonly ILogger<AppletRunner> _log;
    /// <summary>Where the site's own manifests' modules live, relative to the web root.</summary>
    private const string SiteBase = "js/actions/";
    private readonly Lazy<string> _host = new(() => {
        using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("ParksComputing.Engine.Mcp.AppletRunner.js")
            ?? throw new InvalidOperationException("Mcp/AppletRunner.js is not embedded.");
        using var r = new StreamReader(s);
        return r.ReadToEnd();
    });

    public AppletRunner(IWebHostEnvironment env, ILogger<AppletRunner> log, Pages.Services.AppletCatalog? catalog = null) {
        _root = Path.GetFullPath(env.WebRootPath);
        _js = Path.Combine(_root, "js");
        _catalog = catalog;
        _log = log;
    }

    /* === Manifests ====================================================== */

    /// <summary>Every manifest the site serves, as written: the site's own
    /// under js/actions, then the installed packages', each with the folder
    /// its module lives in, relative to the web root.</summary>
    public List<(string File, JsonObject Manifest, string Base)> Manifests() {
        var dir = Path.Combine(_js, "actions");
        var list = new List<(string, JsonObject, string)>();
        if (Directory.Exists(dir)) {
            foreach (var file in Directory.EnumerateFiles(dir, "*.json").OrderBy(f => f, StringComparer.Ordinal)) {
                if (JsonNode.Parse(File.ReadAllText(file)) is JsonObject m) {
                    list.Add((file, m, SiteBase));
                }
            }
        }
        if (_catalog is not null) {
            list.AddRange(_catalog.ActionManifests());
        }
        return list;
    }

    /// <summary>The manifest and action a reference belongs to, with the
    /// module's folder, or null.</summary>
    public (JsonObject Manifest, JsonObject Action, string Base)? Find(string reference) {
        foreach (var (_, m, b) in Manifests()) {
            foreach (var a in (m["actions"] as JsonArray ?? new JsonArray()).OfType<JsonObject>()) {
                if (a["ref"]?.GetValue<string>() == reference) {
                    return (m, a, b);
                }
            }
        }
        return null;
    }

    public static IReadOnlyList<string> CapabilitiesOf(JsonObject action) =>
        (action["capabilities"] as JsonArray ?? new JsonArray()).Select(c => c?.GetValue<string>() ?? "").ToList();

    /// <summary>Why an action can't run on the server, or null when it can.</summary>
    public static string? WhyNot(JsonObject manifest, JsonObject action) {
        if (action["replay"]?.GetValue<string>() != "pure") {
            return action["replay"]?.GetValue<string>() == "human"
                ? "asks a person, which needs your open desktop; that comes in a later step"
                : "has effects in the page (it opens a window or changes files there), which needs your open desktop; that comes in a later step";
        }
        var other = CapabilitiesOf(action).Where(c => !ServerCapabilities.Contains(c)).ToList();
        if (other.Count > 0) {
            return "needs " + string.Join(", ", other) + ", which only the page can give; running it from MCP needs your open desktop, which comes in a later step";
        }
        if (manifest["module"] is null) {
            return "has no module to run on the server";
        }
        return null;
    }

    /* === Running ======================================================== */

    public sealed record Artifact(JsonObject Descriptor, string Text);
    public sealed record Outcome(JsonObject Output, IReadOnlyList<Artifact> Artifacts);

    /// <summary>Runs a pure action and gives its output and artifacts; throws
    /// ActionFailed with the reason it failed.</summary>
    public Task<Outcome> RunAsync(JsonObject manifest, string moduleBase, string reference, string inputJson, string invocationId, CancellationToken cancel) =>
        Task.Run(() => Run(manifest, moduleBase, reference, inputJson, invocationId, cancel), cancel);

    public sealed class ActionFailed : Exception { public ActionFailed(string message) : base(message) { } }

    private Outcome Run(JsonObject manifest, string moduleBase, string reference, string inputJson, string invocationId, CancellationToken cancel) {
        var schemaDir = Path.Combine(_js, "vendor", "cfworker-json-schema-4.1.1");
        using var engine = new Jint.Engine(o => o
            .LimitMemory(MemoryLimit)
            .TimeoutInterval(Timeout)
            .MaxStatements(MaxStatements)
            .LimitRecursion(1000)
            .CancellationToken(cancel)
            .EnableModules(schemaDir, true));
        engine.SetValue("__urlResolve", new Func<string, string?, string>(ResolveUrl));
        engine.SetValue("__random", new Func<int, double>(RandomOf));
        engine.SetValue("__describeText", new Func<string, string>(DescribeText));
        engine.SetValue("__source", new Func<string, string, string>(SourceBeside));
        engine.SetValue("__moduleBase", moduleBase);
        try {
            engine.Execute(_host.Value, "AppletRunner.js");
            engine.SetValue("__schemaLib", engine.Modules.Import("./index.js"));
            engine.Execute(File.ReadAllText(Path.Combine(_js, "applet-actions-core.js")), "applet-actions-core.js");
            var result = engine.Invoke("__runAction", manifest.ToJsonString(), reference, inputJson, invocationId).UnwrapIfPromise(Timeout);
            var parsed = JsonNode.Parse(result.AsString())!.AsObject();
            var artifacts = (parsed["artifacts"] as JsonArray ?? new JsonArray()).OfType<JsonObject>()
                .Select(a => new Artifact(a["descriptor"]!.AsObject().DeepClone().AsObject(), a["text"]?.GetValue<string>() ?? "")).ToList();
            return new Outcome(parsed["output"]!.AsObject().DeepClone().AsObject(), artifacts);
        }
        catch (Exception ex) when (ex is not ActionFailed) {
            throw new ActionFailed(Explain(ex));
        }
    }

    /// <summary>What a failure is called, in the words a caller can act on.</summary>
    private string Explain(Exception ex) {
        var name = ex.GetType().Name;
        switch (name) {
            case "TimeoutException": return "the action did not finish within " + Timeout.TotalSeconds + " seconds";
            case "MemoryLimitExceededException": return "the action used more memory than it may";
            case "StatementsCountOverflowException": return "the action ran for longer than it may";
            case "RecursionDepthOverflowException": return "the action recursed too deeply";
            case "OperationCanceledException": case "ExecutionCanceledException": return "the action was cancelled";
            case "ModuleResolutionException": return "the action imported a module, which the server's runner doesn't allow; a module loads its own scripts with ctx.load";
        }
        var inner = ex is Jint.Runtime.JavaScriptException || name == "PromiseRejectedException" ? ex.Message : null;
        if (inner is not null) {
            return inner.StartsWith("Error: ", StringComparison.Ordinal) ? inner[7..] : inner;
        }
        _log.LogWarning(ex, "An applet action failed in the server's runner");
        return "the action failed on the server (" + name + ")";
    }

    /* === The host's functions =========================================== */

    private static string ResolveUrl(string input, string? baseUrl) {
        var uri = baseUrl is null ? new Uri(input, UriKind.Absolute) : new Uri(new Uri(baseUrl, UriKind.Absolute), input);
        return uri.AbsoluteUri;
    }

    private static double RandomOf(int width) => width switch {
        1 => RandomNumberGenerator.GetBytes(1)[0],
        2 => BitConverter.ToUInt16(RandomNumberGenerator.GetBytes(2)),
        4 => BitConverter.ToUInt32(RandomNumberGenerator.GetBytes(4)),
        _ => throw new ArgumentOutOfRangeException(nameof(width))
    };

    private static string DescribeText(string text) {
        var bytes = Encoding.UTF8.GetBytes(text);
        return JsonSerializer.Serialize(new { size = bytes.Length, sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() });
    }

    /// <summary>A script's text: the module itself when src is empty, or
    /// src beside it, stripped of any ?query. Only .js files under the web
    /// root (the site's js/actions, or a package's folder), and no link on
    /// the way.</summary>
    private string SourceBeside(string moduleRel, string src) {
        var rel = string.IsNullOrEmpty(src) ? moduleRel
            : Path.Combine(Path.GetDirectoryName(moduleRel.Replace('/', Path.DirectorySeparatorChar)) ?? "", src.Split('?', '#')[0].Replace('/', Path.DirectorySeparatorChar));
        var full = Identity.ServerFiles.Resolve(_root, rel.Replace(Path.DirectorySeparatorChar, '/'));
        if (full is null || !full.EndsWith(".js", StringComparison.OrdinalIgnoreCase) || !File.Exists(full)) {
            throw new ActionFailed("the action's module asked for " + src + ", which isn't a script beside it");
        }
        return File.ReadAllText(full);
    }
}
