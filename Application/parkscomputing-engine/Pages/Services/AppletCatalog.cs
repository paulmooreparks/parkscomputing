using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Primitives;

namespace ParksComputing.Engine.Pages.Services;

/// <summary>An installed applet package, as its manifest says
/// (Architecture/applet-packages-design.md). Every file is relative to the
/// package's folder, wwwroot/applets/{Name}.</summary>
public sealed record AppletPackage(
    string Name, string Title, string Version, string? Description, string? License,
    string Src, string? Css, string? PageBody, string? Fit, string? WindowShape, string? WindowMin, string? WindowMax,
    JsonObject? Handles, int? Instances, string? Actions, bool Continuity,
    IReadOnlyList<string> Needs, IReadOnlyList<string> Wants, IReadOnlyList<string> Tags, string Dir) {
    /// <summary>A file of the package by its address on the site.</summary>
    public string Url(string file) => "/" + AppletCatalog.Folder + "/" + Name + "/" + file;
}

/// <summary>
/// The applet packages installed on this site: each a folder under
/// wwwroot/applets with an applet.json, which is the one file read here
/// (Architecture/applet-packages-design.md). From the manifests the site
/// writes what it used to write by hand for each applet: its define() in
/// the registry (/applets/registry.js), its page, its entry in the Applets
/// section of the navigation (Pages/Services/NavService.cs), its action
/// manifest for the broker and /mcp, and its continuity. The folder is
/// read again when a manifest or a page body changes, as sitenav.xfer is.
/// A manifest that breaks the rules is logged and its package left out,
/// so one bad package never takes the site down.
/// </summary>
public sealed class AppletCatalog {
    public const string Folder = "applets";
    private const string ManifestFile = "applet.json";
    private static readonly Regex NamePattern = new("^[a-z][a-z0-9-]{0,63}$", RegexOptions.Compiled);
    private static readonly Regex FilePattern = new(@"^(?!/)(?!.*(^|/)\.\.(/|$))[A-Za-z0-9._/-]+$", RegexOptions.Compiled);
    private static readonly Regex ShapePattern = new(@"^(0?\.[0-9]+|1(\.0+)?),(0?\.[0-9]+|1(\.0+)?)$", RegexOptions.Compiled);
    private static readonly Regex PixelsPattern = new("^[1-9][0-9]*,[1-9][0-9]*$", RegexOptions.Compiled);
    private static readonly string[] Services = { "snapshot", "fs", "config" };

    private readonly string _webRoot;
    private readonly ILogger<AppletCatalog> _log;
    private readonly PhysicalFileProvider? _files;
    private readonly object _sync = new();
    private IReadOnlyList<AppletPackage>? _cached;
    private IChangeToken? _changed;

    public AppletCatalog(IWebHostEnvironment env, ILogger<AppletCatalog> log) {
        _webRoot = env.WebRootPath ?? "";
        _log = log;
        // The content folder comes through Docker Desktop without change
        // notices, so it is looked at every few seconds, as NavService does.
        _files = Directory.Exists(_webRoot) ? new PhysicalFileProvider(_webRoot) { UsePollingFileWatcher = true, UseActivePolling = true } : null;
    }

    /// <summary>Fires when a manifest or a page body is added, changed or
    /// removed, so whatever was built from the catalogue is built again.</summary>
    public IChangeToken Watch() => _files is null ? NullChangeToken.Singleton
        : new CompositeChangeToken(new[] { _files.Watch(Folder + "/*/" + ManifestFile), _files.Watch(Folder + "/*/page.html") });

    /// <summary>The packages, in name order.</summary>
    public IReadOnlyList<AppletPackage> Packages {
        get {
            var cached = _cached;
            if (cached != null && _changed is { HasChanged: false }) { return cached; }
            lock (_sync) {
                if (_cached != null && _changed is { HasChanged: false }) { return _cached; }
                _changed = Watch();
                _cached = Scan();
                return _cached;
            }
        }
    }

    public AppletPackage? Find(string name) =>
        string.IsNullOrEmpty(name) ? null : Packages.FirstOrDefault(p => string.Equals(p.Name, name, StringComparison.Ordinal));

    private List<AppletPackage> Scan() {
        var list = new List<AppletPackage>();
        var root = Path.Combine(_webRoot, Folder);
        if (!Directory.Exists(root)) { return list; }
        foreach (var dir in Directory.EnumerateDirectories(root).OrderBy(d => d, StringComparer.Ordinal)) {
            var manifest = Path.Combine(dir, ManifestFile);
            if (!File.Exists(manifest)) { continue; }
            var folder = Path.GetFileName(dir);
            try {
                var p = Read(dir, folder, JsonNode.Parse(File.ReadAllText(manifest)) as JsonObject);
                if (p is not null) { list.Add(p); }
            }
            catch (Exception ex) when (ex is JsonException or IOException) {
                _log.LogWarning("The applet package {Folder} was left out: its applet.json cannot be read ({Reason}).", folder, ex.Message);
            }
        }
        return list;
    }

