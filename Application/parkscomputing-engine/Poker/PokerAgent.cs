using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

using Microsoft.Extensions.Logging;

using ParksComputing.Engine.Chat;

namespace ParksComputing.Engine.Poker;

/// <summary>
/// A model's seat (Architecture/poker-design.md, P4, P5 and P9). On its
/// turn the model gets one request holding only what a player in its seat
/// would know, and answers through the act tool; a provider that cannot
/// call tools (Codex, which answers in text) may answer with the same
/// fields as a JSON object instead. The calls go through the chat's
/// providers, so the keys and each provider's ways stay in one place.
/// </summary>
public sealed class PokerAgent {
    public sealed record Decision(PokerMove? Move, string? Say, string Reasoning, int TokensIn, int TokensOut, double Seconds, string? Error);
    public sealed record Intro(string? Name, string? Bio, int TokensIn, int TokensOut, string? Error);

    private const int SayMax = 200, NameMax = 24, BioMax = 400;

    /// <summary>The error of a seat that ran out of time.</summary>
    public const string TimedOut = "No move in the time allowed.";

    private readonly ChatSettings _settings;
    private readonly IHttpClientFactory _http;
    private readonly CodexHost _codex;
    private readonly Microsoft.Extensions.Logging.ILogger<PokerAgent> _log;

    public PokerAgent(ChatSettings settings, IHttpClientFactory http, CodexHost codex, Microsoft.Extensions.Logging.ILogger<PokerAgent> log) { _settings = settings; _http = http; _codex = codex; _log = log; }

    private static readonly ToolSpec ActTool = new("act",
        "Make your move. action is fold, check, call or raise. For raise, amount is the total you raise to on this street (a bet when nobody has bet), between the minimum and maximum you were given; leave it out otherwise. say is an optional short line to the table, at most 200 characters, which every player hears; it may be true or not.",
        JsonNode.Parse("""{"type":"object","properties":{"action":{"type":"string","enum":["fold","check","call","raise"]},"amount":{"type":"integer"},"say":{"type":"string"}},"required":["action"]}""")!);

    private static readonly ToolSpec IntroTool = new("introduce",
        "Introduce yourself to the table: the name you will play under (at most 24 characters) and a bio of at most three sentences.",
        JsonNode.Parse("""{"type":"object","properties":{"name":{"type":"string"},"bio":{"type":"string"}},"required":["name","bio"]}""")!);

    public const string Rules =
        "You are a player at a No-Limit Texas Hold'em table, playing for play money against other players, some of whom are other language models and one of whom may be a person. " +
        "Play to win chips. You know only your own two cards, the board, the stacks and what everyone has done and said. " +
        "Other players may talk at the table, and what they say, like their bios, may be true or a bluff. You may talk too.";

    private (IChatProvider Provider, ChatProviderConfig Config) ProviderFor(PokerSeat seat) {
        var (config, error) = _settings.Read();
        var p = config.Find(seat.Provider) ?? throw new ProviderException(error ?? "There is no provider called " + seat.Provider + " in the chat's settings.");
        return (ChatProviders.For(p, _http.CreateClient(ChatProviders.ClientName), _codex), p);
    }

    /// <summary>Codex works in a folder; a seat gets an empty one of its own.</summary>
    private static AgentContext? AgentFor(ChatProviderConfig p, string tableId, int seat) {
        if (!string.Equals(p.Kind, "codex", StringComparison.OrdinalIgnoreCase)) { return null; }
        var dir = Path.Combine(Path.GetTempPath(), "poker", tableId, "seat" + seat);
        Directory.CreateDirectory(dir);
        return new AgentContext(dir, null, _ => { }, null, null);
    }

    private sealed class Reply {
        public JsonNode? ToolInput; public string? ToolName;
        public readonly StringBuilder Text = new(), Thinking = new();
        public int In, Out;
    }

    private static async Task<Reply> AskAsync(IChatProvider provider, ProviderRequest request, CancellationToken cancel) {
        var r = new Reply();
        await foreach (var e in provider.StreamAsync(request, cancel)) {
            switch (e) {
                case TextDelta t: r.Text.Append(t.Text); break;
                case ThinkingDelta t: r.Thinking.Append(t.Text); break;
                case ToolCallReady c when r.ToolInput is null: r.ToolInput = c.Input; r.ToolName = c.Name; break;
                case UsageReport u: r.In += u.Input ?? 0; r.Out += u.Output ?? 0; break;
                case AgentApproval a: a.Answer.TrySetResult("decline"); break;
            }
        }
        return r;
    }

