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

    /* === The entry menu ================================================== */

    var menu = document.createElement('nav');
    menu.className = 'menu-panel admin-ctx';
    menu.id = 'admin-ctx';
    menu.setAttribute('popover', '');
    menu.setAttribute('aria-label', 'Actions');
    document.body.appendChild(menu);
    var menuNode = null, menuAt = null;

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

    function showMenu(link, x, y) {
        var node = F.resolve(null, link.getAttribute('data-path'));
        if (!node) { return; }
        var acts = actionsFor(node);
        if (!acts.length) { return; }
        menuNode = node;
        menuAt = { x: x, y: y, from: link };
        menu.innerHTML = '<div class="md-section-label">' + FB.esc(node.name || '/') + '</div>' +
            acts.map(function (a) { return '<button type="button" class="menu-action" data-ctx="' + a[0] + '">' + FB.esc(a[1]) + '</button>'; }).join('');
        if (menu.matches(':popover-open')) { menu.hidePopover(); }
        menu.showPopover();
    }

    /* PUDL places a panel with no button as a palette; this one goes where
       it was asked for, once PUDL has had its turn. */
    document.addEventListener('toggle', function (e) {
        if (e.target !== menu || e.newState !== 'open' || !menuAt) { return; }
        var vw = document.documentElement.clientWidth, vh = window.innerHeight;
        if (vw <= 640) { return; }
        menu.style.left = Math.max(8, Math.min(menuAt.x, vw - menu.offsetWidth - 8)) + 'px';
        menu.style.top = Math.max(8, Math.min(menuAt.y, vh - menu.offsetHeight - 8)) + 'px';
        var first = menu.querySelector('.menu-action');
        if (first) { first.focus(); }
    }, true);
    document.addEventListener('toggle', function (e) {
        if (e.target === menu && e.newState === 'closed' && menuAt && menuAt.from && menuAt.from.isConnected && menu.contains(document.activeElement)) { menuAt.from.focus(); }
    }, true);
    window.addEventListener('resize', function () { if (menu.matches(':popover-open')) { menu.hidePopover(); } });

    menu.addEventListener('click', function (e) {
        var b = e.target.closest('[data-ctx]');
        if (!b || !menuNode) { return; }
        var node = menuNode, r = F.realOf(node), dir = dirOf(node);
        switch (b.getAttribute('data-ctx')) {
            case 'edit': open(node); break;
            case 'site': window.open(r.kind === 'link' ? r.url : F.publicUrl(r), '_blank', 'noopener'); break;
            case 'shell': request('shell', { path: F.pathOf(dir) }); break;
            case 'browse': request('browse', { path: F.pathOf(dir) }); break;
        }
    });

    tree.addEventListener('contextmenu', function (e) {
        var link = e.target.closest('a[data-path]');
        if (!link || !F) { return; }
        e.preventDefault();
        showMenu(link, e.clientX, e.clientY);
    });
    tree.addEventListener('keydown', function (e) {
        if (!(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) { return; }
        var link = e.target.closest('a[data-path]');
        if (!link || !F) { return; }
        e.preventDefault();
        var r = link.getBoundingClientRect();
        showMenu(link, r.left + 24, r.bottom);
    });

    /* === The desktop's settings ==========================================
       ~/.config/desktop.json (js/config.js), which the Settings applet
       changes: new windows, the theme, the background and the tree. */

    var settings = {}, bgUrl = null, browser = null;
    var stage = document.querySelector('.admin-stage');

    var IMAGE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };
    var FIT = {
        fill: 'center / cover no-repeat', fit: 'center / contain no-repeat',
        center: 'center / auto no-repeat', tile: 'top left / auto repeat'
    };

    /* Draws a background on an element: a colour, or a picture from ~ read
       through the mount and shown from a blob address. Resolves to the new
       address, and lets the old one go. Settings' preview uses it too. */
    async function paint(el, s, oldUrl) {
        var url = null;
        el.style.background = '';
        if (s.bgKind === 'color' && /^#[0-9a-f]{3,8}$/i.test(s.bgColor || '')) {
            el.style.background = s.bgColor;
        } else if (s.bgKind === 'image' && s.bgImage && F) {
            var n = F.resolve(F.home(), s.bgImage);
            var ext = String(s.bgImage).split('.').pop().toLowerCase();
            if (n && !n.children && IMAGE_TYPES[ext]) {
                try {
                    url = URL.createObjectURL(new Blob([await F.readBytes(n)], { type: IMAGE_TYPES[ext] }));
                    el.style.background = 'url("' + url + '") ' + (FIT[s.bgFit] || FIT.fill);
                } catch (err) { url = null; }
            }
        }
        if (oldUrl) { URL.revokeObjectURL(oldUrl); }
        return url;
    }
    window.pcDesktopBackground = paint;

    async function apply(s) {
        var before = settings;
        settings = s;
        if (s.theme && window.pudlSetTheme && window.pudlThemePreference && window.pudlThemePreference() !== s.theme) { window.pudlSetTheme(s.theme); }
        if (stage && (s.bgKind !== before.bgKind || s.bgColor !== before.bgColor || s.bgImage !== before.bgImage || s.bgFit !== before.bgFit)) {
            bgUrl = await paint(stage, s, bgUrl);
        }
        if (browser && !!s.treeHidden !== !!before.treeHidden) { browser.showHidden(!!s.treeHidden); }
    }

    /* A window opened from outside any window, by Start or the tree, opens
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

    /* === Start =========================================================== */

    var fs = window.pcSiteFs ? Promise.resolve() : loadScript(window.pcSiteFsSrc || '/js/sitefs.js');
    var fb = window.pcFileBrowser ? Promise.resolve() : loadScript(window.pcFileBrowserSrc || '/js/filebrowser.js');
    var cf = window.pcConfig ? Promise.resolve() : loadScript(window.pcConfigSrc || '/js/config.js');
    Promise.all([fs, fb, cf]).then(function () {
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
