/* The Pins applet (Architecture/pins-design.md): the reader's pins in their
   order, each to move up or down or remove, and below them everything on
   the site that can be pinned, to add. It changes the pins through
   window.pcPins (js/pins.js), so the menu bar's pins group, every window
   menu and other tabs follow at once, and the pins are kept where they
   always are: the reader's account, or this browser. Reached from the
   Pins menu's Manage pins, as a window in the window view and at /pins. */
(function () {
    'use strict';

    /* A pin's icon as the taskbar shows it: its own image, the app glyph
       for an applet, or the site's. */
    function icon(p) {
        var el;
        if (p.icon || !p.applet) {
            el = document.createElement('img');
            el.src = p.icon || '/favicon-16x16.png';
            el.alt = '';
        } else {
            el = document.createElement('span');
            el.className = 'glyph';
            el.style.setProperty('--glyph', 'var(--glyph-app)');
        }
        el.classList.add('pins-icon');
        el.setAttribute('aria-hidden', 'true');
        return el;
    }

    function button(label, run, disabled, cls) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-sm' + (cls ? ' ' + cls : '');
        b.textContent = label;
        b.disabled = !!disabled;
        b.addEventListener('click', run);
        return b;
    }

    /* The pin's title as a link to it, which opens it as a pin opens. */
    function title(p) {
        var a = document.createElement('a');
        a.className = 'pins-title';
        a.href = window.pcPins.href(p);
        a.textContent = p.title;
        a.addEventListener('click', function (e) {
            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) { return; }
            if (window.pcPins.open(p)) { e.preventDefault(); }
        });
        return a;
    }

    /* Every page and applet of the site, by section, from the tree the
       terminal's /site is built from; external links and scripts are not
       pins. */
    var catalog = null;
    function loadCatalog() {
        if (catalog) { return Promise.resolve(catalog); }
        return fetch('/api/site/tree', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
            .then(function (r) { if (!r.ok) { throw new Error(r.status); } return r.json(); })
            .then(function (tree) {
                var sections = [];
                function add(name, entries) {
                    var items = (entries || []).filter(function (e) { return e.kind === 'page' || e.kind === 'app'; })
                        .map(function (e) { return { key: e.name, chapter: null, title: e.title || e.name, icon: e.icon || null, applet: e.kind === 'app' }; });
                    if (items.length) { sections.push({ name: name, items: items }); }
                }
                var loose = [];
                (tree.children || []).forEach(function (c) {
                    if (c.kind === 'dir' && c.name !== 'bin') { add(c.title || c.name, c.children); }
                    else if (c.kind === 'page' || c.kind === 'app') { loose.push(c); }
                });
                add('Pages', loose);
                catalog = sections;
                return catalog;
            });
    }

    pudlApplets.register('pins', {
        init: function (root) {
            if (!window.pcPins) { root.textContent = 'Pins are not available on this page.'; return { destroy: function () { } }; }
            root.classList.add('pins-applet');
            root.innerHTML =
                '<section class="pins-section" aria-labelledby="pins-yours">' +
                '<h2 class="pins-subtitle" id="pins-yours">Your pins</h2>' +
                '<p class="form-help" data-pins-empty hidden>Nothing is pinned yet. Pin something below, or with Pin in the Pins menu or a window\'s own menu.</p>' +
                '<ol class="pins-list" data-pins-list></ol>' +
                '</section>' +
                '<section class="pins-section" aria-labelledby="pins-add">' +
                '<h2 class="pins-subtitle" id="pins-add">Add a pin</h2>' +
                '<div class="form-group"><label class="form-label" for="pins-filter">Find a page or applet</label>' +
                '<input class="form-input" id="pins-filter" type="search" autocomplete="off" spellcheck="false" placeholder="Type part of a title"></div>' +
                '<div class="pins-catalog" data-pins-catalog><p class="form-help">Loading the site’s pages…</p></div>' +
                '</section>';
            var listEl = root.querySelector('[data-pins-list]'), empty = root.querySelector('[data-pins-empty]');
            var catEl = root.querySelector('[data-pins-catalog]'), filter = root.querySelector('#pins-filter');

            /* Your pins: each with Move up, Move down and Remove. After a
               move, focus stays on the button pressed, now on the pin's new
               row, so a pin can be walked along with the keyboard. */
            function drawPins(focus) {
                var pins = window.pcPins.list();
                listEl.textContent = '';
                empty.hidden = pins.length > 0;
                pins.forEach(function (p, i) {
                    var li = document.createElement('li');
                    li.className = 'pins-row';
                    li.appendChild(icon(p));
                    li.appendChild(title(p));
                    var actions = document.createElement('span');
                    actions.className = 'pins-actions';
                    actions.appendChild(button('Move up', function () { window.pcPins.move(i, i - 1); refocus(i - 1, 'up'); }, i === 0));
                    actions.appendChild(button('Move down', function () { window.pcPins.move(i, i + 1); refocus(i + 1, 'down'); }, i === pins.length - 1));
                    actions.appendChild(button('Remove', function () { window.pcPins.remove(p); refocus(Math.min(i, window.pcPins.list().length - 1), 'remove'); }));
                    li.appendChild(actions);
                    listEl.appendChild(li);
                });
                if (focus) { focus(); }
            }
            function refocus(row, which) {
                var rows = listEl.querySelectorAll('.pins-row');
                if (!rows.length) { filter.focus(); return; }
                var r = rows[Math.max(0, Math.min(row, rows.length - 1))];
                var b = r.querySelectorAll('.pins-actions button')[which === 'up' ? 0 : which === 'down' ? 1 : 2];
                if (b && b.disabled) { b = r.querySelector('.pins-actions button:not([disabled])'); }
                if (b) { b.focus(); }
            }

            /* The site's pages and applets, by section, narrowed by the
               filter; each pins with one press, or says it is pinned. */
            function drawCatalog() {
                if (!catalog) { return; }
                var q = filter.value.trim().toLowerCase();
                catEl.textContent = '';
                var shown = 0;
                catalog.forEach(function (s) {
                    var items = s.items.filter(function (p) { return !q || p.title.toLowerCase().indexOf(q) >= 0; });
                    if (!items.length) { return; }
                    var h = document.createElement('h3');
                    h.className = 'pins-section-name';
                    h.textContent = s.name;
                    catEl.appendChild(h);
                    var ul = document.createElement('ul');
                    ul.className = 'pins-list';
                    items.forEach(function (p) {
                        var li = document.createElement('li');
                        li.className = 'pins-row';
                        li.appendChild(icon(p));
                        li.appendChild(title(p));
                        var actions = document.createElement('span');
                        actions.className = 'pins-actions';
                        var pinned = window.pcPins.has(p);
                        actions.appendChild(button(pinned ? 'Pinned' : 'Pin', function () { window.pcPins.add(p); }, pinned));
                        li.appendChild(actions);
                        ul.appendChild(li);
                        shown++;
                    });
                    catEl.appendChild(ul);
                });
                if (!shown) { catEl.innerHTML = '<p class="form-help">Nothing on the site matches that.</p>'; }
            }

            var off = window.pcPins.onChange(function () { drawPins(); drawCatalog(); });
            filter.addEventListener('input', drawCatalog);
            drawPins();
            loadCatalog().then(drawCatalog).catch(function () {
                catEl.innerHTML = '<p class="form-error">The site’s pages could not be loaded. Reload to try again.</p>';
            });

            return {
                /* The applet's identity menu, as every applet has; its work
                   is on its face. */
                menus: function () { return { titles: [{ label: 'Pin manager', items: window.pcAppletIdentity ? window.pcAppletIdentity(root) : [] }] }; },
                destroy: function () { off(); root.textContent = ''; root.classList.remove('pins-applet'); }
            };
        }
    });
})();
