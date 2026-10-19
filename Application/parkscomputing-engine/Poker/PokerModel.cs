using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.Poker;

/// <summary>A seat at a table (Architecture/poker-design.md): a model from
/// one of the chat's providers, or the person who opened the table, with
/// the name and bio the seat plays under (P9) and its chips.</summary>
public sealed class PokerSeat {
    /// <summary>model or person.</summary>
    [JsonPropertyName("kind")] public string Kind { get; set; } = "model";
    [JsonPropertyName("provider")] public string? Provider { get; set; }
    [JsonPropertyName("model")] public string? Model { get; set; }
    [JsonPropertyName("thinking")] public bool Thinking { get; set; }
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("bio")] public string? Bio { get; set; }
    /// <summary>Whether the model has been asked for its bio, so a model
    /// that declined is not asked again.</summary>
    [JsonPropertyName("introduced")] public bool Introduced { get; set; }
    [JsonPropertyName("stack")] public int Stack { get; set; }
    /// <summary>The seat has left the table, taking its stack with it, and
    /// is dealt no more hands.</summary>
    [JsonPropertyName("left")] public bool Left { get; set; }
    /// <summary>The chips the seat sat down with, from which its gain or
    /// loss is counted; 0 in tables saved before players could join late,
    /// meaning the table's starting stack.</summary>
    [JsonPropertyName("buyIn")] public int BuyIn { get; set; }
    /// <summary>The hands the seat was dealt.</summary>
    [JsonPropertyName("hands")] public int Hands { get; set; }
    [JsonPropertyName("tokensIn")] public long TokensIn { get; set; }
    [JsonPropertyName("tokensOut")] public long TokensOut { get; set; }
    [JsonPropertyName("moves")] public int Moves { get; set; }
    /// <summary>Moves the seat failed to make: no answer in time, or an
    /// illegal one twice, which the table played for it.</summary>
    [JsonPropertyName("faults")] public int Faults { get; set; }
    [JsonPropertyName("seconds")] public double Seconds { get; set; }
    [JsonPropertyName("lastError")] public string? LastError { get; set; }

    [JsonIgnore] public bool IsPerson => Kind == "person";
    [JsonIgnore] public string Label => !string.IsNullOrWhiteSpace(Name) ? Name : IsPerson ? "You" : Model ?? "Seat";
}

/// <summary>A move as the hand's history keeps it: the street, what was
/// done, what the player said (P5) and, for a model, its reasoning, which
/// the table shows only when nobody is seated (P6).</summary>
public sealed class PokerAction {
    [JsonPropertyName("seat")] public int Seat { get; set; }
    [JsonPropertyName("street")] public int Street { get; set; }
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    [JsonPropertyName("amount")] public int Amount { get; set; }
    [JsonPropertyName("to")] public int To { get; set; }
    [JsonPropertyName("say")] public string? Say { get; set; }
    [JsonPropertyName("reasoning")] public string? Reasoning { get; set; }
    [JsonPropertyName("seconds")] public double? Seconds { get; set; }
    /// <summary>What the table did for a seat that failed to move.</summary>
    [JsonPropertyName("note")] public string? Note { get; set; }
}

public sealed class PokerPot {
    [JsonPropertyName("amount")] public int Amount { get; set; }
    [JsonPropertyName("winners")] public List<int> Winners { get; set; } = new();
    [JsonPropertyName("hand")] public string? Hand { get; set; }
}

/// <summary>A finished hand, with every card, for the history.</summary>
public sealed class PokerHandRecord {
    [JsonPropertyName("number")] public int Number { get; set; }
    [JsonPropertyName("button")] public int Button { get; set; }
    [JsonPropertyName("holes")] public Dictionary<int, string> Holes { get; set; } = new();
    [JsonPropertyName("board")] public string Board { get; set; } = "";
    [JsonPropertyName("actions")] public List<PokerAction> Actions { get; set; } = new();
    [JsonPropertyName("pots")] public List<PokerPot> Pots { get; set; } = new();
    /// <summary>The seats whose cards were shown at the showdown.</summary>
    [JsonPropertyName("shown")] public List<int> Shown { get; set; } = new();
    [JsonPropertyName("stacks")] public Dictionary<int, int> Stacks { get; set; } = new();
    [JsonPropertyName("at")] public DateTimeOffset At { get; set; }
}

