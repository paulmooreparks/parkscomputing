# Proposal to PUDL: applets that declare what they handle

From parkscomputing.com, 2026-09-29, against PUDL 0.24.0. The site runs this today as its own code (`js/handlers.js`, with declarations in `js/applets.js`); `Architecture/files-editor-design.md` has the site's design. This proposal asks PUDL to take the mechanism into `pudl-applets.js`, so that the site's copy can be deleted.

## The problem

The applet contract says an applet knows itself and never its host. It says nothing about how one applet asks another for something, and once a site has a few applets, they start to. On parkscomputing.com, the file manager opens a file in the editor, the terminal opens a file in the editor too, and the file manager opens a terminal in a folder. The barcode tool wants its layouts file opened for editing.

Before handlers, each caller named the applet it wanted and carried its own copy of the rules for reaching it:

1. Look for an open window with that applet's key.
2. If there is one, send the applet a site-specific event and raise the window.
3. If there isn't, leave the state in a global hand-off object, and open the window.
4. In the classic view, navigate to the applet's page with a query.

That was three copies of the same logic and one custom event per pair of applets. There was also a bug: "Open a terminal here" closed the running terminal to reopen it in the new folder, because a key can only name one window. Every caller was coupled to the applets it called. The barcode tool, which is meant to be portable, could only open its file in an editor by knowing that the site has one.

## What the site built

The site's mechanism has three parts, and each maps onto something PUDL already has.

- **Declarations.** Each applet says which requests it serves, next to its `define`. A request is a verb, such as `open`, `browse` or `shell`, and a path. The declaration names the state parameter the path travels in, and optionally the kinds of thing it accepts, further parameters a request may carry, and whether each request gets a new instance.
- **A resolver.** A caller asks for a verb and a path, never for an applet. The resolver finds the first applet that serves the request, then chooses the running instance, a new instance, or the applet's own page. It returns false when nothing serves the request, so the caller can fall back or hide the action.
- **Instances.** An applet may have several windows at once. The first has the applet's name as its key, and the others are `terminal-2`, `terminal-3` and so on, up to a declared limit. At the limit, the newest one takes the request. The server answers `/window/{name}-{n}` for any applet page, titling the window "Terminal 2".

## The proposed contract

**Declaring.** Two new, optional keys go in `define`:

```js
pudlApplets.define('editor', {
  src: '/js/editor.js', css: '/css/editor.css', page: '/page/editor', ver: '2',
  handles: { open: { param: 'file', kinds: ['file', 'script', 'page'] } }
});
pudlApplets.define('terminal', {
  src: '/js/terminal.js', css: '/css/terminal.css', page: '/page/terminal', ver: '18',
  handles: { shell: { param: 'cwd', extra: ['run'], fresh: true } },
  instances: 4
});
```

The verbs and the kinds are the project's own strings. PUDL should not fix a list of verbs or know what a file is. It routes a string to whoever declared it, and the meaning stays with the applets that agree on it.

**Asking.** There are two new functions:

```js
pudlApplets.can('open', 'file')                                   // true when some applet serves it
pudlApplets.request('open', { path: '~/notes.md', kind: 'file' }, callerElement)
```

`request` returns false when no applet serves the verb and kind. The caller's element tells PUDL which view the caller is in, as `hostOf(from)` does for window placement.

**Receiving.** An applet receives a request through `setState(s)`, the method it already has, with the state string the request built, such as `file=~/notes.md`. The site uses a custom event for this. PUDL doesn't need one, because the runtime holds every running instance and can call `setState` directly. A request asks the applet to adopt a state, which is what `setState` already means for Back, Forward and preset links. The applet decides what adopting means: the site's editor opens the file in a new tab rather than replacing the current one.

**Routing.**

- **In a window.** A verb without `fresh` goes to the most recently opened instance, whose window is raised and whose `setState` is called. If no instance is open, a new window opens with the state. A `fresh` verb opens a new instance while the applet is under its `instances` limit. At the limit, it goes to the newest instance instead.
- **Outside a window.** The browser goes to the applet's `page` with the state as its query. The one exception is a caller that is itself an instance of the target applet. It gets a new browser tab, because navigating would replace the caller.

**Handing a new instance its state.** The runtime keeps the request's state for the new window's instance key. It then uses that state when the window's applet launches, ahead of anything the host puts in `pudl:applet-state`, because the reader asked for that state just now.

**Telling hosts which instance.** `pudl:applet-state`'s `detail` and the init `opts` gain `instance`. This is the window's key inside a window, and the applet's name anywhere else. Hosts need it to keep continuity per instance; the site stores the terminal at `pc-terminal` and its second instance at `pc-terminal:terminal-2`.

## Sample implementation

These are additions to `pudl-applets.js`, in its style. They were adapted from the site's working `js/handlers.js`, but they use the runtime's own `defs` and `running` instead of a separate declarations object and an event.

