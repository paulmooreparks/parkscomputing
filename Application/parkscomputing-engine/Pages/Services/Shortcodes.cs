using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;

using Markdig;
using Markdig.Helpers;
using Markdig.Parsers;
using Markdig.Renderers;
using Markdig.Renderers.Html;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;

namespace ParksComputing.Engine.Pages.Services;

/* Shortcodes in the site's Markdown (Architecture/wysiwyg-editor-design.md),
   in GK Companion's syntax:

     {{name}}  {{name:args}}                 a shortcode in a line of text,
                                             or alone on its line
     {{name:args}}                           a container, each tag alone on
     …Markdown…                              its line, around Markdown of
     {{/name}}                               its own

   A \{{ writes two braces as they are. The table of shortcodes, with what
   each takes and how it renders, is SiteShortcodes; this file is how
   Markdig finds them and writes them out. */

/// <summary>A shortcode as written: its name, its arguments as written, and
/// those arguments read as words and name=value pairs (a value or word may be
/// in double quotes, with \" for a quote inside).</summary>
public sealed class ShortcodeCall {
    public string Name { get; }
    public string Args { get; }
    public IReadOnlyList<string> Positional { get; }
    public IReadOnlyDictionary<string, string> Named { get; }

    public ShortcodeCall(string name, string args) {
        Name = name;
        Args = args.Trim();
        var positional = new List<string>();
        var named = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        int i = 0;
        string s = Args;
        while (i < s.Length) {
            while (i < s.Length && char.IsWhiteSpace(s[i])) { i++; }
            if (i >= s.Length) { break; }
            var key = Regex.Match(s[i..], @"^([A-Za-z][A-Za-z0-9-]*)=");
            string? k = null;
            if (key.Success) { k = key.Groups[1].Value; i += key.Length; }
            string value;
            if (i < s.Length && s[i] == '"') {
                var sb = new StringBuilder();
                i++;
                while (i < s.Length && s[i] != '"') {
                    if (s[i] == '\\' && i + 1 < s.Length) { i++; }
                    sb.Append(s[i]);
                    i++;
                }
                i++;
                value = sb.ToString();
            }
            else {
                int start = i;
                while (i < s.Length && !char.IsWhiteSpace(s[i])) { i++; }
                value = s[start..i];
            }
            if (k is null) { positional.Add(value); } else { named[k] = value; }
        }
        Positional = positional;
        Named = named;
    }

    public string? Get(string key, int position = -1) =>
        Named.TryGetValue(key, out var v) ? v : position >= 0 && position < Positional.Count ? Positional[position] : null;

    /// <summary>The shortcode as written, for a problem to show.</summary>
    public string Source => "{{" + Name + (Args.Length > 0 ? ":" + Args : "") + "}}";
}

/// <summary>A shortcode in a line of text.</summary>
public sealed class ShortcodeInline : LeafInline {
    public ShortcodeInline(ShortcodeCall call, bool closing) { Call = call; Closing = closing; }
    public ShortcodeCall Call { get; }
    /// <summary>A {{/name}} where no container is open: shown as a problem.</summary>
    public bool Closing { get; }
}

/// <summary>A container shortcode and the Markdown inside it.</summary>
public sealed class ShortcodeBlock : ContainerBlock {
    public ShortcodeBlock(BlockParser parser, ShortcodeCall call) : base(parser) { Call = call; }
    public ShortcodeCall Call { get; }
    /// <summary>Whether its {{/name}} was found; one that runs to the end of
    /// the document is shown as a problem.</summary>
    public bool Closed { get; set; }
}

internal static class ShortcodeSyntax {
    public static readonly Regex Name = new("^[a-z][a-z0-9-]*$", RegexOptions.Compiled);
    // {{name}} or {{name:args}}, args not containing }}.
    public static readonly Regex Tag = new(@"^\{\{(/?)([a-z][a-z0-9-]*)(?::((?:(?!\}\}).)*))?\}\}", RegexOptions.Compiled | RegexOptions.Singleline);
    public static readonly Regex Line = new(@"^ {0,3}\{\{([a-z][a-z0-9-]*)(?::((?:(?!\}\}).)*))?\}\}[ \t]*$", RegexOptions.Compiled);
    public static readonly Regex CloseLine = new(@"^ {0,3}\{\{/([a-z][a-z0-9-]*)\}\}[ \t]*$", RegexOptions.Compiled);
}

