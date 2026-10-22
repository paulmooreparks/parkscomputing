using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Pages.Services;

namespace ParksComputing.Engine.UnitTests;

/// <summary>A page's icon for its window in the taskbar and its pin
/// (NavNode.IconOf).</summary>
[TestClass]
public class WindowIconTests {
    [TestMethod]
    public void APageOnlyTheMenuOffersStillHasItsIcon() {
        var root = new NavNode {
            Slug = "root",
            Nav = new[] {
                new NavNode { Slug = "applets", Nav = new[] { new NavNode { Slug = "editor", Url = "/page/editor", Icon = "/images/icons/editor.svg" } } }
            },
            Menu = new[] {
                new NavNode { Title = "Parks Computing", Nav = new[] { new NavNode { Slug = "settings", Url = "/page/settings", Icon = "/images/icons/settings.svg" } } },
                new NavNode { Title = "Applets", Nav = new[] {
                    new NavNode { Slug = "chat", Url = "/page/chat", When = "admin", Icon = "/applets/chat/icon.svg" },
                    new NavNode { Slug = "editor", Url = "/page/editor", Icon = "/images/icons/other.svg" }
                } }
            }
        };
        Assert.AreEqual("/images/icons/editor.svg", root.IconOf("/page/editor"), "the nav's entry comes first");
        Assert.AreEqual("/images/icons/settings.svg", root.IconOf("/page/settings"));
        Assert.AreEqual("/applets/chat/icon.svg", root.IconOf("/page/chat"));
        Assert.IsNull(root.IconOf("/page/nothing"));
        Assert.IsNull(root.IconOf(null));
    }
}
