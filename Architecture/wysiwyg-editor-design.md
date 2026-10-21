# The visual editor: editing an article as the site shows it

Status: accepted, 2026-10-17, with Paul's decisions below; building in the order of work. The MCP work (Architecture/applet-platform-design.md) is pinned at its next step, the queue to the admin's desktop, while this is built.

## Decisions (Paul, 2026-10-17)

1. Shortcodes use GK's syntax, `{{name:args}}` and `{{name:args}} … {{/name}}`.
2. The visual view covers Markdown articles and book chapters first; HTML articles keep Text and Preview.
3. The visual view shows and types curly quotes, and untouched text keeps its straight quotes in the file.
4. The beta article workspace is retired, and the brochure site editor (padmajairam.com) moves onto the one renderer and the new editor.
5. Every proposed shortcode is in the first build: the GK ports (notices, expand, status, toc, anchor, page, children, include) and the site's own (figure, applet, video, code, score, tagged, latest, kbd, glyph, columns, draft-note).
6. The existing Markdown articles should edit in the new Editor as they are, and may also be cleaned up, with shortcodes replacing hand-written HTML, as long as what a reader sees stays identical or so close as not to matter. Each cleanup is checked by comparing the page's rendered article before and after.

Paul asked for GK Companion's WYSIWYG editor on parkscomputing.com, with shortcodes that the site engine renders to HTML, new shortcodes that make editing the site easier, and one hard rule: the editing view must look exactly like the published article, so the editor and the site share one renderer. Text mode and split mode stay.

## What exists

**On parkscomputing.com** articles are Markdown (`content/{slug}.md`, with front matter) or HTML (`content/{slug}.html`). Paul edits them in the Editor applet (CodeMirror 6), whose Preview posts the unsaved text to the server and shows `/preview/{token}?frame`, rendered by the real page code. Markdown becomes HTML on the server with Markdig, and the browser then changes the article further: highlight.js colours code, `pudl-code.js` wraps each block in a strip with Copy and Download, Mermaid draws diagrams, applets mount on `data-applet`, `code[data-code-src]` fetches its listing, and images get the lightbox.

Six different Markdig configurations exist today. The page and the desktop window share one (pipe tables, task lists, auto links, emphasis extras, SmartyPants, media links, GitHub-style heading ids and generic attributes). The beta article workspace, the brochure site editor, the Terminal, the policy pages and comments each use another. There is no JavaScript Markdown renderer anywhere in the project.

Paul's Markdown articles lean on raw HTML for what Markdown can't say. The live content has 41 hand-written `<figure>` blocks with inline styles, an iframe in a centred `div`, a raw table, and links with generic attributes. HTML articles embed applets (16 of them), carry their own scripts and styles, and keep old WordPress markup.

**In GK Companion** the editor has four views: Visual, Text, Split and Preview. Markdown with `{{shortcode}}` syntax is the stored form. The Visual view is ProseMirror (vendored as a 258 KB bundle, MIT), and all parsing and serialising happens on the server (Go), not in the browser:

- The server splits the Markdown into blocks. A block is edited as rich text (paragraphs, headings, lists, tables, emphasis, links) only if it comes back byte for byte after a round trip; anything else is a source block, drawn as the preview draws it and edited as Markdown in place.
- Containers such as panels and expands are drawn with the preview's own frame around an editable body. Inline shortcodes are atoms whose HTML comes from the preview.
- An untouched block is written back as its original text, so opening and saving a file never changes what wasn't edited. A corpus of 413 real documents round-trips byte for byte, and the test is a gate.
- The preview is "true by construction": it runs the publish conversion and turns the result into HTML, so no shortcode has a second renderer.

GK's shortcodes are registered in one table, each with its syntax, its parameters (for completion) and its renderer. Most target Confluence: panels (`info`, `note`, `tip`, `warning`), `expand`, `status`, `toc`, `anchor`, `page`, `include`, `excerpt`, `children`, `jira`, `mention`, `date`, `attachment`, `layout`, `raw`, review comments and change marks.

## The proposal

### One renderer, on the server

The site's Markdig pipeline is the only renderer, and the visual editor never renders Markdown itself. A JavaScript renderer in the editor would be a second renderer, and its differences are exactly the friction Paul wants to avoid. GK reached the same answer for the same reason.

The first step is a single `SiteMarkdown` service: the page, the desktop window, the draft preview and the visual editor all render through it, with the shortcodes as Markdig extensions inside it. The Terminal's text view and the policy pages can use it too; comments keep their stricter configuration on purpose.

### The editing surface is the page itself