/// <summary>Opens a container on a line holding only its opening tag, and
/// closes it on the line holding only its {{/name}}.</summary>
internal sealed class ShortcodeBlockParser : BlockParser {
    private readonly SiteShortcodes _table;
    public ShortcodeBlockParser(SiteShortcodes table) { _table = table; OpeningCharacters = new[] { '{' }; }

    public override bool CanInterrupt(BlockProcessor processor, Block block) => true;

    public override BlockState TryOpen(BlockProcessor processor) {
        if (processor.IsCodeIndent) { return BlockState.None; }
        var line = processor.Line.ToString();
        var m = ShortcodeSyntax.Line.Match(line);
        if (!m.Success || _table.Find(m.Groups[1].Value) is not { Kind: ShortcodeKind.Container }) { return BlockState.None; }
        var block = new ShortcodeBlock(this, new ShortcodeCall(m.Groups[1].Value, m.Groups[2].Value)) {
            Line = processor.LineIndex, Column = processor.Column,
            Span = new SourceSpan(processor.Start, processor.Line.End)
        };
        processor.NewBlocks.Push(block);
        return BlockState.ContinueDiscard;
    }

    public override BlockState TryContinue(BlockProcessor processor, Block block) {
        var sc = (ShortcodeBlock)block;
        if (!processor.IsBlankLine) {
            var m = ShortcodeSyntax.CloseLine.Match(processor.Line.ToString());
            if (m.Success && m.Groups[1].Value == sc.Call.Name) {
                sc.Closed = true;
                sc.UpdateSpanEnd(processor.Line.End);
                return BlockState.BreakDiscard;
            }
        }
        return BlockState.Continue;
    }

    public override bool Close(BlockProcessor processor, Block block) => true;
}

/// <summary>A shortcode in a line of text, {{name}} or {{name:args}}.</summary>
internal sealed class ShortcodeInlineParser : InlineParser {
    public ShortcodeInlineParser() { OpeningCharacters = new[] { '{' }; }

    public override bool Match(InlineProcessor processor, ref StringSlice slice) {
        if (slice.PeekCharExtra(1) != '{') { return false; }
        var text = slice.Text.Substring(slice.Start, slice.End - slice.Start + 1);
        var m = ShortcodeSyntax.Tag.Match(text);
        if (!m.Success) { return false; }
        int start = processor.GetSourcePosition(slice.Start, out int line, out int column);
        processor.Inline = new ShortcodeInline(new ShortcodeCall(m.Groups[2].Value, m.Groups[3].Value), m.Groups[1].Value == "/") {
            Span = new SourceSpan(start, start + m.Length - 1), Line = line, Column = column
        };
        slice.Start += m.Length;
        return true;
    }
}

/// <summary>What a render is for: the page it belongs to, how deep in
/// {{include}} it is, and whether it is the editor's view, which shows what
/// the page leaves out ({{draft-note}}).</summary>
public sealed record ShortcodeContext(SiteMarkdown Site, string? Slug, bool Editing, IReadOnlyList<string> Including) {
    public static ShortcodeContext For(SiteMarkdown site, string? slug, bool editing = false) =>
        new(site, slug, editing, slug is null ? Array.Empty<string>() : new[] { slug });
}

/// <summary>The HTML renderer for one render, carrying its context.</summary>
public sealed class SiteHtmlRenderer : HtmlRenderer {
    public SiteHtmlRenderer(System.IO.TextWriter writer, ShortcodeContext context) : base(writer) { Context = context; }
    public ShortcodeContext Context { get; }
}

internal static class ShortcodeHtml {
    public static string Problem(string source, string why) =>
        "<code class=\"sc-problem\" title=\"" + WebUtility.HtmlEncode(why) + "\">" + WebUtility.HtmlEncode(source) + "</code>";

