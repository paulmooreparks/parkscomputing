using System;
using System.IO;
using Markdig;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.UnitTests;

/// <summary>The site's one Markdown renderer and its shortcodes
/// (Pages/Services/SiteMarkdown.cs, SiteShortcodes.cs).</summary>
[TestClass]
public class SiteMarkdownTests {
    private sealed class Env : IWebHostEnvironment {
        public string WebRootPath { get; set; } = "";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string ApplicationName { get; set; } = "test";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string ContentRootPath { get; set; } = "";
        public string EnvironmentName { get; set; } = "Test";
    }

    private sealed class Nav : INavService {
        private readonly NavNode _root = new() {
            Title = "Home",
            Nav = new[] {
                new NavNode { Slug = "articles", Title = "Articles", Feed = true, Nav = new[] {
                    new NavNode { Slug = "first", Title = "The First", Date = new DateTime(2026, 1, 2), Tags = new[] { "travel" } },
                    new NavNode { Slug = "second", Title = "The Second", Date = new DateTime(2026, 3, 4) } } },
                new NavNode { Slug = "about", Title = "About Me" }
            }
        };
        public NavNode GetRoot() => _root;
        public NavNode? GetNavNode(string slug) => null;
    }

    private static string _root = "";

    private static SiteMarkdown Site() {
        if (_root.Length == 0) {
            _root = Path.Combine(Path.GetTempPath(), "sitemarkdown-tests-" + Guid.NewGuid().ToString("n"));
            Directory.CreateDirectory(Path.Combine(_root, "pudl"));
            Directory.CreateDirectory(Path.Combine(_root, "content"));
            File.WriteAllText(Path.Combine(_root, "pudl", "pudl.css"), ":root { --glyph-check: url(a); --glyph-info: url(b); --glyph-size: 14px; }");
            File.WriteAllText(Path.Combine(_root, "content", "shared.md"), "---\ntitle: Shared\n---\nShared *text*.\n");
            File.WriteAllText(Path.Combine(_root, "content", "loop.md"), "{{include:loop}}\n");
        }
        var env = new Env { WebRootPath = _root };
        return new SiteMarkdown(new Nav(), new BookService(env, new MemoryCache(new MemoryCacheOptions())), Options.Create(new SiteOptions()), env, new SiteShortcodes());
    }

    /// <summary>The pipeline the page and the window used before shortcodes.</summary>
    private static readonly MarkdownPipeline Before = new MarkdownPipelineBuilder()
        .UsePipeTables().UseTaskLists().UseAutoLinks().UseEmphasisExtras().UseSmartyPants().UseMediaLinks()
        .UseAutoIdentifiers(Markdig.Extensions.AutoIdentifiers.AutoIdentifierOptions.GitHub).UseGenericAttributes().Build();

    [TestMethod]
    public void MarkdownWithoutShortcodesRendersExactlyAsBefore() {
        var md = "# Title\n\nSome \"quoted\" text -- with *emphasis*, ~~strike~~ and a [link](https://example.com){target=\"_blank\"}.\n\n" +
            "## A section\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] not\n\n```csharp\nvar x = 1;\n```\n\n" +
            "<figure style=\"text-align:center;\">\n  <img src=\"/images/a.png\" alt=\"A\" style=\"max-width:80%;height:auto;\" />\n  <figcaption>Cap</figcaption>\n</figure>\n\n" +
            "![video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)\n\nA brace { and } alone, and {single}.\n";
        Assert.AreEqual(Markdown.ToHtml(md, Before), Site().Render(md));
    }

    [TestMethod]
    public void NoticeWrapsMarkdownInAPudlNotice() {
        var html = Site().Render("{{tip:A *good* idea}}\nDo **this**.\n\nAnd that.\n{{/tip}}\n");
        StringAssert.Contains(html, "<div class=\"notice positive sc-notice\" role=\"note\">");
        StringAssert.Contains(html, "<p class=\"notice-title\">A <em>good</em> idea</p>");
        StringAssert.Contains(html, "<p>Do <strong>this</strong>.</p>");
        StringAssert.Contains(html, "<p>And that.</p>");
    }

    [TestMethod]
    public void UnclosedContainerIsShownAsAProblem() {
        StringAssert.Contains(Site().Render("{{note}}\nText\n"), "sc-problem");
    }

    [TestMethod]
    public void UnknownAndMisplacedShortcodesAreShownAsProblems() {
        StringAssert.Contains(Site().Render("Some {{nope:x}} here.\n"), "There is no shortcode called nope.");
        StringAssert.Contains(Site().Render("A {{figure:/a.png alt=x}} in a sentence.\n"), "goes alone on its line");
        StringAssert.Contains(Site().Render("Text {{/info}} here.\n"), "This closes {{info}}, which isn");
    }

    [TestMethod]
    public void EscapedBracesAndCodeStayAsWritten() {
        var html = Site().Render("Write \\{{name}} literally, or `{{name}}` in code.\n");
        StringAssert.Contains(html, "{{name}} literally");
        StringAssert.Contains(html, "<code>{{name}}</code>");
        Assert.IsFalse(html.Contains("sc-problem"), html);
    }