The visual view is the article's own page, the draft preview the Editor already shows, with the editor attached to the article body. The title, date, tags, fonts, widths, colours and every stylesheet are then the page's, not a copy of them. Blocks the editor draws from server HTML go through the same client steps as the published page (highlighting, the code strip, Mermaid, applets, listings), called from the functions `site.js` and `desktop.js` already use rather than repeated in the editor. An applet embedded in an article runs in the editor, as it does on the page.

### How editing works

The model is GK's, ported:

- Markdown stays the stored form, and Text mode is the Editor's CodeMirror view, as now.
- The server parses the Markdown with Markdig's own syntax tree, with precise source positions, into blocks. Each block has its source text and its HTML from `SiteMarkdown`.
- Paragraphs, headings, lists, tables, emphasis, inline code and links are rich text in ProseMirror. A block becomes rich only when it round-trips exactly. Code blocks, raw HTML, figures and anything unusual are source blocks: the visual view shows the server's HTML, and a click opens that block's Markdown in place.
- Shortcode containers (a panel, an expand) show their rendered frame around an editable body; inline shortcodes are atoms showing their rendered HTML.
- The server writes the document back to Markdown. An untouched block keeps its exact text. A gate test round-trips every live Markdown article and book chapter byte for byte before the visual view ships.
- PUDL's editing toolbar (0.61) gives formatting, and a `/` menu inserts shortcodes, with completion from the shortcode table.

**Split mode** is Text beside Visual, kept in step as GK keeps them: a change in either side updates the other after a short pause. **Preview** stays as a read-only view of the same page, for reading without the editor attached.

**Typographic quotes** need one rule, because SmartyPants turns straight quotes into curly ones on the page, and rich text in the editor would otherwise show them straight. The proposal is that the visual view shows and types curly quotes, which the page renders the same, while an untouched block keeps its straight quotes in the file.

### Shortcodes

The syntax is GK's, `{{name:args}}` for an inline shortcode and `{{name:args}} … {{/name}}` for a container, so GK's editor code works unchanged and text moves between the two tools. Each shortcode is one entry in a table in the engine: its syntax, its parameters with descriptions (which drive completion and the `/` menu), and its renderer. A shortcode the table doesn't know renders as itself, visibly marked, so a typo shows rather than vanishing.

**From GK, rendered to the site's HTML:**

| Shortcode | Renders as |
|---|---|
| `{{info}}`, `{{note}}`, `{{tip}}`, `{{warning}}` … `{{/…}}`, optional title | PUDL notices, with glyph and colour |
| `{{expand:Title}} … {{/expand}}` | a `<details>` disclosure |
| `{{status:green Done}}` | a PUDL status badge |
| `{{toc}}` | a contents list from the article's headings |
| `{{anchor:name}}` | an anchor to link to |
| `{{page:slug}}` | a link to a site page, titled from sitenav, opening as a window in the window view |
| `{{children}}` | the pages of a section or the chapters of a book |
| `{{include:slug}}` | another page's body, for text shared between pages |

The Confluence-only ones stay behind: `jira`, `mention`, `attachment`, `raw`, `layout`, review comments and change marks. Raw HTML already does what `raw` does here.

**New, for editing this site:**

| Shortcode | Renders as | Why |
|---|---|---|
| `{{figure:src=/images/x.png alt="…" width=80%}} caption {{/figure}}` | the site's `<figure>`, `<img>` and `<figcaption>` | Replaces the 41 hand-written figure blocks and their inline styles |
| `{{applet:conway fit=flow}}` | an applet mount (`data-applet`) | Embeds an applet in a Markdown article, which today needs an HTML article |
| `{{score:simple/Frere Jacques.musicxml}}` | Sight Reader opened on that score | Music in an article, readable in place |
| `{{video:youtube ID}}` | a privacy-respecting embed | Replaces the hand-written iframe |
| `{{code:/path/to/file.cs}}` | a listing fetched from the file | Markdown's way to the `data-code-src` listings HTML articles use |
| `{{tagged:travel}}`, `{{latest:5}}` | a list of articles under a tag, or the newest | Index pages that stay current without editing |
| `{{kbd:Ctrl+C}}`, `{{glyph:check}}` | PUDL's key cap and glyph | Small things now written as raw HTML |
| `{{columns}} … {{column}} … {{/columns}}` | PUDL's grid | Side-by-side content without CSS in the article |
| `{{draft-note}} … {{/draft-note}}` | nothing on the page; a tinted note in the editor | Notes to self that never publish |

### What the visual view covers first

