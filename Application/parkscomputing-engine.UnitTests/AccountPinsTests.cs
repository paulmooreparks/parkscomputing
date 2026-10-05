using System.Linq;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.UnitTests;

/// <summary>An account keeps only pins in the shapes the site makes
/// (Identity/AccountPins.cs, Architecture/pins-design.md).</summary>
[TestClass]
public sealed class AccountPinsTests {
    [TestMethod]
    public void GoodPinsAreKeptInOrder() {
        var pins = AccountPins.Clean(new Pin?[] {
            new("terminal", null, "Terminal", null, true),
            new("tela", "user-guide/credentials", "Tela · Credentials", "/images/tela.png", false)
        })!;
        Assert.AreEqual(2, pins.Count);
        Assert.AreEqual("terminal", pins[0].Key);
        Assert.AreEqual("user-guide/credentials", pins[1].Chapter);
        Assert.AreEqual("/images/tela.png", pins[1].Icon);
    }

    [TestMethod]
    public void AKeyOrChapterOutOfShapeRefusesTheList() {
        Assert.IsNull(AccountPins.Clean(new Pin?[] { new("../etc", null, "x", null, false) }));
        Assert.IsNull(AccountPins.Clean(new Pin?[] { new("tela", "../../secret", "x", null, false) }));
        Assert.IsNull(AccountPins.Clean(new Pin?[] { null }));
    }

    [TestMethod]
    public void IconsMustBeThisSitesAndTitlesAreTidied() {
        var p = AccountPins.Clean(new Pin?[] {
            new("a", null, "  Line\nbreak  ", "https://evil.example/x.png", false),
            new("b", null, new string('x', 300), "//evil.example/x.png", false),
            new("c", null, "", "/ok.png\" onerror=\"x", false)
        })!;
        Assert.IsTrue(p.All(x => x.Icon is null));
        Assert.AreEqual("Linebreak", p[0].Title);
        Assert.AreEqual(200, p[1].Title.Length);
        Assert.AreEqual("c", p[2].Title);
    }

    [TestMethod]
    public void RepeatsGoAndTheListIsCapped() {
        var many = Enumerable.Range(0, 80).Select(i => (Pin?)new Pin("p" + (i % 60), null, "P", null, false));
        var p = AccountPins.Clean(many)!;
        Assert.AreEqual(AccountPins.MaxPins, p.Count);
        Assert.AreEqual(p.Count, p.Select(x => x.Key).Distinct().Count());
    }
}
