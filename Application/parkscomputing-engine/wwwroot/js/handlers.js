/* Handlers (Architecture/files-editor-design.md). An applet declares the
   requests it serves in window.pcHandlers, in js/applets.js, and a caller
   asks for one here without knowing which applet will answer:

     pcOpen.request('open', { path: '~/notes.md', kind: 'file' }, root)

   The requests are open (a file), browse (a folder) and shell (a command
   line in a folder). request() returns false when no applet serves the
   request, so the caller can fall back on what it would do without one.
   The last argument is the caller's own element, which says which view it
   is in.

   In the window view a request either goes to the running instance, whose
   window is raised and whose mount receives pc:applet-request with the
   state in detail.state, or opens a new instance with the state handed
   over through pcAppletHandoff. An applet that declares instances gets
   numbered windows (terminal, terminal-2, ...) up to its limit, and at the
   limit the most recently opened one takes the request. In the classic
   view a request goes to the applet's page, in a new tab when the caller
   is an instance of that applet, since navigating would replace it. */
(function () {
    'use strict';

    function declarations() { return window.pcHandlers || {}; }

    /* The first applet that serves the request and accepts the kind. */
    function handlerFor(verb, kind) {
        var all = declarations();
        var names = Object.keys(all);
        for (var i = 0; i < names.length; i++) {
            var serves = all[names[i]][verb];
            if (!serves) { continue; }
            if (kind && serves.kinds && serves.kinds.indexOf(kind) < 0) { continue; }
            return { name: names[i], serves: serves, instances: all[names[i]].instances || 1 };
        }
        return null;
    }

    /* A state string that keeps paths readable. */
    function stateOf(h, req) {
        var params = [[h.serves.param, req.path]];
        (h.serves.extra || []).forEach(function (k) { params.push([k, req[k]]); });
        return params.filter(function (p) { return p[1] != null && p[1] !== ''; }).map(function (p) {
            return p[0] + '=' + encodeURIComponent(p[1]).replace(/%2F/g, '/').replace(/%7E/g, '~');
        }).join('&');
    }

    /* The open windows of an applet, in the order they opened. */
    function instanceKeys(name) {
        var pattern = new RegExp('^' + name + '(-[2-9])?$');
        return (window.pudlWindows.state().open || []).filter(function (k) { return pattern.test(k); });
    }

    function freeKey(name, limit, open) {
        if (open.indexOf(name) < 0) { return name; }
        for (var n = 2; n <= limit; n++) { if (open.indexOf(name + '-' + n) < 0) { return name + '-' + n; } }
        return null;
    }

    function deliver(key, h, verb, state) {
        window.pudlWindows.open(key);
        var win = document.querySelector('.win[data-win="' + key + '"]');
        var mount = win && win.querySelector('[data-applet="' + h.name + '"]');
        if (mount) { mount.dispatchEvent(new CustomEvent('pc:applet-request', { detail: { verb: verb, state: state } })); }
    }

    function openNew(key, state) {
        window.pcAppletHandoff = window.pcAppletHandoff || {};
        window.pcAppletHandoff[key] = state;
        window.pudlWindows.open(key);
    }

    function request(verb, req, from) {
        req = req || {};
        var h = handlerFor(verb, req.kind);
        if (!h) { return false; }
        var state = stateOf(h, req);
        var inWindow = window.pudlWindows && from && from.closest && from.closest('.win');
        if (!inWindow) {
            var url = '/page/' + encodeURIComponent(h.name) + (state ? '?' + state : '');
            var self = from && from.closest && from.closest('[data-applet="' + h.name + '"]');
            if (self) { window.open(url, '_blank', 'noopener'); } else { location.assign(url); }
            return true;
        }
        var open = instanceKeys(h.name);
        if (h.serves.fresh) {
            var key = freeKey(h.name, h.instances, open);
            if (key) { openNew(key, state); } else { deliver(open[open.length - 1], h, verb, state); }
        } else if (open.length) {
            deliver(open[open.length - 1], h, verb, state);
        } else {
            openNew(h.name, state);
        }
        return true;
    }

    window.pcOpen = {
        /* Whether any applet serves the request, for a caller deciding
           whether to offer it at all. */
        can: function (verb, kind) { return !!handlerFor(verb, kind); },
        request: request
    };
})();
