using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.UnitTests;

/// <summary>Which files need a passkey tap on the admin desktop, and which
/// MCP may never change (Identity/ServerFiles.cs).</summary>
[TestClass]
public class ServerFilesRulesTests {
    [DataTestMethod]
    [DataRow("pudl/pudl.css", true)]
    [DataRow("pudl", true)]
    [DataRow("PUDL/min/pudl.css", true)]
    [DataRow("pudl\\pudl.css", true)]
    [DataRow("css/site.css", false)]
    [DataRow("js/plausible-init.js", false)]
    [DataRow("content/pudl.md", false)]
    [DataRow("pudlish/x.css", false)]
    public void OnlyThePudlReleaseCopyIsOutOfMcpsReach(string rel, bool releaseCopy) {
        Assert.AreEqual(releaseCopy, ServerFiles.IsReleaseCopy(ServerFiles.WebRoot, rel));
        Assert.IsFalse(ServerFiles.IsReleaseCopy(ServerFiles.Home, rel));
    }

    [DataTestMethod]
    [DataRow("css/site.css")]
    [DataRow("js/accounts.js")]
    [DataRow("pudl/pudl.css")]
    public void TheAdminDesktopStillAsksForAPasskeyTapInJsCssAndPudl(string rel) {
        Assert.IsTrue(ServerFiles.IsProtected(ServerFiles.WebRoot, rel));
    }
}
