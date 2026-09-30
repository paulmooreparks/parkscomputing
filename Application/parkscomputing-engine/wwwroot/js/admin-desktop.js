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
        menu.innerHTML = '<div class="md-section-label">' + FB.esc(node.name || 'Site') + '</div>' +
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

    /* === Start =========================================================== */

    var fs = window.pcSiteFs ? Promise.resolve() : loadScript(window.pcSiteFsSrc || '/js/sitefs.js');
    var fb = window.pcFileBrowser ? Promise.resolve() : loadScript(window.pcFileBrowserSrc || '/js/filebrowser.js');
    Promise.all([fs, fb]).then(function () {
        F = window.pcSiteFs; FB = window.pcFileBrowser;
        return F.load();
    }).then(function () {
        tree.insertAdjacentHTML('beforeend', FB.markup.body({ list: false, treeLabel: 'Files' }));
        FB.create(tree, F, { treeFiles: true, toggleFolders: true, onOpen: open, say: say });
        say('');
    }).catch(function (err) {
        say('The files could not be loaded: ' + err.message + '.');
    });
})();
