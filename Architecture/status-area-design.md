# The status area and background applets

Paul asked on 2026-10-05 for applets that can live in the top bar: an applet registers an active part that runs on every page, constantly or now and then, keeps an icon of its own up to date and answers presses on it. The icons sit at the top right of the top bar. The account button becomes one of them, a background applet like any other that may have notifications of its own one day, and the moderation queue's count moves off the account button into an icon of its own. If it works the way Paul expects, it goes to PUDL as a proposal, as the pins group did.

## How it looks

The status area is one raised group at the far right of the top bar, after Windowed and Classic, holding flat controls, as each of the menu bar's groups and the view switch do. PUDL's rule is that raised means pressable, and the account button broke it: the site had shrunk a raised top-bar pill to a 2px ring around the reader's picture, which covered nearly all of it. Paul chose on 2026-10-05 to keep the round picture and have the group carry the raise, rather than drawing each icon as a raised round button of its own, because the group follows the grammar PUDL already has and needs no new kind of control. Each control in the group highlights on hover and is pressed in while held, as a menu bar title is.

An item is an icon, either a glyph or a picture, with an optional badge for a count. Its accessible name says what it is and what the count means, such as "Moderation: 3 waiting".

## How it works

The server renders the area with the page, so its items and their counts are there before any script runs, and each item is a link to its applet's page, which opens as a window in the window view. A reader without script still sees the counts as of the page load and can follow each link.

A background applet is named in `js/status.js`, the site's registry for them, with the script that runs it, as `js/applets.js` names applets. The registry loads that script only on a page whose status area holds the applet's item, so a reader who is not a moderator never loads the moderation applet's background part. Its script registers the applet with `pcStatus.register(name, { start(item) })`. `start` receives the item, which can set its count and its accessible name, and it may return `stop`. Pressing an item follows its link unless the background applet takes the press.

The two background applets so far are these.

- **account**: the reader's picture, or Sign in when nobody is signed in. Its link opens the Account applet. When the reader changes their picture, the Account applet says so with an event and the icon follows.
- **moderation**, for a moderator wherever the site has comments: a speech-bubble glyph and a badge with what is waiting (comments and edits to review, and open reports). It asks the server again every two minutes and when the tab comes back into view, and at once whenever the moderation queue changes something, which the queue announces with an event. Its link opens the queue.

The logo menu keeps Moderation in the account's section, without a count, since the status area carries it.

## For PUDL

The proposal would give the menu bar a status group, read from a hidden list as the pins group is, placed at the row's far end, whose items are links with an icon, an optional badge and a name; and a small script contract for a host to update an item's badge and name. PUDL would also gain a glyph for comments or messages, since it has none.
