# Proposal to PUDL: a field in a toolbar keeps its own keys

Status: closed the same day by PUDL 0.70.1, which the site took as D77 in `pudl-adoption.md`; Sight Reader 1.2.1 drops its workaround.

From parkscomputing.com, 2026-10-21, after moving the Sight Reader's bar numbers back onto its toolbar in a group marked `data-toolbar-keep`, which 0.69.0 added "such as one holding a field".

## The problem

PUDL's toolbar is one stop in the Tab order. Left and Right move along its controls, Home and End go to its ends, and every control but the one in use has `tabindex="-1"`. Its list of controls is `button, a[href], input, select`, so a text or number field counts as a control like any button, and two things go wrong when a toolbar holds one.

- **The field loses its editing keys.** In the Sight Reader's first-bar box, typing 12 and pressing Left moved focus to the Restart button instead of moving the caret, so a typed number could only be fixed by deleting it. Home and End do the same.
- **Tab cannot reach a second field.** With focus in the first-bar box, Tab left the toolbar for the score, because the last-bar box is `tabindex="-1"`. Two fields that belong together, first and last, a width and a height, or a search box and its options, cannot be filled in one after the other from the keyboard.

The WAI-ARIA Authoring Practices' toolbar pattern makes the same exception: a text field in a toolbar keeps Left and Right for its own caret, and arrow keys move between controls only where that does not take a key the control needs.

## The proposal

1. **A text field keeps its editing keys.** When the event's target is an `input` other than a checkbox, radio, button, submit or reset, or a `textarea` or `[contenteditable]`, the toolbar leaves Left, Right, Home and End alone. A `select` keeps Up and Down, which it already does.
2. **The fields of a kept group are each in the Tab order.** In a group marked `data-toolbar-keep`, every field keeps `tabindex="0"`, so Tab and Shift+Tab move through them as in a form, and the toolbar's single stop covers its other controls. Tab from the group's last field goes on as it would from the toolbar.

Arrow keys still move between the toolbar's buttons, and from a button onto a field, so the toolbar is no harder to cross than it is today.

## What the site does meanwhile

The Sight Reader listens on its two bar boxes: Left, Right, Home and End stop there, before the toolbar sees them, and Tab from the first box and Shift+Tab from the last go to the other box. It relies on nothing but the order in which DOM events bubble from a field to the toolbar around it.
