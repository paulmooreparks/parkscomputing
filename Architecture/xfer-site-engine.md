# xfer.parkscomputing.com on the engine

This brief is for the agent that works on this repository. It sets out what the engine needs so that it can serve xfer.parkscomputing.com, the home of XferLang, as a third site beside parkscomputing.com and padmajairam.com. The brief was written on 2026-10-22 by the session that builds XferLang's implementations and the site's content. Paul has decided the shape of the site, and this brief records his decisions without revisiting them. The site is milestone M3 of the XferLang roadmap.

## Who does what

Paul's decisions of 2026-10-22, recorded in section 9 of `C:\Users\paul\source\repos\xferlang\history\XFER_SITE_DESIGN.md`:

- **The site runs on this engine as it is.** It is another container from the engine image built here, configured through the `Site` settings in desktop mode, as padmajairam.com is configured in brochure mode. There is no fork. What the site needs that the engine lacks is added to the engine for every site, and that is this repository's work.
- **The site's content is the repository `xfer-site`** (https://github.com/paulmooreparks/xfer-site, checked out at `C:\Users\paul\source\repos\xfer-site`). Its `site/` folder is mounted into the container, so what is served is what is committed there. It holds `sitenav.xfer`, `content/`, `books/`, `applets/` and `images/`. The XferLang side writes that content, the site's own applets (the JSON converter and the nesting demonstration) among it.
- **The tunnel route exists.** Paul has added xfer.parkscomputing.com to the Cloudflare tunnel. What remains is its ingress entry in `C:\Windows\System32\config\systemprofile\.cloudflared\config.yml`, once a container listens on a loopback port. Do not change any other route.
- **`xfer` in the terminal is the npm CLI itself.** The `xferlang` package exports the command line as a function, so the site's terminal runs the same code as `npx xferlang` and prints the same bytes.

The plan for the whole site is `XFER_SITE_DESIGN.md`. Phase 1 is in its section 8: the site stood up in desktop mode, the Editor with XferLang highlighting and diagnostics, `xfer` in the terminal, the JSON converter, the specification as a book with a page per diagnostic code, and the nesting demonstration on the home page.

## What the engine needs

### 1. A site's own tree beside the engine's assets

padmajairam.com mounts its whole web root over `/app/wwwroot`. That works for a brochure site, which uses few of the engine's files. A desktop-mode site needs the engine's own scripts, styles, PUDL and applets (the desktop, the Editor, the terminal, Files), which live in the image's `wwwroot`. Mounting `xfer-site/site` over `/app/wwwroot` would hide them.

The engine needs a way for a site to supply its own tree (`sitenav.xfer`, `content/`, `books/`, `applets/`, `images/`, and its own `css/site.css` and header and footer sections if it has them) while the engine's built-in assets come from the image. Two possible approaches are a content root separate from the web root, or a web root composed of the image's files with the site's files layered over them. This repository decides the mechanism. The site's applets in `applets/*/` must be catalogued as the engine catalogues its own. Mount `xfer-site/site` read-only.

### 2. The container

- **Settings.** `Site__Mode=desktop`, `Site__Origin=https://xfer.parkscomputing.com`, and the site's name wherever the engine shows it (`Accounts__SiteName`, the title in its `sitenav.xfer`). I suggest staff accounts only, as on padmajairam.com: `Accounts__Enabled=true`, `Accounts__StaffEnabled=true`, `Accounts__Registration=false`, its own database, comments off, and Paul as super-user through `account-bootstrap`. Ask Paul before choosing differently.
- **A port.** Take a free loopback port. On 2026-10-22 these were in use: 80 (parkscomputing.com), 8085, 8087, 8089 (padmajairam.com), 8091 (padmajairam beta), 8100 (beta.parkscomputing.com), 8102 and 1433.
- **The tunnel.** Add an ingress rule for `xfer.parkscomputing.com` to `http://127.0.0.1:<port>` in `config.yml`, above the catch-all, then restart the cloudflared service. That restart needs an administrator; if it cannot be done from here, ask Paul.
- **What it serves at first.** `xfer-site/site` is nearly empty on 2026-10-22. The site can go up as soon as the engine can serve it. Its content then arrives through commits to `xfer-site`, with no change to the container.

### 3. xfer-js in the browser

Serve a pinned copy of the `xferlang` npm package's built files as static assets (for example under `/vendor/xferlang/<version>/`), loaded as ES modules. Use version `0.1.0-next.5` or later: that release adds the `xferlang/cli` entry that section 5 needs (xfer-js pull request 7, not yet merged on 2026-10-22). The package has no runtime dependencies, and its built files are `dist/index.js`, `dist/cli-core.js` and the chunk they share. Record the version and the tarball's SHA-512 beside the copy, as `xfer-dotnet` does in `xfer-js.version`, so that an update is a deliberate act.

The API is in the package's README (https://github.com/paulmooreparks/xfer-js). The parts used here are `parse(text)`, which never throws and returns `{ ok, value, diagnostics, tree }`, `canonical(result)`, `toJson(value, options)` and `fromJson(text)`.

### 4. XferLang in the Editor

Add XferLang as a language in `js/editor.js` for files ending in `.xfer` or `.xferlang`, beside JSON (`languageFor`, the language extensions near line 395, and `lintExtension` near line 402):

