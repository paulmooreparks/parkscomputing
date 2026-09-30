/* Applet continuity (PUDL 0.21.0), shared by the public site and the admin
   desktop. The site hosts each applet's continuity everywhere the applet
   has none of its own: pudl:applet-state hands a starting instance the
   state kept for it, and pudl:applet-change keeps it again. On the
   applet's own page a board named in the URL still wins (the applet
   prefers its address at boot), so a shared link opens its own board,
   and the installed web app, whose launch URL names nothing, resumes the
   last game. A mount keeping its state in the page's query
   (data-applet-param) is the URL's business, not this. The keys are
   per-applet, functional storage wiped by the settings dialog's Forget.
   Load before pudl-applets.js. */
(function () {
    'use strict';
    if (window.pcContinuity) { return; }

    var CONTINUITY = { sudoku: 'pc-sudoku', barcodes: 'pc-barcodes', terminal: 'pc-terminal' };

    /* The key an instance goes by: the applet's own name for the first,
       and name-2, name-3 and so on for the numbered windows PUDL's
       requests open (0.27.0). pudl:applet-state carries it as
       detail.instance; pudl:applet-change does not, so there it is read
       from the window, as PUDL reads it. */
    function instanceKey(mount, name) {
        var win = mount.closest && mount.closest('.win[data-win]');
        return win ? win.getAttribute('data-win') : name;
    }
    /* The first instance keeps the applet's storage key, so continuity
       kept before instances existed still applies; a numbered one adds its
       key. */
    function continuityKey(name, inst) {
        var key = CONTINUITY[name];
        return key && inst && inst !== name ? key + ':' + inst : key;
    }

    document.addEventListener('pudl:applet-state', function (e) {
        /* A one-shot hand-off: an applet opening another instance of
           itself elsewhere (Conway's "Open this board") leaves the state
           here for the new instance, which takes it once. */
        var handoff = window.pcAppletHandoff;
        var name = e.detail && e.detail.name;
        var inst = e.detail && (e.detail.instance || name);
        if (handoff && inst && Object.prototype.hasOwnProperty.call(handoff, inst)) {
            e.detail.state = handoff[inst];
            delete handoff[inst];
            return;
        }
        var key = name ? continuityKey(name, inst) : null;
        if (!key || (e.detail && e.detail.param)) { return; }
        try {
            var kept = localStorage.getItem(key);
            if (kept) { e.detail.state = kept; }
        } catch (err) { }
    });

    document.addEventListener('pudl:applet-change', function (e) {
        var mount = e.target;
        if (!mount.getAttribute) { return; }
        var name = mount.getAttribute('data-applet');
        var key = continuityKey(name, instanceKey(mount, name));
        if (!key || mount.hasAttribute('data-applet-param')) { return; }
        try {
            if (e.detail && e.detail.state != null) { localStorage.setItem(key, e.detail.state); }
            else { localStorage.removeItem(key); }
        } catch (err) { }
    });

    /* The storage prefixes, for the settings dialog's Forget. */
    window.pcContinuity = { keys: function () { return Object.keys(CONTINUITY).map(function (n) { return CONTINUITY[n]; }); } };
})();
