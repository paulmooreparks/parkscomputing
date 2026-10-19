using System;
using System.Collections.Generic;
using System.Linq;

namespace ParksComputing.Engine.Poker;

/// <summary>A player's move: fold, check, call, or raise to a total for the
/// street (a bet, when nobody has bet yet, is a raise from nothing).</summary>
public sealed record PokerMove(string Kind, int? To = null) {
    public static readonly PokerMove Fold = new("fold"), Check = new("check"), Call = new("call");
    public static PokerMove RaiseTo(int to) => new("raise", to);
}

/// <summary>What the player to act may do. Call is the chips a call puts
/// in (all of the stack, when it is short); a raise goes to a total for the
/// street between MinTo and MaxTo, and MaxTo is all in.</summary>
public sealed record LegalMoves(bool Fold, bool Check, int? Call, int? MinTo, int? MaxTo);

/// <summary>One line of the hand's history: blinds, moves and the board as
/// they happened.</summary>
public sealed record HandEvent(int Street, int Seat, string Kind, int Amount, int To);

/// <summary>A pot at the end of the hand and who took it.</summary>
public sealed record PotResult(int Amount, IReadOnlyList<int> Winners, IReadOnlyList<int> Eligible, string? Hand);

/// <summary>
/// One hand of No-Limit Texas Hold'em (Architecture/poker-design.md, P1
/// and P4), from the blinds to the pots. It knows every card, so it lives
/// only on the server; the table shows each seat what that seat may see.
///
/// The rules it keeps: heads up, the button posts the small blind and acts
/// first before the flop and last after it; with three or more, the blinds
/// are the two seats after the button and the first to act before the flop
/// is the seat after the big blind. A big blind short of the blind still
/// leaves the full blind to call. A raise must be at least the size of the
/// last full raise (the big blind at first); an all-in raise smaller than
/// that does not reopen the betting for players who have already acted,
/// who may then only call or fold. Pots are split by what each player put
/// in, so an all-in player wins only up to their own contribution from
/// each opponent, and an odd chip goes to the first winner after the button.
/// </summary>
public sealed class HoldemHand {
    public sealed class Player {
        public int Seat { get; init; }
        public int Stack { get; set; }
        public int StartStack { get; init; }
        public List<Card> Hole { get; } = new();
        public bool Folded { get; set; }
        public bool AllIn { get; set; }
        /// <summary>Put in on this street.</summary>
        public int Street { get; set; }
        /// <summary>Put in on the whole hand.</summary>
        public int Total { get; set; }
        public bool Acted { get; set; }
        public bool CanRaise { get; set; } = true;
        public bool CanAct => !Folded && !AllIn;
    }

    public static readonly string[] StreetNames = { "preflop", "flop", "turn", "river", "showdown" };

    private readonly Deck _deck;
    private readonly List<Player> _players;
    private readonly List<HandEvent> _log = new();
    private int _toAct = -1;

    public IReadOnlyList<Player> Players => _players;
    public IReadOnlyList<HandEvent> Log => _log;
    public List<Card> Board { get; } = new();
    public int ButtonSeat { get; }
    public int SmallBlindSeat { get; }
    public int BigBlindSeat { get; }
    public int SmallBlind { get; }
    public int BigBlind { get; }
    /// <summary>0 preflop, 1 flop, 2 turn, 3 river, 4 over.</summary>
    public int Street { get; private set; }
    public int CurrentBet { get; private set; }
    public int LastRaise { get; private set; }
    public bool Over => Street == 4;
    /// <summary>Whether the hand went to a showdown, so the hands still in
    /// it are shown.</summary>
    public bool Showdown { get; private set; }
    public IReadOnlyList<PotResult> Results { get; private set; } = Array.Empty<PotResult>();
    public int Pot => _players.Sum(p => p.Total);

    /// <summary>The seat to act, or null when nobody is to act.</summary>
    public int? ToAct => _toAct < 0 ? null : _players[_toAct].Seat;