Markdown articles and book chapters come first. HTML articles keep Text and Preview: they are whole documents with their own scripts and styles, and a visual view for them would need a second model. An HTML article can move to Markdown once the shortcodes above cover what it does; the applet, video and code shortcodes exist for that.

### Order of work

1. **One pipeline and the shortcode table.** `SiteMarkdown` replaces the page, window and preview configurations, with the shortcode framework and the first shortcodes (figure, notices, expand, toc, applet, page). This is useful by itself: the Editor's existing Preview shows shortcodes at once, and figures become one line.
2. **The document model on the server.** Blocks with source positions and HTML, the writer that keeps untouched blocks exact, and the round-trip gate over every live article and chapter.
3. **The visual view.** ProseMirror (GK's bundle), attached to the article body in the draft page, with rich text, source blocks, containers and atoms; PUDL's editing toolbar; the `/` menu.
4. **Split mode,** and the Editor's views settled as Text, Visual, Split and Preview.
5. **The remaining shortcodes,** and moving HTML articles to Markdown where Paul wants to.

## As built

**Step 1, one renderer and the shortcodes (2026-10-17).** `Pages/Services/SiteMarkdown.cs` is the site's one Markdown renderer, a singleton the article page and the desktop window now both use; the editor's preview already renders through the page. Its pipeline is the one the page and the window had, plus precise source positions and the shortcodes. `Pages/Services/Shortcodes.cs` is how Markdig finds them: a block parser for a container's tags, each alone on its line, an inline parser for `{{name:args}}`, and a paragraph renderer that writes a block shortcode alone on its line without a `<p>` around it. `Pages/Services/SiteShortcodes.cs` is the table: every shortcode's kind, parameters, description, example and renderer, which the editor will read for its insert menu. A shortcode written wrongly renders as itself, marked `sc-problem` and underlined, with the reason as its title.

Shortcodes render to PUDL's notices and badges, and to plain HTML that `css/pudl-site.css` styles in an article (`sc-*` classes). An applet an article embeds may say what it opens on (`data-applet-initial`); `js/site.js` hands that to PUDL's `pudl:applet-state` when the host keeps no state of its own, which is how `{{score}}` opens Sight Reader on its score.

Checks: 14 unit tests (`SiteMarkdownTests`), among them one that Markdown without shortcodes renders exactly as the old pipeline rendered it. `Tools/compare-article-render.js` compared every live Markdown article, draft and book chapter (102) as production rendered it before the change with the new renderer: all 102 were byte for byte the same. The same tool will check each article cleanup. `content/drafts/shortcodes.md` shows every shortcode as it renders and as it is written.

**Steps 2 to 4, the document model, the visual view and Split (2026-10-17).**

`Pages/Services/EditorDocument.cs` holds an article as the editor does, on the server. Load splits the Markdown into its top-level blocks, each with its exact text and the space after it, so the parts always give the file again byte for byte. A paragraph, an ATX heading, a list of paragraphs and lists, or a container shortcode around those is rich text in ProseMirror's JSON, but only when writing it back from that JSON renders as the original does (entities decoded, heading ids aside). Anything else is a source block, carrying the HTML the page renders for it, which `SiteMarkdown.RenderBlocks` takes from one render of the whole document, so ids, contents lists and references are the page's. Serialize writes an edited block back as Markdown. A container carries its rendered frame, so the editor draws the page's own notice or expand around the body it edits. Over the live content, 103 articles and chapters and 4,367 blocks, 81% of the blocks are rich, and every article written back from its rich blocks renders as before (the unit test `TheLiveArticlesRoundTrip`, run with the content folder mounted).

`Identity/EditorController.cs` serves it to the admin who may use the server's tools, at `/api/admin/editor`: `document`, `serialize`, `inline` (a shortcode typed in a line) and `shortcodes` (the table, for the insert menu).

The visual view is `js/editor-visual.js`, which the Editor loads into the article's own draft page, the preview it already made, with ProseMirror (GK Companion's 1.42 bundle, MIT, in `js/vendor/prosemirror-1.42`). The editor takes the place of the article's body, so the page around it, its header, fonts, widths and stylesheets, is the page's own. The schema's elements are the ones Markdig writes; a source block, a shortcode and a container's frame are the server's HTML, given the page's own finishing steps through `pcEnhanceArticle`, which `js/site.js` now provides and the desktop's windows use too. Quotes curl as they are typed. A shortcode typed in a line becomes one when its `}}` closes it. Double-clicking a source block opens its Markdown in place; double-clicking a container's frame or a shortcode changes its arguments.

Every top-level node carries the uid of the block it came from, and a node equal to the one loaded keeps that block's exact text, so an edit writes back only the blocks it touched. The Editor puts the result into its text as the least change, which keeps the cursor and the undo history meaningful in Split.

