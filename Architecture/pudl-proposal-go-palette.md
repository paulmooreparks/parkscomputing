# Proposal to PUDL: the go palette

From parkscomputing.com, 2026-09-28. The site grew a hidden control (its decision D22) that PUDL may want as a component: a small raised bar, summoned by a key, that takes typed input and turns it into a URL. The site's version does one thing, going to a page by slug, but the shape underneath is generic, and this proposal describes the generic shape so PUDL can decide where to cut.

## What the site built

Pressing `/` anywhere outside an editable field shows a bar fixed bottom-center above the footer: a raised panel holding one sunken input, focused on arrival. Enter acts on what was typed, Escape or a click outside dismisses, and the summoning key types normally once focus is in any editable field, its own input included. The bar is a server-rendered GET form whose action is an ordinary redirecting endpoint, so the control works without script and every outcome it can produce is an address that could have been typed into the location bar. With script, the submit is intercepted and the same outcome is reached without a round trip; on the site's desktop that means `pudlWindows.open(slug)`, and in its classic view a navigation.

## What PUDL's version would be

A `.palette` component: the raised bar, the sunken input, the fixed bottom-center placement with a gutter below, hidden until summoned. An optional script (`pudl-palette.js` or a corner of an existing file) wires the summoning key from a `data-palette-key` attribute on the form, handles focus, Escape and click-outside, and fires a cancelable `pudl:palette-submit` with the raw text in `detail` so the page decides what the text means; an unhandled event lets the form submit naturally, which keeps the no-script contract. PUDL would not interpret the text at all. Slug parsing, URL normalization and the choice between opening a window and navigating are the page's business, exactly as window content is.

Two design points from building it that the component should keep:

- The summoning key must be a single unmodified printable key, checked against `document.activeElement` being editable, or it fights typing. `/` is the convention readers already know from Slack, GitHub and Gmail, and it needs no Shift on any layout, but the attribute leaves the choice to the page.
- The control's value is that it is a form. Everything it does must remain expressible as a URL, or it becomes a modal that happens to look like one.

## Where to cut

One consumer with one verb does not prove a component, which is why the site built it locally first. The cut PUDL may prefer is to wait for the second verb: the moment a palette wants `>command` syntax or completion, it is a command palette, a much larger contract (result lists, keyboard selection, ranking) that deserves its own design rather than an extrapolation from this one. This proposal is therefore offered as either a small `.palette` primitive now, or a marker in the backlog for that larger design later; the site is content on its local version until one of those ships.
