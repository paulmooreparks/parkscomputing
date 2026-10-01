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
/// nested as deep as the author likes. A book is content/{slug}.md beside a
/// folder content/{slug}/; each Markdown file in the folder is a chapter, and
/// a chapter's own folder (content/{slug}/{chapter}/) holds its chapters.
/// A chapter's front matter may give its title and its order among its
/// siblings (order: 2); otherwise its first heading, or its file name, names
/// it, and chapters without an order follow those with one, by title.
/// Every chapter has its own address, /page/{slug}/{path}.
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

    /// <summary>One chapter, or the book itself at the root (Path empty).</summary>
    public sealed record Chapter(string Path, string Title, int? Order, bool HasPage, IReadOnlyList<Chapter> Children);

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
    /// the slug has no folder of chapters beside it.</summary>
    public Book? Load(string slug) {
        if (!Segment.IsMatch(slug ?? string.Empty)) { return null; }
        // Kept, as a book or as "not a book", until the main page or
        // anything under its folder changes. A key is lower case, as the
        // file system the content lives on ignores case.
        var key = "pc-book:" + slug.ToLowerInvariant();
        if (_cache.TryGetValue(key, out Book? cached)) { return cached; }
        var token = new Microsoft.Extensions.Primitives.CompositeChangeToken(new[] {
            _files.Watch(slug + ".md"), _files.Watch(slug + "/**/*")
        });
        var book = Read(slug);
        _cache.Set(key, book, new Microsoft.Extensions.Caching.Memory.MemoryCacheEntryOptions().AddExpirationToken(token));
        return book;
    }

    private Book? Read(string slug) {
        var main = Path.Combine(_content, slug + ".md");
        var dir = Path.Combine(_content, slug);
        if (!File.Exists(main) || !Directory.Exists(dir)) { return null; }
        var (title, _) = Describe(main, slug);
        return new Book(slug, new Chapter(string.Empty, title, null, true, ChaptersIn(dir, string.Empty)));
    }

    /// <summary>The Markdown file of a chapter, or the main page for "".</summary>
    public string? FileOf(Book book, string chapterPath) {
        var rel = string.IsNullOrEmpty(chapterPath) ? book.Slug : book.Slug + "/" + chapterPath;
        if (!IsSafePath(rel)) { return null; }
        var file = Path.Combine(_content, rel.Replace('/', Path.DirectorySeparatorChar) + ".md");
        return File.Exists(file) ? file : null;
    }

    private List<Chapter> ChaptersIn(string dir, string prefix) {
        var names = Directory.EnumerateFiles(dir, "*.md").Select(f => Path.GetFileNameWithoutExtension(f)!)
            .Concat(Directory.EnumerateDirectories(dir).Select(d => Path.GetFileName(d)!))
            .Where(n => Segment.IsMatch(n))
            .Distinct(StringComparer.OrdinalIgnoreCase);
        var chapters = new List<Chapter>();
        foreach (var name in names) {
            var path = prefix + name;
            var file = Path.Combine(dir, name + ".md");
            var sub = Path.Combine(dir, name);
            bool hasPage = File.Exists(file);
            var (title, order) = hasPage ? Describe(file, name) : (Humanize(name), null);
            var children = Directory.Exists(sub) ? ChaptersIn(sub, path + "/") : new List<Chapter>();
            if (!hasPage && children.Count == 0) { continue; }
            chapters.Add(new Chapter(path, title, order, hasPage, children));
        }
        return chapters
            .OrderBy(c => c.Order.HasValue ? 0 : 1).ThenBy(c => c.Order ?? 0)
            .ThenBy(c => c.Title, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
    }

    /// <summary>A chapter's title and order from its front matter, else its
    /// first heading, else its name.</summary>
    private static (string Title, int? Order) Describe(string file, string name) {
        string? title = null; int? order = null;
        using var reader = new StreamReader(file);
        var first = reader.ReadLine();
        string? line;
        if (first?.Trim() == "---") {
            while ((line = reader.ReadLine()) is not null && line.Trim() != "---") {
                int colon = line.IndexOf(':');
                if (colon <= 0) { continue; }
                var key = line[..colon].Trim().ToLowerInvariant();
                var val = line[(colon + 1)..].Trim().Trim('"');
                if (key == "title" && val.Length > 0) { title = val; }
                else if (key == "order" && int.TryParse(val, NumberStyles.Integer, CultureInfo.InvariantCulture, out var o)) { order = o; }
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
        return (title ?? Humanize(name), order);
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
