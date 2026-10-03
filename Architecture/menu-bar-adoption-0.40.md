# PUDL 0.40.0 menu adoption

The site adopts the unmodified `v0.40.0` distribution and the [PUDL menu conventions](https://github.com/paulmooreparks/pudl/blob/v0.40.0/docs/MENU-BARS.md). This record supersedes the menu placement decisions from 1 October in `menu-bar-design.md` and `site-menu-design.md`. The implementation follows the [migration guide](https://github.com/paulmooreparks/pudl/blob/v0.40.0/docs/MENU-BAR-MIGRATION.md).

## Site menus

The public bar declares Parks Computing, Go, Applets, View, Window, Help in that order. The corresponding stable IDs are `site`, `go`, `applets`, `view`, `window`, and `help`. The server reads `menu-id` and `window-commands` from each Xfer menu title and renders PUDL's documented attributes. Labels can change without changing contribution routing.

| Previous placement | Current placement |
|---|---|
| Site identity included the resume under Quick Links. | Go holds the resume; the identity menu holds Home, About, and Site settings. |
| Applets followed View and Window. | Applets follows Go and retains the live catalog order. |
| Window contained three handwritten bulk commands. | PUDL generates supported active-window actions, bulk actions, and the open-window list. |
| Help held the Terminal Guide. | Help retains that guide and adds site and keyboard guidance. |
| Admin identity included tool launches and the public-site link. | Admin Applets launches tools, Go opens the public site, and identity retains settings and account operations. |

The admin default and shared `/etc/admin-menu.xfer` declare the same IDs and shared slots. Per-user menu overrides remain intact. Custom overrides need the migration guide if they omit shared contribution slots. The generated Window menu disappears when there are no windows. Classic pages do not declare a window-management menu.

The launcher activates existing single-instance tools without discarding their state. Terminal's Session menu explicitly offers New terminal here; the admin launcher already labels its terminal command New terminal. Guides remain under Help, and settings remain under the site identity.

## Applet menus

Explicit applet menus use a small site helper for identity operations. The helper gets fresh `pudlWindows.menuCommands(key)` capability snapshots and selects the documented page, sharing, and close actions. It adds no window-routing framework. Standalone applets can copy their current page URL and do not offer Close window. Close window remains separated and last. Surface controls remain available for frequent actions.

| Applet | Menu changes |
|---|---|
| Barcode Scanner | Working commands move from identity into File, Edit, and Scan. Installation remains in identity. Camera, Decode/Lookup, and layout remain on the surface. |
| Editor | File holds document creation, opening, saving, and Close document. Edit holds undo, redo, and search. View receives file-browser visibility, wrapping, and preview where supported. Go receives the existing CodeMirror go-to-line command. |
| Files | File holds applicable file and folder operations. Go receives folder navigation, View receives hidden-file visibility, and Help retains quick help and the guide. |
| Terminal | Settings remain in identity and explicitly apply to all terminals. Session holds clear-screen and new-terminal commands. The site provides the Terminal Guide once. |
| Barcode Tool | File and Layout remain; help moves from identity to the shared Help menu. |
| Theme Studio | Theme Studio, File, and Palette remain. Identity gains supported page, sharing, and close operations. |
| Diff Viewer | File holds opening and clearing, Compare holds swapping and whitespace comparison, and View receives layout and full-context controls. |
| Dice | Dice, Roll, and Set remain; its View contribution uses the stable ID. |
| Sudoku | Edit contains undo and redo. Game contains existing game operations; Help receives Sudoku help. |
| Conway | Simulation contains existing run, stop, step, and reset operations; Help receives game help. |
| Barcode Flash Cards | Deck contains reveal and shuffle. Go receives previous and next card. |
| Articles | PUDL supplies scoped sharing and close labels, with Print under File. |

Files calls the documented menu refresh API when its available actions change, so a newly populated File menu appears after folder navigation.

File and Edit have explicit standard IDs. Contributions use lowercase stable IDs. Go-to-line advertises Ctrl+Alt+G and retains applet scope. Existing editor line numbers remain fixed; this migration does not invent a line-number setting or an editor help feature that the applet did not have.

Some maintained live assets were absent or older in the repository, including the Barcode Tool menu implementation and the Dice, Diff Viewer, and Theme Studio scripts. Their current source and matching styles are included with this migration so menu changes preserve existing live functionality. Applet registry versions are advanced in both locations without replacing unrelated live registrations.

## Verification

`Tools/test-site-menus.js` exercises the running site with Playwright. It checks standard ordering with and without content, the applet menu inventory, title and glyph toggles, hover switching, keyboard dismissal and focus, contributed commands and shortcut scope, content-sized window capabilities, source removal, unsaved editor close cancellation, and collapsed mobile navigation. `Tools/test-barcode-scanner-window.js` checks that the scanner still sizes its window to content.

The production image is built with the repository Dockerfile. The live mounted assets are updated and the container is recreated so ASP.NET asset hashes refresh. The PUDL files are compared against the tagged distribution. Existing unrelated working-tree edits remain outside this migration.

The menu integration checks passed in Chromium, Firefox, and WebKit. They also verify two Terminal instances, identity-link scope, Files menu refresh after navigation, and that menu interaction leaves browser history unchanged. Scanner decoding, lookup privacy, camera cleanup, image round trips, and content-sized window checks passed. The release image built successfully with the existing NuGet advisory and nullable-reference warnings.

The admin parser recognizes empty contribution slots by their stable menu identity or generated-window declaration. It continues to distinguish legacy logo-only menus, whose leaf entries have no title identity. The admin menu unit tests cover both forms.
