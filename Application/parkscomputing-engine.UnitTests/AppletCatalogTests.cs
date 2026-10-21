using System;
using System.IO;
using System.Linq;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.UnitTests;

/// <summary>The installed applet packages (Pages/Services/AppletCatalog.cs,
/// Architecture/applet-packages-design.md): what the site writes from a
/// manifest, and what it refuses.</summary>
[TestClass]
public class AppletCatalogTests {
    private sealed class Env : IWebHostEnvironment {
        public string WebRootPath { get; set; } = "";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string ApplicationName { get; set; } = "test";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string ContentRootPath { get; set; } = "";
        public string EnvironmentName { get; set; } = "Test";
    }

    private static string Root() {
        var root = Path.Combine(Path.GetTempPath(), "applet-catalog-tests-" + Guid.NewGuid().ToString("n"));
        Directory.CreateDirectory(Path.Combine(root, "applets", "hello"));
        File.WriteAllText(Path.Combine(root, "applets", "hello", "applet.json"),
            "{ \"name\": \"hello\", \"title\": \"Hello & Co\", \"version\": \"0.1.0\", \"description\": \"A greeting\", \"src\": \"hello.js\", \"css\": \"hello.css\", \"icon\": \"icon.svg\"," +
            " \"page\": { \"body\": \"page.html\", \"fit\": \"flow\" }, \"window\": { \"shape\": \"0.3,0.3\", \"min\": \"260,160\" }," +
            " \"handles\": { \"open\": { \"param\": \"name\" } }, \"instances\": 2, \"actions\": \"actions.json\", \"continuity\": true, \"wants\": [\"fs\"], \"tags\": [\"example\"] }");
        File.WriteAllText(Path.Combine(root, "applets", "hello", "hello.js"), "");
        File.WriteAllText(Path.Combine(root, "applets", "hello", "hello.css"), "");
        File.WriteAllText(Path.Combine(root, "applets", "hello", "icon.svg"), "<svg/>");
        File.WriteAllText(Path.Combine(root, "applets", "hello", "page.html"), "<div data-applet=\"hello\" data-applet-fit=\"flow\"></div>\n");
        File.WriteAllText(Path.Combine(root, "applets", "hello", "actions.json"), "{ \"id\": \"example.hello\", \"module\": \"actions.js\", \"actions\": [] }");
        // Refused: its name is not its folder's.
        Directory.CreateDirectory(Path.Combine(root, "applets", "wrong"));
        File.WriteAllText(Path.Combine(root, "applets", "wrong", "applet.json"), "{ \"name\": \"other\", \"title\": \"Other\", \"version\": \"1\", \"src\": \"a.js\" }");
        File.WriteAllText(Path.Combine(root, "applets", "wrong", "a.js"), "");
        // Refused: its script reaches outside the package.
        Directory.CreateDirectory(Path.Combine(root, "applets", "escape"));
        File.WriteAllText(Path.Combine(root, "applets", "escape", "applet.json"), "{ \"name\": \"escape\", \"title\": \"Escape\", \"version\": \"1\", \"src\": \"../hello/hello.js\" }");
        // Refused: not JSON.
        Directory.CreateDirectory(Path.Combine(root, "applets", "broken"));
        File.WriteAllText(Path.Combine(root, "applets", "broken", "applet.json"), "{ not json");
        // Bare: only what is required, so the page is a bare mount.
        Directory.CreateDirectory(Path.Combine(root, "applets", "bare"));
        File.WriteAllText(Path.Combine(root, "applets", "bare", "applet.json"), "{ \"name\": \"bare\", \"title\": \"Bare\", \"version\": \"2\", \"src\": \"bare.js\" }");
        File.WriteAllText(Path.Combine(root, "applets", "bare", "bare.js"), "");
        return root;
    }

    private static AppletCatalog Catalog(string root) => new(new Env { WebRootPath = root }, NullLogger<AppletCatalog>.Instance);

    [TestMethod]
    public void ReadsTheGoodManifestsAndRefusesTheBad() {
        var root = Root();
        try {
            var names = Catalog(root).Packages.Select(p => p.Name).ToArray();
            CollectionAssert.AreEqual(new[] { "bare", "hello" }, names);
            var hello = Catalog(root).Find("hello")!;
            Assert.AreEqual("Hello & Co", hello.Title);
            Assert.AreEqual("0.3,0.3", hello.WindowShape);
            Assert.AreEqual("260,160", hello.WindowMin);
            Assert.AreEqual(2, hello.Instances);
            Assert.IsTrue(hello.Continuity);
            CollectionAssert.AreEqual(new[] { "fs" }, hello.Wants.ToArray());
            Assert.IsNull(Catalog(root).Find("wrong"));
            Assert.IsNull(Catalog(root).Find("escape"));
        } finally { Directory.Delete(root, true); }
    }

