using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Primitives;

namespace ParksComputing.Engine.Pages.Services;

/// <summary>
/// The engine's own web assets (its scripts, stylesheets, PUDL, vendored
/// libraries and fonts), apart from a site's own tree
/// (Architecture/site-engine-layers.md).
///
/// A site that brings only its own tree (sitenav.xfer, content, books,
/// applets, images, its stylesheet and sections) sets that tree as the web
/// root (ASPNETCORE_WEBROOT) and says where the engine's assets are with
/// Site:Assets, which in the image is /app/wwwroot. Static files are then
/// looked for in the site's tree first and in the engine's asset folders
/// after, so a site may replace one of the engine's files by having its own
/// at the same address. Only the folders in <see cref="Folders"/> come from
/// the engine's side: the image's web root also holds parkscomputing.com's
/// own articles, pictures and icons, which another site must never serve.
/// Everything else the engine reads as the site's own (articles, books, the
/// navigation, applet packages, redirects) stays under the web root.
///
/// A site without Site:Assets (parkscomputing.com, padmajairam.com) keeps
/// one tree for both, as before.
/// </summary>
public sealed class EngineAssets {
    public const string SettingKey = "Site:Assets";

    /// <summary>The engine's own top-level folders in its web root.</summary>
    public static readonly IReadOnlyList<string> Folders = new[] { "js", "css", "pudl", "lib", "fonts", "highlightjs" };

    /// <summary>Where the engine's assets are on disk: Site:Assets, or the
    /// web root when the site keeps one tree.</summary>
    public string Root { get; }

    public EngineAssets(IWebHostEnvironment env, IConfiguration configuration) { Root = RootOf(env, configuration); }

    public static string RootOf(IWebHostEnvironment env, IConfiguration configuration) =>
        Path.GetFullPath(configuration[SettingKey] is { Length: > 0 } assets ? assets : env.WebRootPath);

    /// <summary>An engine asset's path on disk, such as pudl/pudl.css.</summary>
    public string PathOf(params string[] parts) => Path.Combine(new[] { Root }.Concat(parts).ToArray());

    /// <summary>Makes the web root's file provider the site's tree over the
    /// engine's asset folders, when Site:Assets is set and is not the web
    /// root itself. Called before anything serves a static file.</summary>
    public static void Layer(IWebHostEnvironment env, IConfiguration configuration) {
        var assets = RootOf(env, configuration);
        if (string.Equals(assets.TrimEnd('/', '\\'), Path.GetFullPath(env.WebRootPath).TrimEnd('/', '\\'), StringComparison.Ordinal)) { return; }
        if (!Directory.Exists(assets)) { throw new InvalidOperationException(SettingKey + " is " + assets + ", which is not a folder."); }
        env.WebRootFileProvider = new CompositeFileProvider(env.WebRootFileProvider, new FoldersOnly(new PhysicalFileProvider(assets), Folders));
    }

    /// <summary>A file provider that shows only some top-level folders of another.</summary>
    public sealed class FoldersOnly : IFileProvider {
        private readonly IFileProvider _inner;
        private readonly HashSet<string> _folders;
        public FoldersOnly(IFileProvider inner, IEnumerable<string> folders) { _inner = inner; _folders = new HashSet<string>(folders, StringComparer.OrdinalIgnoreCase); }

        private bool Allowed(string subpath) {
            var first = (subpath ?? "").TrimStart('/', '\\').Split('/', '\\')[0];
            return first.Length > 0 && _folders.Contains(first);
        }

        public IFileInfo GetFileInfo(string subpath) => Allowed(subpath) ? _inner.GetFileInfo(subpath) : new NotFoundFileInfo(subpath);
        public IDirectoryContents GetDirectoryContents(string subpath) => Allowed(subpath) ? _inner.GetDirectoryContents(subpath) : NotFoundDirectoryContents.Singleton;
        public IChangeToken Watch(string filter) => Allowed(filter) ? _inner.Watch(filter) : NullChangeToken.Singleton;
    }
}