    /// <summary>A new hand. players are (seat, stack) for the seats with
    /// chips, in any order; button is one of their seats.</summary>
    public HoldemHand(IEnumerable<(int Seat, int Stack)> players, int button, int smallBlind, int bigBlind, Deck? deck = null) {
        _players = players.Where(p => p.Stack > 0).OrderBy(p => p.Seat).Select(p => new Player { Seat = p.Seat, Stack = p.Stack, StartStack = p.Stack }).ToList();
        if (_players.Count < 2) { throw new ArgumentException("A hand needs two players with chips."); }
        var bi = _players.FindIndex(p => p.Seat == button);
        if (bi < 0) { throw new ArgumentException("The button is not a player in the hand."); }
        if (smallBlind < 1 || bigBlind < smallBlind) { throw new ArgumentException("The blinds are wrong."); }
        _deck = deck ?? new Deck();
        ButtonSeat = button; SmallBlind = smallBlind; BigBlind = bigBlind;
        var headsUp = _players.Count == 2;
        var sb = headsUp ? bi : Next(bi);
        var bb = Next(sb);
        SmallBlindSeat = _players[sb].Seat; BigBlindSeat = _players[bb].Seat;
        /* Two cards each, one at a time, starting after the button. */
        for (var round = 0; round < 2; round++) {
            for (var k = 1; k <= _players.Count; k++) { _players[(bi + k) % _players.Count].Hole.Add(_deck.Deal()); }
        }
        Put(sb, smallBlind, "small-blind");
        Put(bb, bigBlind, "big-blind");
        CurrentBet = bigBlind; LastRaise = bigBlind;
        _toAct = headsUp ? sb : Next(bb);
        if (!_players[_toAct].CanAct || !Needs(_players[_toAct])) { _toAct = NextNeeding(_toAct); }
        if (_toAct < 0) { EndStreet(); }
    }

    private int Next(int i) => (i + 1) % _players.Count;

    private void Put(int i, int amount, string kind) {
        var p = _players[i];
        var put = Math.Min(amount, p.Stack);
        p.Stack -= put; p.Street += put; p.Total += put;
        if (p.Stack == 0) { p.AllIn = true; }
        _log.Add(new HandEvent(Street, p.Seat, kind, put, p.Street));
    }

    private bool Needs(Player p) => p.CanAct && (!p.Acted || p.Street < CurrentBet);

    /// <summary>The next player after index i who has to act, or -1.</summary>
    private int NextNeeding(int i) {
        for (var k = 1; k <= _players.Count; k++) {
            var j = (i + k) % _players.Count;
            if (Needs(_players[j])) { return j; }
        }
        return -1;
    }

    public Player PlayerAt(int seat) => _players.First(p => p.Seat == seat);

    public LegalMoves Legal() {
        if (_toAct < 0) { return new LegalMoves(false, false, null, null, null); }
        var p = _players[_toAct];
        var toCall = Math.Max(0, CurrentBet - p.Street);
        int? call = toCall > 0 ? Math.Min(toCall, p.Stack) : null;
        int? min = null, max = null;
        /* A raise needs chips beyond the call, the right to raise, and
           someone left who could answer it. */
        var others = _players.Any(o => o != p && o.CanAct);
        if (p.CanRaise && p.Stack > toCall && others) {
            max = p.Street + p.Stack;
            min = CurrentBet == 0 ? BigBlind : CurrentBet + LastRaise;
            if (max < min) { min = max; }
        }
        return new LegalMoves(toCall > 0, toCall == 0, call, min, max);
    }

    /// <summary>Plays the move for the seat to act. A move the rules do not
    /// allow throws, with the reason, and changes nothing.</summary>
    public void Apply(PokerMove move) {
        if (_toAct < 0) { throw new InvalidOperationException("Nobody is to act."); }
        var legal = Legal();
        var p = _players[_toAct];
        switch (move.Kind) {
            case "fold":
                if (!legal.Fold) { throw new InvalidOperationException("There is nothing to call, so check rather than fold."); }
                p.Folded = true; _log.Add(new HandEvent(Street, p.Seat, "fold", 0, p.Street));
                break;
            case "check":
                if (!legal.Check) { throw new InvalidOperationException("There is a bet to call, so check is not allowed."); }
                _log.Add(new HandEvent(Street, p.Seat, "check", 0, p.Street));
                break;
            case "call":
                if (legal.Call is not { } c) { throw new InvalidOperationException("There is nothing to call."); }
                Put(_toAct, c, "call");
                break;
            case "raise": {
                if (legal.MinTo is not { } min || legal.MaxTo is not { } max) { throw new InvalidOperationException("A raise is not allowed now."); }
                var to = move.To ?? throw new InvalidOperationException("A raise needs the total to raise to.");
                if (to < min || to > max) { throw new InvalidOperationException("A raise must be to between " + min + " and " + max + "."); }
                var size = to - CurrentBet;
                var wasBet = CurrentBet == 0;
                Put(_toAct, to - p.Street, wasBet ? "bet" : "raise");
                if (size >= LastRaise) {
                    LastRaise = size;
                    foreach (var o in _players.Where(o => o != p && o.CanAct)) { o.Acted = false; o.CanRaise = true; }
                }
                else {
                    /* A short all-in: whoever already acted must answer it but
                       may not raise again. */
                    foreach (var o in _players.Where(o => o != p && o.CanAct && o.Acted)) { o.Acted = false; o.CanRaise = false; }
                }
                CurrentBet = to;
                break;
            }
            default:
                throw new InvalidOperationException("A move is fold, check, call or raise.");
        }
        p.Acted = true;
        if (_players.Count(o => !o.Folded) == 1) { Finish(); return; }
        _toAct = NextNeeding(_toAct);
        if (_toAct < 0) { EndStreet(); }
    }

