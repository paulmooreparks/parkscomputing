using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

using Microsoft.Extensions.Logging;

namespace ParksComputing.Engine.Poker;

/// <summary>
/// Runs the tables (Architecture/poker-design.md): asks the model seats
/// for their bios, deals each hand, asks each model for its move in turn
/// or waits for the person, keeps the history, and tells the page about
/// every change as a server-sent event, after which the page reads the
/// table again (GET tables/{id}), so what a viewer sees is always the one
/// view the server computes, never something reassembled from events.
///
/// A table plays only while it is "playing" and someone is watching: with
/// no page open on it for a minute it pauses itself after the hand, since
/// every model move is a paid call. A pause asked for takes effect when the
/// hand in progress ends. A hand interrupted by a restart of the server is
/// lost, and the stacks are as they were before it, because a table is
/// saved only between hands.
/// </summary>
public sealed class PokerRunner {
    private const int RecentMax = 300;
    private static readonly TimeSpan Unwatched = TimeSpan.FromSeconds(60);

    private readonly PokerStore _store;
    private readonly PokerAgent _agent;
    private readonly ILogger<PokerRunner> _log;
    private readonly ConcurrentDictionary<(string Home, string Id), Live> _live = new();

    public PokerRunner(PokerStore store, PokerAgent agent, ILogger<PokerRunner> log) { _store = store; _agent = agent; _log = log; }

    private sealed class Live {
        public readonly object Gate = new();
        public long Seq;
        public readonly Queue<(long Seq, string Text)> Recent = new();
        public readonly List<Channel<(long, string)>> Subscribers = new();
        public DateTimeOffset LastWatched = DateTimeOffset.UtcNow;
        public PokerTable Table = null!;
        public Task? Loop;
        public CancellationTokenSource? Cancel;
        public HoldemHand? Hand;
        public PokerHandRecord? Record;
        public int? Acting;
        public DateTimeOffset ActingSince;
        public TaskCompletionSource<PokerMove>? PersonMove;
        public bool PauseAfterHand;
        public bool EndAfterHand;
        public readonly HashSet<int> Leaving = new();
        /// <summary>Players to seat when the hand in progress ends.</summary>
        public readonly List<PokerSeat> Joining = new();
        public string? Notice;
        public string? Introducing;
    }

    private Live? LiveOf(string home, string id) {
        if (_live.TryGetValue((home, id), out var l)) { return l; }
        var t = _store.Read(home, id);
        if (t is null) { return null; }
        /* A table saved as playing by a server that stopped is paused now. */
        if (t.Status == "playing") { t.Status = "paused"; }
        return _live.GetOrAdd((home, id), _ => new Live { Table = t });
    }

    public PokerTable? Table(string home, string id) => LiveOf(home, id)?.Table;

    private void Publish(Live live, string type) {
        Channel<(long, string)>[] subs; long seq; string text;
        lock (live.Gate) {
            seq = ++live.Seq;
            text = new JsonObject { ["type"] = type, ["seq"] = seq }.ToJsonString();
            live.Recent.Enqueue((seq, text));
            while (live.Recent.Count > RecentMax) { live.Recent.Dequeue(); }
            subs = live.Subscribers.ToArray();
        }
        foreach (var s in subs) { s.Writer.TryWrite((seq, text)); }
    }

    public (ChannelReader<(long Seq, string Text)> Events, Action Leave)? Subscribe(string home, string id, long after) {
        var live = LiveOf(home, id);
        if (live is null) { return null; }
        var ch = Channel.CreateUnbounded<(long, string)>();
        lock (live.Gate) {
            foreach (var e in live.Recent.Where(e => e.Seq > after)) { ch.Writer.TryWrite(e); }
            live.Subscribers.Add(ch);
            live.LastWatched = DateTimeOffset.UtcNow;
        }
        return (ch.Reader, () => { lock (live.Gate) { live.Subscribers.Remove(ch); live.LastWatched = DateTimeOffset.UtcNow; } });
    }

    private static bool Watched(Live live) {
        lock (live.Gate) { return live.Subscribers.Count > 0 || DateTimeOffset.UtcNow - live.LastWatched < Unwatched; }
    }

    public async Task CreateAsync(string home, PokerTable table) {
        await _store.SaveAsync(home, table);
        _live[(home, table.Id)] = new Live { Table = table };
    }

