using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

using HtmlAgilityPack;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.Lsp;

/// <summary>
/// The site's language server (Architecture/wysiwyg-editor-design.md): the
/// Language Server Protocol over stdin and stdout, for the site's Markdown
/// in VS Code or any editor with an LSP client, from the same shortcode
/// definitions and the same renderer the site and its Editor use.
///
///   dotnet ParksComputing.Engine.dll lsp [--root &lt;wwwroot&gt;]
///
/// It offers completion of shortcode names after {{ and of a shortcode's
/// parameters inside its call, hover text for a shortcode, and diagnostics,
/// which are the problems the site's renderer finds when it renders the
/// document (an unknown shortcode, a missing argument, a container left
/// open), each placed where its shortcode is. The web root, which includes
/// and lists of pages read, is --root, or else the nearest folder at or
/// above the workspace that holds sitenav.xfer, or else the workspace.
/// Nothing but the protocol is written to stdout.
/// </summary>
public sealed class SiteLanguageServer {
    public static bool Matches(string[] args) => args.Length > 0 && args[0] == "lsp";

    public static int Run(string[] args) {
        string? root = null;
        for (int i = 1; i < args.Length - 1; i++) { if (args[i] == "--root") { root = args[i + 1]; } }
        var server = new SiteLanguageServer(root);
        server.Serve(Console.OpenStandardInput(), Console.OpenStandardOutput()).GetAwaiter().GetResult();
        return server._exitCode;
    }

    private string? _root;
    private SiteMarkdown? _markdown;
    private readonly SiteShortcodes _shortcodes = new();
    private readonly Dictionary<string, string> _docs = new();
    private Stream? _out;
    private readonly SemaphoreSlim _writing = new(1, 1);
    private bool _shutdown;
    private int _exitCode = 1;

    public SiteLanguageServer(string? root) { _root = root; }

    /* === The protocol ==================================================== */

    public async Task Serve(Stream input, Stream output) {
        _out = output;
        while (true) {
            var message = await Read(input);
            if (message is null) { return; }
            JsonObject? reply;
            try { reply = Handle(message); }
            catch (Exception ex) {
                reply = message["id"] is { } id ? Error(id, -32603, ex.Message) : null;
            }
            if (reply is not null) { await Write(reply); }
            if (message["method"]?.GetValue<string>() == "exit") { return; }
        }
    }

