using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

using Markdig.Extensions.SmartyPants;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;

namespace ParksComputing.Engine.Pages.Services;

/// <summary>
/// An article as the visual editor holds it (Architecture/wysiwyg-editor-design.md,
/// step 2), on the server, as GK Companion holds its documents.
///
/// The Markdown stays the stored form. Load splits it into its top-level
/// blocks, keeping the exact text of each and of the space after it, so the
/// text is always the front matter, the space before the first block, and
/// each block's text and space in turn. A block the editor can show as rich
/// text (a paragraph, a heading, a list, a container shortcode around them)
/// is given in ProseMirror's JSON; every other block is a source block,
/// shown as the page renders it and edited as Markdown. A block is rich only
/// when writing it back from that JSON renders exactly as the original does,
/// so nothing the editor can't represent is ever lost. An untouched block is
/// written back as its own text, byte for byte; only a block the person
/// changes is written by Serialize.
///
/// "Renders exactly as" compares the HTML with entities decoded and heading
/// ids left out (they come from the whole document): a curly quote typed in
/// the editor renders as the straight quote SmartyPants made curly, which is
/// the same on the page (Paul's decision 3).
/// </summary>
public sealed class EditorDocument {
    private readonly SiteMarkdown _md;
    public EditorDocument(SiteMarkdown md) { _md = md; }

    public sealed record Part(string Uid, string Source, string Gap, bool Rich, JsonObject Node, string Html);
    public sealed record Model(string Front, string Lead, IReadOnlyList<Part> Blocks) {
        /// <summary>The text again, from its parts: the same as was loaded.</summary>
        public string Text => Front + Lead + string.Concat(Blocks.Select(b => b.Source + b.Gap));
    }

    /* === Loading ======================================================== */

    public Model Load(string text, string? slug) {
        text ??= "";
        var (_, body) = SiteMarkdown.SplitFrontMatter(text);
        var front = text[..(text.Length - body.Length)];
        var doc = _md.Parse(body);
        var ctx = ShortcodeContext.For(_md, slug, editing: true);
        var segments = _md.RenderBlocks(doc, ctx);

        // The units are the top-level blocks, and each link reference
        // definition on its own, since Markdig gathers those into one group.
        var units = new List<(Block Markdig, string Html)>();
        int k = 0;
        foreach (var block in doc) {
            var html = segments[k++];
            if (block is LinkReferenceDefinitionGroup group) {
                foreach (var def in group) { units.Add((def, "")); }
            }
            else {
                units.Add((block, html));
            }
        }
        units.Sort((a, b) => a.Markdig.Line.CompareTo(b.Markdig.Line));

        var lineStarts = new List<int> { 0 };
        for (int i = 0; i < body.Length; i++) { if (body[i] == '\n') { lineStarts.Add(i + 1); } }
        int StartOf(Block b) => b.Line < lineStarts.Count ? lineStarts[b.Line] : body.Length;

        var lead = units.Count == 0 ? body : body[..StartOf(units[0].Markdig)];
        var blocks = new List<Part>();
        for (int i = 0; i < units.Count; i++) {
            int start = StartOf(units[i].Markdig);
            int end = i + 1 < units.Count ? StartOf(units[i + 1].Markdig) : body.Length;
            var region = body[start..end];
            var source = region.TrimEnd('\r', '\n', ' ', '\t');
            var gap = region[source.Length..];
            var uid = "b" + i.ToString(CultureInfo.InvariantCulture);
            var node = Rich(units[i].Markdig, units[i].Html, ctx);
            var rich = node is not null;
            node ??= new JsonObject { ["type"] = "source_block", ["attrs"] = new JsonObject { ["src"] = source, ["html"] = units[i].Html } };
            Attrs(node)["uid"] = uid;
            blocks.Add(new Part(uid, source, gap, rich, node, units[i].Html));
        }
        return new Model(front, lead, blocks);
    }

    private static JsonObject Attrs(JsonObject node) {
        if (node["attrs"] is not JsonObject a) { a = new JsonObject(); node["attrs"] = a; }
        return a;
    }