    /// <summary>The fields from the tool's input, or from the first JSON
    /// object in the reply's text.</summary>
    public static JsonObject? FieldsOf(JsonNode? toolInput, string text) {
        if (toolInput is JsonObject o) { return o; }
        if (toolInput is JsonValue v && v.TryGetValue<string>(out var s)) { try { if (JsonNode.Parse(s) is JsonObject p) { return p; } } catch (JsonException) { } }
        foreach (Match m in Regex.Matches(text ?? "", "\\{[^{}]*\\}")) {
            try { if (JsonNode.Parse(m.Value) is JsonObject p) { return p; } } catch (JsonException) { }
        }
        return null;
    }

    public static PokerMove? MoveOf(JsonObject? f) {
        var action = (f?["action"]?.ToString() ?? "").Trim().ToLowerInvariant();
        int? amount = null;
        if (f?["amount"] is JsonNode a && int.TryParse(a.ToString().Trim().TrimStart('$'), out var n)) { amount = n; }
        return action switch {
            "fold" => PokerMove.Fold,
            "check" => PokerMove.Check,
            "call" => PokerMove.Call,
            "raise" or "bet" or "all-in" or "allin" => amount is { } to ? PokerMove.RaiseTo(to) : new PokerMove("raise"),
            _ => null
        };
    }

    private static string? Clip(string? s, int max) {
        if (string.IsNullOrWhiteSpace(s)) { return null; }
        s = Regex.Replace(s.Trim(), "\\s+", " ");
        return s.Length > max ? s[..max].TrimEnd() + "…" : s;
    }

    /// <summary>A line said at the table, without the quotation marks some
    /// models wrap it in, since the table draws its own.</summary>
    public static string? Spoken(string? s) {
        var t = (s ?? "").Trim().Trim('"', '“', '”', '\'').Trim();
        return Clip(t, SayMax);
    }

    /// <summary>Asks a model seat for its name and bio (P9).</summary>
    public async Task<Intro> IntroduceAsync(PokerTable table, int seat, CancellationToken cancel) {
        var s = table.At(seat);
        try {
            var (provider, config) = ProviderFor(s);
            var others = table.Seats.Count - 1;
            var text = "Before the first hand, introduce yourself to the table. You are at seat " + seat + " of " + table.Seats.Count + ", against " + others + (others == 1 ? " other player" : " other players") +
                ". Give a name to play under (at most 24 characters) and a bio of at most three sentences about yourself as a player. Every other player will read your bio, and you will read theirs. " +
                "What you say is up to you: it may be true, a bluff, or part of how you mean to play. " +
                "Call the introduce tool. If you cannot call tools, reply with only a JSON object: {\"name\": \"...\", \"bio\": \"...\"}.";
            var request = new ProviderRequest(s.Model ?? "", Rules, new List<ChatMessage> { new() { Role = "user", Parts = { ChatPart.TextPart(text) }, At = DateTimeOffset.UtcNow } },
                new[] { IntroTool }, s.Thinking, AgentFor(config, table.Id, seat));
            var r = await WithinAsync(provider, request, TimeSpan.FromSeconds(Math.Max(30, table.TurnSeconds)), cancel);
            var f = FieldsOf(r.ToolInput, r.Text.ToString());
            return new Intro(Clip(f?["name"]?.ToString(), NameMax), Clip(f?["bio"]?.ToString(), BioMax), r.In, r.Out, f is null ? "The model gave no name or bio." : null);
        }
        catch (Exception ex) when (ex is TimeoutException || (ex is OperationCanceledException && !cancel.IsCancellationRequested)) { return new Intro(null, null, 0, 0, "The model took too long to introduce itself."); }
        catch (Exception ex) when (!cancel.IsCancellationRequested && ex is not OperationCanceledException) { return new Intro(null, null, 0, 0, ex.Message); }
    }

