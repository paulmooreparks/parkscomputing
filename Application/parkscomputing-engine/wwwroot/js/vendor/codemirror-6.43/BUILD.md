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

It was rebuilt on 2026-10-07 from the same package versions, with `Transaction`, `historyField`, `searchPanelOpen`, `getSearchQuery`, `setSearchQuery` and `SearchQuery` added to the exports, so the editor can keep its undo history and its search across a reload. Before the change, a rebuild from those versions matched the old bundle byte for byte. Installing exact versions needs `--save-exact` and npm `overrides` for the indirect packages, at the versions `LICENSE.txt` lists.

The main versions are `@codemirror/view` 6.43.13 and `@codemirror/state` 6.7.6; `LICENSE.txt` lists every package in the bundle with its version and licence. The bundle is about 600 KB, or 200 KB compressed, most of it the Markdown language, which brings in the HTML, CSS and JavaScript highlighters for HTML inside Markdown.

To upgrade, repeat the build in a scratch directory with the new versions, replace the three files here in a new directory named for the `@codemirror/view` version, and update the path in `js/editor.js`.

It was rebuilt again on 2026-10-18 from the same package versions, with `Decoration`, `ViewPlugin`, `MatchDecorator`, `WidgetType` and `hoverTooltip` from `@codemirror/view` and `autocompletion`, `completionKeymap`, `startCompletion` and `acceptCompletion` from `@codemirror/autocomplete` added to the exports, for the shortcode highlighting, completion and hover in the editor's text view. A rebuild of the previous `entry.js` first matched the old bundle byte for byte. The bundle grew to about 630 KB. The editor loads it with `?v=3`.

It was rebuilt again on 2026-10-21 from the same package versions, with `closeSearchPanel`, `findNext`, `findPrevious`, `replaceNext` and `replaceAll` from `@codemirror/search` added to the exports, for the editor's own find bar, which CodeMirror's `search({ createPanel })` puts in its panel. A rebuild of the previous `entry.js` first matched the old bundle byte for byte. The editor loads it with `?v=4`.