The Editor's Preview button became a switch: Text, Visual (the page alone, to edit), Split (the text beside the page, each following the other) and Preview (the text beside the page, to read). Visual and Split are for a Markdown article at the top of `content/`; an HTML article has Text and Preview. A formatting bar (bold, italic, strike, code, link, paragraph, headings, lists, and an insert menu of the shortcodes) shows in Visual and Split.

Checks: `Tools/test-visual-editor.js` (17, on the test instance, as a super-user): the page as the editor, a container's frame, a code block, typing in a paragraph and in a container writing exactly what was typed, a shortcode typed in a line, bold from the toolbar, a source block's Markdown edited in place, Split in both directions, Preview and Text.

**The article workspace beta, retired (2026-10-17).** Its pages, `/articles/{id}`, `Publishing/` (store, sanitised renderer, import planner and the `article-import` command) and their tests are gone. The comment policy enum, which comments still use, moved to `Identity/CommentPolicies.cs`, and the policy pages split their front matter with `SiteMarkdown.SplitFrontMatter`. The migration `RetireArticleWorkspace` drops the seven article tables; production, padmajairam.com and its beta each had none of their rows filled. The account test that used the workspace as its staff-only page now checks the server's tools: a member gets 404, and a staff session that hasn't tapped a passkey can read but can't delete.

**The brochure editor's preview, on the readers' code (2026-10-17).** The brochure workspace's Preview (`Pages/SiteAdmin/Edit.cshtml.cs`) rendered a Markdown page with its own `UseAdvancedExtensions` pipeline and an HTML page with its own body extraction, so it could differ from what readers get. It now keeps the unsaved text as a draft (`PreviewDrafts`) and frames `/preview/{token}`, the page the readers' own code draws in the brochure layout, without the staff bar. On padmajairam's beta the preview's page body matched the live page's exactly, apart from the edit. The workspace's content policy allows framing the site's own pages for this.

The brochure editor does not have the visual view yet. Every one of padmajairam.com's 17 pages is HTML exported from WordPress, and the visual view edits Markdown (decision 2), so it waits on a choice between converting her pages to Markdown and giving the visual view HTML pages.

**The figure form and the formatting bar on the text (2026-10-18).** Pressing a figure in the visual view opened the page's lightbox. Now a picture in the editor never does (`data-no-lightbox`, set as the editor finishes the server's HTML), and a figure pressed opens a form in the Editor with the `{{figure}}` shortcode's settings: the picture's address, with Browse opening the standard Open dialog on the site's pictures, what it shows, its largest width and its caption. Insert offers the same form for a new figure. The form reads and writes the shortcode's call (`parseShortcode`, `buildFigure` in `editor.js`), with the server's quoting, and the visual view's host gained `figure(src)`. The formatting bar stays for a Markdown file in Text and Preview and works on the Markdown itself (`textFormat`): a mark wraps the selection, or comes off when it is already there; H2, H3 and the lists mark each selected line, and Paragraph takes the marks off; in Split it goes to whichever side has the keyboard. The visual editor test covers both (now 36 checks).

**Shortcodes in the text view (2026-10-18).** The vendored CodeMirror bundle was rebuilt from the same package versions (Paul approved the download) with `Decoration`, `ViewPlugin`, `MatchDecorator`, `WidgetType`, `hoverTooltip` and `autocompletion` added to its exports; a rebuild of the old entry first reproduced the old bundle byte for byte, so the new one differs only by the exports. In a Markdown file a `{{shortcode}}` is marked as one, with its name and braces in one colour and its arguments in another; typing `{{` offers the shortcodes' names, with the example as the completion's note, and inside a call a space offers the shortcode's parameters, all from the server's table that the Insert menu reads; the pointer over a shortcode shows its title, description and parameters. The braces close themselves as `{{` is typed, so a completion writes only the name, with a colon where arguments follow. The extensions are built when CodeMirror has loaded, since the Editor fetches it lazily. The visual editor test is now 41 checks.

**The language server (2026-10-18).** The counterpart for other editors is `ParksComputing.Engine.dll lsp [--root <wwwroot>]` (`Lsp/SiteLanguageServer.cs`), the Language Server Protocol over stdin and stdout, with no web host. It completes shortcode names after `{{`, with only containers after `{{/`, and a shortcode's parameters inside its call; it describes a shortcode under the pointer; and its diagnostics are the renderer's own: it renders the document through `SiteMarkdown` over the web root, collects every `sc-problem` the renderer wrote, and places each at the n-th place its source appears, so the problems an editor shows are exactly the ones the page would show. The web root is `--root`, or the nearest folder holding `sitenav.xfer`. Six unit tests cover completion, hover, diagnostics and the protocol over streams; `Tools/test-lsp.js` drives it as an editor would, and passed nine checks against the live content through the engine's image. `Tools/vscode-parkscomputing` is the VS Code extension that starts it, by default as `docker run -i … parkscomputing-local:dev … lsp --root /site` with the open folder mounted; building it needs `vscode-languageclient` from npm.