    /// <summary>One message: headers to a blank line, then Content-Length bytes of JSON.</summary>
    private static async Task<JsonObject?> Read(Stream input) {
        int length = -1;
        var line = new StringBuilder();
        while (true) {
            var b = new byte[1];
            if (await input.ReadAsync(b) == 0) { return null; }
            if (b[0] == '\n') {
                var text = line.ToString().TrimEnd('\r');
                line.Clear();
                if (text.Length == 0) { break; }
                if (text.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase)) { length = int.Parse(text[15..].Trim()); }
                continue;
            }
            line.Append((char)b[0]);
        }
        if (length < 0) { return null; }
        var body = new byte[length];
        int got = 0;
        while (got < length) {
            int n = await input.ReadAsync(body.AsMemory(got, length - got));
            if (n == 0) { return null; }
            got += n;
        }
        return JsonNode.Parse(body) as JsonObject;
    }

    private async Task Write(JsonObject message) {
        message["jsonrpc"] = "2.0";
        var body = Encoding.UTF8.GetBytes(message.ToJsonString());
        var head = Encoding.ASCII.GetBytes("Content-Length: " + body.Length + "\r\n\r\n");
        await _writing.WaitAsync();
        try {
            await _out!.WriteAsync(head);
            await _out.WriteAsync(body);
            await _out.FlushAsync();
        } finally { _writing.Release(); }
    }

    private static JsonObject Result(JsonNode id, JsonNode? result) => new() { ["id"] = id.DeepClone(), ["result"] = result };
    private static JsonObject Error(JsonNode id, int code, string message) => new() { ["id"] = id.DeepClone(), ["error"] = new JsonObject { ["code"] = code, ["message"] = message } };

    /// <summary>A message's answer, or null for a notification.</summary>
    public JsonObject? Handle(JsonObject message) {
        var method = message["method"]?.GetValue<string>() ?? "";
        var id = message["id"];
        var p = message["params"] as JsonObject;
        switch (method) {
            case "initialize":
                _root ??= RootFrom(p);
                return Result(id!, new JsonObject {
                    ["capabilities"] = new JsonObject {
                        ["textDocumentSync"] = new JsonObject { ["openClose"] = true, ["change"] = 1, ["save"] = new JsonObject { ["includeText"] = false } },
                        ["completionProvider"] = new JsonObject { ["triggerCharacters"] = new JsonArray("{", ":", " ", "/") },
                        ["hoverProvider"] = true
                    },
                    ["serverInfo"] = new JsonObject { ["name"] = "parkscomputing-site", ["version"] = "1.0" }
                });
            case "shutdown":
                _shutdown = true;
                return Result(id!, null);
            case "exit":
                _exitCode = _shutdown ? 0 : 1;
                return null;
            case "textDocument/didOpen": {
                var doc = p!["textDocument"]!;
                var uri = doc["uri"]!.GetValue<string>();
                _docs[uri] = doc["text"]!.GetValue<string>();
                _ = Publish(uri);
                return null;
            }
            case "textDocument/didChange": {
                var uri = p!["textDocument"]!["uri"]!.GetValue<string>();
                var changes = p["contentChanges"] as JsonArray;
                if (changes is { Count: > 0 } && changes[^1]?["text"] is { } text) { _docs[uri] = text.GetValue<string>(); }
                _ = Publish(uri);
                return null;
            }
            case "textDocument/didClose": {
                var uri = p!["textDocument"]!["uri"]!.GetValue<string>();
                _docs.Remove(uri);
                _ = Write(new JsonObject { ["method"] = "textDocument/publishDiagnostics", ["params"] = new JsonObject { ["uri"] = uri, ["diagnostics"] = new JsonArray() } });
                return null;
            }
            case "textDocument/completion": {
                var (text, line, character) = At(p!);
                return Result(id!, text is null ? new JsonArray() : Complete(text, line, character));
            }
            case "textDocument/hover": {
                var (text, line, character) = At(p!);
                return Result(id!, text is null ? null : Hover(text, line, character));
            }
            default:
                return id is null || method.Length == 0 ? null : Error(id, -32601, "The site's language server does not answer " + method + ".");
        }
    }

    private (string? Text, int Line, int Character) At(JsonObject p) {
        var uri = p["textDocument"]?["uri"]?.GetValue<string>() ?? "";
        var pos = p["position"]!;
        return (_docs.TryGetValue(uri, out var t) ? t : null, pos["line"]!.GetValue<int>(), pos["character"]!.GetValue<int>());
    }

    /* === The site ======================================================== */

    /// <summary>The web root: the nearest folder at or above the workspace
    /// that holds sitenav.xfer, or a wwwroot under it, or the workspace.</summary>
    private static string? RootFrom(JsonObject? p) {
        var uri = p?["rootUri"]?.GetValue<string>() ?? (p?["workspaceFolders"] as JsonArray)?.FirstOrDefault()?["uri"]?.GetValue<string>();
        if (uri is null || !Uri.TryCreate(uri, UriKind.Absolute, out var u) || !u.IsFile) { return null; }
        var dir = new DirectoryInfo(u.LocalPath);
        if (File.Exists(Path.Combine(dir.FullName, "wwwroot", "sitenav.xfer"))) { return Path.Combine(dir.FullName, "wwwroot"); }
        for (var d = dir; d is not null; d = d.Parent) {
            if (File.Exists(Path.Combine(d.FullName, "sitenav.xfer"))) { return d.FullName; }
        }
        return dir.FullName;
    }

    private sealed class Env : IWebHostEnvironment {
        public string WebRootPath { get; set; } = "";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string ApplicationName { get; set; } = "ParksComputing.Engine";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string ContentRootPath { get; set; } = "";
        public string EnvironmentName { get; set; } = "Production";
    }

    /// <summary>The site's renderer, over the web root, built when first needed.</summary>
    private SiteMarkdown Markdown() {
        if (_markdown is not null) { return _markdown; }
        var root = Path.GetFullPath(_root ?? Directory.GetCurrentDirectory());
        var env = new Env { WebRootPath = root, ContentRootPath = root };
        var options = Options.Create(new SiteOptions());
        var nav = new NavService(env, NullLogger<NavService>.Instance, options);
        _markdown = new SiteMarkdown(nav, new BookService(env, new MemoryCache(new MemoryCacheOptions())), options, env, _shortcodes);
        return _markdown;
    }

    /* === Diagnostics ===================================================== */

    private async Task Publish(string uri) {
        if (!_docs.TryGetValue(uri, out var text)) { return; }
        JsonArray found;
        try { found = Diagnose(text, SlugOf(uri)); }
        catch (Exception ex) {
            // stderr is the server's log, which an editor shows; stdout is the protocol's.
            Console.Error.WriteLine("parkscomputing lsp: " + uri + " could not be checked: " + ex);
            found = new JsonArray();
        }
        await Write(new JsonObject { ["method"] = "textDocument/publishDiagnostics", ["params"] = new JsonObject { ["uri"] = uri, ["diagnostics"] = found } });
    }

    private static string? SlugOf(string uri) {
        var name = Uri.TryCreate(uri, UriKind.Absolute, out var u) ? Path.GetFileNameWithoutExtension(u.LocalPath) : null;
        return name is not null && Regex.IsMatch(name, "^[A-Za-z0-9_-]+$") ? name : null;
    }

    /// <summary>The problems the site's renderer finds in a document, each
    /// placed at its shortcode: the n-th problem with a given source at the
    /// n-th place that source appears.</summary>
    public JsonArray Diagnose(string text, string? slug) {
        var (_, body) = SiteMarkdown.SplitFrontMatter(text);
        var html = Markdown().Render(body, slug);
        var doc = new HtmlDocument();
        doc.LoadHtml(html);
        var list = new JsonArray();
        var used = new Dictionary<string, int>();
        foreach (var node in doc.DocumentNode.SelectNodes("//code[contains(concat(' ', normalize-space(@class), ' '), ' sc-problem ')]") ?? Enumerable.Empty<HtmlNode>()) {
            var source = WebUtility.HtmlDecode(node.InnerText);
            var why = WebUtility.HtmlDecode(node.GetAttributeValue("title", ""));
            int start = used.TryGetValue(source, out var from) ? from : 0, at = source.Length > 0 ? text.IndexOf(source, start, StringComparison.Ordinal) : -1;
            if (at >= 0) { used[source] = at + source.Length; }
            var (sl, sc) = at >= 0 ? Position(text, at) : (0, 0);
            var (el, ec) = at >= 0 ? Position(text, at + source.Length) : (0, 0);
            list.Add(new JsonObject {
                ["range"] = Range(sl, sc, el, ec),
                ["severity"] = 1,
                ["source"] = "parkscomputing",
                ["message"] = why
            });
        }
        return list;
    }

    private static JsonObject Range(int sl, int sc, int el, int ec) => new() {
        ["start"] = new JsonObject { ["line"] = sl, ["character"] = sc },
        ["end"] = new JsonObject { ["line"] = el, ["character"] = ec }
    };

    /// <summary>A UTF-16 offset as the protocol's line and character.</summary>
    private static (int Line, int Character) Position(string text, int offset) {
        int line = 0, start = 0;
        for (int i = 0; i < offset && i < text.Length; i++) { if (text[i] == '\n') { line++; start = i + 1; } }
        return (line, offset - start);
    }

    private static string LineText(string text, int line) {
        var lines = text.Split('\n');
        return line < lines.Length ? lines[line].TrimEnd('\r') : "";
    }

    /* === Completion and hover ============================================ */

    private static readonly Regex NameBefore = new(@"\{\{(/?)([a-z0-9-]*)$", RegexOptions.Compiled);
    private static readonly Regex ParamBefore = new(@"\{\{([a-z][a-z0-9-]*)(?::(?:[^}]|\}(?!\}))*)?[\s:]([a-z0-9-]*)$", RegexOptions.Compiled);
    private static readonly Regex Call = new(@"\{\{/?([a-z][a-z0-9-]*)(?::(?:[^}]|\}(?!\}))*)?\}\}", RegexOptions.Compiled);

    public JsonArray Complete(string text, int line, int character) {
        var before = LineText(text, line);
        before = before[..Math.Min(character, before.Length)];
        var items = new JsonArray();
        var name = NameBefore.Match(before);
        if (name.Success) {
            bool closing = name.Groups[1].Value == "/";
            foreach (var d in _shortcodes.All.Where(d => !closing || d.Kind == ShortcodeKind.Container)) {
                items.Add(new JsonObject {
                    ["label"] = d.Name, ["kind"] = 14, ["detail"] = d.Title,
                    ["documentation"] = new JsonObject { ["kind"] = "markdown", ["value"] = Describe(d) },
                    ["insertText"] = closing ? d.Name : d.Params.Count > 0 ? d.Name + ":" : d.Name,
                    ["filterText"] = d.Name
                });
            }
            return items;
        }
        var inside = ParamBefore.Match(before);
        if (inside.Success && _shortcodes.Find(inside.Groups[1].Value) is { } def) {
            foreach (var p in def.Params) {
                items.Add(new JsonObject {
                    ["label"] = p.Name, ["kind"] = 10, ["detail"] = p.Required ? "needed" : "",
                    ["documentation"] = p.Description, ["insertText"] = p.Name + "="
                });
            }
        }
        return items;
    }

    public JsonObject? Hover(string text, int line, int character) {
        var lineText = LineText(text, line);
        foreach (Match m in Call.Matches(lineText)) {
            if (character < m.Index || character > m.Index + m.Length) { continue; }
            var def = _shortcodes.Find(m.Groups[1].Value);
            if (def is null) { return null; }
            return new JsonObject {
                ["contents"] = new JsonObject { ["kind"] = "markdown", ["value"] = Describe(def) },
                ["range"] = Range(line, m.Index, line, m.Index + m.Length)
            };
        }
        return null;
    }

    private static string Describe(ShortcodeDef d) {
        var sb = new StringBuilder();
        sb.Append("**").Append(d.Title).Append("** `{{").Append(d.Name).Append("}}`\n\n").Append(d.Description);
        if (d.Params.Count > 0) {
            sb.Append("\n\n");
            foreach (var p in d.Params) { sb.Append("- `").Append(p.Name).Append('`').Append(p.Required ? " (needed): " : ": ").Append(p.Description).Append('\n'); }
        }
        if (!string.IsNullOrEmpty(d.Example)) { sb.Append("\n```\n").Append(d.Example).Append("\n```"); }
        return sb.ToString();
    }
}
