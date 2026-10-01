using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;

using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Caching.Memory;

namespace ParksComputing.Engine.Pages.Services;

/// <summary>
/// Books (Architecture/books-design.md): a main page with chapters under it,
/// nested as deep as the author likes. Nothing is a book by its name: a page
/// is a book's main page because its front matter says where its chapters
/// are, chapters: {folder}, a folder relative to the page. Every Markdown
/// file in that folder is a chapter, and a chapter that has chapters of its
/// own says so the same way. A chapter's front matter may give its title and
/// its order among its siblings (order: 2); otherwise its first heading, or
/// its file name, names it, and chapters without an order follow those with
/// one, by title. Every chapter has its own address, /page/{slug}/{path},
/// where the path is the chapters' file names, whatever their folders are
/// called.
/// </summary>
public sealed class BookService {
    private static readonly Regex Segment = new("^[A-Za-z0-9_-]+$", RegexOptions.Compiled);
    private readonly string _content;
    private readonly Microsoft.Extensions.Caching.Memory.IMemoryCache _cache;
    private readonly Microsoft.Extensions.FileProviders.PhysicalFileProvider _files;

    public BookService(IWebHostEnvironment env, Microsoft.Extensions.Caching.Memory.IMemoryCache cache) {
        _content = Path.Combine(env.WebRootPath, "content");
        _cache = cache;
        /* A book is read once and kept until one of its files changes.
           The content folder is a Windows folder that Docker Desktop
           passes into the container without change notices, so the
           provider looks at the files every few seconds instead of
           waiting to be told (a documented PhysicalFileProvider mode). */
        _files = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(_content) {
            UsePollingFileWatcher = true,
            UseActivePolling = true
        };
    }

    /// <summary>One chapter, or the book itself at the root (Path empty), with
    /// the file it is.</summary>
    public sealed record Chapter(string Path, string Title, int? Order, bool HasPage, IReadOnlyList<Chapter> Children, string File = "");

    /// <summary>What a page's front matter says about it as a book's page.</summary>
    private sealed record Described(string Title, int? Order, string? Chapters);

    public sealed record Book(string Slug, Chapter Root) {
        /// <summary>Every chapter with a page, in reading order: the main
        /// page, then each chapter before its own chapters.</summary>
        public IReadOnlyList<Chapter> ReadingOrder { get; } = Flatten(Root).Where(c => c.HasPage).ToList();

        public Chapter? Find(string path) => Flatten(Root).FirstOrDefault(c => string.Equals(c.Path, path, StringComparison.OrdinalIgnoreCase));

        private static IEnumerable<Chapter> Flatten(Chapter c) {
            yield return c;
            foreach (var child in c.Children) {
                foreach (var d in Flatten(child)) { yield return d; }
            }
        }
    }

    /// <summary>Whether every segment of a content path is a plain name, so
    /// the path can only ever name a file inside content/.</summary>
    public static bool IsSafePath(string? path) =>
        !string.IsNullOrEmpty(path) && path.Split('/').All(s => Segment.IsMatch(s));

    /// <summary>The book a content path belongs to, if its first segment is
    /// a book, with the chapter path within it ("" for the main page).</summary>
    public (Book Book, string ChapterPath)? Locate(string? path) {
        if (!IsSafePath(path)) { return null; }
        var parts = path!.Split('/', 2);
        var book = Load(parts[0]);
        if (book is null) { return null; }
        var chapter = parts.Length > 1 ? parts[1] : string.Empty;
        return book.Find(chapter) is { HasPage: true } ? (book, chapter) : null;
    }

