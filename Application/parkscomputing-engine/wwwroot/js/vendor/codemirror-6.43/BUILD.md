# CodeMirror 6 for the site's editor

`codemirror.js` is CodeMirror 6 (MIT), bundled once from npm and vendored unmodified. It defines the global `CM` with the exports listed in `entry.js`. The editor applet (`js/editor.js`) loads it only when the editor opens.

Built on 2026-09-29 with esbuild 0.28.2:

```
npm install esbuild @codemirror/state @codemirror/view @codemirror/commands \
  @codemirror/language @codemirror/search @codemirror/lint @codemirror/autocomplete \
  @codemirror/lang-markdown @codemirror/lang-json @codemirror/legacy-modes @lezer/highlight
npx esbuild entry.js --bundle --format=iife --global-name=CM --minify \
  --legal-comments=eof --outfile=codemirror.js
```

The main versions are `@codemirror/view` 6.43.13 and `@codemirror/state` 6.7.6; `LICENSE.txt` lists every package in the bundle with its version and licence. The bundle is about 600 KB, or 200 KB compressed, most of it the Markdown language, which brings in the HTML, CSS and JavaScript highlighters for HTML inside Markdown.

To upgrade, repeat the build in a scratch directory with the new versions, replace the three files here in a new directory named for the `@codemirror/view` version, and update the path in `js/editor.js`.