**Preview opens the page, each tab keeps its view, and the Editor keeps its session (Paul, 2026-10-18).** Paul asked whether a Preview view is needed beside Visual, and decided it is not: Preview now opens the page as it is on the site, as a window in the site's window view and a browser tab elsewhere, through the link that was "View on the site", and as the View menu's "Preview on the site", which keeps the key binding `preview`. Unsaved text is not on the site, and the status line says so when Preview is used with changes. The views are Text, Visual and Split, shown for a Markdown article only; an HTML article has its text and Preview. This revises decision 2 and the switch described above. Changing tabs had dropped the page view; each tab now keeps its own view, so the article comes back in Visual or Split when it comes to the front, and the snapshot keeps each tab's view. Paul also asked that closing the Editor and opening it again bring it back as it was: its snapshot is now also kept in this browser's storage as `pc-editor-session`, read when the Editor starts without a snapshot of its own, so its documents, the one in front, their unsaved text, places and views come back after the window closes, in another browser tab, or after the browser restarts. Since unsaved text survives closing, closing the window or leaving the page asks about it only when the session could not be kept. The first instance keeps the session; Settings' Forget clears it. `Tools/test-editor-session.js` (7) checks it; the visual editor test is now 42.

**Find and replace on the page, and a find bar in PUDL's parts (Paul, 2026-10-21).** Ctrl+F in the Visual view did nothing visible: the key went to the Editor, which opened CodeMirror's search panel in the text, hidden behind the page. Paul also found CodeMirror's own panel ugly. The Editor now has one find bar for both. It has the Find and Replace fields, sunken and lined up; Previous and Next; Match Case, Whole Word and Regular Expression as latching buttons; a count ("3 of 12", "No matches", "Not a valid expression"); Replace and Replace All; and Close. Enter finds the next match and Shift+Enter the one before; in Replace, Enter replaces it and Ctrl+Enter replaces them all; Escape closes the bar and gives the keyboard back. A narrow bar, such as the page's in Split, stacks its buttons under its fields.
- **In the text**, the bar is CodeMirror's search panel, made with its documented `search({ createPanel })`, so CodeMirror still highlights the matches, keeps the query with each tab and restores it after a reload. The vendored bundle was rebuilt from the same package versions with `findNext`, `findPrevious`, `replaceNext`, `replaceAll` and `closeSearchPanel` exported; a rebuild of the old entry first reproduced the old bundle byte for byte, and the Editor loads the new one as `?v=4`.
- **On the page**, the bar sits over the frame and drives a search the visual editor keeps (`api.search` in `editor-visual.js`). It is a ProseMirror plugin that searches each text block as the text it shows, with a shortcode or other inline object standing for a character no word matches, and marks every match, the one in hand more strongly. Replacing goes through ProseMirror, so it becomes text by the usual path. A source block's Markdown is not searched on the page; the text's search finds it.
- **Ctrl+F follows the reader.** In Visual, and in Split while the text does not have the keyboard, it opens the page's bar; otherwise the text's. The query carries over between them.

The same day, leaving Visual or Split put "The page could not be edited: this page has no article body to edit" on the status line. Emptying the frame loads a blank page into it, and its load was taken for the page to edit. Leaving now drops the frame's load handler and moves to a new view generation first. The visual editor test is now 60 checks, with eleven for find and replace in both views and one for the message.

Still to do: book chapters (the draft preview takes only an article at the top of `content/`), the brochure editor's visual view (above), and cleaning up the existing articles with shortcodes (decision 6).

## Rules this follows

The design relies on no undocumented behaviour: Markdig's source positions, ProseMirror and PUDL are used through their documented interfaces. The stored form stays plain Markdown that reads well without the editor, and untouched text is never rewritten. The editor's server endpoints are the super-user's, behind the admin mount's checks.

## The questions that were put to Paul

The proposal asked five questions, answered in the Decisions section above: the shortcode syntax, the visual view's first scope, curly quotes, the other two editors (the database-backed article workspace beta, which used its own sanitised pipeline, and the brochure site editor with a third), and which shortcodes to build.
