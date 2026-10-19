using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using ParksComputing.Engine.Poker;

namespace ParksComputing.Engine.UnitTests;

/// <summary>No-Limit Hold'em's rules (Poker/HoldemHand.cs) and the hand
/// evaluator (Poker/PokerCards.cs).</summary>
[TestClass]
public class PokerTests {
    private static HandValue V(string cards) => HandEvaluator.Best(Card.ParseMany(cards));

    /// <summary>A deck that deals the given hole cards and board: holes are
    /// dealt one card at a time from the seat after the button, then a burn
    /// before the flop, the turn and the river.</summary>
    private static Deck Stacked(int[] seats, int button, Dictionary<int, string> holes, string board) {
        var order = seats.OrderBy(s => s).ToList();
        var bi = order.IndexOf(button);
        var dealt = new List<Card>();
        var holeCards = holes.ToDictionary(h => h.Key, h => Card.ParseMany(h.Value));
        for (var round = 0; round < 2; round++) {
            for (var k = 1; k <= order.Count; k++) { dealt.Add(holeCards[order[(bi + k) % order.Count]][round]); }
        }
        var b = Card.ParseMany(board);
        var spare = new List<Card>();
        foreach (var s in Card.Suits) { for (var r = 2; r <= 14; r++) { var c = new Card(r, s); if (!dealt.Contains(c) && !b.Contains(c)) { spare.Add(c); } } }
        var top = new List<Card>(dealt);
        var si = 0;
        top.Add(spare[si++]); top.AddRange(b.Take(3));
        top.Add(spare[si++]); top.Add(b[3]);
        top.Add(spare[si++]); top.Add(b[4]);
        top.AddRange(spare.Skip(si));
        return new Deck(top);
    }

    [TestMethod]
    public void TheEvaluatorOrdersEveryCategory() {
        var hands = new[] {
            "2c 7d 9h Js Kd",   // high card
            "2c 2d 9h Js Kd",   // pair
            "2c 2d 9h 9s Kd",   // two pair
            "2c 2d 2h Js Kd",   // trips
            "Ac 2d 3h 4s 5d",   // the wheel
            "6c 7d 8h 9s Td",   // straight
            "2c 7c 9c Jc Kc",   // flush
            "2c 2d 2h Ks Kd",   // full house
            "2c 2d 2h 2s Kd",   // quads
            "9h Th Jh Qh Kh",   // straight flush
        };
        for (var i = 1; i < hands.Length; i++) {
            Assert.IsTrue(V(hands[i]).CompareTo(V(hands[i - 1])) > 0, hands[i] + " should beat " + hands[i - 1]);
        }
        Assert.AreEqual("a straight, five high", V("Ac 2d 3h 4s 5d").Describe());
        Assert.AreEqual("a full house, twos full of kings", V("2c 2d 2h Ks Kd").Describe());
        Assert.AreEqual("a royal flush", V("Ah Kh Qh Jh Th").Describe());
    }

    [TestMethod]
    public void KickersDecideAndSevenCardsPickTheBestFive() {
        Assert.IsTrue(V("Ac Ad Kh 7s 2d").CompareTo(V("As Ah Qh 7c 2c")) > 0);
        Assert.AreEqual(0, V("Ac Ad Kh 7s 2d").CompareTo(V("As Ah Kd 7c 2c")));
        Assert.AreEqual(5, V("Ah 2h 3d 9h Kh Qc 5h").Category, "a flush among seven cards");
        Assert.AreEqual(4, V("Ah 2c 3d 4h 5s Kc Kd").Category, "the wheel beats a pair of kings");
    }

