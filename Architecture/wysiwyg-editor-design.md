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

Still to do: book chapters (the draft preview takes only an article at the top of `content/`), the brochure editor (decision 4), and cleaning up the existing articles with shortcodes (decision 6).

## Rules this follows

The design relies on no undocumented behaviour: Markdig's source positions, ProseMirror and PUDL are used through their documented interfaces. The stored form stays plain Markdown that reads well without the editor, and untouched text is never rewritten. The editor's server endpoints are the super-user's, behind the admin mount's checks.

## The questions that were put to Paul

The proposal asked five questions, answered in the Decisions section above: the shortcode syntax, the visual view's first scope, curly quotes, the other two editors (the database-backed article workspace beta, which used its own sanitised pipeline, and the brochure site editor with a third), and which shortcodes to build.