    public static ShortcodeContext ContextOf(HtmlRenderer renderer) =>
        renderer is SiteHtmlRenderer s ? s.Context : throw new InvalidOperationException("Shortcodes render through SiteMarkdown.");

    /// <summary>The block shortcode a paragraph holds alone, if it does.</summary>
    public static ShortcodeInline? Alone(ParagraphBlock p, SiteShortcodes table) {
        if (p.Inline is null) { return null; }
        ShortcodeInline? found = null;
        foreach (var inline in p.Inline) {
            if (inline is ShortcodeInline sc && found is null) { found = sc; continue; }
            if (inline is LiteralInline lit && lit.Content.IsEmptyOrWhitespace()) { continue; }
            if (inline is LineBreakInline) { continue; }
            return null;
        }
        return found is not null && !found.Closing && table.Find(found.Call.Name) is { Kind: ShortcodeKind.Block } ? found : null;
    }
}

internal sealed class ShortcodeInlineRenderer : HtmlObjectRenderer<ShortcodeInline> {
    private readonly SiteShortcodes _table;
    public ShortcodeInlineRenderer(SiteShortcodes table) { _table = table; }

    protected override void Write(HtmlRenderer renderer, ShortcodeInline obj) =>
        renderer.Write(_table.RenderInline(obj, ShortcodeHtml.ContextOf(renderer), renderer));
}

internal sealed class ShortcodeBlockRenderer : HtmlObjectRenderer<ShortcodeBlock> {
    private readonly SiteShortcodes _table;
    public ShortcodeBlockRenderer(SiteShortcodes table) { _table = table; }

    protected override void Write(HtmlRenderer renderer, ShortcodeBlock obj) =>
        _table.RenderContainer(obj, ShortcodeHtml.ContextOf(renderer), renderer);
}

/// <summary>Markdig's paragraph, except that a paragraph holding only a
/// block shortcode (a figure, a contents list, an applet) is written as that
/// shortcode alone, since it can't sit inside a &lt;p&gt;.</summary>
internal sealed class ShortcodeParagraphRenderer : ParagraphRenderer {
    private readonly SiteShortcodes _table;
    public ShortcodeParagraphRenderer(SiteShortcodes table) { _table = table; }

    protected override void Write(HtmlRenderer renderer, ParagraphBlock obj) {
        if (ShortcodeHtml.Alone(obj, _table) is { } alone) {
            renderer.EnsureLine();
            renderer.Write(_table.RenderBlock(alone, ShortcodeHtml.ContextOf(renderer), renderer));
            renderer.EnsureLine();
            return;
        }
        base.Write(renderer, obj);
    }
}

/// <summary>Adds shortcodes to a Markdig pipeline.</summary>
public sealed class ShortcodeExtension : IMarkdownExtension {
    private readonly SiteShortcodes _table;
    public ShortcodeExtension(SiteShortcodes table) { _table = table; }

    public void Setup(MarkdownPipelineBuilder pipeline) {
        if (!pipeline.BlockParsers.Contains<ShortcodeBlockParser>()) {
            pipeline.BlockParsers.Insert(0, new ShortcodeBlockParser(_table));
        }
        // Before generic attributes, which would read {…} as attributes.
        if (!pipeline.InlineParsers.Contains<ShortcodeInlineParser>()) {
            pipeline.InlineParsers.Insert(0, new ShortcodeInlineParser());
        }
    }

    public void Setup(MarkdownPipeline pipeline, IMarkdownRenderer renderer) {
        if (renderer is not HtmlRenderer html) { return; }
        html.ObjectRenderers.ReplaceOrAdd<ParagraphRenderer>(new ShortcodeParagraphRenderer(_table));
        if (!html.ObjectRenderers.Contains<ShortcodeInlineRenderer>()) { html.ObjectRenderers.Add(new ShortcodeInlineRenderer(_table)); }
        if (!html.ObjectRenderers.Contains<ShortcodeBlockRenderer>()) { html.ObjectRenderers.Add(new ShortcodeBlockRenderer(_table)); }
    }
}