    /// <summary>A model's answer within the time it has. The request is
    /// cancelled when the time is up, and the answer is also waited for
    /// beside a clock of its own, so a provider whose stream does not stop
    /// on cancellation still cannot hold the table: the seat moves on, and
    /// the abandoned request finishes or fails unobserved.</summary>
    private static Task<Reply> WithinAsync(IChatProvider provider, ProviderRequest request, TimeSpan limit, CancellationToken cancel) =>
        Within(stop => AskAsync(provider, request, stop), limit, TimeSpan.FromSeconds(3), cancel);

    /// <summary>work, given a token that is cancelled after limit; if work
    /// has still not finished grace later, TimeoutException, and work is
    /// left to end on its own with its result unobserved.</summary>
    public static async Task<T> Within<T>(Func<CancellationToken, Task<T>> work, TimeSpan limit, TimeSpan grace, CancellationToken cancel) {
        var stop = CancellationTokenSource.CreateLinkedTokenSource(cancel);
        stop.CancelAfter(limit);
        var task = work(stop.Token);
        _ = task.ContinueWith(t => { _ = t.Exception; stop.Dispose(); }, TaskScheduler.Default);
        var done = await Task.WhenAny(task, Task.Delay(limit + grace, cancel));
        if (done != task) {
            cancel.ThrowIfCancellationRequested();
            try { stop.Cancel(); } catch (ObjectDisposedException) { }
            throw new TimeoutException();
        }
        return await task;
    }

    /// <summary>Asks a model seat for its move, within limit. retryReason,
    /// when given, says why its last answer was refused.</summary>
    public async Task<Decision> DecideAsync(PokerTable table, int seat, HoldemHand hand, PokerHandRecord record, string? retryReason, TimeSpan limit, CancellationToken cancel) {
        var s = table.At(seat);
        var clock = Stopwatch.StartNew();
        Decision d;
        try {
            var (provider, config) = ProviderFor(s);
            var text = Situation(table, seat, hand, record);
            if (retryReason is not null) { text += "\n\nYour last answer could not be played: " + retryReason + " Choose again from the legal moves."; }
            var request = new ProviderRequest(s.Model ?? "", Rules, new List<ChatMessage> { new() { Role = "user", Parts = { ChatPart.TextPart(text) }, At = DateTimeOffset.UtcNow } },
                new[] { ActTool }, s.Thinking, AgentFor(config, table.Id, seat));
            var r = await WithinAsync(provider, request, limit, cancel);
            var f = FieldsOf(r.ToolInput, r.Text.ToString());
            var reasoning = (r.Thinking.Length > 0 ? r.Thinking.ToString() : r.ToolInput is not null ? r.Text.ToString() : "").Trim();
            var move = MoveOf(f);
            d = new Decision(move, Spoken(f?["say"]?.ToString()), reasoning, r.In, r.Out, clock.Elapsed.TotalSeconds,
                move is null ? "The answer held no move (" + Clip(r.Text.ToString(), 120) + ")." : null);
        }
        catch (Exception ex) when (ex is TimeoutException || (ex is OperationCanceledException && !cancel.IsCancellationRequested)) {
            d = new Decision(null, null, "", 0, 0, clock.Elapsed.TotalSeconds, TimedOut);
        }
        catch (Exception ex) when (!cancel.IsCancellationRequested && ex is not OperationCanceledException) {
            d = new Decision(null, null, "", 0, 0, clock.Elapsed.TotalSeconds, ex.Message);
        }
        _log.LogInformation("Poker table {Table} seat {Seat} ({Model}): {Seconds:0.0}s, {Outcome}", table.Id, seat, s.Model, d.Seconds, d.Error ?? d.Move?.Kind ?? "no move");
        return d;
    }

    private static string Words(PokerAction a, PokerTable table) {
        var who = "seat " + a.Seat + " (" + table.At(a.Seat).Label + ")";
        var did = a.Kind switch {
            "small-blind" => "posts the small blind of " + a.Amount,
            "big-blind" => "posts the big blind of " + a.Amount,
            "fold" => "folds", "check" => "checks",
            "call" => "calls " + a.Amount,
            "bet" => "bets " + a.To,
            "raise" => "raises to " + a.To,
            _ => a.Kind
        };
        return who + " " + did + (a.Note is not null ? " (" + a.Note + ")" : "") + (a.Say is not null ? ", and says: \"" + a.Say + "\"" : "");
    }

