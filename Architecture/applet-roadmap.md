# Applet roadmap

Paul chose these on 2026-10-01 from a list of applets that would be good PUDL demonstrations and also useful in their own right. The work starts after the site has moved to PUDL 0.38.0, which ships PUDL's menu bar (`menu-bar-design.md`), so each applet is built on PUDL's menu bar from the first day rather than migrated to it.

## Before any of these

Both steps were done on 2026-10-01 (`pudl-adoption.md`, D53): the site runs PUDL 0.38.0's menu bar in place of its own, and the admin desktop at edit.parkscomputing.com has it too.

## The order Paul set

### 1. PUDL theme studio (public), built 2026-10-01

The studio is at `/page/theme-studio` (`js/theme-studio.js`, `css/theme-studio.css`). The reader edits the tokens PUDL's contract lets a theme set: page and text, accent and status, the top bar, and the lighting. Light and dark each have a preview, side by side, of PUDL's own components: a top bar, section tabs, buttons, a working menu, a segmented control, a switch, a card with badges and chips, form fields, status lines and code. Under the previews, each pairing that carries text shows its contrast ratio against WCAG AA's 4.5:1, with badge text mixed as `pudl.css` mixes it. The theme is written out as both palettes in full, as PUDL's contract asks a theme to set them, and the reader can copy it, save it as a file, or open a theme file to go on editing it. The address keeps only the tokens that differ from PUDL's, so a link shares a theme.

The previews are their own page (`theme-studio/preview.html`) in frames, one per palette. PUDL computes its derived tokens on `:root` from the palette, so a palette set on an element inside the studio's page would leave the raised gradients, sunken fields and focus rings behind; set on a frame's root, it reaches them all. The studio reads PUDL's own values from the frames, so it starts from whichever release the site has pinned.

The menu bar and windows themselves are not in the preview yet: both need PUDL's scripts and a page of windows, which the preview page would have to grow into.

### Background for the window view (Paul, 2026-10-01)

The admin desktop's Settings can give the window area a colour or a picture (`js/settings.js` and `js/admin-desktop.js`, kept in `~/.config/desktop.json`). Paul suggested the same for the public site's window view. There it would live in the browser, as the public Settings' other choices do, with a picture taken from the reader's own files in the browser's file system. Paul put it off on 2026-10-01, after the theme studio.

### 2. Diff viewer (public), built 2026-10-01

The viewer is at `/page/diff` (`js/diff.js`, `css/diff.css`). Each side is typed or pasted, or opened through the file browser's Open dialog, which reaches the site's files and the reader's own and has "From your computer" for a file on disk. The comparison shows side by side or in one column, with a minus or a plus on each changed line as well as its tint, and the words that changed within a line marked. Ignore spaces treats lines that differ only in their spacing as the same. Unless Show every line is on, only the changes show, with three lines around each and a note where lines are left out. The address keeps the view and its choices, two files of the site by their paths, and texts up to 2,000 characters between them; longer pasted texts are not kept, and the viewer says so.

The comparison is `js/textdiff.js`, `pcTextDiff.lines(a, b, { ignoreWhitespace })`, for the file history to use. It aligns lines with Myers' O(ND) algorithm after setting aside the lines the texts share at either end, then compares each changed line with its replacement word by word. Its memory grows with the square of the number of edits, so past 2,000 edits it stops aligning and shows all of each text as removed and added, and says so. Its checks are `Tools/test-textdiff.js`, run with Node and given the live web root, since that is not in the repository: `node Tools/test-textdiff.js <path to wwwroot>`.

### 3. Site health check (admin)

A report of what is wrong with the published site, each finding linking to its file, which opens in the Editor:

- pages in `sitenav.xfer` with no content file, and content files the nav never names;
- broken internal links and missing images;
- an applet file changed since its `ver` in `js/applets.js` was last raised;
- a stylesheet or script loaded with `asp-append-version` that changed since the server computed its hash, which means the container needs a restart.

The last two are the mistakes that cost the most time on 2026-10-01.

### 4. File history and restore (admin)

The server keeps each file's previous versions for 30 days before overwriting it (`admin-and-identity-design.md`). This applet browses them by file or by date, shows any version against the current file with the diff viewer's engine (2), and restores a version after a recent passkey tap, as every other change to the site's scripts and styles needs.

## Next, ahead of the list above (Paul, 2026-10-01)

Paul picked two ideas from a list of applets built on open APIs, and put them ahead of everything else, in this order:

1. **GitHub repositories in the site's file system**, browsable in Files, the terminal, the Editor and the Diff Viewer, with sign-in from the start. The design is `github-mount-design.md`.
2. **A phone barcode scanner with Open Food Facts.** It installs on a phone like Sudoku, on iPhone and Android alike, and scans with the camera both product barcodes, which it looks up in Open Food Facts (ingredients, nutrition, Nutri-Score, allergens, and two or three products side by side), and the barcodes the Barcode Tool makes, which it reads back through the tool's layouts. Decoding is ZXing, vendored like CodeMirror and xterm, since Safari has no built-in barcode detector and GS1-128 needs its FNC1 reported in a documented way.

## Retail tools (proposed 2026-10-01, not yet placed)

Paul asked for applets in the Barcode Tool's vein, useful to a retail consultant, a retail QA engineer or a retail developer, and said he would come back to them. In the order I proposed:

1. **Scanner input inspector.** Scan into a field and see every character the scanner typed, the invisible ones too (prefix and suffix, the GS separator between GS1 fields, AIM symbology identifiers such as `]C1`), the time between keystrokes, and the data parsed as GS1 application identifiers with the Barcode Tool's engine.
2. **Tax and rounding calculator.** Line items worked out under the usual rule choices side by side (prices with or without tax, tax per line or on the total, half up or half even, cash rounding to 0.05 or 0.10), showing where the totals part and by how much.
3. **Promotion and discount-spread simulator.** A basket and its promotions, which apply and in what order, how each discount is spread across the lines, and what a partial return refunds.
4. **Transaction log viewer.** An ARTS POSLog transaction drawn as a receipt beside its element tree, with search.
5. **Payment data decoder.** EMV tag-length-value hex from a terminal log, decoded with tag names and nested templates.
6. **Receipt printer preview.** ESC/POS bytes drawn as the receipt they print, with every command listed.
7. **Test data generator.** Batches of valid GTINs, price-embedded EAN-13s for a layout, SSCCs, check-digit loyalty numbers and the card schemes' published test numbers, as CSV or a printable sheet of barcodes.

Further out: a ZPL shelf-label preview, and a till count. My picks were the first three, in that order.

## Kept for later

These were on the same list and are still good ideas.

- **XferLang playground** (public): XferLang on one side and its parsed tree on the other, with errors placed on their lines, and conversion to and from JSON.
- **Meeting planner across time zones** (public): rows of cities against a sliding grid of hours, working hours shaded, the selection in the address.
- **GS1 Digital Link and QR generator** (public): the Barcode Tool's two-dimensional companion, sharing its layout library.
- **Navigation editor** (admin): a structured editor for `sitenav.xfer`, in the manner of the barcode layout editor, with the raw XferLang kept as an advanced view.
- **Comment moderation queue** (admin): approve, reject or reply, once comments land.
- **Audit log viewer** (admin): a filterable grid of admin actions, each linked to its file and its history.
