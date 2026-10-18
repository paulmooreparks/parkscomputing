using System;
using System.IO;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.FileProviders;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Controllers;

namespace ParksComputing.Engine.UnitTests;

/// <summary>The site's score library, the service score-library
/// (Controllers/ScoreLibraryController.cs): what it lists and what it
/// gives, over a temporary web root.</summary>
[TestClass]
public class ScoreLibraryTests {
    private sealed class Env : IWebHostEnvironment {
        public string WebRootPath { get; set; } = "";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string ApplicationName { get; set; } = "test";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string ContentRootPath { get; set; } = "";
        public string EnvironmentName { get; set; } = "Test";
    }

    private static (ScoreLibraryController lib, string root) Library(bool listed = true) {
        var root = Path.Combine(Path.GetTempPath(), "score-library-tests-" + Guid.NewGuid().ToString("n"));
        var scores = Path.Combine(root, "content", "scores");
        Directory.CreateDirectory(Path.Combine(scores, "simple"));
        Directory.CreateDirectory(Path.Combine(scores, ".drafts"));
        if (listed) { File.WriteAllText(Path.Combine(scores, ".listed"), ""); }
        File.WriteAllText(Path.Combine(scores, "simple", "Ode to Joy.musicxml"), "<score-partwise/>");
        File.WriteAllText(Path.Combine(scores, "Top.mxl"), "PK");
        File.WriteAllText(Path.Combine(scores, "CREDITS.md"), "# Credits");
        File.WriteAllText(Path.Combine(scores, ".drafts", "Hidden.musicxml"), "<score-partwise/>");
        var lib = new ScoreLibraryController(new Env { WebRootPath = root }) { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
        return (lib, root);
    }

    [TestMethod]
    public void TheIndexListsTheScoresAndNothingElse() {
        var (lib, root) = Library();
        try {
            var ok = (OkObjectResult)lib.Index();
            var json = JsonSerializer.Serialize(ok.Value);
            StringAssert.Contains(json, "\"path\":\"simple/Ode to Joy.musicxml\"");
            StringAssert.Contains(json, "\"folder\":\"simple\"");
            StringAssert.Contains(json, "\"path\":\"Top.mxl\"");
            Assert.IsFalse(json.Contains("CREDITS"), "a file that is not a score is left out");
            Assert.IsFalse(json.Contains("Hidden"), "a folder whose name starts with a dot is left out");
        } finally { Directory.Delete(root, true); }
    }

    [TestMethod]
    public void AScoreComesBackByItsPath() {
        var (lib, root) = Library();
        try {
            var file = (PhysicalFileResult)lib.Score("simple/Ode to Joy.musicxml");
            Assert.AreEqual("application/vnd.recordare.musicxml+xml", file.ContentType);
            Assert.AreEqual("application/vnd.recordare.musicxml", ((PhysicalFileResult)lib.Score("Top.mxl")).ContentType);
        } finally { Directory.Delete(root, true); }
    }

    [TestMethod]
    public void ItGivesNothingOutsideTheScores() {
        var (lib, root) = Library();
        try {
            Assert.IsInstanceOfType(lib.Score("CREDITS.md"), typeof(NotFoundResult));
            Assert.IsInstanceOfType(lib.Score(".drafts/Hidden.musicxml"), typeof(NotFoundResult));
            Assert.IsInstanceOfType(lib.Score("../scores/simple/Ode to Joy.musicxml"), typeof(NotFoundResult));
            Assert.IsInstanceOfType(lib.Score("simple/Missing.musicxml"), typeof(NotFoundResult));
        } finally { Directory.Delete(root, true); }
    }

    [TestMethod]
    public void AFolderThatDoesNotAskToBeListedIsNotALibrary() {
        var (lib, root) = Library(listed: false);
        try {
            Assert.IsInstanceOfType(lib.Index(), typeof(NotFoundResult));
            Assert.IsInstanceOfType(lib.Score("Top.mxl"), typeof(NotFoundResult));
        } finally { Directory.Delete(root, true); }
    }
}
