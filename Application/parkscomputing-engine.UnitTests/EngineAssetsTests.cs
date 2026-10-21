using System;
using System.Collections.Generic;
using System.IO;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.UnitTests;

/// <summary>A site's own tree over the engine's assets
/// (Pages/Services/EngineAssets.cs).</summary>
[TestClass]
public class EngineAssetsTests {
    private sealed class Env : IWebHostEnvironment {
        public string WebRootPath { get; set; } = "";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string ApplicationName { get; set; } = "test";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string ContentRootPath { get; set; } = "";
        public string EnvironmentName { get; set; } = "Test";
    }

    private static void Write(string root, string rel, string text) {
        var path = Path.Combine(root, rel.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, text);
    }

    private static string Read(IFileProvider p, string rel) {
        var f = p.GetFileInfo(rel);
        if (!f.Exists) { return "(none)"; }
        using var r = new StreamReader(f.CreateReadStream());
        return r.ReadToEnd();
    }

    [TestMethod]
    public void ASiteServesItsOwnTreeAndOnlyTheEnginesFoldersBehindIt() {
        var dir = Path.Combine(Path.GetTempPath(), "engine-assets-" + Guid.NewGuid().ToString("n"));
        var site = Path.Combine(dir, "site"); var image = Path.Combine(dir, "image");
        try {
            Write(site, "sitenav.xfer", "site nav");
            Write(site, "css/site.css", "site style");
            Write(image, "sitenav.xfer", "image nav");
            Write(image, "content/about.md", "the image's own article");
            Write(image, "favicon.ico", "the image's icon");
            Write(image, "css/site.css", "image style");
            Write(image, "pudl/pudl.css", "pudl");
            Write(image, "js/editor.js", "editor");
            var env = new Env { WebRootPath = site, WebRootFileProvider = new PhysicalFileProvider(site) };
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { [EngineAssets.SettingKey] = image }).Build();
            EngineAssets.Layer(env, config);
            var p = env.WebRootFileProvider;
            Assert.AreEqual("site nav", Read(p, "/sitenav.xfer"), "the site's own navigation");
            Assert.AreEqual("site style", Read(p, "/css/site.css"), "a site's file wins over the engine's at the same address");
            Assert.AreEqual("pudl", Read(p, "/pudl/pudl.css"));
            Assert.AreEqual("editor", Read(p, "/js/editor.js"));
            Assert.AreEqual("(none)", Read(p, "/content/about.md"), "another site's articles never show through");
            Assert.AreEqual("(none)", Read(p, "/favicon.ico"), "nor its icons");
            Assert.AreEqual(Path.GetFullPath(Path.Combine(image, "pudl", "pudl.css")), new EngineAssets(env, config).PathOf("pudl", "pudl.css"));

            /* Without Site:Assets, one tree, as parkscomputing.com keeps it. */
            var plain = new Env { WebRootPath = image, WebRootFileProvider = new PhysicalFileProvider(image) };
            var none = new ConfigurationBuilder().Build();
            var before = plain.WebRootFileProvider;
            EngineAssets.Layer(plain, none);
            Assert.AreSame(before, plain.WebRootFileProvider);
            Assert.AreEqual(Path.GetFullPath(Path.Combine(image, "js")), new EngineAssets(plain, none).PathOf("js"));
            ((PhysicalFileProvider)before).Dispose();
        }
        finally { try { Directory.Delete(dir, true); } catch (IOException) { } }
    }
}