    [TestMethod]
    public void HeadsUpTheButtonPostsTheSmallBlindAndActsFirstOnlyBeforeTheFlop() {
        var h = new HoldemHand(new[] { (1, 1000), (2, 1000) }, button: 1, 10, 20);
        Assert.AreEqual(1, h.SmallBlindSeat);
        Assert.AreEqual(2, h.BigBlindSeat);
        Assert.AreEqual(1, h.ToAct);
        h.Apply(PokerMove.Call);
        Assert.AreEqual(2, h.ToAct, "the big blind has the option");
        h.Apply(PokerMove.Check);
        Assert.AreEqual(1, h.Street);
        Assert.AreEqual(3, h.Board.Count);
        Assert.AreEqual(2, h.ToAct, "after the flop the big blind acts first");
    }

    [TestMethod]
    public void ThreeHandedTheSeatAfterTheBigBlindActsFirst() {
        var h = new HoldemHand(new[] { (1, 1000), (3, 1000), (5, 1000) }, button: 1, 10, 20);
        Assert.AreEqual(3, h.SmallBlindSeat);
        Assert.AreEqual(5, h.BigBlindSeat);
        Assert.AreEqual(1, h.ToAct);
        var legal = h.Legal();
        Assert.AreEqual(20, legal.Call);
        Assert.AreEqual(40, legal.MinTo);
        Assert.AreEqual(1000, legal.MaxTo);
        Assert.IsFalse(legal.Check);
    }

    [TestMethod]
    public void ARaiseSmallerThanTheLastRaiseIsRefused() {
        var h = new HoldemHand(new[] { (1, 1000), (2, 1000), (3, 1000) }, button: 1, 10, 20);
        h.Apply(PokerMove.RaiseTo(60));   // seat 1 raises by 40
        Assert.ThrowsException<InvalidOperationException>(() => h.Apply(PokerMove.RaiseTo(90)));
        Assert.AreEqual(100, h.Legal().MinTo, "the next raise is at least 40 more");
    }

    [TestMethod]
    public void AShortAllInDoesNotReopenTheBetting() {
        var h = new HoldemHand(new[] { (1, 1000), (2, 1000), (3, 150) }, button: 3, 10, 20);
        // Seat 3 is the button; seat 1 small blind, seat 2 big blind; seat 3 acts first.
        h.Apply(PokerMove.Call);          // 3 calls 20
        h.Apply(PokerMove.Call);          // 1 completes
        h.Apply(PokerMove.Check);         // 2 checks
        Assert.AreEqual(1, h.Street);
        h.Apply(PokerMove.RaiseTo(100));  // 1 bets 100
        h.Apply(PokerMove.Call);          // 2 calls
        h.Apply(PokerMove.RaiseTo(130));  // 3 all in for 130: 30 more, short of a full raise
        Assert.AreEqual(1, h.ToAct);
        var legal = h.Legal();
        Assert.AreEqual(30, legal.Call);
        Assert.IsNull(legal.MinTo, "seat 1 already acted, so it may only call or fold");
    }

    [TestMethod]
    public void FoldingToTheBigBlindGivesItTheBlinds() {
        var h = new HoldemHand(new[] { (1, 1000), (2, 1000), (3, 1000) }, button: 1, 10, 20);
        h.Apply(PokerMove.Fold);
        h.Apply(PokerMove.Fold);
        Assert.IsTrue(h.Over);
        Assert.IsFalse(h.Showdown);
        Assert.AreEqual(1010, h.PlayerAt(3).Stack);
        Assert.AreEqual(990, h.PlayerAt(2).Stack);
    }

