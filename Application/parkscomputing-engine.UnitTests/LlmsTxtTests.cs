using System;
using System.IO;
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
        private readonly NavNode _root = new() {
            Title = "Jo Example",
            Description = "Jo Example is a counsellor.",
            Nav = new[] { new NavNode { Slug = "about", Title = "About" } }
        };
        public NavNode GetRoot() => _root;
        public NavNode? GetNavNode(string slug) => null;
    }

    private static (MarkdownPages Pages, string Content) Site() {
        var root = Path.Combine(Path.GetTempPath(), "llms-tests-" + Guid.NewGuid().ToString("n"));
        var content = Path.Combine(root, "content");
        Directory.CreateDirectory(content);
        File.WriteAllText(Path.Combine(content, "index.md"), "# Home\n\nWelcome.\n");
        File.WriteAllText(Path.Combine(content, "about.md"), "---\ntitle: About\ndescription: About Jo.\n---\nJo counsels.\n");
        var pages = new MarkdownPages(new Env { WebRootPath = root }, new Nav(), Options.Create(new SiteOptions()), new FileCache());
        return (pages, content);
    }

    [TestMethod]
    public void WithoutAHandWrittenSectionLlmsTxtIsTheNameTheDescriptionAndThePages() {
        var (pages, _) = Site();
        var text = pages.LlmsTxt("https://example.com").Replace("\r\n", "\n");
        StringAssert.StartsWith(text, "# Jo Example\n\n> Jo Example is a counsellor.\n\nEach page below");
        StringAssert.Contains(text, "- [About](https://example.com/page/about.md): About Jo.");
    }

    [TestMethod]
    public void TheHandWrittenSectionComesAfterTheDescriptionAndIsNotAPage() {
        var (pages, content) = Site();
        File.WriteAllText(Path.Combine(content, MarkdownPages.LlmsSectionFile), "## Key facts\r\n\r\n- Office: [directions](/directions)\r\n");
        var text = pages.LlmsTxt("https://example.com").Replace("\r\n", "\n");
        StringAssert.Contains(text, "> Jo Example is a counsellor.\n\n## Key facts\n\n- Office: [directions](https://example.com/directions)\n\nEach page below");
        Assert.IsFalse(text.Contains("llms-section"), text);
        Assert.IsFalse(pages.IsReadable("llms-section"));
    }

    [TestMethod]
    public void AnEditToTheSectionShowsAtOnceAndDeletingItRemovesIt() {
        var (pages, content) = Site();
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
