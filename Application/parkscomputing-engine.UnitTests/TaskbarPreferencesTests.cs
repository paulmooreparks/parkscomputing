using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Identity;
using ParksComputing.Engine.Pages.Models;

namespace ParksComputing.Engine.UnitTests;

[TestClass]
public sealed class TaskbarPreferencesTests {
    [TestMethod]
    public void TaskbarRecordsRejectInvalidVersionsDuplicatesAndNavigationText() {
        Assert.IsTrue(TaskbarController.Valid(new(1, new[] { "app-editor", "unavailable-tool" }, new[] { "pin:app-editor", "terminal-2" })));
        Assert.IsFalse(TaskbarController.Valid(new(2, new[] { "app-editor" }, new string[0])));
        Assert.IsFalse(TaskbarController.Valid(new(1, new[] { "app-editor", "app-editor" }, new string[0])));
        Assert.IsFalse(TaskbarController.Valid(new(1, new[] { "../account" }, new string[0])));
        Assert.IsFalse(TaskbarController.Valid(new(1, new string[0], new[] { "https://example.com" })));
    }

    [TestMethod]
    public void DestinationIdentityDoesNotGuessFromInstanceSuffixes() {
        Assert.AreEqual("app-terminal", WindowViewModel.DestinationFor("terminal"));
        Assert.AreEqual("article-coincidences", WindowViewModel.DestinationFor("coincidences"));
        Assert.AreEqual("window-terminal-2", WindowViewModel.DestinationFor("terminal-2"));
        Assert.AreEqual("window-one-word-or-two", WindowViewModel.DestinationFor("one-word-or-two"));
        Assert.AreEqual("one-word-or-two", TaskbarDestinationsController.KeyOf("window-one-word-or-two"));
        Assert.IsNull(TaskbarDestinationsController.KeyOf("unavailable-tool"));
    }

    [TestMethod]
    public void ProviderReferencesRequireUniquePinnedIdentities() {
        Assert.IsTrue(TaskbarController.Valid(new(2, new[] { "window-about" }, new string[0], new[] { new TaskbarReference("window-about", "content") })));
        Assert.IsFalse(TaskbarController.Valid(new(2, new[] { "window-about" }, new string[0], new[] { new TaskbarReference("window-other", "content") })));
        Assert.IsFalse(TaskbarController.Valid(new(2, new[] { "window-about" }, new string[0], new[] { new TaskbarReference("window-about", "../content") })));
        Assert.IsFalse(TaskbarController.Valid(new(2, new[] { "window-about" }, new string[0], new[] { new TaskbarReference("window-about", "content"), new TaskbarReference("window-about", "other") })));
    }

    [TestMethod]
    public void SiteMenuReferencesSurviveTheAccountEnvelope() {
        var id = "pudl-menu-" + string.Concat(System.Linq.Enumerable.Repeat("0076", 40));
        var preferences = new TaskbarPreferences(2, new[] { id }, new[] { "pin:" + id },
            new[] { new TaskbarReference(id, "pudl-site-menus") });
        Assert.IsTrue(TaskbarController.Valid(preferences));
        var json = System.Text.Json.JsonSerializer.Serialize(preferences);
        var restored = System.Text.Json.JsonSerializer.Deserialize<TaskbarPreferences>(json);
        Assert.IsTrue(TaskbarController.Valid(restored));
        Assert.AreEqual("pudl-site-menus", restored!.References![0].Provider);
        var tooLarge = "pudl-menu-" + string.Concat(System.Linq.Enumerable.Repeat("0076", 9000));
        Assert.IsFalse(TaskbarController.Valid(new(2, new[] { tooLarge }, new string[0],
            new[] { new TaskbarReference(tooLarge, "pudl-site-menus") })));
    }
}
