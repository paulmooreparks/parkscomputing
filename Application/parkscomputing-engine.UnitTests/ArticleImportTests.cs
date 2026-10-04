using System;
using System.IO;
using System.Threading.Tasks;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Publishing;

namespace ParksComputing.Engine.UnitTests;

[TestClass]
public class ArticleImportTests {
    [TestMethod]
    public async Task MarkdownWinsACollisionAndAlternateSourceIsPreservedPrivately() {
        string root = Path.Combine(Path.GetTempPath(), "parkscomputing-import-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try {
            File.WriteAllText(Path.Combine(root, "about.md"), "# Markdown");
            File.WriteAllText(Path.Combine(root, "about.html"), "<h1>Alternate</h1>");
            var plan = await ArticleImportPlanner.PlanAsync(root, _ => Task.FromResult<ArticleState>(null));
            Assert.AreEqual(1, plan.Articles.Length);
            Assert.AreEqual("about.md", plan.Articles[0].Path);
            Assert.AreEqual("<h1>Alternate</h1>", plan.Articles[0].AlternateSources[0].Source);
            ArticleImportPlanner.Verify(plan);
            File.WriteAllText(Path.Combine(root, "about.html"), "Changed after review");
            Assert.ThrowsException<ArgumentException>(() => ArticleImportPlanner.Verify(plan));
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [TestMethod]
    public void CommentMetadataUsesTheExistingSourceFormatAndIgnoresNestedFields() {
        Assert.AreEqual(ArticleCommentPolicy.Closed, ArticleImportPlanner.Metadata("a.md",
            "---\ncommentsEnabled: true\nmenu:\n  commentsAllowed: true\n---\n# Article").CommentPolicy);
        Assert.AreEqual(ArticleCommentPolicy.Open, ArticleImportPlanner.Metadata("a.html",
            "<meta name='comments-enabled' content='true'><meta name='comments-allowed' content='true'>").CommentPolicy);
        Assert.AreEqual(ArticleCommentPolicy.Disabled, ArticleImportPlanner.Metadata("a.md", "# Article").CommentPolicy);
    }

    [TestMethod]
    public void FencedCodeDoesNotBecomeMetadataButMixedActiveMetadataRequiresReview() {
        Assert.AreEqual(ArticleCommentPolicy.Disabled, ArticleImportPlanner.Metadata("a.md",
            "```html\n<meta name='comments-enabled' content='true'>\n```").CommentPolicy);
        Assert.ThrowsException<ArgumentException>(() => ArticleImportPlanner.Metadata("a.md", "<meta name='comments-enabled' content='true'>"));
    }

    [DataTestMethod]
    [DataRow("../private")]
    [DataRow("a//b")]
    [DataRow("a\\b")]
    [DataRow("/root")]
    public void InvalidArticlePathsAreRejected(string path) => Assert.ThrowsException<ArgumentException>(() => ArticleStore.NormalizeSlug(path));
}
