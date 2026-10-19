using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;

namespace ParksComputing.Engine.Poker;

/// <summary>
/// A playing card (Architecture/poker-design.md): a rank from 2 to 14 (the
/// ace high) and a suit, written as two characters such as "As" or "Td",
/// which is the form the table's state, the page and the models' requests
/// all use.
/// </summary>
public readonly record struct Card(int Rank, char Suit) {
    public const string Ranks = "23456789TJQKA";
    public const string Suits = "shdc";

    public override string ToString() => Ranks[Rank - 2].ToString() + Suit;

    public static Card Parse(string s) {
        if (s is not { Length: 2 } || Ranks.IndexOf(s[0]) < 0 || Suits.IndexOf(s[1]) < 0) { throw new FormatException("Not a card: " + s); }
        return new Card(Ranks.IndexOf(s[0]) + 2, s[1]);
    }

    public static IReadOnlyList<Card> ParseMany(string s) => s.Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(Parse).ToList();

    /// <summary>A rank's name in words, for the hand descriptions.</summary>
    public static string RankName(int rank, bool plural = false) {
        var n = rank switch { 14 => "ace", 13 => "king", 12 => "queen", 11 => "jack", 10 => "ten", 9 => "nine", 8 => "eight", 7 => "seven", 6 => "six", 5 => "five", 4 => "four", 3 => "three", _ => "two" };
        return plural ? (n == "six" ? "sixes" : n + "s") : n;
    }
}

/// <summary>A shuffled deck, dealt from the top. The shuffle is
/// Fisher-Yates with the operating system's cryptographic generator, so no
/// seat, and no one reading the server's memory layout, can predict it.</summary>
public sealed class Deck {
    private readonly List<Card> _cards;

    public Deck() : this(Shuffled()) { }

    /// <summary>A deck in a given order, top first: for the tests.</summary>
    public Deck(IEnumerable<Card> order) { _cards = order.ToList(); }

    public int Count => _cards.Count;

    public Card Deal() {
        if (_cards.Count == 0) { throw new InvalidOperationException("The deck is empty."); }
        var c = _cards[0]; _cards.RemoveAt(0); return c;
    }

    public IReadOnlyList<Card> Remaining => _cards;

    private static List<Card> Shuffled() {
        var cards = new List<Card>(52);
        foreach (var s in Card.Suits) { for (var r = 2; r <= 14; r++) { cards.Add(new Card(r, s)); } }
        for (var i = cards.Count - 1; i > 0; i--) {
            var j = RandomNumberGenerator.GetInt32(i + 1);
            (cards[i], cards[j]) = (cards[j], cards[i]);
        }
        return cards;
    }
}

/// <summary>A five-card poker hand's value: its category (0 high card to 8
/// straight flush) and the ranks that order hands within it, highest
/// first. Larger compares greater.</summary>
public sealed record HandValue(int Category, IReadOnlyList<int> Ranks) : IComparable<HandValue> {
    public static readonly string[] Categories = { "high card", "one pair", "two pair", "three of a kind", "straight", "flush", "full house", "four of a kind", "straight flush" };

    public int CompareTo(HandValue? other) {
        if (other is null) { return 1; }
        if (Category != other.Category) { return Category.CompareTo(other.Category); }
        for (var i = 0; i < Math.Min(Ranks.Count, other.Ranks.Count); i++) {
            if (Ranks[i] != other.Ranks[i]) { return Ranks[i].CompareTo(other.Ranks[i]); }
        }
        return 0;
    }

    /// <summary>The hand in words, such as "a full house, kings full of
    /// fives" or "a straight, nine high".</summary>
    public string Describe() => Category switch {
        8 => Ranks[0] == 14 ? "a royal flush" : "a straight flush, " + Card.RankName(Ranks[0]) + " high",
        7 => "four " + Card.RankName(Ranks[0], true),
        6 => "a full house, " + Card.RankName(Ranks[0], true) + " full of " + Card.RankName(Ranks[1], true),
        5 => "a flush, " + Card.RankName(Ranks[0]) + " high",
        4 => "a straight, " + Card.RankName(Ranks[0]) + " high",
        3 => "three " + Card.RankName(Ranks[0], true),
        2 => "two pair, " + Card.RankName(Ranks[0], true) + " and " + Card.RankName(Ranks[1], true),
        1 => "a pair of " + Card.RankName(Ranks[0], true),
        _ => Card.RankName(Ranks[0]) + " high"
    };
}

public static class HandEvaluator {
    /// <summary>The best five-card hand among five to seven cards.</summary>
    public static HandValue Best(IReadOnlyList<Card> cards) {
        if (cards.Count < 5) { throw new ArgumentException("A hand needs five cards."); }
        HandValue? best = null;
        var n = cards.Count;
        var pick = new Card[5];
        for (var a = 0; a < n; a++) for (var b = a + 1; b < n; b++) for (var c = b + 1; c < n; c++) for (var d = c + 1; d < n; d++) for (var e = d + 1; e < n; e++) {
            pick[0] = cards[a]; pick[1] = cards[b]; pick[2] = cards[c]; pick[3] = cards[d]; pick[4] = cards[e];
            var v = Five(pick);
            if (best is null || v.CompareTo(best) > 0) { best = v; }
        }
        return best!;
    }

    public static HandValue Five(IReadOnlyList<Card> five) {
        var ranks = five.Select(c => c.Rank).OrderByDescending(r => r).ToList();
        var flush = five.All(c => c.Suit == five[0].Suit);
        var distinct = ranks.Distinct().ToList();
        int? straightHigh = null;
        if (distinct.Count == 5) {
            if (ranks[0] - ranks[4] == 4) { straightHigh = ranks[0]; }
            else if (ranks.SequenceEqual(new[] { 14, 5, 4, 3, 2 })) { straightHigh = 5; }
        }
        if (straightHigh is { } sh && flush) { return new HandValue(8, new[] { sh }); }
        /* Ranks grouped by how many of each, most first, then highest. */
        var groups = ranks.GroupBy(r => r).OrderByDescending(g => g.Count()).ThenByDescending(g => g.Key).ToList();
        var order = groups.Select(g => g.Key).ToList();
        var shape = string.Join("", groups.Select(g => g.Count()));
        if (shape == "41") { return new HandValue(7, order); }
        if (shape == "32") { return new HandValue(6, order); }
        if (flush) { return new HandValue(5, ranks); }
        if (straightHigh is { } s) { return new HandValue(4, new[] { s }); }
        if (shape == "311") { return new HandValue(3, order); }
        if (shape == "221") { return new HandValue(2, order); }
        if (shape == "2111") { return new HandValue(1, order); }
        return new HandValue(0, ranks);
    }
}
