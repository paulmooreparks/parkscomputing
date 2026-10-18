using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.Chat;

/// <summary>A skill, as GK Companion lists them: a folder holding SKILL.md,
/// whose front matter gives its name, what it does and its argument-hint,
/// and whose body is the instructions the model follows.</summary>
public sealed record ChatSkill(string Name, string Description, string Hint, string Source, string Body);

/// <summary>
/// The skills the chat offers under "/" (Architecture/chat-design.md): the
/// reader's own, in ~/skills/&lt;name&gt;/SKILL.md, and the site's, in
/// /etc/skills/&lt;name&gt;/SKILL.md, the same shape as a Devin or Agent Skills
/// skill, so a skill written for GK Companion works here. A message that
/// starts with /name goes to the model as the skill's instructions followed
/// by the command, while the conversation keeps what was typed. Read from
/// the disk on each request, so a skill dropped into a folder is there at
/// once.
/// </summary>
public sealed class ChatSkills {
    private static readonly Regex Front = new(@"\A---\r?\n(.*?)\r?\n---\r?\n?", RegexOptions.Singleline | RegexOptions.Compiled);
    private readonly ServerFiles _files;

    public ChatSkills(ServerFiles files) { _files = files; }

    public IReadOnlyList<ChatSkill> List(string home) {
        var list = new List<ChatSkill>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (root, source) in new[] { (_files.RootDir(ServerFiles.Home, home), "mine"), (_files.RootDir(ServerFiles.Etc, ""), "site") }) {
            if (root is null) { continue; }
            var dir = Path.Combine(root, "skills");
            if (!Directory.Exists(dir)) { continue; }
            foreach (var folder in Directory.EnumerateDirectories(dir).OrderBy(d => d, StringComparer.OrdinalIgnoreCase)) {
                var file = Path.Combine(folder, "SKILL.md");
                if (!File.Exists(file)) { continue; }
                var skill = Read(file, Path.GetFileName(folder), source);
                if (skill is not null && seen.Add(skill.Name)) { list.Add(skill); }
            }
        }
        return list;
    }

    public ChatSkill? Find(string home, string name) => List(home).FirstOrDefault(s => string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase));

    private static ChatSkill? Read(string file, string folder, string source) {
        string text;
        try { text = File.ReadAllText(file); } catch (IOException) { return null; }
        var fields = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var body = text;
        var m = Front.Match(text);
        if (m.Success) {
            body = text[m.Length..];
            foreach (var line in m.Groups[1].Value.Split('\n')) {
                var i = line.IndexOf(':');
                if (i <= 0 || char.IsWhiteSpace(line[0])) { continue; }
                var value = line[(i + 1)..].Trim();
                if (value.Length >= 2 && (value[0] == '"' && value[^1] == '"' || value[0] == '\'' && value[^1] == '\'')) { value = value[1..^1]; }
                fields[line[..i].Trim()] = value;
            }
        }
        var name = fields.TryGetValue("name", out var n) && n.Length > 0 ? n : folder;
        if (!Regex.IsMatch(name, "^[A-Za-z0-9][A-Za-z0-9_.-]*$")) { return null; }
        return new ChatSkill(name, fields.GetValueOrDefault("description", ""), fields.GetValueOrDefault("argument-hint", ""), source, body.Trim());
    }

    /// <summary>The text the model gets for a message that starts with a
    /// skill's command, or null when it starts with none.</summary>
    public string? Expand(string home, string text) {
        var t = (text ?? "").TrimStart();
        if (!t.StartsWith('/')) { return null; }
        var word = t.Split((char[]?)null, 2, StringSplitOptions.RemoveEmptyEntries)[0][1..];
        var skill = Find(home, word);
        if (skill is null) { return null; }
        return "The reader invoked the skill /" + skill.Name + (skill.Description.Length > 0 ? " (" + skill.Description + ")" : "") +
            ". Follow its instructions:\n\n" + skill.Body + "\n\nThe command as the reader typed it:\n" + t;
    }
}
