using ParksComputing.Engine.Pages.Services;

using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace ParksComputing.Engine.UnitTests {
    /// <summary>An article's menu from its front matter (PageMenu).</summary>
    [TestClass]
    public class PageMenuTests {
        private const string FrontMatter =
            "title: Coincidences\n" +
            "date: 2026-09-29\n" +
            "menu:\n" +
            "  - title: Coincidences\n" +
            "    items:\n" +
            "      - label: The A380 incident\n" +
            "        href: \"#a380\"\n" +
            "      - \"-\"\n" +
            "      - heading: Elsewhere\n" +
            "      - label: Qantas & friends\n" +
            "        href: https://en.wikipedia.org/wiki/Qantas\n" +
            "keywords: travel\n";

        [TestMethod]
        public void RendersTitlesCommandsHeadingsAndSeparators() {
            var html = PageMenu.Render(FrontMatter);
            Assert.AreEqual(
                "<nav data-page-menu hidden aria-label=\"Page menu\"><ul><li>Coincidences<ul>" +
                "<li><a href=\"#a380\">The A380 incident</a></li>" +
                "<li>-</li>" +
                "<li>Elsewhere</li>" +
                "<li><a href=\"https://en.wikipedia.org/wiki/Qantas\">Qantas &amp; friends</a></li>" +
                "</ul></li></ul></nav>", html);
        }

        [TestMethod]
        public void NoMenuGivesNothing() {
            Assert.AreEqual(string.Empty, PageMenu.Render("title: Coincidences\ndate: 2026-09-29\n"));
            Assert.AreEqual(string.Empty, PageMenu.Render(null));
        }

        [TestMethod]
        public void AScriptLinkIsLeftOut() {
            var html = PageMenu.Render("menu:\n  - title: Bad\n    items:\n      - label: Run\n        href: javascript:alert(1)\n");
            Assert.AreEqual(string.Empty, html);
        }

        [TestMethod]
        public void AMenuThatIsNotYamlIsLeftOut() {
            Assert.AreEqual(string.Empty, PageMenu.Render("menu:\n  - title: [unclosed\n"));
        }

        [TestMethod]
        public void TheRestOfTheFrontMatterNeedNotBeYaml() {
            var html = PageMenu.Render("title: A: B: C\nmenu:\n  - title: Go\n    items:\n      - label: Home\n        href: /home\ndescription: x: y\n");
            StringAssert.Contains(html, "<li><a href=\"/home\">Home</a></li>");
        }
    }
}
