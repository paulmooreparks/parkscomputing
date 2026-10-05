using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using ParksComputing.Engine.Identity;

namespace ParksComputing.Engine.Pages.Services;

/// <summary>A file the staff may edit: where it is under wwwroot, what to
/// call it, the group it is listed under, and whether only the super-user
/// may change it.</summary>
public sealed record EditableFile(string Path, string Title, string Group, bool SuperOnly);

/// <summary>A file's text and the version it was read at, which a save
/// must name, so one person's edit never silently replaces another's.</summary>
public sealed record FileText(string Text, string Version);

/// <summary>
/// A brochure site's own editing (Architecture/padmajairam-port-design.md,
/// "Sign-in and editing"): the pages for an Admin, and the site's own files
/// (navigation, stylesheet, header, footer, head and redirects) for the
/// super-user too. Only files on that list can be read or written here, so
/// no path from a form reaches anything else. Every save keeps the version
/// it replaces in the history (Identity/ServerFiles.cs) and is written to
/// the audit log, and any kept version can be put back.
/// </summary>
public sealed class SiteEditor {
    private const string RootKey = ServerFiles.WebRoot;
    private readonly ServerFiles _files;
    private readonly MarkdownPages _pages;

    public SiteEditor(ServerFiles files, MarkdownPages pages) { _files = files; _pages = pages; }

    private static readonly (string Path, string Title)[] SiteFiles = {
        ("sitenav.xfer", "Navigation (sitenav.xfer)"),
        ("css/site.css", "Stylesheet (css/site.css)"),
        ("content/header-section.html", "Header"),
        ("content/footer-section.html", "Footer"),
        ("content/head-section.html", "Head: fonts, analytics, structured data"),
        ("redirects.txt", "Redirects (redirects.txt)")
    };

    private string Root => _files.RootDir(RootKey, "")!;

    /// <summary>What this reader may edit, in the order the site lists its
    /// pages, then the site files for the super-user.</summary>
    public IReadOnlyList<EditableFile> Files(bool superuser) {
        var list = new List<EditableFile>();
        foreach (var p in _pages.Pages()) {
            var rel = PathOf(p.Slug);
            if (rel is not null) { list.Add(new EditableFile(rel, p.Title, p.Group, false)); }
        }
        if (superuser) {
            list.AddRange(SiteFiles.Where(f => File.Exists(Path.Combine(Root, f.Path))).Select(f => new EditableFile(f.Path, f.Title, "Site files", true)));
        }
        return list;
    }

    /// <summary>A page's content file, .md before .html as the site reads
    /// them; null when it has none.</summary>
    private string? PathOf(string slug) =>
        new[] { ".md", ".html" }.Select(ext => "content/" + slug + ext).FirstOrDefault(rel => File.Exists(Path.Combine(Root, rel)));

    /// <summary>The file at path if this reader may edit it, else null.</summary>
    public EditableFile? Find(string? path, bool superuser) =>
        path is null ? null : Files(superuser).FirstOrDefault(f => string.Equals(f.Path, path, StringComparison.Ordinal));

    private string FullOf(EditableFile f) => ServerFiles.Resolve(Root, f.Path) ?? throw new InvalidOperationException("The file is outside the site.");

    private static string VersionOf(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes))[..16].ToLowerInvariant();

    public FileText Read(EditableFile f) {
        var bytes = File.ReadAllBytes(FullOf(f));
        return new FileText(Encoding.UTF8.GetString(bytes), VersionOf(bytes));
    }

    /// <summary>Saves new text, unless the file changed since version was
    /// read, in which case it returns false and changes nothing. The text
    /// it replaces is kept first.</summary>
    public async Task<(bool Saved, string Version)> SaveAsync(EditableFile f, string text, string version, string who, string ip) {
        var full = FullOf(f);
        var current = VersionOf(File.ReadAllBytes(full));
        if (!string.Equals(current, version, StringComparison.Ordinal)) { return (false, current); }
        // Lines end as the browser sent them, normalised to the file's own.
        var bytes = new UTF8Encoding(false).GetBytes(text.Replace("\r\n", "\n"));
        if (VersionOf(bytes) == current) { return (true, current); }
        _files.KeepPrevious(RootKey, f.Path, full);
        await File.WriteAllBytesAsync(full, bytes);
        await _files.AuditAsync(who, ip, "edit", RootKey, f.Path, full: full);
        return (true, VersionOf(bytes));
    }

    /// <summary>The kept versions of a file, newest first.</summary>
    public IReadOnlyList<(string Id, DateTime Time, long Size)> Versions(EditableFile f) =>
        _files.Versions(RootKey, f.Path).Where(v => !v.Dir).Select(v => (v.Id, v.Time, v.Size)).ToList();

    public string? ReadVersion(EditableFile f, string id) {
        var p = _files.VersionPath(RootKey, f.Path, id);
        return p is null || !File.Exists(p) ? null : File.ReadAllText(p);
    }

    /// <summary>Puts a kept version back, keeping the current one first, so
    /// a restore can itself be undone.</summary>
    public async Task<bool> RestoreAsync(EditableFile f, string id, string who, string ip) {
        var p = _files.VersionPath(RootKey, f.Path, id);
        if (p is null || !File.Exists(p)) { return false; }
        var full = FullOf(f);
        _files.KeepPrevious(RootKey, f.Path, full);
        File.Copy(p, full, overwrite: true);
        await _files.AuditAsync(who, ip, "restore", RootKey, f.Path, to: id, full: full);
        return true;
    }
}
