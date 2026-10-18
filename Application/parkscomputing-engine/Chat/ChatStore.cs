using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.Chat;

/// <summary>
/// Conversations, each a file in its owner's home directory on the server,
/// ~/.chat/{id}.json, so they are the owner's alone and follow ~ as the
/// rest of their files do. A file is written whole, through a temporary
/// file, so a crash leaves the last good copy.
/// </summary>
public sealed class ChatStore {
    public const string Folder = ".chat";
    private static readonly Regex IdShape = new("^[a-z0-9]{12,32}$", RegexOptions.Compiled);
    private static readonly JsonSerializerOptions Write = new() { WriteIndented = false };
    private readonly ServerFiles _files;
    private readonly SemaphoreSlim _lock = new(1, 1);

    public ChatStore(ServerFiles files) { _files = files; }

    public static bool ValidId(string? id) => id is not null && IdShape.IsMatch(id);

    public static string NewId() => Convert.ToHexString(RandomNumberGenerator.GetBytes(10)).ToLowerInvariant();

    private string Dir(string home) {
        var root = _files.RootDir(ServerFiles.Home, home) ?? throw new InvalidOperationException("There is no home directory.");
        var dir = Path.Combine(root, Folder);
        Directory.CreateDirectory(dir);
        return dir;
    }

    private string PathOf(string home, string id) => Path.Combine(Dir(home), id + ".json");

    public sealed record Summary(string Id, string Title, string Provider, string Model, DateTimeOffset Updated);

    public IReadOnlyList<Summary> List(string home) {
        var list = new List<Summary>();
        foreach (var f in new DirectoryInfo(Dir(home)).EnumerateFiles("*.json")) {
            var c = Read(home, Path.GetFileNameWithoutExtension(f.Name));
            if (c is not null) { list.Add(new Summary(c.Id, c.Title, c.Provider, c.Model, c.Updated)); }
        }
        return list.OrderByDescending(s => s.Updated).ToList();
    }

    public Conversation? Read(string home, string id) {
        if (!ValidId(id)) { return null; }
        var path = PathOf(home, id);
        if (!File.Exists(path)) { return null; }
        try { return JsonSerializer.Deserialize<Conversation>(File.ReadAllText(path), ChatSettings.Json); }
        catch (JsonException) { return null; }
    }

    public async Task SaveAsync(string home, Conversation c) {
        if (!ValidId(c.Id)) { throw new ArgumentException("Not a conversation id."); }
        var path = PathOf(home, c.Id); var tmp = path + ".tmp";
        await _lock.WaitAsync();
        try {
            await File.WriteAllTextAsync(tmp, JsonSerializer.Serialize(c, Write));
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
