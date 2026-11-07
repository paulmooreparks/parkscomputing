# Start heading spacing and launcher selection feedback

Paul requested these changes during review of parkscomputing.com's PUDL 0.99.0 content launcher on 2026-11-06. The distribution is unchanged at `68fcc2b6031539cc27f0c33d0e7a336e1c8d621c`. The host fixes are on beta; production has not received the launcher layout.

## Heading spacing

The items pane's category heading, such as All, sits too close to the top rule in the default Start layout. The host now gives `.start-heading` `padding-block: var(--space-3) var(--space-2)`. This is a general Start presentation issue. The requested upstream change is a balanced vertical inset on that heading, including the count, across both category placements and narrow layouts.

## Selection feedback

The launcher currently dismisses an unpinned popup synchronously when a destination is activated. Paul wants the selected item to flash a background highlight briefly before dismissal, making the accepted choice visible.

The host currently intercepts plain activation of window destinations and launcher-header actions, adds an accent background for 180 ms, then replays the destination's normal click. That keeps the existing window, account-dialog and launcher handlers in charge after the feedback. Repeated clicks during the pending activation are ignored. Modified clicks and unmanaged native new-tab links retain synchronous browser behavior. The highlight is static rather than an animation.

This belongs in a documented PUDL activation-feedback contract so hosts do not need to coordinate their own timing with the controller's synchronous dismissal. The upstream design should cover pointer and keyboard activation, disabled items, double activation, pin/popup behavior and reduced-motion preferences. It must preserve native modified and new-tab link behavior and avoid relying on transient user activation surviving a timer. Whether destination execution is deferred or only dismissal is deferred should be explicit.

## Evidence and boundary

`Tools/test-launcher.js` passes against beta in Chromium. It checks heading inset, a selected item's highlighted state while the launcher is still visible, subsequent activation/collapse, keyboard activation, window preservation and the existing popup, pin, phone and filter behavior. Screenshots are in `.local/beta/uitest/launcher-pinned.png`, `launcher-desktop.png` and `launcher-phone-open.png`; the original review screenshots are in this conversation. The host style and adapter are `wwwroot/css/pudl-site.css` and `wwwroot/js/launcher.js` under `Application/parkscomputing-engine`.

The sign-in dialog's reordered passkey and bottom actions are site-owned. They are verified separately and are not part of this PUDL request.

The proposal and a beta screenshot were sent to PUDL Team Lead on 2026-11-06 as bus message 5247. PUDL 0.100.0 implements the shared heading inset and activation-feedback contract. The beta adapter now uses `pudlLauncher.activated(root, actionElement)` and `data-launcher-activate`. The original operation executes synchronously, and PUDL supplies the static selection highlight and defers only popup dismissal for 180 ms. The local heading override and click replay have been removed. On a phone, the host defers its pinned-to-collapsed layout change for the same interval so the chosen window becomes visible. The paragraphs above retain the original proposal and temporary implementation history.
