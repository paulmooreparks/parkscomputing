using System;
using System.IO;
using System.Linq;

using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;

using ParksComputing.Engine.Identity;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.UnitTests {
    /// <summary>The admin site's menu in the titled shape, the older shape
    /// still reading, and the way back to the desktop (AdminMenu).</summary>
    [TestClass]
    public class AdminMenuTests {
        private string _dir = "";

        [TestInitialize]
        public void Make() {
            _dir = Path.Combine(Path.GetTempPath(), "admin-menu-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path.Combine(_dir, "etc"));
            Directory.CreateDirectory(Path.Combine(_dir, "home", "paul", ".config"));
        }

        [TestCleanup]
        public void Remove() { try { Directory.Delete(_dir, true); } catch (IOException) { } }

        private AdminMenu Menu() => new(Options.Create(new AdminOptions {
            HomeRoot = Path.Combine(_dir, "home"), EtcRoot = Path.Combine(_dir, "etc"), PublicOrigin = "https://example.com"
        }), NullLogger<AdminMenu>.Instance);

        private static string Html(System.Collections.Generic.IReadOnlyList<MenuTitle> m) => MenuBuilder.ToHtml(m);

        [TestMethod]
        public void TheDefaultRetainsStandardTitlesAndEmptyContributionSlots() {
            var m = Menu().For("paul", desktop: true);
            CollectionAssert.AreEqual(new[] { "Parks Computing Admin", "Go", "Applets", "View", "Window", "Help" }, m.Select(t => t.Label).ToArray());
            Assert.IsTrue(m[4].WindowsOnly);
            Assert.IsTrue(m[4].WindowCommands);
            Assert.AreEqual("help", m[5].Id);
            var html = Html(m);
            StringAssert.Contains(html, "<a href=\"/admin/files\" data-win-open=\"files\">Files</a>");
            StringAssert.Contains(html, "<a href=\"/admin/terminal\" data-win-request=\"shell\">New terminal</a>");
            StringAssert.Contains(html, "<button type=\"submit\" form=\"admin-signout\">Sign out</button>");
            StringAssert.Contains(html, "data-command=\"theme\"");
            StringAssert.Contains(html, "data-menubar-windows");
        }

        [TestMethod]
        public void OffTheDesktopTheLogoGoesBackToItAndThereIsNoWindowTitle() {
            var m = Menu().For("paul", desktop: false);
            CollectionAssert.AreEqual(new[] { "Parks Computing Admin", "Go", "Applets", "View", "Help" }, m.Select(t => t.Label).ToArray());
            Assert.AreEqual("Desktop", m[0].Entries[0].Label);
            StringAssert.Contains(Html(m), "<a href=\"/admin/files\">Files</a>");
        }

        [TestMethod]
        public void AFileInTheOlderShapeBecomesTheLogosTitle() {
            File.WriteAllText(Path.Combine(_dir, "home", "paul", ".config", "admin-menu.xfer"),
                "{ menu [ { title \"Tools\" nav [ { slug \"files\" } ] } { slug \"site\" } { title \"Docs\" url \"https://example.org\" } ] }");
            var m = Menu().For("paul", desktop: true);
            CollectionAssert.AreEqual(new[] { "Parks Computing Admin", "Go", "Applets", "View", "Window", "Help" }, m.Select(t => t.Label).ToArray());
            Assert.AreEqual(MenuEntryKind.Heading, m[0].Entries[0].Kind);
            Assert.AreEqual("Tools", m[0].Entries[0].Label);
            Assert.AreEqual("View the site", m[0].Entries[1].Label);
            StringAssert.Contains(Html(m), "<a href=\"https://example.org\" target=\"_blank\" rel=\"noopener\">Docs</a>");
        }

        [TestMethod]
        public void AnAdminsOwnTitledFileReplacesTheShared() {
            File.WriteAllText(Path.Combine(_dir, "home", "paul", ".config", "admin-menu.xfer"),
                "{ menu [ { title \"Mine\" icon \"/x.png\" nav [ { slug \"editor\" } { separator ~true } { title \"Run hello\" command \"run\" args { script \"hello\" } } ] } ] }");
            var m = Menu().For("paul", desktop: true);
            Assert.AreEqual(1, m.Count);
            var html = Html(m);
            StringAssert.Contains(html, "<img src=\"/x.png\" alt=\"\" /> Mine");
            StringAssert.Contains(html, "<li>-</li>");
            StringAssert.Contains(html, "data-command=\"run\"");
        }

        [TestMethod]
        public void AFileThatDoesNotParseFallsBackToTheShared() {
            File.WriteAllText(Path.Combine(_dir, "home", "paul", ".config", "admin-menu.xfer"), "{ menu [ { title ");
            Assert.AreEqual("Parks Computing Admin", Menu().For("paul", desktop: true)[0].Label);
        }
    }
}
