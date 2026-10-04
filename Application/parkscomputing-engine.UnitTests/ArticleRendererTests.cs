using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Publishing;

namespace ParksComputing.Engine.UnitTests;

[TestClass]
public class ArticleRendererTests {
    [DataTestMethod]
    [DataRow("<a href='javascript:run()'>Link</a>")]
    [DataRow("<a href='java&#x73;cript:run()'>Link</a>")]
    [DataRow("<img src='data:image/svg+xml,test' onerror='run()'>")]
    [DataRow("<svg><a xlink:href='javascript:run()'>Link</a></svg>")]
    [DataRow("<iframe srcdoc='<script>run()</script>'></iframe>")]
    [DataRow("<form action='/admin'><input name='role'></form>")]
    public void RestrictedContentCannotCarryExecutableMarkup(string source) {
        string body = new ArticleRenderer().Render(source, ArticleFormat.Html, ArticleTrust.Restricted).Body;
        foreach (string forbidden in new[] { "javascript:", "onerror", "<script", "<svg", "<iframe", "srcdoc", "<form", "<input", "data:image" }) {
            Assert.IsFalse(body.Contains(forbidden), body);
        }
    }

    [TestMethod]
    public void ArticleMarkdownRetainsCodeAndTablesWhileRemovingShellAttributes() {
        var rendered = new ArticleRenderer().Render("---\ntitle: Private metadata\n---\n# Header\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n`<script>`\n\n<p id='admin' data-win-open='admin' style='color:red'>Text</p>", ArticleFormat.Markdown, ArticleTrust.Restricted);
        Assert.IsTrue(rendered.Body.Contains("<table>"));
        Assert.IsTrue(rendered.Body.Contains("&lt;script&gt;"));
        Assert.IsFalse(rendered.Body.Contains("Private metadata"));
        Assert.IsFalse(rendered.Body.Contains("id="));
        Assert.IsFalse(rendered.Body.Contains("data-win"));
        Assert.IsFalse(rendered.Body.Contains("style="));
    }
}