    /// <summary>Starts or resumes play.</summary>
    public async Task<string?> PlayAsync(string home, string id) {
        var live = LiveOf(home, id);
        if (live is null) { return "There is no such table."; }
        if (live.Table.Status == "finished") { return "This table has finished: one player has all the chips."; }
        live.PauseAfterHand = false; live.Notice = null;
        live.Table.Status = "playing";
        await _store.SaveAsync(home, live.Table);
        lock (live.Gate) {
            live.LastWatched = DateTimeOffset.UtcNow;
            if (live.Loop is null || live.Loop.IsCompleted) {
                live.Cancel = new CancellationTokenSource();
                var cancel = live.Cancel.Token;
                live.Loop = Task.Run(() => RunAsync(home, live, cancel));
            }
        }
        Publish(live, "changed");
        return null;
    }

    /// <summary>Pauses when the hand in progress ends, or now when no hand is.</summary>
    public async Task PauseAsync(string home, string id) {
        var live = LiveOf(home, id);
        if (live is null) { return; }
        if (live.Loop is { IsCompleted: false } && live.Hand is { Over: false }) { live.PauseAfterHand = true; }
        else {
            live.Cancel?.Cancel();
            if (live.Table.Status == "playing") { live.Table.Status = "paused"; }
            await _store.SaveAsync(home, live.Table);
        }
        Publish(live, "changed");
    }

    /// <summary>Ends the game for good when the hand in progress ends, or
    /// now when no hand is; on false, takes that back.</summary>
    public async Task<string?> EndAsync(string home, string id, bool end) {
        var live = LiveOf(home, id);
        if (live is null) { return "There is no such table."; }
        if (live.Table.Status == "finished") { return end ? null : "The game is already over."; }
        if (live.Loop is { IsCompleted: false } && live.Hand is { Over: false }) { live.EndAfterHand = end; }
        else if (end) {
            live.Cancel?.Cancel();
            Finish(live.Table, live, "The game is over.");
            await _store.SaveAsync(home, live.Table);
        }
        Publish(live, "changed");
        return null;
    }

    /// <summary>A seat leaves the table, taking its chips, when the hand in
    /// progress ends, or now when no hand is; on false, it stays.</summary>
    public async Task<string?> LeaveAsync(string home, string id, int seat, bool leave) {
        var live = LiveOf(home, id);
        if (live is null) { return "There is no such table."; }
        var t = live.Table;
        if (seat < 1 || seat > t.Seats.Count) { return "There is no such seat."; }
        if (t.At(seat).Left) { return leave ? null : "That player has already left."; }
        lock (live.Gate) { if (leave) { live.Leaving.Add(seat); } else { live.Leaving.Remove(seat); } }
        if (!(live.Loop is { IsCompleted: false } && live.Hand is { Over: false })) {
            ApplyLeaving(live);
            await _store.SaveAsync(home, t);
        }
        Publish(live, "changed");
        return null;
    }

    /// <summary>A new player, seated now between hands, or when the hand
    /// in progress ends. Null, or why not.</summary>
    public async Task<string?> JoinAsync(string home, string id, PokerSeat seat) {
        var live = LiveOf(home, id);
        if (live is null) { return "There is no such table."; }
        var t = live.Table;
        if (t.Status == "finished") { return "The game is over."; }
        lock (live.Gate) {
            var seated = t.Seats.Where(s => !s.Left).Concat(live.Joining).ToList();
            if (seated.Count >= PokerTable.MaxSeats) { return "The table has six players already."; }
            if (seat.IsPerson && seated.Any(s => s.IsPerson)) { return "You are already at the table."; }
            if (t.Seats.Count + live.Joining.Count >= PokerTable.MaxSeatsEver) { return "This table has had as many players as it can keep."; }
            live.Joining.Add(seat);
        }
        if (!(live.Loop is { IsCompleted: false } && live.Hand is { Over: false })) {
            ApplyLeaving(live);
            await _store.SaveAsync(home, t);
        }
        Publish(live, "changed");
        return null;
    }

    /// <summary>Between hands: seats the players waiting to join, then lets
    /// go of those leaving.</summary>
    private static void ApplyLeaving(Live live) {
        var t = live.Table;
        lock (live.Gate) {
            t.Seats.AddRange(live.Joining);
            live.Joining.Clear();
            foreach (var n in live.Leaving) { t.At(n).Left = true; }
            live.Leaving.Clear();
        }
        if (t.Status != "finished" && t.Seats.Count(s => !s.Left && s.Stack > 0) < 2) { Finish(t, live, null); }
    }

