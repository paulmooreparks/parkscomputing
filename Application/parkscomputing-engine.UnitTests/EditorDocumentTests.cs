using System;
using System.IO;
using System.Linq;
using System.Text;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.UnitTests;

/// <summary>The visual editor's document model (Pages/Services/EditorDocument.cs):
/// text in, blocks out, and back again without losing a byte.</summary>
[TestClass]
public class EditorDocumentTests {
    private static EditorDocument Doc() => new(SiteMarkdownTests.SiteForTests());

    /// <summary>The text written back with every rich block serialized from
    /// its JSON and every other block as it was.</summary>
    private static string Rewritten(EditorDocument.Model m, EditorDocument d) =>
        m.Front + m.Lead + string.Concat(m.Blocks.Select(b => (b.Rich ? d.Serialize(b.Node) : b.Source) + b.Gap));

    private static void RoundTrips(string text, int richAtLeast = 0) {
        var d = Doc();
        var m = d.Load(text, null);
        Assert.AreEqual(text, m.Text, "the parts give the text again");
        var again = Rewritten(m, d);
        var md = SiteMarkdownTests.SiteForTests();
        Assert.IsTrue(EditorDocument.Same(md.Render(SiteMarkdown.SplitFrontMatter(again).Body), md.Render(SiteMarkdown.SplitFrontMatter(text).Body)),
            "rewritten:\n" + again);
        Assert.IsTrue(m.Blocks.Count(b => b.Rich) >= richAtLeast, "rich blocks: " + m.Blocks.Count(b => b.Rich) + " of " + m.Blocks.Count);
    }

    [TestMethod]
    public void PartsGiveTheTextAgainExactly() {
        RoundTrips("---\ntitle: A\n---\n\n# Title\r\n\r\nPara one\nwith a soft break.\n\n\n\n## Two\n\n- a\n- b\n  - c\n\n1. x\n2. y\n\n```cs\ncode\n```\n\n[ref]: https://example.com\n\nTrailing.   \n\n\n", 5);
    }

    [TestMethod]
    public void ParagraphsHeadingsAndListsAreRich() {
        var m = Doc().Load("# Title\n\nSome *em*, **strong**, ~~gone~~, `code` and a [link](https://example.com \"t\").\n\n- one\n- two\n", null);
        Assert.IsTrue(m.Blocks.All(b => b.Rich), string.Join(", ", m.Blocks.Select(b => b.Node["type"] + ":" + b.Rich)));
    }

    [TestMethod]
    public void WhatTheEditorCantShowStaysSource() {
        var m = Doc().Load("```cs\nx\n```\n\n<div>raw</div>\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n{{toc}}\n\nA [link](x){target=\"_blank\"}.\n", null);
        Assert.IsTrue(m.Blocks.All(b => !b.Rich), string.Join(", ", m.Blocks.Select(b => b.Node["type"] + ":" + b.Rich)));
        Assert.IsTrue(m.Blocks.All(b => b.Node["type"]!.GetValue<string>() == "source_block"));
    }

    [TestMethod]
    public void QuotesSerializeCurlyAndRenderTheSame() {
        var d = Doc();
        var m = d.Load("He said \"it's fine\" -- and left...\n", null);
        Assert.IsTrue(m.Blocks[0].Rich);
        var again = d.Serialize(m.Blocks[0].Node);
        // As the page shows them: SmartyPants curls the quotes and leaves an
        // apostrophe inside a word as it is.
        StringAssert.Contains(again, "\u201Cit's fine\u201D \u2013 and left\u2026");
    }

    [TestMethod]
    public void TextThatLooksLikeMarkupIsEscaped() {
        RoundTrips("A literal \\*star\\*, \\_under\\_, \\[bracket\\], \\{{brace}} and \\<tag>.\n\n1\\. Not a list.\n\n\\# Not a heading.\n", 3);
    }

    [TestMethod]
    public void ShortcodesSurvive() {
        var d = Doc();
        var m = d.Load("{{tip:Title}}\nInside *it*.\n{{/tip}}\n\nIt is {{status:green Done}} now.\n\n{{figure:/a.png alt=x}}\n", null);
        Assert.AreEqual("container", m.Blocks[0].Node["type"]!.GetValue<string>());
        Assert.IsTrue(m.Blocks[1].Rich);
        Assert.AreEqual("source_block", m.Blocks[2].Node["type"]!.GetValue<string>(), "a block shortcode alone shows as the page renders it");
        RoundTrips("{{tip:Title}}\nInside *it*.\n{{/tip}}\n\nIt is {{status:green Done}} now.\n");
    }

    /// <summary>Every live article and chapter, when PC_CONTENT names the
    /// content folder: its parts give it again, and with every rich block
    /// rewritten it renders as it did. Skipped where the folder isn't there.</summary>
    [TestMethod]
    public void TheLiveArticlesRoundTrip() {
        var root = Environment.GetEnvironmentVariable("PC_CONTENT");
        if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) { Assert.Inconclusive("PC_CONTENT is not set."); return; }
        var d = Doc();
        var md = SiteMarkdownTests.SiteForTests();
        int files = 0, blocks = 0, rich = 0;
        var failures = new StringBuilder();
        foreach (var file in Directory.EnumerateFiles(root, "*.md", SearchOption.AllDirectories)
                     .Where(f => !f.Contains(Path.DirectorySeparatorChar + "scores" + Path.DirectorySeparatorChar) && !f.Contains(Path.DirectorySeparatorChar + "bin" + Path.DirectorySeparatorChar))) {
            var text = File.ReadAllText(file);
            var m = d.Load(text, null);
            files++; blocks += m.Blocks.Count; rich += m.Blocks.Count(b => b.Rich);
            if (m.Text != text) { failures.AppendLine(file + ": the parts don't give the text again"); continue; }
            var again = Rewritten(m, d);
            if (!EditorDocument.Same(md.Render(SiteMarkdown.SplitFrontMatter(again).Body), md.Render(SiteMarkdown.SplitFrontMatter(text).Body))) {
                failures.AppendLine(file + ": rewritten, it renders differently");
            }
        }
        Console.WriteLine($"{files} articles, {blocks} blocks, {rich} rich ({(blocks == 0 ? 0 : 100 * rich / blocks)}%).");
        Assert.AreEqual("", failures.ToString());
    }
}