    /// <summary>The block as rich text, or null when it can't be, or when
    /// writing it back wouldn't render as it does now.</summary>
    private JsonObject? Rich(Block block, string html, ShortcodeContext ctx) {
        if (block is ParagraphBlock p && ShortcodeHtml.Alone(p, _md.Shortcodes) is not null) { return null; }
        JsonObject? node;
        try { node = ToNode(block, ctx); }
        catch (NotRepresentable) { return null; }
        if (node is null) { return null; }
        var again = Serialize(node);
        return Same(_md.Render(again, ctx.Slug, editing: true), html) ? node : null;
    }

    private static readonly Regex Ids = new(@"\sid=""[^""]*""", RegexOptions.Compiled);
    /// <summary>Whether two renderings show the same: entities decoded,
    /// heading ids left out, and the spaces between tags ignored.</summary>
    public static bool Same(string a, string b) {
        static string N(string h) => Regex.Replace(WebUtility.HtmlDecode(Ids.Replace(h, "")), @">\s+<", "><").Trim();
        return N(a) == N(b);
    }

    private sealed class NotRepresentable : Exception { }

    /* === Markdig to ProseMirror ========================================= */

    private JsonObject? ToNode(Block block, ShortcodeContext ctx) {
        switch (block) {
            case HeadingBlock h when h.HeaderChar == '#':
                return Node("heading", Inlines(h.Inline, ctx), new JsonObject { ["level"] = h.Level, ["id"] = Markdig.Renderers.Html.HtmlAttributesExtensions.GetAttributes(h).Id });
            case ParagraphBlock p:
                return Node("paragraph", Inlines(p.Inline, ctx));
            case ListBlock list: {
                var items = new JsonArray();
                foreach (var child in list) {
                    if (child is not ListItemBlock item || item.Count == 0 || item[0] is not ParagraphBlock) { return null; }
                    var content = new JsonArray();
                    foreach (var b in item) {
                        var n = b is ParagraphBlock or ListBlock ? ToNode(b, ctx) : null;
                        if (n is null) { return null; }
                        content.Add(n);
                    }
                    items.Add(new JsonObject { ["type"] = "list_item", ["content"] = content });
                }
                return list.IsOrdered
                    ? Node("ordered_list", items, new JsonObject {
                        ["order"] = int.TryParse(list.OrderedStart, NumberStyles.Integer, CultureInfo.InvariantCulture, out var start) ? start : 1,
                        ["delimiter"] = list.OrderedDelimiter.ToString(), ["tight"] = !list.IsLoose })
                    : Node("bullet_list", items, new JsonObject { ["marker"] = list.BulletType.ToString(), ["tight"] = !list.IsLoose });
            }
            case ShortcodeBlock sc when sc.Closed: {
                // The editor draws the page's own frame around the body it edits.
                if (_md.Shortcodes.Frame(sc.Call, ctx) is not { } frame) { return null; }
                var content = new JsonArray();
                foreach (var b in sc) {
                    var n = ToNode(b, ctx);
                    if (n is null) { return null; }
                    content.Add(n);
                }
                if (content.Count == 0) { return null; }
                return Node("container", content, new JsonObject { ["name"] = sc.Call.Name, ["args"] = sc.Call.Args, ["open"] = frame.Open, ["close"] = frame.Close });
            }
            default:
                return null;
        }
    }

    private static JsonObject Node(string type, JsonArray? content, JsonObject? attrs = null) {
        var n = new JsonObject { ["type"] = type };
        if (attrs is not null) { n["attrs"] = attrs; }
        if (content is not null && content.Count > 0) { n["content"] = content; }
        return n;
    }

    /// <summary>The marks a text carries, in the order the editor's schema
    /// gives them.</summary>
    private static readonly string[] MarkOrder = { "link", "em", "strong", "strike", "code" };