    [TestMethod]
    public void TheRegistryDefinesEachPackageFromItsManifest() {
        var root = Root();
        try {
            var js = Catalog(root).RegistryScript();
            StringAssert.Contains(js, "pudlApplets.define(\"hello\", {\"src\":\"/applets/hello/hello.js\",\"page\":\"/page/hello\",\"ver\":\"0.1.0\",\"css\":\"/applets/hello/hello.css\",\"handles\":{\"open\":{\"param\":\"name\"}},\"instances\":2,\"actions\":\"/applets/hello/actions.json\"});");
            StringAssert.Contains(js, "window.pcContinuity.add(\"hello\");");
            StringAssert.Contains(js, "pudlApplets.define(\"bare\", {\"src\":\"/applets/bare/bare.js\",\"page\":\"/page/bare\",\"ver\":\"2\"});");
            Assert.IsFalse(js.Contains("pcContinuity.add(\"bare\")"));
            Assert.IsFalse(js.Contains("wrong"));
        } finally { Directory.Delete(root, true); }
    }

    [TestMethod]
    public void ThePageIsAnAppletPageWithTheManifestsBodyOrABareMount() {
        var root = Root();
        try {
            var catalog = Catalog(root);
            var page = catalog.PageDocument("hello")!;
            StringAssert.Contains(page, "<title>Hello &amp; Co</title>");
            StringAssert.Contains(page, "<meta name=\"applet-page\" content=\"true\" />");
            StringAssert.Contains(page, "<meta name=\"description\" content=\"A greeting\" />");
            StringAssert.Contains(page, "<div data-applet=\"hello\" data-applet-fit=\"flow\"></div>");
            var bare = catalog.PageDocument("bare")!;
            StringAssert.Contains(bare, "<div data-applet=\"bare\" role=\"application\" aria-label=\"Bare\"><noscript><p>Bare needs JavaScript to run.</p></noscript></div>");
            Assert.IsNull(catalog.PageDocument("nope"));
            Assert.IsNull(catalog.PageDocument("../hello"));
        } finally { Directory.Delete(root, true); }
    }

    [TestMethod]
    public void TheActionManifestsSayWhereTheirModulesLive() {
        var root = Root();
        try {
            var list = Catalog(root).ActionManifests().ToList();
            Assert.AreEqual(1, list.Count);
            Assert.AreEqual("applets/hello/", list[0].Base);
            Assert.AreEqual("example.hello", list[0].Manifest["id"]!.GetValue<string>());
        } finally { Directory.Delete(root, true); }
    }

    [TestMethod]
    public void ThePackagesJoinTheAppletsSectionOfTheNavigation() {
        var root = Root();
        try {
            File.WriteAllText(Path.Combine(root, "sitenav.xfer"), "{ slug \"root\" nav [ { slug \"applets\" title \"Applets\" nav [ { slug \"dice\" title \"Dice\" } ] } ] }");
            var env = new Env { WebRootPath = root };
            var nav = new NavService(env, NullLogger<NavService>.Instance, Options.Create(new SiteOptions()), Catalog(root));
            var applets = NavService.Sections(nav.GetRoot()).Single(s => s.Slug == "applets");
            CollectionAssert.AreEqual(new[] { "dice", "bare", "hello" }, applets.Nav!.Select(n => n.Slug).ToArray());
            var hello = applets.Nav!.Single(n => n.Slug == "hello");
            Assert.AreEqual("Hello & Co", hello.Title);
            Assert.AreEqual("0.3,0.3", hello.Win);
            Assert.AreEqual("/page/hello", hello.Url);
            Assert.AreEqual("/applets/hello/icon.svg", hello.Icon);
            CollectionAssert.AreEqual(new[] { "example" }, hello.Tags);
        } finally { Directory.Delete(root, true); }
    }

    [TestMethod]
    public void APackageTheMenuKeepsForAnAudienceStaysOutOfTheAppletsSection() {
        var root = Root();
        try {
            File.WriteAllText(Path.Combine(root, "sitenav.xfer"),
                "{ slug \"root\" nav [ { slug \"applets\" title \"Applets\" nav [ ] } ] " +
                "menu [ { menu-id \"applets\" title \"Applets\" nav [ { from \"applets\" } { slug \"hello\" when \"admin\" } ] } ] }");
            var nav = new NavService(new Env { WebRootPath = root }, NullLogger<NavService>.Instance, Options.Create(new SiteOptions()), Catalog(root));
            var r = nav.GetRoot();
            var applets = NavService.Sections(r).Single(s => s.Slug == "applets");
            CollectionAssert.AreEqual(new[] { "bare" }, applets.Nav!.Select(n => n.Slug).ToArray(), "everyone's list leaves it out");
            var entry = r.Menu!.Single().Nav!.Single(n => n.Slug == "hello");
            Assert.AreEqual("Hello & Co", entry.Title);
            Assert.AreEqual("/applets/hello/icon.svg", entry.Icon);
            Assert.AreEqual("0.3,0.3", entry.Win);
        } finally { Directory.Delete(root, true); }
    }

    [TestMethod]
    public void ASiteWithNoAppletsSectionGetsOneWhenAPackageIsInstalled() {
        var root = Root();
        try {
            File.WriteAllText(Path.Combine(root, "sitenav.xfer"), "{ slug \"root\" nav [ { slug \"articles\" title \"Articles\" feed true nav [ { slug \"one\" title \"One\" } ] } ] }");
            var nav = new NavService(new Env { WebRootPath = root }, NullLogger<NavService>.Instance, Options.Create(new SiteOptions()), Catalog(root));
            var sections = NavService.Sections(nav.GetRoot()).Select(s => s.Slug).ToArray();
            CollectionAssert.AreEqual(new[] { "articles", "applets" }, sections);
        } finally { Directory.Delete(root, true); }
    }
}