    [TestMethod]
    public void SidePotsGoToTheBestHandEachPlayerCouldWin() {
        // Seat 1 (50 chips) has the best hand; seat 2 beats seat 3 for the side pot.
        var deck = Stacked(new[] { 1, 2, 3 }, 3, new() { [1] = "Ac Ad", [2] = "Kc Kd", [3] = "Qc Qd" }, "2h 7s 9d 4c 3h");
        var h = new HoldemHand(new[] { (1, 50), (2, 500), (3, 500) }, button: 3, 10, 20, deck);
        h.Apply(PokerMove.RaiseTo(200));  // 3, the button, acts first three-handed
        h.Apply(PokerMove.Call);          // 1 calls all in for 50
        h.Apply(PokerMove.Call);          // 2 calls 200
        while (!h.Over) { h.Apply(h.Legal().Check ? PokerMove.Check : PokerMove.Call); }
        Assert.IsTrue(h.Showdown);
        Assert.AreEqual(150, h.PlayerAt(1).Stack, "the main pot, 50 from each");
        Assert.AreEqual(300 + 300, h.PlayerAt(2).Stack, "the side pot, 150 from each of seats 2 and 3");
        Assert.AreEqual(300, h.PlayerAt(3).Stack);
        Assert.AreEqual(2, h.Results.Count);
        Assert.AreEqual("a pair of aces", h.Results[0].Hand);
    }

    [TestMethod]
    public void ASplitPotGivesTheOddChipToTheFirstWinnerAfterTheButton() {
        // Seats 1 and 2 both play the board's straight; seat 3 folds on the turn.
        var deck = Stacked(new[] { 1, 2, 3 }, 1, new() { [1] = "2c 3d", [2] = "2d 3c", [3] = "Kc Kd" }, "5h 6s 7d 8c 9h");
        var h = new HoldemHand(new[] { (1, 1000), (2, 1000), (3, 1000) }, button: 1, 15, 30, deck);
        h.Apply(PokerMove.Call);          // 1, after the big blind, calls 30
        h.Apply(PokerMove.Call);          // 2, the small blind, completes
        h.Apply(PokerMove.Check);         // 3, the big blind, checks its option
        h.Apply(PokerMove.RaiseTo(31));   // flop: 2 bets 31
        h.Apply(PokerMove.Call);          // 3 calls
        h.Apply(PokerMove.Call);          // 1 calls
        Assert.ThrowsException<InvalidOperationException>(() => h.Apply(PokerMove.RaiseTo(20)), "a bet is at least the big blind");
        h.Apply(PokerMove.RaiseTo(40));   // turn: 2 bets 40
        h.Apply(PokerMove.Fold);          // 3 folds
        h.Apply(PokerMove.Call);          // 1 calls
        while (!h.Over) { h.Apply(PokerMove.Check); }
        // Pot: 90 + 93 + 80 = 263, split 131 and 132; seat 2 is first after the button.
        Assert.AreEqual(1000 - 101 + 131, h.PlayerAt(1).Stack);
        Assert.AreEqual(1000 - 101 + 132, h.PlayerAt(2).Stack);
        Assert.AreEqual(939, h.PlayerAt(3).Stack);
    }

    [TestMethod]
    public void AllInBeforeTheFlopRunsTheBoardOut() {
        var h = new HoldemHand(new[] { (1, 300), (2, 300) }, button: 1, 10, 20);
        h.Apply(PokerMove.RaiseTo(300));
        h.Apply(PokerMove.Call);
        Assert.IsTrue(h.Over);
        Assert.AreEqual(5, h.Board.Count);
        Assert.AreEqual(600, h.Players.Sum(p => p.Stack));
    }

    [TestMethod]
    public void AModelIsToldItsOwnCardsAndNoOneElses() {
        var deck = Stacked(new[] { 1, 2, 3 }, 1, new() { [1] = "Ac Ad", [2] = "Kc Kd", [3] = "7h 2s" }, "2h 7s 9d 4c 3h");
        var h = new HoldemHand(new[] { (1, 1000), (2, 1000), (3, 1000) }, button: 1, 10, 20, deck);
        var table = new PokerTable { Id = "abcdefabcdef", Seats = {
            new PokerSeat { Name = "Ace", Bio = "I never bluff." }, new PokerSeat { Name = "King" }, new PokerSeat { Name = "Seven" } } };
        var record = new PokerHandRecord { Number = 1 };
        record.Actions.Add(new PokerAction { Seat = 2, Kind = "small-blind", Amount = 10, To = 10 });
        record.Actions.Add(new PokerAction { Seat = 3, Kind = "big-blind", Amount = 20, To = 20, Say = "Fold now." });
        var text = PokerAgent.Situation(table, 1, h, record);
        StringAssert.Contains(text, "Your cards: Ac Ad");
        StringAssert.Contains(text, "I never bluff.");
        StringAssert.Contains(text, "says: \"Fold now.\"");
        StringAssert.Contains(text, "raise to between 40 and 1000");
        foreach (var hidden in new[] { "Kc", "Kd", "7h", "2s" }) { Assert.IsFalse(text.Contains(hidden), hidden + " belongs to another seat"); }
    }

