using System;
using System.IO;
using System.Linq;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.UnitTests;

/// <summary>/llms.txt (Pages/Services/MarkdownPages.cs), and the text a site
/// writes by hand for it in content/llms-section.md.</summary>
[TestClass]
public class LlmsTxtTests {
    private sealed class Env : IWebHostEnvironment {
        public string WebRootPath { get; set; } = "";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string ApplicationName { get; set; } = "test";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string ContentRootPath { get; set; } = "";
        public string EnvironmentName { get; set; } = "Test";
    }

    private sealed class Nav : INavService {
        public readonly NavNode Root = new() {
            Title = "Jo Example",
            Description = "Jo Example is a counsellor.",
            Nav = new[] {
                new NavNode { Slug = "about", Title = "About" },
                new NavNode { Slug = "cv", Title = "CV", Description = "Jo's work and training." }
            }
        };
        public NavNode GetRoot() => Root;
        public NavNode? GetNavNode(string slug) => Array.Find(Root.Nav!, n => n.Slug == slug);
    }

    private static (MarkdownPages Pages, string Content, Nav Nav) Site() {
        var root = Path.Combine(Path.GetTempPath(), "llms-tests-" + Guid.NewGuid().ToString("n"));
        var content = Path.Combine(root, "content");
        Directory.CreateDirectory(content);
        File.WriteAllText(Path.Combine(content, "index.md"), "# Home\n\nWelcome.\n");
        File.WriteAllText(Path.Combine(content, "about.md"), "---\ntitle: About\ndescription: About Jo.\n---\nJo counsels.\n");
        File.WriteAllText(Path.Combine(content, "cv.md"), "# CV\n\nJo trained.\n");
        File.WriteAllText(Path.Combine(content, "contact.md"), "---\ntitle: Contact\ndescription: Write to Jo.\n---\nWrite.\n");
        var nav = new Nav();
        var pages = new MarkdownPages(new Env { WebRootPath = root }, nav, Options.Create(new SiteOptions()), new FileCache());
        return (pages, content, nav);
    }

    [TestMethod]
    public void WithoutAHandWrittenSectionLlmsTxtIsTheNameTheDescriptionAndThePages() {
        var (pages, _, _) = Site();
        var text = pages.LlmsTxt("https://example.com").Replace("\r\n", "\n");
        StringAssert.StartsWith(text, "# Jo Example\n\n> Jo Example is a counsellor.\n\nEach page below");
        StringAssert.Contains(text, "## Pages\n\n- [Home](https://example.com/index.md): Jo Example is a counsellor.\n- [About](https://example.com/page/about.md): About Jo.");
        StringAssert.Contains(text, "## Optional\n\n- [Contact](https://example.com/page/contact.md): Write to Jo.");
    }

    [TestMethod]
    public void TheLlmsListGroupsPagesFirstWithoutTouchingTheMenu() {
        var (pages, _, nav) = Site();
        nav.Root.Llms = new[] {
            new NavNode { Title = "Start here", Nav = new[] {
                new NavNode { Slug = "home", Url = "/", Description = "Who Jo is." },
                new NavNode { Slug = "contact", Title = "Book a call" }
            } },
            new NavNode { Title = "About Jo", Nav = new[] { new NavNode { Slug = "cv" }, new NavNode { Slug = "missing" } } }
        };
        var text = pages.LlmsTxt("https://example.com").Replace("\r\n", "\n");
        StringAssert.Contains(text,
            "## Start here\n\n" +
            "- [Home](https://example.com/index.md): Who Jo is.\n" +
            "- [Book a call](https://example.com/page/contact.md): Write to Jo.\n\n" +
            "## About Jo\n\n" +
            "- [CV](https://example.com/page/cv.md): Jo's work and training.\n\n" +
            "## Pages\n\n" +
            "- [About](https://example.com/page/about.md): About Jo.\n");
        Assert.IsFalse(text.Contains("## Optional"), text);
        Assert.IsFalse(text.Contains("missing"), text);
        Assert.AreEqual(2, nav.Root.Nav!.Length);
    }

