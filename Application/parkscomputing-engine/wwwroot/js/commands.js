/* The site's commands, on both sites (Architecture/site-menu-design.md).
   sitenav.xfer's menu names a command and its parameters, and the server
   writes it into the menu as a link or a button carrying data-site-command and
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
        document.querySelectorAll('[data-site-command]').forEach(function (el) {
            var d = defs[el.getAttribute('data-site-command')];
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
        var el = e.target.closest && e.target.closest('[data-site-command]');
        if (!el) { return; }
        /* A link opened in a new tab or window is the browser's. */
        if (el.tagName === 'A' && (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)) { return; }
        if (run(el.getAttribute('data-site-command'), argsOf(el), el, e) || el.tagName !== 'A') { e.preventDefault(); }
    });

    /* === The site's commands ============================================ */

    /* theme { value }: light, dark, or system, PUDL's three. */
    define('theme', {
        run: function (a) { if (window.pudlSetTheme && a.value) { window.pudlSetTheme(a.value); } return true; },
        checked: function (a) { return (window.pudlThemePreference ? window.pudlThemePreference() : 'system') === a.value; }
    });

    function sidebarLayout() { return document.querySelector('.md-layout[data-md-persistent]'); }

    /* sidebar: hide or show the window view's article list, as the window
       bar's sidebar button does. js/window-bar.js ticks it while the list
       is hidden, and disables it with the button. */
    define('sidebar', {
        run: function () {
            var button = document.querySelector('[data-sidebar-toggle]');
            if (button && !button.disabled) { button.click(); }
            return true;
        }
    });

    /* sidebar-side { value }: put the window view's article list on the
       right (end) or the left (start), PUDL's data-md-side (0.52.0); with no
       value, on the other side. The choice is kept in this browser under
       pc-sidebar-side, which Pages/Desktop.cshtml applies before the first
       paint. Settings' Windows card offers the same choice through this
       command, and hears of a change from pc:sidebar-side. Ticked while the
       list is on the right. */
    function sideNow() {
        try { return localStorage.getItem('pc-sidebar-side') === 'end' ? 'end' : 'start'; } catch (err) { return 'start'; }
    }
    define('sidebar-side', {
        run: function (a) {
            var side = a.value === 'end' || a.value === 'start' ? a.value : sideNow() === 'end' ? 'start' : 'end';
            try {
                if (side === 'end') { localStorage.setItem('pc-sidebar-side', 'end'); } else { localStorage.removeItem('pc-sidebar-side'); }
            } catch (err) { }
            var l = sidebarLayout();
            if (l) { if (side === 'end') { l.setAttribute('data-md-side', 'end'); } else { l.removeAttribute('data-md-side'); } }
            document.dispatchEvent(new CustomEvent('pc:sidebar-side', { detail: { side: side } }));
            return true;
        },
        checked: function () { return sideNow() === 'end'; }
    });

    /* find: focus in the window view's list filter. */

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

    /* edit { path }: an article's Edit link. In the window view the file
       goes to the Editor through the request it answers ("open"), so it
       opens beside what the Editor already has, starting one if none is
       open. Elsewhere the link goes to the Editor's page with the file. */
    define('edit', {
        run: function (a) {
            if (!desktop() || !a.path || !window.pudlApplets || !window.pudlApplets.request) { return false; }
            return window.pudlApplets.request('open', { path: a.path, kind: 'file' });
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