    /// <summary>The street's betting is done: the next street is dealt, or
    /// the board is run out when nobody is left to bet, or the hand ends.</summary>
    private void EndStreet() {
        while (true) {
            if (Street == 3) { Finish(); return; }
            Street++;
            foreach (var p in _players) { p.Street = 0; p.Acted = false; p.CanRaise = true; }
            CurrentBet = 0; LastRaise = BigBlind;
            _deck.Deal(); /* the burn card */
            var n = Street == 1 ? 3 : 1;
            for (var k = 0; k < n; k++) { Board.Add(_deck.Deal()); }
            _log.Add(new HandEvent(Street, 0, StreetNames[Street], 0, 0));
            if (_players.Count(p => p.CanAct) < 2) { continue; }
            /* After the flop the first to act is the first seat after the button. */
            var bi = _players.FindIndex(p => p.Seat == ButtonSeat);
            _toAct = NextNeeding(bi);
            if (_toAct >= 0) { return; }
        }
    }

    private void Finish() {
        _toAct = -1;
        var contenders = _players.Where(p => !p.Folded).ToList();
        var results = new List<PotResult>();
        if (contenders.Count == 1) {
            var w = contenders[0];
            results.Add(new PotResult(Pot, new[] { w.Seat }, new[] { w.Seat }, null));
            w.Stack += Pot;
        }
        else {
            Showdown = true;
            while (Board.Count < 5) { Board.Add(_deck.Deal()); }
            var values = contenders.ToDictionary(p => p.Seat, p => HandEvaluator.Best(p.Hole.Concat(Board).ToList()));
            var levels = _players.Select(p => p.Total).Where(t => t > 0).Distinct().OrderBy(t => t).ToList();
            var prev = 0;
            var pots = new List<(int Amount, List<Player> Eligible)>();
            foreach (var level in levels) {
                var amount = _players.Sum(p => Math.Min(p.Total, level) - Math.Min(p.Total, prev));
                var eligible = contenders.Where(p => p.Total >= level).ToList();
                if (eligible.Count == 0) { eligible = pots.Count > 0 ? pots[^1].Eligible : contenders; }
                /* Neighbouring levels with the same players are one pot. */
                if (pots.Count > 0 && pots[^1].Eligible.Select(p => p.Seat).SequenceEqual(eligible.Select(p => p.Seat))) {
                    pots[^1] = (pots[^1].Amount + amount, pots[^1].Eligible);
                }
                else { pots.Add((amount, eligible)); }
                prev = level;
            }
            var bi = _players.FindIndex(p => p.Seat == ButtonSeat);
            foreach (var (amount, eligible) in pots) {
                var best = eligible.Max(p => values[p.Seat])!;
                /* Winners in order from the seat after the button, for the odd chip. */
                var winners = Enumerable.Range(1, _players.Count).Select(k => _players[(bi + k) % _players.Count])
                    .Where(p => eligible.Contains(p) && values[p.Seat].CompareTo(best) == 0).ToList();
                var share = amount / winners.Count; var odd = amount - share * winners.Count;
                for (var k = 0; k < winners.Count; k++) { winners[k].Stack += share + (k < odd ? 1 : 0); }
                results.Add(new PotResult(amount, winners.Select(p => p.Seat).ToList(), eligible.Select(p => p.Seat).ToList(), best.Describe()));
            }
        }
        Results = results;
        Street = 4;
    }

    /// <summary>The value of a seat's best hand on the board so far, when
    /// the board has three cards or more.</summary>
    public HandValue? ValueOf(int seat) {
        var p = PlayerAt(seat);
        return Board.Count >= 3 ? HandEvaluator.Best(p.Hole.Concat(Board).ToList()) : null;
    }
}
