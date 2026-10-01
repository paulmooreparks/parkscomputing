# Proposal to PUDL: reloading an applet's code in a running page

From parkscomputing.com, 2026-10-01. Paul builds applets on the live site, and after each change to an applet's script or stylesheet he has to reload the whole browser page to see it. That throws away every other window's state: the arrangement survives in the address, but a terminal session, an unsaved editor tab and a half-played game do not. He asked for a way to reload one window's content without reloading the page.

The site has done the part it owns. Its window menu now has a Reload command that fetches the window's content again from `/window/{key}` and swaps it in, calling `pudlApplets.destroy(body)` before and `pudlApplets.boot(body)` after, which `pudl-applets.js` documents as the way to handle content a project swaps by other means. That picks up an edited article, an edited book chapter, and a change to an applet's mount markup. It cannot pick up a change to the applet's code, because `pudl-applets.js` loads each script once per page, keyed by its address, and `boot()` starts a new instance from the definition it already holds. The site could get round that by inserting the script again itself and relying on `register()` replacing the earlier definition, but that would rest on how the runtime happens to behave today, which the contract does not promise.

## Behavior

**`pudlApplets.reload(name)` reloads one applet's code and restarts its instances.** It fetches the applet's script and stylesheet again, from the addresses its `define()` gave, past the browser's cache. The new script's `register()` replaces the definition. Every running instance of that applet, in any window or page host, is then restarted. Each one is asked for `state()` before its `destroy()`, and the string is handed to the new `init()` as `opts.state`, so a game or a form comes back as it was when the applet supports that. The function returns a promise that settles when the instances are running again, or rejects with the load error, leaving the old instances running.

**Every instance restarts, not just the one in the window that asked.** A page holds one copy of an applet's code, so an instance left running would keep the old code while new ones got the new, and two versions of one applet would share a page.

**The stylesheet is replaced, not added to.** The old `<link>` goes once the new one has loaded, so rules removed from the stylesheet stop applying and the applet does not flash unstyled between the two.

**Getting past the cache is the runtime's business.** A `<script>` element cannot ask for a fresh copy, so the runtime needs some way to make the address new, such as a reload counter beside `?v=`. The choice is PUDL's, and it should be one that does not depend on a particular browser's memory cache.

## The contract it needs

Running an applet's script a second time is safe only if the script does nothing at load beyond calling `register()`. The contract already says `init()` finds and listens only within its root and that `destroy()` undoes everything it set up; it would add that the script itself sets nothing up at load, so no listener or timer outlives a reload. An applet that cannot meet that can say so in its definition (`reload: false`, for example), and `reload()` would then reject and leave a full page reload as the answer.

## Why PUDL

The script cache, the registry and the list of running instances are all private to `pudl-applets.js`, and the stylesheet bookkeeping is too. Only the runtime can restart every instance and hand each its state. Every PUDL site whose author develops applets in place has the same problem, and the window menu could offer the command itself.

## What the site would do

- Have the window menu's Reload also call `pudlApplets.reload()` for each applet in the window, after fetching the content, so one command picks up any kind of change.
- Check its applets for anything their scripts set up at load, and move it into `init()`.