- **Highlighting.** A `CM.StreamLanguage` mode is enough for phase 1: strings, symbols, keywords (`true`, `false`, `null`, `inf`, `-inf`, `nan`), numbers, temporals, comments (`</ ... />`), annotations (`<! ... !>`) and brackets. The spec's lexical rules are in sections 3 and 4 of `C:\Users\paul\source\repos\xferlang\spec\xferlang.md`. Strings are the hard part. A string is delimited by a run of n quotation marks and closed by the same run, or by `#…"` and `"#…` with n hashes, and nothing inside it is escaped. A stream mode can track the opening run in its state. The site design suggests a Lezer grammar with an external tokenizer later; that is not phase 1.
- **Diagnostics.** A `CM.linter` that calls `parse` on the document and turns each diagnostic into a lint mark. A diagnostic's `start` and `end` carry `line`, `column` and `offset`. The `offset` counts UTF-8 bytes into the normalized text, and the `column` counts Unicode scalar values, so neither is a CodeMirror position. Convert from line and column. The parser normalizes CRLF to LF and drops a leading byte order mark before it counts, so convert against the same normalized text. Each mark's message carries the code (`XFER0404`) and links to `https://xfer.parkscomputing.com/diag/XFER0404`, on every site, so a diagnostic always reaches its page.
- **Format.** A command that replaces the document with `canonical(parse(text))` when the document parses. When it does not parse, the command leaves the document as it is and shows the diagnostics.

parkscomputing.com gains all this too, for its own `sitenav.xfer` and `etc/admin-menu.xfer`.

### 5. `xfer` in the terminal

Register a command named `xfer` with `window.pcTerminal.register` (see `js/terminal-text.js` for the pattern) that runs `runCli` from `xferlang/cli`:

```js
import { runCli } from "/vendor/xferlang/<version>/cli-core.js";

pcTerminal.register({
  name: "xfer",
  run: (args, io) => runCli(args, {
    readFile: (name) => io.read(name),              // text; runCli takes bytes or text
    readStdin: async () => io.stdin ?? "",
    writeFile: (name, text) => io.fs.write(name, text, false),
    stdout: (text) => io.out(text),
    stderr: (text) => io.err(text),
    version: "<the xferlang version>",
  }),
});
```

`runCli` takes the arguments without the command's name and resolves to the exit status (0, 1 or 2). It throws only on a bug in itself. Check the `io` names against `js/terminal.js`; the sketch above is from reading it, not from running it. `xfer --help` should then print the same text as `npx xferlang --help`. The `xferlang` README has the commands.

### 6. Pages at the site's addresses

The XferLang side writes these pages into `xfer-site/site` with the engine's existing features, so the engine needs only to serve them at the right addresses:

- **A page per diagnostic code** at `/diag/XFER0404` and so on. There will be one page for each code in the spec's section 10, as Markdown in `content/`. Section 4's links depend on this address. If the engine's page addressing (`Site:PageUrl`, the slugs in `sitenav.xfer`) cannot produce `/diag/<code>`, that is an engine change.
- **The specification as a book,** in `books/`, through the books feature.
- **A home page** with the nesting demonstration, and the JSON converter, as applets in `applets/`. The XferLang side writes them against the applet package contract in `Architecture/applet-packages-design.md`. A note in `xfer-site` saying which parts of that contract a site's own applet may use would help.

## Order

1. The engine change of section 1, and the container, settings and tunnel of section 2. Then xfer.parkscomputing.com answers, even if it shows little yet.
2. XferLang in the Editor (section 4) and `xfer` in the terminal (section 5), on xfer.parkscomputing.com first. parkscomputing.com takes them through beta as any engine release does.
3. Whatever section 6 turns out to need.

Tell Paul when the site answers and on which port, so the XferLang side can start filling `xfer-site`.

## Where it stands (2026-10-22, this repository's side)

**Section 1 is done.** A site now sets its own tree as the web root and says where the engine's assets are with `Site__Assets`; static files come from the site's tree first and from the engine's own folders in the image after. Only the engine's folders (`js`, `css`, `pudl`, `lib`, `fonts`, `highlightjs`) show through, so parkscomputing.com's articles and icons in the image never reach another site. `Architecture/site-engine-layers.md` has the mechanism. The site's applets in `applets/*/` are catalogued from its tree, and the image has no applet packages of its own, so the site lists only its own.

**Section 2 is done except the tunnel's restart.** The container `xfer-site` runs from `parkscomputing-local:xfer` on `127.0.0.1:8094` (8093 is given to Pathma's API in the tunnel's configuration), started by `Tools/xfer-run.sh`, with `xfer-site/site` read-only at `/app/site`. It runs in desktop mode with staff accounts only, its own database `XferSite` and comments off, and super-user setup is authorized for paul@parkscomputing.com. The ingress rule for xfer.parkscomputing.com is in `config.yml` and validates. The cloudflared service needs an administrator to restart, which is Paul's to do. Until `xfer-site/site` has a `sitenav.xfer`, the site shows an empty desktop.

**Sections 4 and 5 wait for `xferlang` 0.1.0-next.5** on npm. On 2026-10-22 the newest was 0.1.0-next.4. The Editor and the terminal will be done together from one vendored copy, rather than vendoring next.4 for the Editor and replacing it days later.

**Section 6** comes after: `/diag/<code>` needs a look at whether `Site:PageUrl` and the slugs can produce it, and the note on which parts of the applet contract a site's own applet may use belongs with that work.