public sealed class PokerTable {
    public const int MaxSeats = 6;
    /// <summary>Every player a table has seated, those who left included.</summary>
    public const int MaxSeatsEver = 24;
    public const int HistoryKept = 200;

    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("title")] public string Title { get; set; } = "";
    [JsonPropertyName("created")] public DateTimeOffset Created { get; set; }
    [JsonPropertyName("updated")] public DateTimeOffset Updated { get; set; }
    /// <summary>Seat n is Seats[n - 1].</summary>
    [JsonPropertyName("seats")] public List<PokerSeat> Seats { get; set; } = new();
    [JsonPropertyName("startingStack")] public int StartingStack { get; set; } = 1000;
    [JsonPropertyName("smallBlind")] public int SmallBlind { get; set; } = 10;
    [JsonPropertyName("bigBlind")] public int BigBlind { get; set; } = 20;
    /// <summary>The pause between moves, so play can be followed.</summary>
    [JsonPropertyName("paceMs")] public int PaceMs { get; set; } = 1500;
    /// <summary>How long a model has for a move.</summary>
    [JsonPropertyName("turnSeconds")] public int TurnSeconds { get; set; } = 120;
    /// <summary>Whether the watcher sees every seat's cards and reasoning;
    /// honoured only while nobody is seated (P6).</summary>
    [JsonPropertyName("reveal")] public bool Reveal { get; set; }
    /// <summary>The seat with the button for the hand last played.</summary>
    [JsonPropertyName("button")] public int Button { get; set; }
    [JsonPropertyName("hands")] public int Hands { get; set; }
    /// <summary>paused, playing or finished.</summary>
    [JsonPropertyName("status")] public string Status { get; set; } = "paused";
    [JsonPropertyName("history")] public List<PokerHandRecord> History { get; set; } = new();

    [JsonIgnore] public bool HasPerson => Seats.Any(s => s.IsPerson);
    [JsonIgnore] public bool Revealing => Reveal && !HasPerson;
    public int SeatOf(PokerSeat s) => Seats.IndexOf(s) + 1;
    public PokerSeat At(int seat) => Seats[seat - 1];
}

/// <summary>The tables, one JSON file each in the owner's ~/.poker, as the
/// chat keeps its conversations.</summary>
public sealed class PokerStore {
    public const string Folder = ".poker";
    private static readonly Regex IdShape = new("^[a-z0-9]{12,32}$", RegexOptions.Compiled);
    public static readonly JsonSerializerOptions Json = new() { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull, PropertyNameCaseInsensitive = true };
    private readonly ServerFiles _files;
    private readonly SemaphoreSlim _lock = new(1, 1);

    public PokerStore(ServerFiles files) { _files = files; }

    public static bool ValidId(string? id) => id is not null && IdShape.IsMatch(id);
    public static string NewId() => Convert.ToHexString(RandomNumberGenerator.GetBytes(10)).ToLowerInvariant();

    private string Dir(string home) {
        var root = _files.RootDir(ServerFiles.Home, home) ?? throw new InvalidOperationException("There is no home directory.");
        var dir = Path.Combine(root, Folder);
        Directory.CreateDirectory(dir);
        return dir;
    }

    private string PathOf(string home, string id) => Path.Combine(Dir(home), id + ".json");

    public IReadOnlyList<PokerTable> List(string home) {
        var list = new List<PokerTable>();
        foreach (var f in new DirectoryInfo(Dir(home)).EnumerateFiles("*.json")) {
            if (Read(home, Path.GetFileNameWithoutExtension(f.Name)) is { } t) { list.Add(t); }
        }
        return list.OrderByDescending(t => t.Updated).ToList();
    }

    public PokerTable? Read(string home, string id) {
        if (!ValidId(id)) { return null; }
        var path = PathOf(home, id);
        if (!File.Exists(path)) { return null; }
        try { return JsonSerializer.Deserialize<PokerTable>(File.ReadAllText(path), Json); }
        catch (JsonException) { return null; }
    }

    public async Task SaveAsync(string home, PokerTable t) {
        if (!ValidId(t.Id)) { throw new ArgumentException("Not a table id."); }
        if (t.History.Count > PokerTable.HistoryKept) { t.History.RemoveRange(0, t.History.Count - PokerTable.HistoryKept); }
        t.Updated = DateTimeOffset.UtcNow;
        var path = PathOf(home, t.Id); var tmp = path + ".tmp";
        await _lock.WaitAsync();
        try {
            await File.WriteAllTextAsync(tmp, JsonSerializer.Serialize(t, Json));
            File.Move(tmp, path, overwrite: true);
        }
        finally { _lock.Release(); }
    }

    public bool Delete(string home, string id) {
        if (!ValidId(id)) { return false; }
        var path = PathOf(home, id);
        if (!File.Exists(path)) { return false; }
        File.Delete(path);
        return true;
    }
}
