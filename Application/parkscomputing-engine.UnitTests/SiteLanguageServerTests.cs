using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Lsp;

namespace ParksComputing.Engine.UnitTests;

/// <summary>The site's language server (Lsp/SiteLanguageServer.cs):
/// completion, hover and diagnostics, and the protocol over streams.</summary>
[TestClass]
public class SiteLanguageServerTests {
    private static string Root() {
        var root = Path.Combine(Path.GetTempPath(), "site-lsp-tests-" + Guid.NewGuid().ToString("n"));
        Directory.CreateDirectory(Path.Combine(root, "content"));
        Directory.CreateDirectory(Path.Combine(root, "pudl"));
        File.WriteAllText(Path.Combine(root, "pudl", "pudl.css"), ":root { --glyph-check: url(a); }");
        return root;
    }

    [TestMethod]
    public void CompletesShortcodeNamesAfterTwoBraces() {
        var s = new SiteLanguageServer(Root());
        var items = s.Complete("Some text {{fi", 0, 14);
        var labels = items.Select(i => i!["label"]!.GetValue<string>()).ToList();
        CollectionAssert.Contains(labels, "figure");
        Assert.AreEqual("figure:", items.First(i => i!["label"]!.GetValue<string>() == "figure")!["insertText"]!.GetValue<string>());
    }

    [TestMethod]
    public void ClosingTwoBracesOffersOnlyContainers() {
        var s = new SiteLanguageServer(Root());
        var labels = s.Complete("{{/", 0, 3).Select(i => i!["label"]!.GetValue<string>()).ToList();
        CollectionAssert.Contains(labels, "tip");
        CollectionAssert.DoesNotContain(labels, "figure");
    }

    [TestMethod]
    public void CompletesAShortcodesParametersInsideItsCall() {
        var s = new SiteLanguageServer(Root());
        var line = "{{figure:/images/a.png al";
        var labels = s.Complete(line, 0, line.Length).Select(i => i!["label"]!.GetValue<string>()).ToList();
        CollectionAssert.IsSubsetOf(new[] { "alt", "width", "caption" }, labels);
    }

    [TestMethod]
    public void HoverDescribesTheShortcodeUnderThePointer() {
        var s = new SiteLanguageServer(Root());
        var hover = s.Hover("Before {{figure:/a.png alt=\"x\"}} after", 0, 12)!;
        StringAssert.Contains(hover["contents"]!["value"]!.GetValue<string>(), "**Figure**");
        Assert.AreEqual(7, hover["range"]!["start"]!["character"]!.GetValue<int>());
        Assert.IsNull(s.Hover("Before {{figure:/a.png alt=\"x\"}} after", 0, 2));
    }

    [TestMethod]
    public void DiagnosticsAreTheRenderersProblemsWhereTheShortcodesAre() {
        var s = new SiteLanguageServer(Root());
        var text = "---\ntitle: T\n---\n\nFine {{kbd:Ctrl}} here.\n\nAn {{nonesuch}} here.\n\n{{figure:/images/a.png}}\n";
        var d = s.Diagnose(text, "t");
        Assert.AreEqual(2, d.Count, d.ToJsonString());
        var unknown = d.First(x => x!["message"]!.GetValue<string>().Contains("nonesuch"))!;
        Assert.AreEqual(6, unknown["range"]!["start"]!["line"]!.GetValue<int>());
        Assert.AreEqual(3, unknown["range"]!["start"]!["character"]!.GetValue<int>());
        var figure = d.First(x => x!["message"]!.GetValue<string>().Contains("alt"))!;
        Assert.AreEqual(8, figure["range"]!["start"]!["line"]!.GetValue<int>());
    }

    [TestMethod]
    public async Task SpeaksTheProtocolOverStreams() {
        static byte[] Frame(string json) { var body = Encoding.UTF8.GetBytes(json); return Encoding.ASCII.GetBytes("Content-Length: " + body.Length + "\r\n\r\n").Concat(body).ToArray(); }
        var input = new MemoryStream(new[] {
            Frame("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}"),
            Frame("{\"jsonrpc\":\"2.0\",\"method\":\"initialized\",\"params\":{}}"),
            Frame("{\"jsonrpc\":\"2.0\",\"method\":\"textDocument/didOpen\",\"params\":{\"textDocument\":{\"uri\":\"file:///c/site/content/a.md\",\"languageId\":\"markdown\",\"version\":1,\"text\":\"x {{nonesuch}}\"}}}"),
            Frame("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"textDocument/completion\",\"params\":{\"textDocument\":{\"uri\":\"file:///c/site/content/a.md\"},\"position\":{\"line\":0,\"character\":4}}}"),
            Frame("{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"shutdown\"}"),
            Frame("{\"jsonrpc\":\"2.0\",\"method\":\"exit\"}")
        }.SelectMany(b => b).ToArray());
        var output = new MemoryStream();
        await new SiteLanguageServer(Root()).Serve(input, output);
        var text = Encoding.UTF8.GetString(output.ToArray());
        var messages = text.Split("Content-Length:", StringSplitOptions.RemoveEmptyEntries)
            .Select(m => JsonNode.Parse(m[(m.IndexOf("\r\n\r\n") + 4)..])!.AsObject()).ToList();
        Assert.IsTrue(messages.Any(m => m["id"]?.GetValue<int>() == 1 && m["result"]!["capabilities"]!["hoverProvider"]!.GetValue<bool>()), text);
        Assert.IsTrue(messages.Any(m => m["method"]?.GetValue<string>() == "textDocument/publishDiagnostics" && m["params"]!["diagnostics"]!.AsArray().Count == 1), text);
        Assert.IsTrue(messages.Any(m => m["id"]?.GetValue<int>() == 2 && m["result"]!.AsArray().Count > 5), text);
        Assert.IsTrue(messages.Any(m => m["id"]?.GetValue<int>() == 3 && m.ContainsKey("result")), text);
    }
}