    /* The manifest's rules (schema/applet.schema.json in the packages repo),
       applied here so a host trusts nothing it did not check. */
    private AppletPackage? Read(string dir, string folder, JsonObject? m) {
        if (m is null) { return Refuse(folder, "applet.json is not an object"); }
        string? Str(string key) => m[key] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
        string? File(string key, JsonObject? from = null) {
            var node = (from ?? m)[key];
            if (node is null) { return null; }
            var s = node is JsonValue v && v.TryGetValue<string>(out var t) ? t : null;
            if (s is null || !FilePattern.IsMatch(s)) { throw new ManifestProblem(key + " must be a relative path inside the package"); }
            if (!System.IO.File.Exists(Path.Combine(dir, s.Replace('/', Path.DirectorySeparatorChar)))) { throw new ManifestProblem(key + " names " + s + ", which is not in the package"); }
            return s;
        }
        IReadOnlyList<string> List(string key, bool services) {
            if (m[key] is null) { return Array.Empty<string>(); }
            if (m[key] is not JsonArray a) { throw new ManifestProblem(key + " must be a list"); }
            var items = a.Select(x => x is JsonValue v && v.TryGetValue<string>(out var s) ? s : throw new ManifestProblem(key + " must be a list of text")).ToList();
            if (services && items.Any(s => !Services.Contains(s))) { throw new ManifestProblem(key + " may list only " + string.Join(", ", Services)); }
            return items;
        }
        try {
            var name = Str("name") ?? throw new ManifestProblem("name is missing");
            if (!NamePattern.IsMatch(name)) { throw new ManifestProblem("name must be lower-case letters, digits and hyphens, starting with a letter"); }
            if (name != folder) { throw new ManifestProblem("name must be the folder's name, " + folder); }
            var title = Str("title");
            if (string.IsNullOrWhiteSpace(title)) { throw new ManifestProblem("title is missing"); }
            var version = Str("version");
            if (string.IsNullOrWhiteSpace(version)) { throw new ManifestProblem("version is missing"); }
            var src = File("src") ?? throw new ManifestProblem("src is missing");
            var page = m["page"] as JsonObject;
            if (m["page"] is not null && page is null) { throw new ManifestProblem("page must be an object"); }
            var fit = page is null ? null : Str2(page, "fit");
            if (fit is not null && fit is not ("fill" or "flow")) { throw new ManifestProblem("page.fit must be fill or flow"); }
            var bodyFile = page is null ? null : File("body", page);
            var body = bodyFile is null ? null : System.IO.File.ReadAllText(Path.Combine(dir, bodyFile.Replace('/', Path.DirectorySeparatorChar)));
            var window = m["window"] as JsonObject;
            if (m["window"] is not null && window is null) { throw new ManifestProblem("window must be an object"); }
            var shape = window is null ? null : Str2(window, "shape");
            if (shape is not null && !ShapePattern.IsMatch(shape)) { throw new ManifestProblem("window.shape must be fractions of the desktop, such as 0.28,0.88"); }
            var min = window is null ? null : Str2(window, "min");
            var max = window is null ? null : Str2(window, "max");
            if ((min is not null && !PixelsPattern.IsMatch(min)) || (max is not null && !PixelsPattern.IsMatch(max))) { throw new ManifestProblem("window.min and window.max must be pixels, such as 420,220"); }
            var handles = m["handles"] as JsonObject;
            if (m["handles"] is not null && handles is null) { throw new ManifestProblem("handles must be an object"); }
            int? instances = null;
            if (m["instances"] is not null) {
                if (m["instances"] is JsonValue iv && iv.TryGetValue<int>(out var n) && n >= 1) { instances = n; }
                else { throw new ManifestProblem("instances must be a whole number from 1"); }
            }
            bool continuity = false;
            if (m["continuity"] is not null) {
                if (m["continuity"] is JsonValue cv && cv.TryGetValue<bool>(out var b)) { continuity = b; }
                else { throw new ManifestProblem("continuity must be true or false"); }
            }
            return new AppletPackage(name, title!.Trim(), version!.Trim(), Str("description"), Str("license"),
                src, File("css"), body, fit, shape, min, max,
                handles?.DeepClone().AsObject(), instances, File("actions"), continuity,
                List("needs", true), List("wants", true), List("tags", false), dir);
        }
        catch (ManifestProblem p) { return Refuse(folder, p.Message); }
        catch (IOException ex) { return Refuse(folder, ex.Message); }

        static string? Str2(JsonObject o, string key) => o[key] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
    }