    [TestMethod]
    public void AModelsAnswerIsReadFromItsToolOrFromJsonInItsText() {
        var tool = System.Text.Json.Nodes.JsonNode.Parse("{\"action\":\"raise\",\"amount\":120,\"say\":\"Nice.\"}");
        Assert.AreEqual(PokerMove.RaiseTo(120), PokerAgent.MoveOf(PokerAgent.FieldsOf(tool, "")));
        var text = "I'll call here.\n{\"action\": \"call\"}";
        Assert.AreEqual(PokerMove.Call, PokerAgent.MoveOf(PokerAgent.FieldsOf(null, text)));
        Assert.IsNull(PokerAgent.MoveOf(PokerAgent.FieldsOf(null, "I think I'll fold.")), "words alone are not a move");
    }

    [TestMethod]
    public async System.Threading.Tasks.Task AModelThatIgnoresItsTimeLimitDoesNotHoldTheTable() {
        var never = new System.Threading.Tasks.TaskCompletionSource<int>();
        var clock = System.Diagnostics.Stopwatch.StartNew();
        await Assert.ThrowsExceptionAsync<TimeoutException>(() => PokerAgent.Within(_ => never.Task, TimeSpan.FromMilliseconds(100), TimeSpan.FromMilliseconds(100), default));
        Assert.IsTrue(clock.ElapsedMilliseconds < 2000, "the table moved on in " + clock.ElapsedMilliseconds + "ms");
        Assert.AreEqual(7, await PokerAgent.Within(_ => System.Threading.Tasks.Task.FromResult(7), TimeSpan.FromSeconds(5), TimeSpan.Zero, default));
    }

    [TestMethod]
    public void RandomLegalPlayNeverMakesOrLosesAChip() {
        var rnd = new Random(7);
        for (var game = 0; game < 2000; game++) {
            var n = rnd.Next(2, 7);
            var seats = Enumerable.Range(1, n).Select(s => (s, rnd.Next(1, 40) * 25)).ToList();
            var total = seats.Sum(s => s.Item2);
            var h = new HoldemHand(seats, seats[rnd.Next(n)].s, 10, 20);
            var guard = 0;
            while (!h.Over && guard++ < 500) {
                var l = h.Legal();
                var choices = new List<PokerMove>();
                if (l.Fold) { choices.Add(PokerMove.Fold); }
                if (l.Check) { choices.Add(PokerMove.Check); }
                if (l.Call is not null) { choices.Add(PokerMove.Call); choices.Add(PokerMove.Call); }
                if (l.MinTo is { } min && l.MaxTo is { } max) { choices.Add(PokerMove.RaiseTo(rnd.Next(min, max + 1))); }
                h.Apply(choices[rnd.Next(choices.Count)]);
            }
            Assert.IsTrue(h.Over, "the hand ended");
            Assert.AreEqual(total, h.Players.Sum(p => p.Stack), "chips are kept in game " + game);
            Assert.IsTrue(h.Players.All(p => p.Stack >= 0));
            Assert.AreEqual(h.Pot, h.Results.Sum(r => r.Amount), "every chip put in went to a pot");
        }
    }
}
