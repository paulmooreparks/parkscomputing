using System.Collections.Generic;
using System.Linq;

using ParksComputing.Engine.Pages.Services;
using ParksComputing.Xfer.Lang;

using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace ParksComputing.Engine.UnitTests {
    /// <summary>sitenav.xfer's menu in its titled shape, and the site's
    /// commands as the menu writes them (Architecture/site-menu-design.md).</summary>
    [TestClass]
    public class SiteMenuTests {
        private const string Nav = @"<! document { xferlang ""0.15"" } !>
{
    slug ""home""
    menu [
        {
            title ""Parks Computing""
            icon ""/favicon-32x32.png""
            nav [
                { title ""Home"" url ""/"" }
                { separator ~true }
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
            var root = XferConvert.Deserialize<NavNode>(Nav)!;
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
            Assert.AreEqual("theme", Attrs(r)["data-command"]);
            Assert.AreEqual("{\"value\":\"dark\"}", Attrs(r)["data-args"]);
            StringAssert.Contains(r.Open(), "data-args=\"{&quot;value&quot;:&quot;dark&quot;}\"");
            StringAssert.Contains(r.Open(), "type=\"button\"");
        }

        [TestMethod]
        public void TheWindowCommandsAreTheWindowBarsLinks() {
            Assert.IsTrue(Attrs(SiteCommands.Render("windows.minimize-all", null, true)).ContainsKey("data-win-back"));
            Assert.IsTrue(Attrs(SiteCommands.Render("windows.restore-all", null, true)).ContainsKey("data-win-restore"));
            Assert.IsTrue(Attrs(SiteCommands.Render("windows.close-all", null, true)).ContainsKey("data-close-all"));
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
            var root = XferConvert.Deserialize<NavNode>(Nav)!;
            var window = MenuBuilder.ToHtml(MenuBuilder.Build(root.Menu, desktop: true, e => null, _ => Enumerable.Empty<MenuEntry>()));
            StringAssert.Contains(window, "<li data-menubar-if=\"windows\">Window<ul>");
            StringAssert.Contains(window, "<li><img src=\"/favicon-32x32.png\" alt=\"\" /> Parks Computing<ul>");
            StringAssert.Contains(window, "<li>-</li><li>Quick Links</li>");
            StringAssert.Contains(window, "<li>Theme<ul><li><button");
            var classic = MenuBuilder.ToHtml(MenuBuilder.Build(root.Menu, desktop: false, e => null, _ => Enumerable.Empty<MenuEntry>()));
            Assert.IsFalse(classic.Contains("Minimize all"));
        }

        [TestMethod]
        public void AnUnknownCommandIsAButtonForAScriptToDefine() {
            var r = SiteCommands.Render("notes.new", new Dictionary<string, string> { ["folder"] = "inbox" }, desktop: false);
            Assert.AreEqual("button", r.Tag);
            Assert.AreEqual("notes.new", Attrs(r)["data-command"]);
        }
    }
}