    /// <summary>The book whose main page is content/{slug}.md, or null when
    /// that page names no folder of chapters.</summary>
    public Book? Load(string slug) {
        if (!Segment.IsMatch(slug ?? string.Empty)) { return null; }
        // Kept, as a book or as "not a book", until the main page or
        // anything under its chapters' folder changes. A key is lower case,
        // as the file system the content lives on ignores case.
        var key = "pc-book:" + slug.ToLowerInvariant();
        if (_cache.TryGetValue(key, out Book? cached)) { return cached; }
        var main = Path.Combine(_content, slug + ".md");
        var described = File.Exists(main) ? Describe(main, slug) : null;
        var folder = described?.Chapters is { } c && IsSafePath(c) ? c : null;
        var tokens = new List<Microsoft.Extensions.Primitives.IChangeToken> { _files.Watch(slug + ".md") };
        if (folder is not null) { tokens.Add(_files.Watch(folder + "/**/*")); }
        Book? book = null;
        if (folder is not null && Directory.Exists(Path.Combine(_content, folder))) {
            book = new Book(slug, new Chapter(string.Empty, described!.Title, null, true,
                ChaptersIn(Path.Combine(_content, folder), string.Empty), main));
        }
        _cache.Set(key, book, new MemoryCacheEntryOptions().AddExpirationToken(new Microsoft.Extensions.Primitives.CompositeChangeToken(tokens)));
        return book;
    }

    /// <summary>The Markdown file of a chapter, or the main page for "".</summary>
    public string? FileOf(Book book, string chapterPath) =>
        book.Find(chapterPath ?? string.Empty) is { File.Length: > 0 } c && File.Exists(c.File) ? c.File : null;