    private JsonArray Inlines(ContainerInline? inlines, ShortcodeContext ctx) {
        var list = new JsonArray();
        if (inlines is null) { return list; }
        Walk(inlines, new List<JsonObject>(), list, ctx);
        // Neighbouring text with the same marks is one text node.
        var merged = new JsonArray();
        foreach (var n in list.Select(x => x!.DeepClone().AsObject())) {
            if (merged.Count > 0 && merged[^1] is JsonObject last && last["type"]?.GetValue<string>() == "text" && n["type"]?.GetValue<string>() == "text"
                && JsonNode.DeepEquals(last["marks"], n["marks"])) {
                last["text"] = last["text"]!.GetValue<string>() + n["text"]!.GetValue<string>();
                continue;
            }
            merged.Add(n);
        }
        return merged;
    }

    private void Walk(ContainerInline container, List<JsonObject> marks, JsonArray into, ShortcodeContext ctx) {
        foreach (var inline in container) {
            switch (inline) {
                case LiteralInline lit:
                    Text(lit.Content.ToString(), marks, into);
                    break;
                case SmartyPant sp:
                    Text(SmartChar(sp), marks, into);
                    break;
                case HtmlEntityInline ent:
                    Text(ent.Transcoded.ToString(), marks, into);
                    break;
                case CodeInline code:
                    Text(code.Content, marks.Append(new JsonObject { ["type"] = "code" }).ToList(), into);
                    break;
                case LineBreakInline br:
                    into.Add(new JsonObject { ["type"] = br.IsHard ? "hard_break" : "soft_break" });
                    break;
                case ShortcodeInline sc when !sc.Closing:
                    var src = sc.Call.Source;
                    into.Add(new JsonObject { ["type"] = "shortcode", ["attrs"] = new JsonObject { ["src"] = src, ["html"] = _md.InlineHtml(src, ctx) } });
                    if (marks.Count > 0) { throw new NotRepresentable(); }
                    break;
                case AutolinkInline auto:
                    Text(auto.Url, marks.Append(Link(auto.IsEmail ? "mailto:" + auto.Url : auto.Url, null)).ToList(), into);
                    break;
                case LinkInline link when !link.IsImage:
                    Walk(link, marks.Append(Link(link.GetDynamicUrl?.Invoke() ?? link.Url ?? "", string.IsNullOrEmpty(link.Title) ? null : link.Title)).ToList(), into, ctx);
                    break;
                case EmphasisInline em:
                    var type = (em.DelimiterChar, em.DelimiterCount) switch {
                        ('*' or '_', 1) => "em", ('*' or '_', 2) => "strong", ('~', 2) => "strike", _ => throw new NotRepresentable()
                    };
                    Walk(em, marks.Append(new JsonObject { ["type"] = type }).ToList(), into, ctx);
                    break;
                default:
                    throw new NotRepresentable();
            }
        }
    }

    private static JsonObject Link(string href, string? title) {
        var attrs = new JsonObject { ["href"] = href };
        if (title is not null) { attrs["title"] = title; }
        return new JsonObject { ["type"] = "link", ["attrs"] = attrs };
    }

    private static void Text(string text, List<JsonObject> marks, JsonArray into) {
        if (text.Length == 0) { return; }
        var node = new JsonObject { ["type"] = "text", ["text"] = text };
        var sorted = marks.GroupBy(m => m["type"]!.GetValue<string>()).Select(g => g.Last())
            .OrderBy(m => Array.IndexOf(MarkOrder, m["type"]!.GetValue<string>())).ToList();
        if (sorted.Count > 0) { node["marks"] = new JsonArray(sorted.Select(m => (JsonNode)m.DeepClone()).ToArray()); }
        into.Add(node);
    }

    private static readonly SmartyPantOptions Smarty = new();
    private static string SmartChar(SmartyPant sp) =>
        Smarty.Mapping.TryGetValue(sp.Type, out var r) ? WebUtility.HtmlDecode(r) : sp.ToString();

    /* === ProseMirror to Markdig ========================================= */

