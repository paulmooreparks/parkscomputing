/* The admin desktop's file tree (Pages/Admin/Index.cshtml,
   Architecture/admin-and-identity-design.md, A12). The side of the desktop
   is the shared file browser's tree (js/filebrowser.js), files and all,
   over ~, /home and /wwwroot. A click on a file opens it: text in the
   Editor, anything else as the public site serves it. A menu on each
   entry, by right-click, the context-menu key or Shift+F10, offers the
   rest. Every tool is reached through PUDL's requests (open, browse and
   shell), so this names none of them. Load with defer, after
   js/applets.js. */
(function () {
    'use strict';

    var tree = document.querySelector('[data-desk-tree]');
    if (!tree) { return; }
    var note = tree.querySelector('[data-desk-tree-note]');

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = function () { reject(new Error('could not load ' + src)); };
            document.head.appendChild(s);
        });
    }

    var F = null, FB = null;

    function request(verb, req) { return !!(window.pudlApplets && window.pudlApplets.request(verb, req, tree)); }

    function dirOf(node) { var r = F.realOf(node); return r.children ? r : r.parent; }

    /* Opening an entry: text goes to the Editor; a link, a page, an applet
       or a picture opens on the public site, in a tab of its own. */
    function open(node) {
        var r = F.realOf(node), kind = F.kindOf(node);
        if (kind === 'link') { window.open(r.url, '_blank', 'noopener'); return; }
        /* A built-in command, from /bin, is explained in a terminal. */
        if (kind === 'command') { request('shell', { path: F.pathOf(r.parent), run: 'man ' + r.name }); return; }
        if ((kind === 'file' || kind === 'script') && F.isText(r)) {
            if (!request('open', { path: F.displayPath(r), kind: kind })) { say('Nothing here opens ' + r.name + '.'); }
            return;
        }
        var url = F.publicUrl(r);
        if (url) { window.open(url, '_blank', 'noopener'); } else { say(r.name + ' can\'t be opened here.'); }
    }

    function say(msg) {
        var live = document.querySelector('[data-admin-status]');
        if (live) { live.textContent = msg; }
        if (note) { note.textContent = msg; note.hidden = !msg; }
    }

    /* === The entry menu ==================================================
       PUDL's context menu (0.74.0): a right-click, Shift+F10 or the Menu key
       on an entry asks for rows, and PUDL draws, places and closes the menu
       and gives focus back. */

    function actionsFor(node) {
        var r = F.realOf(node), kind = F.kindOf(node), acts = [];
        if (!r.children && kind !== 'link') {
            if ((kind === 'file' || kind === 'script') && F.isText(r) && window.pudlApplets.can('open', kind)) { acts.push(['edit', 'Open in the Editor']); }
            if (F.publicUrl(r)) { acts.push(['site', 'Open on the public site']); }
        }
        if (kind === 'link') { acts.push(['site', 'Open the link']); }
        if (window.pudlApplets.can('shell')) { acts.push(['shell', r.children ? 'Terminal here' : 'Terminal in its folder']); }
        if (window.pudlApplets.can('browse')) { acts.push(['browse', r.children ? 'Show in Files' : 'Show its folder in Files']); }
        return acts;
    }

    function run(act, node) {
        var r = F.realOf(node), dir = dirOf(node);
        switch (act) {
            case 'edit': open(node); break;
            case 'site': window.open(r.kind === 'link' ? r.url : F.publicUrl(r), '_blank', 'noopener'); break;
            case 'shell': request('shell', { path: F.pathOf(dir) }); break;
            case 'browse': request('browse', { path: F.pathOf(dir) }); break;
        }
    }

    tree.addEventListener('pudl:contextmenu', function (e) {
        var link = e.detail.target.closest && e.detail.target.closest('a[data-path]');
        if (!link || !F) { return; }
        var node = F.resolve(null, link.getAttribute('data-path'));
        if (!node) { return; }
        e.detail.add(actionsFor(node).map(function (a) {
            return { label: a[1], run: function () { run(a[0], node); } };
        }));
    });

    /* === The desktop's settings ==========================================
       ~/.config/desktop.json (js/config.js), which the Settings applet
       changes: new windows, the theme, the background and the tree. */

    var settings = {}, bgUrl = null, browser = null;
    var stage = document.querySelector('.admin-stage');

    /* The background is drawn by js/desktop-background.js, which the window
       view and Settings' preview share. */
    async function apply(s) {
        var before = settings;
        settings = s;
        if (s.theme && window.pudlSetTheme && window.pudlThemePreference && window.pudlThemePreference() !== s.theme) { window.pudlSetTheme(s.theme); }
        if (stage && window.pcDesktopBackground && (s.bgKind !== before.bgKind || s.bgColor !== before.bgColor || s.bgImage !== before.bgImage || s.bgFit !== before.bgFit)) {
            bgUrl = await window.pcDesktopBackground(stage, s, bgUrl);
        }
        if (browser && !!s.treeHidden !== !!before.treeHidden) { browser.showHidden(!!s.treeHidden); }
        if (layout && s.sidebarWidth !== before.sidebarWidth) {
            if (typeof s.sidebarWidth === 'number') { layout.style.setProperty('--md-sidebar-w', s.sidebarWidth + 'px'); }
            else { layout.style.removeProperty('--md-sidebar-w'); }
        }
    }

    /* The sidebar's width, which PUDL's divider sets (pudl-md.js), is kept
       with the desktop's settings, so it follows the admin too. */
    var layout = document.querySelector('.admin-desk');
    if (layout) {
        layout.addEventListener('pudl:md-resize', function (e) {
            if (!window.pcConfig) { return; }
            var w = e.detail && e.detail.reset ? null : Math.round(e.detail.width);
            settings = Object.assign({}, settings, { sidebarWidth: w });
            window.pcConfig.set('desktop', { sidebarWidth: w });
        });
    }

    /* A window opened from outside any window, by the logo menu or the tree, opens
       as the settings say; one opened from a link inside a window keeps
       its opener's state, which is PUDL's own behavior. */
    var layer = document.querySelector('[data-win-layer]');
    if (layer) {
        layer.addEventListener('pudl:window-place', function (e) {
            if (e.detail.placement || settings.newWindows !== 'maximized') { return; }
            if (e.detail.opener && e.detail.opener.closest && e.detail.opener.closest('.win')) { return; }
            e.detail.placement = { mode: 'maximized', x: 0.06, y: 0.05, w: 0.55, h: 0.75 };
        });
    }

    /* === Loading ========================================================= */

    var fs = window.pcSiteFs ? Promise.resolve() : loadScript(window.pcSiteFsSrc || '/js/sitefs.js');
    var fb = window.pcFileBrowser ? Promise.resolve() : loadScript(window.pcFileBrowserSrc || '/js/filebrowser.js');
    var cf = window.pcConfig ? Promise.resolve() : loadScript(window.pcConfigSrc || '/js/config.js');
    var bg = window.pcDesktopBackground ? Promise.resolve() : loadScript(window.pcDesktopBackgroundSrc || '/js/desktop-background.js');
    Promise.all([fs, fb, cf, bg]).then(function () {
        F = window.pcSiteFs; FB = window.pcFileBrowser;
        return F.load();
    }).then(function () {
        return window.pcConfig.load('desktop', { newWindows: 'floating', bgKind: 'none', treeWwwroot: false, treeHidden: false })
            .catch(function () { return {}; });
    }).then(function (s) {
        tree.insertAdjacentHTML('beforeend', FB.markup.body({ list: false, treeLabel: 'Files' }));
        browser = FB.create(tree, F, {
            treeFiles: true, toggleFolders: true, onOpen: open, say: say,
            showHidden: !!s.treeHidden, expand: s.treeWwwroot ? ['/wwwroot'] : []
        });
        apply(s);
        window.pcConfig.onChange('desktop', apply);
        say('');
    }).catch(function (err) {
        say('The files could not be loaded: ' + err.message + '.');
    });
})();