    [TestMethod]
    public async System.Threading.Tasks.Task TheContentApiNeitherListsNorGivesAPartOfTheLayout() {
        var (_, content, _) = Site();
        File.WriteAllText(Path.Combine(content, MarkdownPages.LlmsSectionFile), "## Key facts\n");
        File.WriteAllText(Path.Combine(content, "header-section.html"), "<header>Jo</header>");
        var storage = new ParksComputing.Engine.Api.FileContentStorage(new Env { WebRootPath = Path.GetDirectoryName(content)! },
            Options.Create(new ParksComputing.Engine.Api.ContentStorageOptions()));
        Assert.IsNull(await storage.GetAsync("llms-section"));
        Assert.IsNull(await storage.GetAsync("header-section"));
        Assert.IsNotNull(await storage.GetAsync("about"));
        var ids = (await storage.ListAsync()).Select(r => r.Id).ToList();
        CollectionAssert.Contains(ids, "about");
        CollectionAssert.DoesNotContain(ids, "llms-section");
        CollectionAssert.DoesNotContain(ids, "header-section");
    }

    [TestMethod]
    public void SitenavXferReadsTheLlmsList() {
        var root = ParksComputing.XferLang.Serialization.XferSerializer.Deserialize<NavNode>(
            "{ slug \"home\" title \"Jo\" nav [ { slug \"about\" } ] " +
            "llms [ { title \"Start here\" nav [ { slug \"home\" url \"/\" description \"Who Jo is.\" } { slug \"contact\" } ] } ] }")!;
        Assert.AreEqual(1, root.Nav!.Length);
        Assert.AreEqual("Start here", root.Llms![0].Title);
        Assert.AreEqual("/", root.Llms[0].Nav![0].Url);
        Assert.AreEqual("Who Jo is.", root.Llms[0].Nav![0].Description);
        Assert.AreEqual("contact", root.Llms[0].Nav![1].Slug);
    }

    [DataTestMethod]
    [DataRow("header-section", true)]
    [DataRow("llms-section", true)]
    [DataRow("Footer-Section", true)]
    [DataRow("book/chapter-section", true)]
    [DataRow("book/chapter-section/", true)]
    [DataRow("sections", false)]
    [DataRow("section-one", false)]
    [DataRow("about", false)]
    public void APathWhoseLastNameEndsInSectionIsAPartOfTheLayout(string slug, bool part) {
        Assert.AreEqual(part, MarkdownPages.IsLayoutPart(slug));
    }

    [TestMethod]
    public void TheHandWrittenSectionComesAfterTheDescriptionAndIsNotAPage() {
        var (pages, content, _) = Site();
        File.WriteAllText(Path.Combine(content, MarkdownPages.LlmsSectionFile), "## Key facts\r\n\r\n- Office: [directions](/directions)\r\n");
        var text = pages.LlmsTxt("https://example.com").Replace("\r\n", "\n");
        StringAssert.Contains(text, "> Jo Example is a counsellor.\n\n## Key facts\n\n- Office: [directions](https://example.com/directions)\n\nEach page below");
        Assert.IsFalse(text.Contains("llms-section"), text);
        Assert.IsFalse(pages.IsReadable("llms-section"));
    }

    [TestMethod]
    public void AnEditToTheSectionShowsAtOnceAndDeletingItRemovesIt() {
        var (pages, content, _) = Site();
        var file = Path.Combine(content, MarkdownPages.LlmsSectionFile);
        File.WriteAllText(file, "First facts.");
        StringAssert.Contains(pages.LlmsTxt("https://example.com"), "First facts.");
        File.WriteAllText(file, "Second facts, longer.");
        var text = pages.LlmsTxt("https://example.com").Replace("\r\n", "\n");
        StringAssert.Contains(text, "Second facts, longer.");
        Assert.IsFalse(text.Contains("First facts."));
        File.Delete(file);
        Assert.IsFalse(pages.LlmsTxt("https://example.com").Contains("facts"));
    }
}
