using System.Collections.Generic;
using System.Linq;

using ParksComputing.Engine.Identity;
using ParksComputing.Engine.Pages.Services;
using ParksComputing.XferLang.Serialization;

using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace ParksComputing.Engine.UnitTests {
    /// <summary>sitenav.xfer's menu in its titled shape, and the site's
    /// commands as the menu writes them (Architecture/site-menu-design.md).</summary>
    [TestClass]
    public class SiteMenuTests {
        private const string Nav = @"<! xfer 1 !>
{
    slug ""home""
    menu [
        {
            title ""Parks Computing""
            icon ""/favicon-32x32.png""
            nav [
                { title ""Home"" url ""/"" }
                { separator true }
                { heading ""Quick Links"" nav [ { slug ""about"" } ] }
            ]
        }
        {
            title ""View""
            nav [
                { title ""Dark"" command ""theme"" args { value ""dark"" } }
                { title ""Theme"" nav [ { title ""Light"" command ""theme"" args { value ""light"" } } ] }
            ]
        }
        {
            title ""Window""
            when ""window""
            nav [ { title ""Minimize all"" command ""windows.minimize-all"" } ]
        }
        {
            title ""Go""
            nav [
                { from ""sections"" when ""classic"" }
                { title ""Logistics label"" command ""open"" args { applet ""barcodes"" state ""l=demo-logistics"" } }
            ]
        }
    ]
}";

        [TestMethod]
        public void TheTitledMenuReadsIntoNavNodes() {
            var root = XferSerializer.Deserialize<NavNode>(Nav)!;
            Assert.AreEqual(4, root.Menu!.Length);
            var logo = root.Menu[0];
            Assert.AreEqual("Parks Computing", logo.Title);
            Assert.AreEqual("/favicon-32x32.png", logo.Icon);
            Assert.IsTrue(logo.Nav![1].Separator);
            Assert.AreEqual("Quick Links", logo.Nav[2].Heading);
            Assert.AreEqual("about", logo.Nav[2].Nav![0].Slug);

            var dark = root.Menu[1].Nav![0];
            Assert.AreEqual("theme", dark.Command);
            Assert.AreEqual("dark", dark.Args!["value"]);
            Assert.AreEqual("light", root.Menu[1].Nav![1].Nav![0].Args!["value"]);

            Assert.AreEqual("window", root.Menu[2].When);
            Assert.AreEqual("sections", root.Menu[3].Nav![0].From);
            var open = root.Menu[3].Nav![1];
            Assert.AreEqual("barcodes", open.Args!["applet"]);
            Assert.AreEqual("l=demo-logistics", open.Args["state"]);
        }

        private static Dictionary<string, string?> Attrs(SiteCommands.Rendered r) => r.Attributes.ToDictionary(a => a.Key, a => a.Value);

        [TestMethod]
        public void ViewIsALinkTickedForTheViewInUse() {
            var window = SiteCommands.Render("view", new Dictionary<string, string> { ["value"] = "window" }, desktop: true);
            Assert.AreEqual("a", window.Tag);
            Assert.AreEqual("/?view=window", Attrs(window)["href"]);
            Assert.AreEqual("true", Attrs(window)["aria-checked"]);
            var classic = SiteCommands.Render("view", new Dictionary<string, string> { ["value"] = "classic" }, desktop: true);
            Assert.AreEqual("/home", Attrs(classic)["href"]);
            Assert.AreEqual("false", Attrs(classic)["aria-checked"]);
        }

        [TestMethod]
        public void ThemeIsAButtonCarryingItsArguments() {
            var r = SiteCommands.Render("theme", new Dictionary<string, string> { ["value"] = "dark" }, desktop: false);
            Assert.AreEqual("button", r.Tag);
            Assert.AreEqual("theme", Attrs(r)["data-site-command"]);
            Assert.AreEqual("{\"value\":\"dark\"}", Attrs(r)["data-args"]);
            StringAssert.Contains(r.Open(), "data-args=\"{&quot;value&quot;:&quot;dark&quot;}\"");
            StringAssert.Contains(r.Open(), "type=\"button\"");
        }

        [TestMethod]
        public void TheWindowCommandsAreTheWindowBarsLinks() {
            Assert.IsTrue(Attrs(SiteCommands.Render("windows.minimize-all", null, true)).ContainsKey("data-win-back"));
            Assert.IsTrue(Attrs(SiteCommands.Render("windows.restore-all", null, true)).ContainsKey("data-win-restore"));
            Assert.IsTrue(Attrs(SiteCommands.Render("windows.close-all", null, true)).ContainsKey("data-win-close-all"));
        }

        [TestMethod]
        public void OpenLinksToTheAppletInItsState() {
            var args = new Dictionary<string, string> { ["applet"] = "barcodes", ["state"] = "l=demo-logistics" };
            Assert.AreEqual("/page/barcodes?l=demo-logistics", Attrs(SiteCommands.Render("open", args, desktop: false))["href"]);
            Assert.AreEqual("/?open=barcodes&top=barcodes", Attrs(SiteCommands.Render("open", args, desktop: true))["href"]);
            /* An applet name that isn't a slug makes no link. */
            var bad = SiteCommands.Render("open", new Dictionary<string, string> { ["applet"] = "../x" }, desktop: false);
            Assert.AreEqual("button", bad.Tag);
        }

        [TestMethod]
        public void RunLinksToTheTerminalWithItsScript() {
            var r = SiteCommands.Render("run", new Dictionary<string, string> { ["script"] = "hello world", ["cwd"] = "~/bin" }, desktop: false);
            Assert.AreEqual("/page/terminal?cwd=~%2Fbin&run=hello%20world", Attrs(r)["href"]);
        }

        [TestMethod]
        public void TheMenuIsWrittenForTheViewInUse() {
            var root = XferSerializer.Deserialize<NavNode>(Nav)!;
            var window = MenuBuilder.ToHtml(MenuBuilder.Build(root.Menu, desktop: true, e => null, _ => Enumerable.Empty<MenuEntry>()));
            StringAssert.Contains(window, "<li data-menubar-if=\"windows\">Window<ul>");
            StringAssert.Contains(window, "<li><img src=\"/favicon-32x32.png\" alt=\"\" /> Parks Computing<ul>");
            StringAssert.Contains(window, "<li>-</li><li>Quick Links</li>");
            StringAssert.Contains(window, "<li>Theme<ul><li><button");
            var classic = MenuBuilder.ToHtml(MenuBuilder.Build(root.Menu, desktop: false, e => null, _ => Enumerable.Empty<MenuEntry>()));
            Assert.IsFalse(classic.Contains("Minimize all"));
        }

        [TestMethod]
        public void TheSiteIsNamedByItsLogoTitleOrElseItsRoot() {
            var withMenu = new NavNode { Title = "Home", Menu = new[] { new NavNode { Title = "Parks Computing", Icon = "/logo.png" } } };
            Assert.AreEqual("Parks Computing", withMenu.SiteName());
            Assert.AreEqual("/logo.png", withMenu.LogoIcon());
            var bare = new NavNode { Title = "XferLang" };
            Assert.AreEqual("XferLang", bare.SiteName());
            Assert.AreEqual("/favicon-32x32.png", bare.LogoIcon());
            Assert.AreEqual("XferLang", SiteMenu.Build(bare, desktop: true)[0].Label);
        }

        [TestMethod]
        public void ATitleGlyphIsWrittenWhenItIsAGlyphName() {
            var titles = new[] {
                new NavNode { Title = "Home" },
                new NavNode { Title = "Go", Glyph = "home", Nav = new[] { new NavNode { Command = "x", Title = "X" } } },
                new NavNode { Title = "Bad", Glyph = "home\" onclick=\"x", Nav = new[] { new NavNode { Command = "x", Title = "X" } } }
            };
            var html = MenuBuilder.ToHtml(MenuBuilder.Build(titles, desktop: true, e => null, _ => Enumerable.Empty<MenuEntry>()));
            StringAssert.Contains(html, "<li data-menu-glyph=\"home\">Go<ul>");
            StringAssert.Contains(html, "<li>Bad<ul>");
        }

        [TestMethod]
        public void AnEntryCanShowOnOneStageOnly() {
            var titles = new[] { new NavNode { Title = "Help", Nav = new[] {
                new NavNode { Command = "always", Title = "Always" },
                new NavNode { Command = "beta-only", Title = "Beta only", When = "beta" },
                new NavNode { Command = "production-only", Title = "Production only", When = "production" },
                new NavNode { Command = "classic-only", Title = "Classic only", When = "classic" }
            } } };
            string Labels(string? stage, bool desktop) => string.Join("|", MenuBuilder.Build(titles, desktop, e => null, _ => Enumerable.Empty<MenuEntry>(), stage)[0].Entries.Select(e => e.Label));
            Assert.AreEqual("Always|Beta only|Classic only", Labels("beta", false));
            Assert.AreEqual("Always|Production only|Classic only", Labels(null, false), "No stage is production.");
            Assert.AreEqual("Always|Production only", Labels("Production", true));
        }

        [TestMethod]
        public void AnEntryCanShowToARoleAndEveryWordMustHold() {
            var titles = new[] { new NavNode { Title = "Tools", Nav = new[] {
                new NavNode { Command = "a", Title = "Anyone" },
                new NavNode { Command = "m", Title = "Moderators", When = "moderator" },
                new NavNode { Command = "s", Title = "Super-user on beta", When = "beta superuser" },
                new NavNode { Command = "w", Title = "Admins in windows", When = "admin window" }
            } } };
            string Labels(IReadOnlyCollection<string> roles, string stage, bool desktop) => string.Join("|",
                MenuBuilder.Build(titles, desktop, e => null, _ => Enumerable.Empty<MenuEntry>(), stage, roles)[0].Entries.Select(e => e.Label));
            Assert.AreEqual("Anyone", Labels(System.Array.Empty<string>(), "beta", true), "A reader who is not signed in sees none of them.");
            Assert.AreEqual("Anyone", Labels(AccountMenu.RolesOf(new[] { "Member" }), "beta", true));
            Assert.AreEqual("Anyone|Moderators", Labels(AccountMenu.RolesOf(new[] { "Moderator" }), "beta", true));
            Assert.AreEqual("Anyone|Moderators|Super-user on beta|Admins in windows", Labels(AccountMenu.RolesOf(new[] { "SuperAdmin" }), "beta", true));
            Assert.AreEqual("Anyone|Moderators", Labels(AccountMenu.RolesOf(new[] { "SuperAdmin" }), "production", false));
            CollectionAssert.AreEqual(new[] { "member", "moderator", "admin" }, AccountMenu.RolesOf(new[] { "Admin" }).ToArray());
        }

        [TestMethod]
        public void AnUnknownCommandIsAButtonForAScriptToDefine() {
            var r = SiteCommands.Render("notes.new", new Dictionary<string, string> { ["folder"] = "inbox" }, desktop: false);
            Assert.AreEqual("button", r.Tag);
            Assert.AreEqual("notes.new", Attrs(r)["data-site-command"]);
        }
    }
}
