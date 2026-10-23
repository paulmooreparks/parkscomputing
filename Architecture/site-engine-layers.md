# A site's own tree over the engine's assets

A site on this engine used to be one folder: parkscomputing.com and padmajairam.com each mount a whole web root over the image's `/app/wwwroot`. That suits a brochure site, which uses few of the engine's files, and parkscomputing.com, whose live tree carries copies of them. A desktop-mode site that brings only its own content, as xfer.parkscomputing.com does (`Architecture/xfer-site-engine.md`), would lose the engine's scripts, styles, PUDL and built-in applets that way. Since 2026-10-22 such a site sets its own tree as the web root and serves the engine's assets from the image behind it (`Pages/Services/EngineAssets.cs`).

## How a site uses it

The container sets two things:

- `ASPNETCORE_WEBROOT` to the site's tree, mounted read-only, such as `/app/site`.
- `Site__Assets` to where the engine's assets are in the image, `/app/wwwroot`.

Everything the engine reads as the site's own is then read from the site's tree, because it is the web root: `sitenav.xfer`, `content/` with its header and footer sections and its books (which live inside `content/`, per `books-design.md`), `applets/` (which the applet catalogue and the action runner list), `images/`, `audio/`, `redirects.txt`. Static files are looked for in the site's tree first and in the image after, through .NET's `CompositeFileProvider`, so `asp-append-version` stamps and the static file middleware see both. A site can replace one of the engine's files by keeping its own at the same address; a `css/site.css` of its own is the usual case.

## Only the engine's folders show through

The image's web root also holds parkscomputing.com's own articles, pictures, icons, manifests and navigation, because the repository's `wwwroot` doubles as a demonstration of that site. The layer behind a site's tree therefore shows only the engine's own top-level folders: `js`, `css`, `pudl`, `lib`, `fonts` and `highlightjs` (`EngineAssets.Folders`). A request for `/content/about.html` or `/favicon.ico` on another site finds nothing rather than parkscomputing.com's. A new top-level folder of engine assets has to be added to that list.

The few places that read an engine asset by its path on disk ask `EngineAssets` for it rather than the web root: the Markdown renderer's list of PUDL glyphs (`pudl/pudl.css`) and the action runner's scripts (`js/actions`, `pudl/`). The content API (`Api/FileContentStorage.cs`) read articles from the app folder's `wwwroot` rather than the web root, which was the same folder on every site until now; it reads the web root.

## What does not change

A site without `Site__Assets` keeps one tree for both, as before, and `EngineAssets.Layer` leaves its file provider alone. parkscomputing.com, its beta and padmajairam.com run that way.

## Run and route

`Tools/xfer-run.sh` builds `parkscomputing-local:xfer` from the checkout and runs the container `xfer-site` on `127.0.0.1:8094`, with `C:\Users\paul\source\repos\xfer-site\site` mounted read-only at `/app/site`, desktop mode, staff accounts only and its own database, `XferSite`, on the shared SQL Server. Its settings file, which holds the database's credentials, is `C:\Users\paul\.config\docker-sites\xfer.env`, outside the repository. Port 8093, the first free-looking one, is already given to Pathma's API in the tunnel's configuration, so the site took 8094. With accounts on, the engine answers only its own host, so a local check needs `-H "Host: xfer.parkscomputing.com"`.