    /// <summary>A block written as Markdown, from the editor's JSON.</summary>
    public string Serialize(JsonObject node) {
        var type = Type(node);
        switch (type) {
            case "paragraph":
                return LineStarts(InlineText(Content(node)));
            case "heading": {
                int level = Math.Clamp(Attr(node, "level")?.GetValue<int>() ?? 1, 1, 6);
                var text = InlineText(Content(node)).Replace("\n", " ");
                // A heading's text may not end in #, which would read as its closing sequence.
                if (text.EndsWith('#')) { text = text[..^1] + "\\#"; }
                return new string('#', level) + " " + text;
            }
            case "bullet_list":
            case "ordered_list": {
                bool tight = Attr(node, "tight")?.GetValue<bool>() ?? true;
                var marker = Attr(node, "marker")?.GetValue<string>() is { Length: 1 } m && "-*+".Contains(m) ? m : "-";
                int order = Attr(node, "order")?.GetValue<int>() ?? 1;
                var delimiter = Attr(node, "delimiter")?.GetValue<string>() == ")" ? ")" : ".";
                var items = new List<string>();
                int k = 0;
                foreach (var item in Content(node)) {
                    var prefix = type == "bullet_list" ? marker + " " : (order + k).ToString(CultureInfo.InvariantCulture) + delimiter + " ";
                    k++;
                    var parts = Content(item).Select(Serialize).ToList();
                    var body = tight ? string.Join("\n", parts) : string.Join("\n\n", parts);
                    var pad = new string(' ', prefix.Length);
                    var lines = body.Split('\n');
                    items.Add(prefix + lines[0] + string.Concat(lines.Skip(1).Select(l => "\n" + (l.Length == 0 ? "" : pad + l))));
                }
                return string.Join(tight ? "\n" : "\n\n", items);
            }
            case "container": {
                var name = Attr(node, "name")?.GetValue<string>() ?? "";
                var args = Attr(node, "args")?.GetValue<string>() ?? "";
                if (!ShortcodeSyntax.Name.IsMatch(name)) { throw new ArgumentException("A container's name isn't a shortcode's name."); }
                return "{{" + name + (args.Length > 0 ? ":" + args : "") + "}}\n" + string.Join("\n\n", Content(node).Select(Serialize)) + "\n{{/" + name + "}}";
            }
            case "source_block":
                return Attr(node, "src")?.GetValue<string>() ?? "";
            default:
                throw new ArgumentException("The editor sent a block the site doesn't know: " + type + ".");
        }
    }

    private static string Type(JsonNode? n) => n?["type"]?.GetValue<string>() ?? "";
    private static JsonNode? Attr(JsonNode node, string name) => node["attrs"]?[name];
    private static IEnumerable<JsonObject> Content(JsonNode node) => (node["content"] as JsonArray ?? new JsonArray()).OfType<JsonObject>();

    private static string MarkKey(JsonObject m) => m.ToJsonString();

    /// <summary>Inline content as Markdown: marks become their delimiters,
    /// outermost first, and text is escaped where Markdown would read it as
    /// something else.</summary>
    private static string InlineText(IEnumerable<JsonObject> nodes) => Inline(nodes.ToList(), new HashSet<string>());