    /// <summary>The game is over: says who finished on top.</summary>
    private static void Finish(PokerTable t, Live live, string? why) {
        t.Status = "finished";
        var top = t.Seats.Where(s => !s.Left).OrderByDescending(s => s.Stack).FirstOrDefault() ?? t.Seats.OrderByDescending(s => s.Stack).First();
        live.Notice = (why is null ? "" : why + " ") + top.Label + " finished on top with " + top.Stack.ToString("N0") + ".";
    }

    public async Task<bool> DeleteAsync(string home, string id) {
        if (_live.TryRemove((home, id), out var live)) { live.Cancel?.Cancel(); live.PersonMove?.TrySetCanceled(); }
        await Task.Yield();
        return _store.Delete(home, id);
    }

    public async Task UpdateAsync(string home, string id, Action<PokerTable> change) {
        var live = LiveOf(home, id);
        if (live is null) { return; }
        change(live.Table);
        await _store.SaveAsync(home, live.Table);
        Publish(live, "changed");
    }

    /// <summary>The person's move, when it is their turn; null, or why not.</summary>
    public string? Move(string home, string id, PokerMove move) {
        var live = LiveOf(home, id);
        if (live?.Hand is not { } hand || live.PersonMove is not { } wait || hand.ToAct is not { } seat || !live.Table.At(seat).IsPerson) { return "It is not your turn."; }
        var l = hand.Legal();
        var why = move.Kind switch {
            "fold" when !l.Fold => "There is nothing to call, so check.",
            "check" when !l.Check => "There is a bet to call.",
            "call" when l.Call is null => "There is nothing to call.",
            "raise" when l.MinTo is null => "A raise is not allowed now.",
            "raise" when move.To is not { } to || to < l.MinTo || to > l.MaxTo => "A raise must be to between " + l.MinTo + " and " + l.MaxTo + ".",
            "fold" or "check" or "call" or "raise" => null,
            _ => "A move is fold, check, call or raise."
        };
        if (why is not null) { return why; }
        wait.TrySetResult(move);
        return null;
    }