    private AppletPackage? Refuse(string folder, string why) {
        _log.LogWarning("The applet package {Folder} was left out: {Why}.", folder, why);
        return null;
    }

    private sealed class ManifestProblem : Exception { public ManifestProblem(string message) : base(message) { } }

    /// <summary>The registry script, /applets/registry.js: a define() for
    /// each package, with its files at their addresses, its page at /page/,
    /// and its version as the cache stamp, and its continuity where it asks
    /// for it. It loads after js/applets.js, whose define() wrapper notes
    /// each actions manifest for the broker.</summary>
    public string RegistryScript() {
        var sb = new StringBuilder();
        sb.Append("/* The applet packages installed on this site, from wwwroot/applets/<name>/applet.json\n   (Architecture/applet-packages-design.md). Written by the server; not a file. */\n");
        foreach (var p in Packages) {
            var cfg = new JsonObject {
                ["src"] = p.Url(p.Src),
                ["page"] = "/page/" + p.Name,
                ["ver"] = p.Version
            };
            if (p.Css is not null) { cfg["css"] = p.Url(p.Css); }
            if (p.Handles is not null) { cfg["handles"] = p.Handles.DeepClone(); }
            if (p.Instances is not null) { cfg["instances"] = p.Instances; }
            if (p.Actions is not null) { cfg["actions"] = p.Url(p.Actions); }
            var name = JsonSerializer.Serialize(p.Name);
            if (p.Continuity) { sb.Append("if (window.pcContinuity) { window.pcContinuity.add(").Append(name).Append("); }\n"); }
            sb.Append("pudlApplets.define(").Append(name).Append(", ").Append(cfg.ToJsonString()).Append(");\n");
        }
        return sb.ToString();
    }

    /// <summary>The package's page as a content document, the shape the
    /// hand-written applet pages under content/ have: the title, the mark
    /// that makes it an applet page, and the body from the manifest, or a
    /// bare mount when the manifest gives none. Null for no such package.</summary>
    public string? PageDocument(string name) {
        var p = Find(name);
        if (p is null) { return null; }
        var title = WebUtility.HtmlEncode(p.Title);
        var sb = new StringBuilder();
        sb.Append("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n");
        sb.Append("<title>").Append(title).Append("</title>\n");
        sb.Append("<meta name=\"applet-page\" content=\"true\" />\n");
        sb.Append("<meta name=\"comments-enabled\" content=\"false\" />\n<meta name=\"comments-allowed\" content=\"false\" />\n");
        if (!string.IsNullOrWhiteSpace(p.Description)) { sb.Append("<meta name=\"description\" content=\"").Append(WebUtility.HtmlEncode(p.Description)).Append("\" />\n"); }
        sb.Append("</head>\n<body>\n");
        if (p.PageBody is not null) { sb.Append(p.PageBody.TrimEnd()).Append('\n'); }
        else {
            sb.Append("<div data-applet=\"").Append(p.Name).Append('"');
            if (p.Fit is not null) { sb.Append(" data-applet-fit=\"").Append(p.Fit).Append('"'); }
            sb.Append(" role=\"application\" aria-label=\"").Append(title).Append("\"><noscript><p>").Append(title).Append(" needs JavaScript to run.</p></noscript></div>\n");
        }
        sb.Append("</body>\n</html>\n");
        return sb.ToString();
    }

    /// <summary>Each package's action manifest, as written, with the folder
    /// its module lives in relative to the web root, for the server's runner.</summary>
    public IEnumerable<(string File, JsonObject Manifest, string Base)> ActionManifests() {
        foreach (var p in Packages) {
            if (p.Actions is null) { continue; }
            var file = Path.Combine(p.Dir, p.Actions.Replace('/', Path.DirectorySeparatorChar));
            JsonObject? m = null;
            try { m = JsonNode.Parse(File.ReadAllText(file)) as JsonObject; }
            catch (Exception ex) when (ex is JsonException or IOException) {
                _log.LogWarning("The actions of the applet package {Name} cannot be read ({Reason}).", p.Name, ex.Message);
            }
            if (m is null) { continue; }
            var dirOfManifest = Path.GetDirectoryName(p.Actions.Replace('\\', '/')) ?? "";
            var baseRel = Folder + "/" + p.Name + "/" + (dirOfManifest.Length > 0 ? dirOfManifest + "/" : "");
            yield return (file, m, baseRel);
        }
    }
}