    [TestMethod]
    public void FigureAloneIsAFigureWithoutAParagraph() {
        var html = Site().Render("{{figure:/images/x.png alt=\"An x\" width=80% caption=\"A *caption*.\"}}\n");
        Assert.AreEqual("<figure class=\"sc-figure\"><img src=\"/images/x.png\" alt=\"An x\" style=\"max-width:80%\" loading=\"lazy\" /><figcaption>A <em>caption</em>.</figcaption></figure>", html.Trim());
        StringAssert.Contains(Site().Render("{{figure:javascript:alert(1) alt=x}}\n"), "sc-problem");
        StringAssert.Contains(Site().Render("{{figure:/a.png}}\n"), "needs alt");
    }

    [TestMethod]
    public void TocListsTheHeadingsWithTheirIds() {
        var html = Site().Render("{{toc}}\n\n## One\n\n### One a\n\n## Two\n");
        StringAssert.Contains(html, "<nav class=\"sc-toc\" aria-label=\"Contents\"><ul><li><a href=\"#one\">One</a><ul><li><a href=\"#one-a\">One a</a></li></ul></li><li><a href=\"#two\">Two</a></li></ul></nav>");
    }

    [TestMethod]
    public void ColumnsDivideAtColumn() {
        var html = Site().Render("{{columns}}\nLeft\n\n{{column}}\n\nRight\n{{/columns}}\n");
        StringAssert.Contains(html, "<div class=\"sc-columns\"><div class=\"sc-column\">");
        StringAssert.Contains(html, "</div><div class=\"sc-column\"><p>Right</p>");
    }

    [TestMethod]
    public void DraftNoteShowsOnlyInTheEditor() {
        var md = "Before\n\n{{draft-note}}\nSecret\n{{/draft-note}}\n\nAfter\n";
        Assert.IsFalse(Site().Render(md).Contains("Secret"));
        StringAssert.Contains(Site().Render(md, editing: true), "Secret");
    }

    [TestMethod]
    public void IncludeRendersAnotherPageAndNeverLoops() {
        StringAssert.Contains(Site().Render("{{include:shared}}\n"), "<p>Shared <em>text</em>.</p>");
        StringAssert.Contains(Site().Render("{{include:loop}}\n", "loop"), "already being included");
        StringAssert.Contains(Site().Render("{{include:missing}}\n"), "no Markdown page missing");
    }

    [TestMethod]
    public void PageLinksAndListsComeFromTheSitesPages() {
        StringAssert.Contains(Site().Render("See {{page:about}}.\n"), "<a href=\"/page/about\">About Me</a>");
        StringAssert.Contains(Site().Render("See {{page:about my page}}.\n"), "<a href=\"/page/about\">my page</a>");
        StringAssert.Contains(Site().Render("See {{page:nowhere}}.\n"), "sc-problem");
        var latest = Site().Render("{{latest:1}}\n");
        StringAssert.Contains(latest, "The Second");
        Assert.IsFalse(latest.Contains("The First"));
        StringAssert.Contains(Site().Render("{{tagged:travel}}\n"), "<a href=\"/page/first\">The First</a>");
        StringAssert.Contains(Site().Render("{{children:articles}}\n"), "The Second");
    }

    [TestMethod]
    public void SmallInlineShortcodes() {
        StringAssert.Contains(Site().Render("It is {{status:green Done and dusted}}.\n"), "<span class=\"badge positive\">Done and dusted</span>");
        StringAssert.Contains(Site().Render("{{status:purple x}}\n"), "sc-problem");
        StringAssert.Contains(Site().Render("Press {{kbd:Ctrl+Shift++}}.\n"), "<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>+</kbd>");
        StringAssert.Contains(Site().Render("A {{glyph:check}} tick.\n"), "--glyph: var(--glyph-check)");
        StringAssert.Contains(Site().Render("A {{glyph:size}} one.\n"), "sc-problem");
        StringAssert.Contains(Site().Render("Go {{anchor:here}} now.\n"), "<a id=\"here\"></a>");
    }

    [TestMethod]
    public void AppletsVideosAndListings() {
        StringAssert.Contains(Site().Render("{{score:simple/Frere Jacques.musicxml}}\n"), "<div data-applet=\"sight-reader\" data-applet-fit=\"flow\" data-applet-initial=\"score=simple/Frere Jacques.musicxml\"></div>");
        StringAssert.Contains(Site().Render("{{score:../secret.xml}}\n"), "sc-problem");
        StringAssert.Contains(Site().Render("{{applet:conway}}\n"), "<div data-applet=\"conway\" data-applet-fit=\"flow\"></div>");
        StringAssert.Contains(Site().Render("{{video:youtube dQw4w9WgXcQ}}\n"), "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
        StringAssert.Contains(Site().Render("{{video:vimeo 123}}\n"), "sc-problem");
        StringAssert.Contains(Site().Render("{{code:/js/conway.js}}\n"), "<pre><code class=\"language-javascript\" data-code-src=\"/js/conway.js\"></code></pre>");
        StringAssert.Contains(Site().Render("{{code:https://evil.example/x.js}}\n"), "sc-problem");
    }

    [TestMethod]
    public void ExpandIsADisclosure() {
        StringAssert.Contains(Site().Render("{{expand:More detail}}\nHidden.\n{{/expand}}\n"), "<details class=\"sc-expand\"><summary>More detail</summary>");
    }
}
