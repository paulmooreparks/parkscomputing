# Folded launcher discoverability

## Review status

PUDL Team Lead accepted Open launcher and `data-menubar-launcher-label` in bus message 5257 on 2026-11-06. The correction is scheduled after the current window-stack candidate. The expanded identity and section heading will retain the site name, and the existing request, cancellation and focus path will be preserved. Glyph selection remains pending review of the shared catalog. No implementation or release is claimed. View > Open launcher remains available until the shared contract is published.

## Problem

The frozen, unreleased taskbar candidate `dfccc91cbc7b5cada258ff81c0b04056923c8c5a` now implements this correction and is deployed on beta.parkscomputing.com. The folded label was verified in Chromium, Firefox and WebKit. Publication and production adoption remain held for beta review.

On parkscomputing.com's PUDL 0.100.0 beta, narrowing the viewport folds the menu bar into its combined menu. That menu shows Parks Computing as both its section heading and the launcher action. Paul reported that he could not readily find how to reopen the launcher. The site identity makes sense on the expanded button, but the folded action needs to name what it opens.

The launcher branch in `pudl-menubar.js` currently builds the combined-menu action from the identity title's label and does not carry a glyph. The published launcher documentation provides no separate folded-action label. This finding comes from the rendered beta screenshot and inspection of the tagged source; no upstream change has been implemented or tested.

## Proposed contract

The folded launcher action should default to the localized label Open launcher and a shared launcher glyph. The expanded identity button should retain the host's site name and logo. The combined menu's host section heading should also retain the site name.

Hosts should be able to provide a localized folded label through a documented attribute on the real menu bar, provisionally `data-menubar-launcher-label`. PUDL should define the glyph and its fallback centrally. If there is no dedicated launcher glyph, the release should choose an existing suitable glyph and document it. A host should not need to rewrite generated menu nodes.

This changes presentation only. The action should continue through the existing launcher request path, with the same cancellation, focus, invoker and pin/popup behavior. It must not create a second launcher or navigation destination. Menu bars without `data-menubar-launcher` should keep their existing identity-menu behavior.

## Verification

- The folded menu should show the site heading once and a distinct Open launcher action with its glyph.
- Pointer and keyboard activation should reopen the same launcher and preserve existing window state.
- Opening and closing should retain the documented focus behavior in closed, collapsed, popup and pinned presentations.
- Resizing repeatedly between folded and expanded layouts should preserve the site identity and the configured folded label.
- A localized label should appear in both the visible action and its accessible name.
- Ordinary identity menus should remain unchanged when launcher integration is absent.
- Source and minified builds should pass the focused checks in supported browser engines, with light, dark and narrow-layout screenshots.

## Requested next step

PUDL Team Lead should review the default wording, localization hook and glyph choice, then schedule the shared change. Parks Computing will adopt the published contract after release. The current beta keeps View > Open launcher as an additional route while this proposal is pending.
