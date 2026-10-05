using System;
using System.Linq;
using Microsoft.Extensions.Logging;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.UnitTests;

/// <summary>The Server log's store (Identity/RecentLogs.cs).</summary>
[TestClass]
public sealed class RecentLogsTests {
    [TestMethod]
    public void EntriesComeNewestFirstFilteredByLevelSourceAndTime() {
        var logs = new RecentLogs();
        var t = new DateTime(2026, 10, 5, 7, 0, 0, DateTimeKind.Utc);
        logs.Add(t, LogLevel.Information, "ParksComputing.Engine.Identity.AccountWorkflow", "sent", null);
        logs.Add(t.AddMinutes(1), LogLevel.Warning, "ParksComputing.Engine.Identity.Turnstile", "refused", null);
        logs.Add(t.AddMinutes(2), LogLevel.Error, "Microsoft.EntityFrameworkCore.Query", "broke", new InvalidOperationException("bad"));
        var all = logs.Read(LogLevel.Trace, null, null, 10);
        CollectionAssert.AreEqual(new[] { "broke", "refused", "sent" }, all.Select(e => e.Message).ToArray());
        Assert.AreEqual("InvalidOperationException: bad", all[0].Exception);
        Assert.AreEqual(2, logs.Read(LogLevel.Warning, null, null, 10).Count);
        Assert.AreEqual("refused", logs.Read(LogLevel.Trace, "turnstile", null, 10).Single().Message);
        Assert.AreEqual("sent", logs.Read(LogLevel.Trace, "accounts", null, 10).Single().Message);
        Assert.AreEqual("broke", logs.Read(LogLevel.Trace, "framework", null, 10).Single().Message);
        Assert.AreEqual(2, logs.Read(LogLevel.Trace, null, t.AddMinutes(1), 10).Count);
    }

    [TestMethod]
    public void OnlyTheMostRecentAreKept() {
        var logs = new RecentLogs();
        for (int i = 0; i < RecentLogs.Capacity + 10; i++) { logs.Add(DateTime.UtcNow, LogLevel.Warning, "X", "m" + i, null); }
        Assert.AreEqual(RecentLogs.Capacity, logs.Count);
        Assert.AreEqual("m" + (RecentLogs.Capacity + 9), logs.Read(LogLevel.Trace, null, null, 1).Single().Message);
    }

    [TestMethod]
    public void SourcesFollowTheCategory() {
        Assert.AreEqual("mail", RecentLogs.SourceOf("ParksComputing.Engine.Identity.ResendMailer"));
        Assert.AreEqual("comments", RecentLogs.SourceOf("ParksComputing.Engine.Identity.ModerationNotifier"));
        Assert.AreEqual("site", RecentLogs.SourceOf("ParksComputing.Engine.Pages.Services.NavService"));
    }
}