    /// <summary>The seat's view of the hand, in words: its cards, the
    /// board, every seat with its bio and chips, the betting so far and
    /// the legal moves. Nothing another seat holds is in it.</summary>
    public static string Situation(PokerTable table, int seat, HoldemHand hand, PokerHandRecord record) {
        var me = hand.PlayerAt(seat);
        var b = new StringBuilder();
        b.Append("Hand ").Append(record.Number).Append(". Blinds ").Append(hand.SmallBlind).Append('/').Append(hand.BigBlind).Append(". You are seat ").Append(seat)
         .Append(", playing as \"").Append(table.At(seat).Label).Append("\".\n");
        b.Append("Your cards: ").Append(string.Join(" ", me.Hole)).Append(".\n");
        b.Append("Board: ").Append(hand.Board.Count == 0 ? "none yet (preflop)" : string.Join(" ", hand.Board) + " (" + HoldemHand.StreetNames[hand.Street] + ")").Append(".\n");
        if (hand.ValueOf(seat) is { } v) { b.Append("Your best hand now: ").Append(v.Describe()).Append(".\n"); }
        b.Append("\nPlayers, in seat order:\n");
        foreach (var p in hand.Players) {
            var s = table.At(p.Seat);
            b.Append("- Seat ").Append(p.Seat).Append(" \"").Append(s.Label).Append('"').Append(p.Seat == seat ? " (you)" : "")
             .Append(": stack ").Append(p.Stack).Append(", in this round ").Append(p.Street).Append(", in the pot this hand ").Append(p.Total);
            var marks = new List<string>();
            if (p.Seat == hand.ButtonSeat) { marks.Add("button"); }
            if (p.Seat == hand.SmallBlindSeat) { marks.Add("small blind"); }
            if (p.Seat == hand.BigBlindSeat) { marks.Add("big blind"); }
            if (p.Folded) { marks.Add("folded"); }
            if (p.AllIn) { marks.Add("all in"); }
            if (marks.Count > 0) { b.Append(" [").Append(string.Join(", ", marks)).Append(']'); }
            b.Append('\n');
            if (!string.IsNullOrWhiteSpace(s.Bio)) { b.Append("  Bio: ").Append(s.Bio).Append('\n'); }
        }
        b.Append("\nPot: ").Append(hand.Pot).Append(".\n");
        b.Append("\nThis hand so far:\n");
        var street = -1;
        foreach (var a in record.Actions) {
            if (a.Street != street) { street = a.Street; b.Append(HoldemHand.StreetNames[street]).Append(":\n"); }
            b.Append("- ").Append(Words(a, table)).Append('\n');
        }
        var recent = table.History.TakeLast(3).ToList();
        if (recent.Count > 0) {
            b.Append("\nThe last hands:\n");
            foreach (var h in recent) {
                b.Append("- Hand ").Append(h.Number).Append(": ").Append(string.Join("; ", h.Pots.Select(p => string.Join(" and ", p.Winners.Select(w => table.At(w).Label)) + " won " + p.Amount + (p.Hand is not null ? " with " + p.Hand : ""))));
                if (h.Shown.Count > 0) { b.Append(". Shown: ").Append(string.Join(", ", h.Shown.Select(w => table.At(w).Label + " " + h.Holes[w]))); }
                b.Append(".\n");
            }
        }
        var l = hand.Legal();
        var moves = new List<string>();
        if (l.Fold) { moves.Add("fold"); }
        if (l.Check) { moves.Add("check"); }
        if (l.Call is { } c) { moves.Add("call " + c + (c >= me.Stack ? " (all in)" : "")); }
        if (l.MinTo is { } min && l.MaxTo is { } max) {
            var verb = hand.CurrentBet == 0 ? "bet" : "raise to";
            moves.Add(min == max ? verb + " " + max + " (all in), as action raise with amount " + max : verb + " between " + min + " and " + max + " (" + max + " is all in), as action raise with that amount");
        }
        b.Append("\nIt is your turn. Your legal moves: ").Append(string.Join("; ", moves)).Append(".\n");
        b.Append("Call the act tool with your move. If you cannot call tools, reply with only a JSON object such as {\"action\": \"raise\", \"amount\": 120, \"say\": \"...\"}.");
        return b.ToString();
    }
}