    /// <summary>The chapters in a folder: every Markdown file in it, each
    /// with its own chapters when its front matter names their folder. A
    /// folder is always below the page that names it, so a book can't loop
    /// back on itself.</summary>
    private List<Chapter> ChaptersIn(string dir, string prefix) {
        var chapters = new List<Chapter>();
        foreach (var file in Directory.EnumerateFiles(dir, "*.md")) {
            var name = Path.GetFileNameWithoutExtension(file)!;
            if (!Segment.IsMatch(name)) { continue; }
            var path = prefix + name;
            var d = Describe(file, name);
            var sub = d.Chapters is { } c && IsSafePath(c) ? Path.Combine(dir, c.Replace('/', Path.DirectorySeparatorChar)) : null;
            var children = sub is not null && Directory.Exists(sub) ? ChaptersIn(sub, path + "/") : new List<Chapter>();
            chapters.Add(new Chapter(path, d.Title, d.Order, true, children, file));
        }
        return chapters
            .OrderBy(c => c.Order.HasValue ? 0 : 1).ThenBy(c => c.Order ?? 0)
            .ThenBy(c => c.Title, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
    }

    /// <summary>A page's title, its order among its siblings and the folder
    /// of its chapters, from its front matter; its title else comes from its
    /// first heading, else from its name.</summary>
    private static Described Describe(string file, string name) {
        string? title = null, chapters = null; int? order = null;
        using var reader = new StreamReader(file);
        var first = reader.ReadLine();
        string? line;
        if (first?.Trim() == "---") {
            while ((line = reader.ReadLine()) is not null && line.Trim() != "---") {
                // An indented line belongs to a nested value, such as the
                // titles of the page's menu (PageMenu), not to a key here.
                if (line.Length > 0 && char.IsWhiteSpace(line[0])) { continue; }
                int colon = line.IndexOf(':');
                if (colon <= 0) { continue; }
                var key = line[..colon].Trim().ToLowerInvariant();
                var val = line[(colon + 1)..].Trim().Trim('"');
                if (key == "title" && val.Length > 0) { title = val; }
                else if (key == "order" && int.TryParse(val, NumberStyles.Integer, CultureInfo.InvariantCulture, out var o)) { order = o; }
                else if (key == "chapters" && val.Length > 0) { chapters = val.Trim('/'); }
            }
        }
        else if (first?.StartsWith("# ") == true) {
            title = first[2..].Trim();
        }
        if (title is null) {
            while ((line = reader.ReadLine()) is not null) {
                if (line.StartsWith("# ")) { title = line[2..].Trim(); break; }
            }
        }
        return new Described(title ?? Humanize(name), order, chapters);
    }

    private static string Humanize(string name) =>
        string.Join(' ', name.Split('-', '_', StringSplitOptions.RemoveEmptyEntries)
            .Select(w => char.ToUpperInvariant(w[0]) + w[1..]));

    /* === Rendering ====================================================== */

    /// <summary>
    /// A book page: the contents tree beside the chapter, and the previous
    /// and next chapters below it. The same markup serves the classic page
    /// and a window. Every link is the chapter's own address, and carries
    /// data-book-chapter, which js/books.js takes over in a window so the
    /// window turns the page rather than the browser.
    /// </summary>
    public static string Render(Book book, string current, string chapterHtml, string windowKey = "") =>
        RenderOpen(book, current, windowKey) + chapterHtml + RenderClose(book, current);

    private static string Href(Book book, Chapter c) => "/page/" + book.Slug + (c.Path.Length > 0 ? "/" + c.Path : string.Empty);
    private static string Enc(string s) => WebUtility.HtmlEncode(s);
    private static string Link(Book book, Chapter c, string cls = "") =>
        $"<a{(cls.Length > 0 ? $" class=\"{cls}\"" : "")} href=\"{Href(book, c)}\" data-book-of=\"{Enc(book.Slug)}\" data-book-chapter=\"{Enc(c.Path)}\"";

    /// <summary>The book's frame and contents, up to where the chapter goes.</summary>
    public static string RenderOpen(Book book, string current, string windowKey = "") {
        string Link(Chapter c, string cls = "") => BookService.Link(book, c, cls);
        var sb = new StringBuilder();
        sb.Append($"<div class=\"book\" data-book=\"{Enc(book.Slug)}\" data-book-current=\"{Enc(current)}\"{(windowKey.Length > 0 ? $" data-book-window=\"{Enc(windowKey)}\"" : "")}><div class=\"book-grid\">");
        // The contents: a disclosure, so it folds away, holding PUDL's tree.
        sb.Append("<details class=\"book-contents\" open><summary>Contents</summary>");
        sb.Append($"<ul class=\"tree book-tree\" aria-label=\"Contents of {Enc(book.Root.Title)}\">");
        sb.Append("<li>").Append(Link(book.Root)).Append(current.Length == 0 ? " aria-current=\"page\"" : "").Append('>').Append(Enc(book.Root.Title)).Append("</a></li>");
        void Tree(IReadOnlyList<Chapter> chapters) {
            foreach (var c in chapters) {
                bool here = string.Equals(c.Path, current, StringComparison.OrdinalIgnoreCase);
                // A branch starts open when the current chapter is in it.
                bool open = current.StartsWith(c.Path + "/", StringComparison.OrdinalIgnoreCase) || here;
                sb.Append("<li>");
                if (c.HasPage) {
                    sb.Append(Link(c));
                    if (here) { sb.Append(" aria-current=\"page\""); }
                }
                else {
                    sb.Append("<a");
                }
                if (c.Children.Count > 0) { sb.Append($" aria-expanded=\"{(open ? "true" : "false")}\""); }
                sb.Append('>').Append(Enc(c.Title)).Append("</a>");
                if (c.Children.Count > 0) { sb.Append("<ul>"); Tree(c.Children); sb.Append("</ul>"); }
                sb.Append("</li>");
            }
        }
        Tree(book.Root.Children);
        sb.Append("</ul></details>");
        sb.Append("<div class=\"book-page\">");
        return sb.ToString();
    }

    /// <summary>After the chapter: the previous and next chapters, and the frame's end.</summary>
    public static string RenderClose(Book book, string current) {
        string Link(Chapter c, string cls = "") => BookService.Link(book, c, cls);
        var sb = new StringBuilder();
        var order = book.ReadingOrder;
        int at = order.ToList().FindIndex(c => string.Equals(c.Path, current, StringComparison.OrdinalIgnoreCase));
        if (at >= 0) {
            sb.Append("<nav class=\"book-pager\" aria-label=\"Chapters\">");
            if (at > 0) { var p = order[at - 1]; sb.Append(Link(p, "book-prev")).Append(" rel=\"prev\"><span class=\"book-pager-dir\">Previous</span><span class=\"book-pager-title\">").Append(Enc(p.Title)).Append("</span></a>"); }
            if (at < order.Count - 1) { var n = order[at + 1]; sb.Append(Link(n, "book-next")).Append(" rel=\"next\"><span class=\"book-pager-dir\">Next</span><span class=\"book-pager-title\">").Append(Enc(n.Title)).Append("</span></a>"); }
            sb.Append("</nav>");
        }
        sb.Append("</div></div></div>");
        return sb.ToString();
    }
}
