/* The site's commands, on both sites (Architecture/site-menu-design.md).
   sitenav.xfer's menu names a command and its parameters, and the server
   writes it into the menu as a link or a button carrying data-command and
   data-args (Pages/Services/SiteCommands.cs). PUDL's menu bar presses that
   element for the reader, so the click reaches the handler here, as any
   click would.

     pcCommands.define(name, {
         run(args, el, event)   carries the command out; returns true when
                                it has, so a link is not followed as well
         checked(args)          optional: whether the command is ticked
     })
     pcCommands.run(name, args) carries a command out from a script.

   A link whose command declines (run returns false), or which has no
   command defined here, is followed, as its address says. */
(function () {
    'use strict';
    if (window.pcCommands) { return; }

    var defs = {}, warned = {};

    function argsOf(el) {
        try { return JSON.parse(el.getAttribute('data-args') || '{}') || {}; } catch (err) { return {}; }
    }
    function desktop() { return !!(window.pudlWindows && document.querySelector('[data-win-layer]')); }

    function sync() {
        document.querySelectorAll('[data-command]').forEach(function (el) {
            var d = defs[el.getAttribute('data-command')];
            if (d && d.checked) { el.setAttribute('aria-checked', d.checked(argsOf(el)) ? 'true' : 'false'); }
        });
    }

    function define(name, def) { defs[name] = def; sync(); }

    function run(name, args, el, event) {
        var d = defs[name];
        if (!d) {
            if (!warned[name] && window.console) { warned[name] = true; console.warn('commands: there is no command "' + name + '"'); }
            return false;
        }
        var done = !!d.run(args || {}, el || null, event || null);
        sync();
        return done;
    }

    document.addEventListener('click', function (e) {
        var el = e.target.closest && e.target.closest('[data-command]');
        if (!el) { return; }
        /* A link opened in a new tab or window is the browser's. */
        if (el.tagName === 'A' && (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)) { return; }
        if (run(el.getAttribute('data-command'), argsOf(el), el, e) || el.tagName !== 'A') { e.preventDefault(); }
    });

    /* === The site's commands ============================================ */

    /* theme { value }: light, dark, or system, PUDL's three. */
    define('theme', {
        run: function (a) { if (window.pudlSetTheme && a.value) { window.pudlSetTheme(a.value); } return true; },
        checked: function (a) { return (window.pudlThemePreference ? window.pudlThemePreference() : 'system') === a.value; }
    });

    /* find: focus in the window view's list filter. */
    define('sidebar', {
        run: function () {
            var button = document.querySelector('[data-sidebar-toggle]');
            if (button && !button.disabled) { button.click(); }
            return true;
        }
    });

    define('find', {
        run: function () {
            var filter = document.querySelector('.md-filter');
            if (filter) { filter.focus(); filter.select(); }
            return true;
        }
    });

    /* open { applet, state }: in the window view, the applet's window, with
       the state handed to the instance as it starts (js/continuity.js); a
       window already open closes first, so it starts again in that state.
       Elsewhere the link goes to the applet's page with the state. */
    define('open', {
        run: function (a) {
            if (!desktop() || !a.applet) { return false; }
            if (a.state) {
                window.pcAppletHandoff = window.pcAppletHandoff || {};
                window.pcAppletHandoff[a.applet] = String(a.state).replace(/^\?/, '');
                if ((window.pudlWindows.state().open || []).indexOf(a.applet) >= 0) { window.pudlWindows.close(a.applet); }
            }
            window.pudlWindows.open(a.applet);
            return true;
        }
    });

    /* run { script, cwd }: one of the terminal's scripts, through the
       request the terminal answers ("shell", with the script to run), so a
       terminal opens and runs it. Elsewhere the link goes to the terminal's
       page with the script in its query. */
    define('run', {
        run: function (a) {
            if (!desktop() || !a.script || !window.pudlApplets || !window.pudlApplets.request) { return false; }
            return window.pudlApplets.request('shell', { path: a.cwd || '', run: a.script });
        }
    });

    window.pcCommands = { define: define, run: function (name, args) { return run(name, args); } };

    document.addEventListener('pudl:theme-change', sync);
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', sync); } else { sync(); }
})();
