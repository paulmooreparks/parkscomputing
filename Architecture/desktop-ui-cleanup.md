# Windowed interface cleanup

Paul requested these changes on 3 October 2026 to bring Parks Computing into line with YAVCHN's cleaned-up interface. The canonical principles remain in [Architectural Principles](<C:/Users/paul/OneDrive/Documents/Architectural Principles.md>).

The taskbar belongs to the whole workspace and sits below the sidebar and the window area. Its sidebar button follows YAVCHN's behavior. On wide layouts it hides the sidebar without changing any windows and remembers the choice locally. At 640 pixels or less, it minimizes visible windows to reveal the list and restores the surviving windows that were visible, with the previous front window raised last. Window actions and viewport changes refresh the button's label, pressed state, expansion state, and availability. With no open windows on mobile, the button is disabled.

The Articles back link above the window area is removed because the taskbar's sidebar toggle provides that navigation.

The View menu includes the sidebar command and uses the same action and availability as the taskbar button. Both labels follow the current layout and window state. The shell loads PUDL's tooltip script so the button's current action appears on hover and keyboard focus.

The initial sidebar splitter was an 18-pixel band, matching the thickness of YAVCHN's article/discussion divider. Collapsing the sidebar leaves this band visible. On wide layouts, dragging it reopens and resizes the sidebar; dragging back to the edge collapses it. Collapsed content is inert and absent from keyboard navigation. Arrow keys resize, Home collapses, End opens to half the workspace, Enter toggles, and a double-click restores the default width. On phones the splitter remains visible and an inward drag reveals the list using the same minimize/restore behavior as the sidebar button. This site-owned splitter replaces the stock master-detail resize handler because it must also manage collapse state.

Settings declares `data-applet-window-size="content"` on its own HTML mount, as Barcode Tool, Barcode Scanner, and Dice do. The server translates that applet-owned declaration into PUDL window markup before first paint. Navigation entries do not declare sizing mode, and removing the Settings entry from Applets does not affect its Parks Computing menu entry.

Settings supplies its own identity menu in both public and admin modes. This prevents PUDL's article-menu fallback from adding File and Print to a settings surface.

The topbar uses YAVCHN's light and dark neutral colors. PUDL 0.42.0 supplies the menu groups and light-theme topbar surface without site overrides. The view selector uses PUDL's own segmented-control treatment. The displayed view name is Windowed; existing `view=window` addresses and stored values remain compatible. The Window menu retains its standard name because it manages windows.

Task buttons show a navigation entry's associated icon where one is supplied. Otherwise, article buttons show the site's 16-pixel favicon and applet buttons show PUDL's app glyph. Titles retain their text and truncate within the taskbar. Icon decoration refreshes after PUDL rebuilds the dock, including changes to window titles and new applet instances.

The source checkout and the live content directory are separate. Deployment updates the selected assets under `C:\Users\paul\OneDrive\Documents\parkscomputing.com\wwwroot` and rebuilds the server image for Razor changes.

The Docker build succeeded. Browser integration checks passed against localhost and the public HTTPS site at desktop and phone widths. Those checks cover taskbar bounds, sidebar persistence, preservation of desktop window state, selective mobile restoration, automatic button updates after minimize and close actions, task icons, both themes, and Classic view naming. Screenshots of the light, dark, and mobile layouts were inspected.


PUDL 0.43.0 supersedes the local splitter mechanics described above. The site now uses PUDL's persistent `.md-resize` divider with its 24-pixel target, a 300-pixel default sidebar, and a 40-pixel expanded minimum. PUDL manages focus and accessibility. Application-owned mobile restoration is recorded in the URL, so it survives reloads. D57 in [the adoption record](pudl-adoption.md) describes the integration boundary.


## Applet sizing and framed article activation

The window lookup previously traversed only `nav` entries, excluding the separate `menu` tree. A menu link could open Settings by slug while the window endpoint read its sizing from the Applets entry. Removing that entry left the endpoint with no navigation metadata, even when the menu entry declared the same metadata. Duplicate sharing within the navigation tree was a separate behavior. Lookup now falls back to menu entries after navigation entries, preserving the existing navigation precedence while supporting menu-only pages.

The `size` navigation property and its duplicate-sharing logic are removed. The applet's HTML document owns sizing mode through `data-applet-window-size="content"` on its mount. The server recognizes the declaration only on an applet page; an article embedding an applet does not inherit content sizing. Unknown or absent values use the ordinary resizable frame. Both initial desktop rendering and the window endpoint use the same parsed content metadata, including numbered applet instances. Initial placement and pixel limits remain separate existing navigation fields.

HTML articles with their own assets run inside same-origin frames. Their pointer events do not bubble into the desktop document, so PUDL's parent-document activation listener never received those clicks. The framed page now raises its containing window through PUDL's public API on a primary pointer press, without canceling the event. This preserves the input's normal focus and click behavior. Foreign frames are outside this bridge.

The regression browser checks cover content sizing without an Applets navigation entry, initial and fetched windows, numbered instances, repeated activation of the Excel capacity article, and first-click input focus inside its frame.

The Docker build and browser regression checks passed on staging, localhost, and parkscomputing.com. Staging removed only the Applets Settings entry and verified that the surviving menu entry still supplied its initial placement metadata and that applet-owned content sizing remained intact. The broader desktop/mobile suite also passed in staging.