    private async Task RunAsync(string home, Live live, CancellationToken cancel) {
        var table = live.Table;
        try {
            await IntroduceAsync(home, live, cancel);
            while (!cancel.IsCancellationRequested && table.Status == "playing") {
                ApplyLeaving(live);
                if (table.Status == "finished") { break; }
                /* A model that has just joined introduces itself before its first hand. */
                await IntroduceAsync(home, live, cancel);
                var active = table.Seats.Select((s, i) => (Seat: i + 1, s.Stack, s.Left)).Where(s => s.Stack > 0 && !s.Left).Select(s => (s.Seat, s.Stack)).ToList();
                if (!Watched(live)) { table.Status = "paused"; live.Notice = "Paused because nobody was watching."; break; }
                await PlayHandAsync(home, live, active, cancel);
                ApplyLeaving(live);
                if (live.EndAfterHand) { live.EndAfterHand = false; Finish(table, live, "The game is over."); break; }
                if (live.PauseAfterHand) { table.Status = "paused"; live.PauseAfterHand = false; break; }
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) {
            _log.LogError(ex, "Poker table {Table} stopped", table.Id);
            live.Notice = "The table stopped: " + ex.Message;
            if (table.Status == "playing") { table.Status = "paused"; }
        }
        finally {
            if (table.Status == "playing") { table.Status = "paused"; }
            live.Acting = null; live.PersonMove = null; live.Introducing = null;
            if (live.Hand is { Over: false }) { live.Hand = null; live.Record = null; }
            if (_live.ContainsKey((home, table.Id))) {
                try { await _store.SaveAsync(home, table); } catch (Exception ex) { _log.LogWarning(ex, "Poker table {Table} was not saved", table.Id); }
                Publish(live, "changed");
            }
        }
    }

    /// <summary>Asks every model seat not yet asked for its name and bio,
    /// all at once (P9).</summary>
    private async Task IntroduceAsync(string home, Live live, CancellationToken cancel) {
        var table = live.Table;
        var asking = table.Seats.Select((s, i) => (Seat: s, N: i + 1)).Where(x => !x.Seat.IsPerson && !x.Seat.Introduced).ToList();
        if (asking.Count == 0) { return; }
        live.Introducing = "The players are introducing themselves.";
        Publish(live, "changed");
        var intros = await Task.WhenAll(asking.Select(x => _agent.IntroduceAsync(table, x.N, cancel)));
        for (var k = 0; k < asking.Count; k++) {
            var (s, intro) = (asking[k].Seat, intros[k]);
            s.Introduced = true; s.TokensIn += intro.TokensIn; s.TokensOut += intro.TokensOut;
            if (intro.Name is not null && string.IsNullOrWhiteSpace(s.Name)) { s.Name = intro.Name; }
            if (intro.Bio is not null && string.IsNullOrWhiteSpace(s.Bio)) { s.Bio = intro.Bio; }
            if (string.IsNullOrWhiteSpace(s.Name)) { s.Name = s.Model ?? "Seat " + asking[k].N; }
            s.LastError = intro.Error;
        }
        /* Two seats under one name would confuse every reader, models included. */
        foreach (var g in table.Seats.GroupBy(s => s.Name.Trim(), StringComparer.OrdinalIgnoreCase).Where(g => g.Count() > 1)) {
            var n = 1;
            foreach (var s in g.Skip(1)) { s.Name = s.Name.Trim() + " " + (++n); }
        }
        live.Introducing = null;
        await _store.SaveAsync(home, table);
        Publish(live, "changed");
    }

    private async Task PlayHandAsync(string home, Live live, List<(int Seat, int Stack)> active, CancellationToken cancel) {
        var table = live.Table;
        var seats = active.Select(a => a.Seat).ToList();
        var button = seats.FirstOrDefault(s => s > table.Button);
        if (button == 0) { button = seats[0]; }
        var hand = new HoldemHand(active, button, table.SmallBlind, table.BigBlind);
        var record = new PokerHandRecord { Number = table.Hands + 1, Button = button, At = DateTimeOffset.UtcNow };
        foreach (var p in hand.Players) { record.Holes[p.Seat] = string.Join(" ", p.Hole); }
        foreach (var e in hand.Log.Where(e => e.Kind is "small-blind" or "big-blind")) {
            record.Actions.Add(new PokerAction { Seat = e.Seat, Street = 0, Kind = e.Kind, Amount = e.Amount, To = e.To });
        }
        lock (live.Gate) { live.Hand = hand; live.Record = record; }
        Publish(live, "changed");
        await Task.Delay(table.PaceMs, cancel);

        while (!hand.Over) {
            var seat = hand.ToAct!.Value;
            var s = table.At(seat);
            live.Acting = seat; live.ActingSince = DateTimeOffset.UtcNow;
            var logged = hand.Log.Count;
            PokerAction act;
            if (s.IsPerson) {
                live.PersonMove = new TaskCompletionSource<PokerMove>(TaskCreationOptions.RunContinuationsAsynchronously);
                Publish(live, "changed");
                var move = await live.PersonMove.Task.WaitAsync(cancel);
                live.PersonMove = null;
                lock (live.Gate) { hand.Apply(move); }
                act = new PokerAction { Seconds = (DateTimeOffset.UtcNow - live.ActingSince).TotalSeconds };
            }
            else {
                Publish(live, "changed");
                act = await ModelMoveAsync(live, seat, hand, record, cancel);
            }
            var e = hand.Log.Skip(logged).First(x => x.Seat == seat);
            act.Seat = seat; act.Street = e.Street; act.Kind = e.Kind; act.Amount = e.Amount; act.To = e.To;
            lock (live.Gate) { record.Actions.Add(act); }
            s.Moves++; s.Seconds += act.Seconds ?? 0;
            live.Acting = null;
            Publish(live, "changed");
            await Task.Delay(table.PaceMs, cancel);
        }

        record.Board = string.Join(" ", hand.Board);
        record.Pots = hand.Results.Select(r => new PokerPot { Amount = r.Amount, Winners = r.Winners.ToList(), Hand = r.Hand }).ToList();
        if (hand.Showdown) { record.Shown = hand.Players.Where(p => !p.Folded).Select(p => p.Seat).ToList(); }
        lock (live.Gate) { foreach (var p in hand.Players) { table.At(p.Seat).Stack = p.Stack; table.At(p.Seat).Hands++; record.Stacks[p.Seat] = p.Stack; } table.History.Add(record); }
        table.Button = button; table.Hands = record.Number;
        await _store.SaveAsync(home, table);
        Publish(live, "changed");
        /* The outcome stays on the table long enough to read: the winners,
           the amounts and the hands shown. */
        await Task.Delay(Math.Max(6000, table.PaceMs * 4), cancel);
    }

    /// <summary>A model's move: its answer, or a second try told why the
    /// first could not be played, or, failing both, a check or a fold made
    /// for it.</summary>
    private async Task<PokerAction> ModelMoveAsync(Live live, int seat, HoldemHand hand, PokerHandRecord record, CancellationToken cancel) {
        var table = live.Table;
        var s = table.At(seat);
        string? why = null; double seconds = 0;
        /* The table's seconds are for the whole move, a second try included. */
        var budget = TimeSpan.FromSeconds(table.TurnSeconds);
        for (var attempt = 0; attempt < 2; attempt++) {
            var left = budget - TimeSpan.FromSeconds(seconds);
            if (left < TimeSpan.FromSeconds(5)) { why ??= PokerAgent.TimedOut; break; }
            var d = await _agent.DecideAsync(table, seat, hand, record, why, left, cancel);
            s.TokensIn += d.TokensIn; s.TokensOut += d.TokensOut; seconds += d.Seconds;
            why = d.Error;
            if (d.Move is { } move) {
                if (move.Kind == "raise" && move.To is null) { why = "A raise needs the amount to raise to."; }
                else {
                    try {
                        lock (live.Gate) { hand.Apply(move); }
                        s.LastError = null;
                        return new PokerAction { Say = d.Say, Reasoning = Clip(d.Reasoning), Seconds = seconds };
                    }
                    catch (InvalidOperationException ex) { why = ex.Message; }
                }
            }
            /* An answer that never came is not asked for again. */
            if (d.Error == PokerAgent.TimedOut) { break; }
        }
        s.Faults++; s.LastError = why;
        var check = hand.Legal().Check;
        lock (live.Gate) { hand.Apply(check ? PokerMove.Check : PokerMove.Fold); }
        return new PokerAction { Seconds = seconds, Note = (check ? "checked" : "folded") + " for it: " + why };
    }

    private static string? Clip(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Length > 6000 ? s[..6000] + "…" : s;

    /// <summary>The table as the page draws it. Hole cards are in it only
    /// for the person's own seat, for the hands shown at a showdown, and for
    /// every seat when the table reveals (nobody seated, P6); models'
    /// reasoning only when it reveals.</summary>
    public JsonObject View(string home, string id) {
        var live = LiveOf(home, id) ?? throw new InvalidOperationException("There is no such table.");
        /* The game's thread changes the hand under the same lock. */
        lock (live.Gate) { return ViewOf(live); }
    }

    private static JsonObject ViewOf(Live live) {
        var t = live.Table;
        var hand = live.Hand; var record = live.Record;
        var reveal = t.Revealing;
        var seats = new JsonArray();
        for (var n = 1; n <= t.Seats.Count; n++) {
            var s = t.At(n);
            var p = hand?.Players.FirstOrDefault(x => x.Seat == n);
            var o = new JsonObject {
                ["seat"] = n, ["kind"] = s.Kind, ["name"] = s.Label, ["bio"] = s.Bio, ["provider"] = s.Provider, ["model"] = s.Model, ["thinking"] = s.Thinking,
                ["stack"] = p?.Stack ?? s.Stack, ["out"] = (p?.Stack ?? s.Stack) == 0 && p is null,
                ["tokensIn"] = s.TokensIn, ["tokensOut"] = s.TokensOut, ["moves"] = s.Moves, ["faults"] = s.Faults,
                ["averageSeconds"] = s.Moves > 0 ? Math.Round(s.Seconds / s.Moves, 1) : null, ["lastError"] = s.LastError,
                ["left"] = s.Left, ["leaving"] = live.Leaving.Contains(n), ["hands"] = s.Hands, ["net"] = (p?.Stack ?? s.Stack) - (s.BuyIn > 0 ? s.BuyIn : t.StartingStack)
            };
            if (p is not null && hand is not null) {
                o["inHand"] = true; o["folded"] = p.Folded; o["allIn"] = p.AllIn; o["bet"] = p.Street; o["total"] = p.Total;
                o["button"] = n == hand.ButtonSeat; o["smallBlind"] = n == hand.SmallBlindSeat; o["bigBlind"] = n == hand.BigBlindSeat;
                var shown = hand.Over && hand.Showdown && !p.Folded;
                if (s.IsPerson || reveal || shown) {
                    o["cards"] = new JsonArray(p.Hole.Select(c => (JsonNode)c.ToString()).ToArray());
                    if (hand.ValueOf(n) is { } v && (shown || s.IsPerson || reveal)) { o["handName"] = v.Describe(); }
                }
                else { o["cards"] = null; }
            }
            seats.Add(o);
        }
        var view = new JsonObject {
            ["id"] = t.Id, ["title"] = t.Title, ["status"] = t.Status, ["notice"] = live.Notice ?? live.Introducing,
            ["running"] = live.Loop is { IsCompleted: false }, ["pausing"] = live.PauseAfterHand, ["ending"] = live.EndAfterHand,
            ["joining"] = new JsonArray(live.Joining.Select(j => (JsonNode)new JsonObject { ["name"] = j.Label, ["kind"] = j.Kind, ["model"] = j.Model }).ToArray()),
            ["canAdd"] = t.Status != "finished" && t.Seats.Count(s => !s.Left) + live.Joining.Count < PokerTable.MaxSeats && t.Seats.Count + live.Joining.Count < PokerTable.MaxSeatsEver,
            ["personSeated"] = t.Seats.Any(s => s.IsPerson && !s.Left) || live.Joining.Any(s => s.IsPerson),
            ["hands"] = t.Hands, ["startingStack"] = t.StartingStack, ["smallBlind"] = t.SmallBlind, ["bigBlind"] = t.BigBlind,
            ["paceMs"] = t.PaceMs, ["turnSeconds"] = t.TurnSeconds, ["reveal"] = t.Reveal, ["revealing"] = reveal, ["hasPerson"] = t.HasPerson,
            ["seats"] = seats
        };
        if (hand is not null && record is not null) {
            var actions = new JsonArray();
            foreach (var a in record.Actions) {
                actions.Add(new JsonObject {
                    ["seat"] = a.Seat, ["street"] = HoldemHand.StreetNames[a.Street], ["kind"] = a.Kind, ["amount"] = a.Amount, ["to"] = a.To,
                    ["say"] = a.Say, ["note"] = a.Note, ["seconds"] = a.Seconds is { } sec ? Math.Round(sec, 1) : null,
                    ["reasoning"] = reveal ? a.Reasoning : null
                });
            }
            var h = new JsonObject {
                ["number"] = record.Number, ["street"] = HoldemHand.StreetNames[hand.Street], ["board"] = new JsonArray(hand.Board.Select(c => (JsonNode)c.ToString()).ToArray()),
                ["pot"] = hand.Pot, ["currentBet"] = hand.CurrentBet, ["toAct"] = hand.ToAct, ["acting"] = live.Acting,
                ["actingSeconds"] = live.Acting is null ? null : Math.Round((DateTimeOffset.UtcNow - live.ActingSince).TotalSeconds),
                ["over"] = hand.Over, ["actions"] = actions
            };
            if (hand.Over) {
                h["pots"] = new JsonArray(hand.Results.Select(r => (JsonNode)new JsonObject {
                    ["amount"] = r.Amount, ["winners"] = new JsonArray(r.Winners.Select(w => (JsonNode)w).ToArray()), ["hand"] = r.Hand
                }).ToArray());
            }
            if (live.PersonMove is not null && hand.ToAct is { } who && t.At(who).IsPerson) {
                var l = hand.Legal();
                h["legal"] = new JsonObject { ["fold"] = l.Fold, ["check"] = l.Check, ["call"] = l.Call, ["minTo"] = l.MinTo, ["maxTo"] = l.MaxTo, ["bet"] = hand.CurrentBet == 0 };
            }
            view["hand"] = h;
        }
        view["history"] = new JsonArray(t.History.TakeLast(12).Reverse().Select(r => (JsonNode)new JsonObject {
            ["number"] = r.Number,
            ["summary"] = string.Join("; ", r.Pots.Select(p => string.Join(" and ", p.Winners.Select(w => t.At(w).Label)) + " won " + p.Amount + (p.Hand is not null ? " with " + p.Hand : "")))
        }).ToArray());
        return view;
    }
}
