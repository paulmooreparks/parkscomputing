# Proposal to PUDL: a status area in the top bar, and a comments glyph

From parkscomputing.com, 2026-10-05. Paul wants applets that live in the top bar: an applet registers a part of itself that runs on every page, constantly or now and then, keeps an icon up to date and answers presses on it. The icons sit together at the top bar's far right, and the site's account button is one of them, a background applet like any other that may have notifications of its own one day. The site has built this (`Architecture/status-area-design.md`, `Pages/Shared/_StatusArea.cshtml`, `js/status.js`), and it works on beta. This proposal asks PUDL to make the status area a component of the top bar, so other projects have it and it follows PUDL's rules wherever it appears, and to add a glyph for comments.

## Why PUDL should own it

PUDL's rule is that raised means pressable, and a project that puts a round picture in the top bar breaks it easily. Parks Computing did: its account button was a raised top-bar pill shrunk to a 2px ring around the reader's picture, which covered nearly all of it, so the button did not read as pressable. The menu bar already answers the same question for its groups, each of which is one raised surface holding flat controls. A status area drawn the same way keeps a picture round and the group pressable, and a project should not have to rediscover that.

## Behavior

**The status area is one raised group at the top bar's far end,** after anything else the top bar holds there, such as a view switch. It is drawn as the menu bar's groups are: one raised surface, with a border and the raised shadow, holding flat controls.

**Each item is a flat control,** a link or a button, that highlights on hover, is pressed in while held and shows the focus ring, as a menu bar title does. An item holds an icon, either a glyph or a picture, and an optional badge. A picture is shown whole and may be round; the group carries the raise, so the picture need not.

**An item's badge is PUDL's badge,** leading with its glyph, so a count reads as a status and not as decoration. A badge of nothing is hidden, not drawn as 0.

**An item's accessible name says what it is and what its badge means,** such as "Moderation: 3 waiting". The badge itself is hidden from assistive technology, since the name already says it.

**On a narrow screen the group stays,** icons and badges only, since each item is already an icon. An item with words of its own, such as Sign in, keeps them.

**The order is the host's,** with the account last, at the very end, where a site's account usually is.

## Declaring it

The host renders the area with the page, so the items and their badges are right before any script runs, and each item is a real link, so a reader without script can follow it:

```html
<nav class="status-area" aria-label="Status">
  <a class="status-item" href="/moderation" aria-label="Moderation: 3 waiting" title="Moderation: 3 waiting">
    <span class="glyph" style="--glyph: var(--glyph-comments)" aria-hidden="true"></span>
    <span class="badge warn status-count" aria-hidden="true">3</span>
  </a>
  <a class="status-item status-account" href="/account" aria-label="Your account">
    <img class="status-picture" src="/avatars/…" alt="" />
  </a>
</nav>
```

Parks Computing's classes are `status-area`, `status-item`, `status-count` and `status-account`, in `css/pudl-site.css`; PUDL is welcome to name them its own way.

## Script

PUDL need not run anyone's background work. It is enough for PUDL to draw the area and keep it right when a host changes an item: a host that sets an item's badge text, hides the badge, or changes its accessible name sees the area redrawn as it should be, as the menu bar does when a host changes its lists. Parks Computing runs its background applets itself (`js/status.js`): it loads an applet's background script only on a page whose area holds that applet's item, and gives the script the item, with `count(n)` and `label(text)`. If PUDL would rather offer that registry too, as it offers `pudlApplets`, the shape the site uses is

```js
pcStatus.register('moderation', { start: function (item) { …; return { stop: function () { … } }; } });
```

## A comments glyph

PUDL has no glyph for comments or messages, so the site draws a speech bubble of its own, `--pc-glyph-comments`, in PUDL's glyph style: a 16 by 16 view box, a 1.3 stroke, round joins and caps, drawn in the text colour through a mask. PUDL adopting `--glyph-comments` lets the site drop its own, as it dropped its pin glyph when PUDL shipped `--glyph-pin`.

## What the site does when PUDL ships it

The site adopts the component and the glyph, deletes its own status-area styles and glyph, and keeps its background applets. That is recorded in `pudl-adoption.md` when it happens.