```js
  /* === Requests ============================================================
     An applet may declare in define() the requests it serves:
       handles: { verb: { param, kinds, extra, fresh } }, instances: n
     A caller asks with request(verb, { path, kind, ...extra }, from) and never
     names an applet. The first applet defined that serves the verb and the
     kind answers: its newest running instance takes the state through
     setState(), or a new instance opens with it. A fresh verb opens a new
     instance each time, up to instances of them (keys name, name-2, ...),
     and at the limit the newest takes it. Outside a window the request goes
     to the applet's page, in a new tab when the caller is that applet. */

  var handed = {};         // instance key -> state a request left for a window still opening

  function instanceKey(root, name) {
    var win = root.closest('.win[data-win]');
    return win ? win.getAttribute('data-win') : name;
  }

  function handlerFor(verb, kind) {
    for (var name in defs) {
      var h = defs[name].handles && defs[name].handles[verb];
      if (!h) continue;
      if (kind && h.kinds && h.kinds.indexOf(kind) < 0) continue;
      return { name: name, h: h, def: defs[name] };
    }
    return null;
  }

  /* The request as a state string, with paths left readable. */
  function stateOf(h, req) {
    var pairs = [[h.param, req.path]];
    (h.extra || []).forEach(function (k) { pairs.push([k, req[k]]); });
    return pairs.filter(function (p) { return p[1] != null && p[1] !== ''; }).map(function (p) {
      return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]).replace(/%2F/g, '/').replace(/%7E/g, '~');
    }).join('&');
  }

  /* The applet's open windows, oldest first. */
  function instanceKeys(name) {
    var re = new RegExp('^' + name + '(-[2-9])?$');
    return (window.pudlWindows.state().open || []).filter(function (k) { return re.test(k); });
  }

  function freeKey(name, limit, open) {
    if (open.indexOf(name) < 0) return name;
    for (var n = 2; n <= Math.min(limit, 9); n++) if (open.indexOf(name + '-' + n) < 0) return name + '-' + n;
    return null;
  }

  function deliver(key, name, state) {
    window.pudlWindows.open(key);                     // raises it, restoring it if minimised
    var entry = running.find(function (x) {
      return x.name === name && x.root.isConnected && instanceKey(x.root, name) === key;
    });
    if (entry && entry.instance && entry.instance.setState) entry.instance.setState(state);
    else handed[key] = state;                         // still loading: it takes the state at launch
  }

  function request(verb, req, from) {
    req = req || {};
    var found = handlerFor(verb, req.kind);
    if (!found) return false;
    var state = stateOf(found.h, req);
    var inWindow = window.pudlWindows && from && from.closest && from.closest('.win');
    if (!inWindow) {
      var page = found.def.page;
      if (!page || !sameOrigin(page)) return false;
      var url = page + (state ? (page.indexOf('?') < 0 ? '?' : '&') + state : '');
      if (from && from.closest && from.closest('[data-applet="' + found.name + '"]')) window.open(url, '_blank', 'noopener');
      else location.assign(url);
      return true;
    }
    var open = instanceKeys(found.name);
    if (found.h.fresh || !open.length) {
      var key = freeKey(found.name, found.def.instances || 1, open);
      if (key) { handed[key] = state; window.pudlWindows.open(key, from); return true; }
    }
    deliver(open[open.length - 1], found.name, state);
    return true;
  }

  function can(verb, kind) { return !!handlerFor(verb, kind); }

  window.pudlApplets = { define: define, register: register, boot: boot, destroy: destroy, request: request, can: can };
```

In `launch()`, the instance key joins the handshake, and a handed state wins over the host's:

```js
    var inst = instanceKey(root, c.name);
    var ask = new CustomEvent('pudl:applet-state', { bubbles: true,
      detail: { name: c.name, instance: inst, host: host, fit: fit, param: param, state: entry.last } });
    root.dispatchEvent(ask);
    var state = ask.detail.state == null ? null : String(ask.detail.state);
    if (Object.prototype.hasOwnProperty.call(handed, inst)) { state = handed[inst]; delete handed[inst]; }
    var instance = def.init(root, { host: host, fit: fit, instance: inst, ownsUrl: ownsUrl, pageUrl: pageUrl, state: state,
                                    changed: /* as now */ });
```

The site's version and this one behave the same, with two differences. The site delivers through a custom event, `pc:applet-request`, because it cannot reach `running`. It also keeps its own hand-off object, read in its `pudl:applet-state` listener, because it cannot reach `launch`. Both go away if PUDL takes this.

## What stays with the project

- **Serving numbered windows.** `/window/{name}-{n}` has to render the applet's page again, with a title that carries the number. PUDL can document this convention, but only the project's window source can answer it. The site does it in `ArticleContentService.LoadInstance`. The convention should be written down, because a page whose own slug ends in `-2` would otherwise collide; the site checks for a real page first.
- **Continuity per instance.** Where each instance's state is kept is the host's business. `detail.instance` makes it possible.
- **What the verbs mean.** Which kinds exist, what "open" does to a file that doesn't exist yet, and whether several terminals share a history all belong to the applets.

## Questions for PUDL

1. **Names.** Should the keys be `handles` and `fresh`, or something else? `fresh` in particular reads oddly; the site took it for want of a better word.
2. **Where instances live.** Instance keys touch both `pudl-applets.js` and `pudl-windows.js`. The sample keeps them in the applet runtime and uses only `pudlWindows.open` and `state`. An alternative is to have `pudlWindows` know that `name-2` belongs to `name`, which a template window source (`data-win-src="#…"`) would need, since its template is looked up by key.
3. **The limit.** One digit keeps keys short and the pattern simple, so the sample caps instances at 9. Is that the right cap?
4. **The first match wins.** When two applets serve the same verb and kind, the first defined answers. A project that wants a choice ("open with…") would need `can` to return the candidates. The site hasn't needed that, and I'd leave it out until a project does.