    private static string Inline(List<JsonObject> nodes, HashSet<string> active) {
        var sb = new StringBuilder();
        int i = 0;
        while (i < nodes.Count) {
            var node = nodes[i];
            var mark = Marks(node).Where(m => !active.Contains(MarkKey(m)))
                .OrderBy(m => Array.IndexOf(MarkOrder, Type(m))).FirstOrDefault();
            if (mark is null) { sb.Append(Leaf(node)); i++; continue; }
            var key = MarkKey(mark);
            int j = i;
            while (j < nodes.Count && Marks(nodes[j]).Any(m => MarkKey(m) == key)) { j++; }
            var run = nodes.GetRange(i, j - i);
            if (Type(mark) == "code") {
                sb.Append(CodeSpan(string.Concat(run.Select(n => n["text"]?.GetValue<string>() ?? ""))));
            }
            else {
                var inner = Inline(run, new HashSet<string>(active) { key });
                // Spaces at the edges go outside the delimiters, where emphasis can open and close.
                var lead = inner.Length - inner.TrimStart().Length;
                var trail = inner.Length - inner.TrimEnd().Length;
                var core = inner.Trim();
                sb.Append(inner[..lead]);
                if (core.Length > 0) {
                    switch (Type(mark)) {
                        case "em": sb.Append('*').Append(core).Append('*'); break;
                        case "strong": sb.Append("**").Append(core).Append("**"); break;
                        case "strike": sb.Append("~~").Append(core).Append("~~"); break;
                        case "link":
                            var href = mark["attrs"]?["href"]?.GetValue<string>() ?? "";
                            var title = mark["attrs"]?["title"]?.GetValue<string>();
                            sb.Append('[').Append(core).Append("](").Append(Href(href))
                              .Append(title is null ? "" : " \"" + title.Replace("\"", "\\\"") + "\"").Append(')');
                            break;
                    }
                }
                sb.Append(inner[(inner.Length - trail)..]);
            }
            i = j;
        }
        return sb.ToString();
    }

    private static IEnumerable<JsonObject> Marks(JsonObject node) => (node["marks"] as JsonArray ?? new JsonArray()).OfType<JsonObject>();

    private static string Leaf(JsonObject node) => Type(node) switch {
        "text" => Escape(node["text"]?.GetValue<string>() ?? ""),
        "hard_break" => "\\\n",
        "soft_break" => "\n",
        "shortcode" => node["attrs"]?["src"]?.GetValue<string>() ?? "",
        var t => throw new ArgumentException("The editor sent an inline the site doesn't know: " + t + ".")
    };

    private static string Href(string href) =>
        href.Any(c => c == ' ' || c == '(' || c == ')' || c == '<' || c == '>') ? "<" + href.Replace("<", "%3C").Replace(">", "%3E") + ">" : href;

    private static string CodeSpan(string code) {
        int longest = 0, run = 0;
        foreach (var c in code) { run = c == '`' ? run + 1 : 0; longest = Math.Max(longest, run); }
        var fence = new string('`', longest + 1);
        var pad = code.StartsWith('`') || code.EndsWith('`') || (code.StartsWith(' ') && code.EndsWith(' ') && code.Trim().Length > 0) ? " " : "";
        return fence + pad + code + pad + fence;
    }

    private static readonly Regex Entity = new(@"&(#\d+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);", RegexOptions.Compiled);
    /// <summary>Text, with what Markdown would read as markup escaped.</summary>
    private static string Escape(string text) {
        var sb = new StringBuilder();
        for (int i = 0; i < text.Length; i++) {
            char c = text[i];
            if (c is '\\' or '`' or '*' or '_' or '[' or ']' or '<' or '~' || (c == '{' && i + 1 < text.Length && text[i + 1] == '{')
                || (c == '&' && Entity.IsMatch(text, i) && Entity.Match(text, i).Index == i)) {
                sb.Append('\\');
            }
            sb.Append(c);
        }
        return sb.ToString();
    }

    private static readonly Regex BlockStart = new(@"^( {0,3})(#|>|[-+*](?=\s|$)|=+\s*$|-+\s*$)", RegexOptions.Compiled);
    private static readonly Regex OrderedStart = new(@"^( {0,3}\d{1,9})([.)])(?=\s|$)", RegexOptions.Compiled);
    /// <summary>A paragraph's lines, each escaped where its start would read
    /// as another kind of block. A digit can't be escaped, so a line that
    /// would start an ordered list has its . or ) escaped instead.</summary>
    private static string LineStarts(string text) =>
        string.Join("\n", text.Split('\n').Select(line => {
            var o = OrderedStart.Match(line);
            if (o.Success) { return o.Groups[1].Value + "\\" + line[o.Groups[1].Length..]; }
            var m = BlockStart.Match(line);
            return m.Success ? m.Groups[1].Value + "\\" + line[m.Groups[1].Value.Length..] : line;
        }));
}
