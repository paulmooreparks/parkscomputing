/* The barcode tool as a PUDL applet (0.23.0). It makes barcodes from free
   data or from a layout of named fields, and reads a scanned value back
   into its fields. The encoding, rendering and layout model live in
   barcode-engine.js, which this script loads beside itself; this file is
   only the interface. Architecture/barcode-tool-design.md has the design.

   State is a query string (sym, data, layout, field values as f.<id>,
   options), so a barcode is a link: on the applet's own page it rides in
   the address, and elsewhere it goes through the applet state handshake.
   Imported layouts live only in this browser's storage. */
(function () {
    'use strict';

    var SELF_SRC = document.currentScript && document.currentScript.src;
    function beside(file) { return SELF_SRC ? SELF_SRC.replace(/barcode-tool\.js/, file) : '/js/' + file; }
    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = function () { reject(new Error('could not load ' + src)); };
            document.head.appendChild(s);
        });
    }
    /* The engine, and the QR library it wraps. Without the library the
       engine still loads and QR Code says it is unavailable. */
    var engineReady = null;
    function loadEngine() {
        if (window.pcBarcode && window.pcBarcode.demos) { return Promise.resolve(window.pcBarcode); }
        if (!engineReady) {
            var qr = window.qrcodegen ? Promise.resolve() : loadScript(beside('vendor/qrcodegen-1.8.0.js')).catch(function () { });
            engineReady = qr.then(function () { return loadScript(beside('barcode-engine.js')); })
                .then(function () { return window.pcBarcode; });
        }
        return engineReady;
    }

    /* The site filesystem and the file browser, for Open and Save as. They
       load the first time either is used, from the addresses js/applets.js
       names, so a page that never saves a file never fetches the site tree. */
    var filesReady = null;
    function loadFiles() {
        if (!filesReady) {
            var fs = window.pcSiteFs ? Promise.resolve() : loadScript(window.pcSiteFsSrc || beside('sitefs.js'));
            var fb = window.pcFileBrowser ? Promise.resolve() : loadScript(window.pcFileBrowserSrc || beside('filebrowser.js'));
            filesReady = Promise.all([fs, fb])
                .then(function () { return window.pcSiteFs.load(); })
                .then(function () { return { F: window.pcSiteFs, FB: window.pcFileBrowser }; })
                .catch(function (err) { filesReady = null; throw err; });
        }
        return filesReady;
    }

    var LIBRARY_KEY = 'pc-barcode-layouts';
    var GUIDE_URL = '/page/barcode-tool-guide', GUIDE_KEY = 'barcode-tool-guide';

    var SYM_GROUPS = [
        ['Retail', ['ean13', 'ean8', 'upca', 'upce']],
        ['Logistics', ['gs1-128', 'itf14', 'itf']],
        ['General', ['code128', 'code39', 'codabar']],
        ['Two-dimensional', ['qr']]
    ];
    var SAMPLE_DATA = {
        ean13: '480036140036', ean8: '9638507', upca: '03600029145', upce: '0425261',
        'gs1-128': '(01)09501101530003(17)271231(10)LOT42A', itf14: '1540014128876', itf: '123420260929001234',
        code128: 'Hello, PUDL 2026', code39: 'CODE-39', codabar: '40156',
        qr: 'https://parkscomputing.com/page/barcodes'
    };
    var ECC_LEVELS = [['L', 'L (7%)'], ['M', 'M (15%)'], ['Q', 'Q (25%)'], ['H', 'H (30%)']];
    var MODULE_MM = [['0.264', '0.264 mm (80%)'], ['0.33', '0.33 mm (100%)'], ['0.40', '0.40 mm'], ['0.495', '0.495 mm (150%)'], ['0.66', '0.66 mm (200%)']];

    var uid = 0;
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    function libraryFile(list) {
        return JSON.stringify({ format: 'pc-barcode-layouts', version: 1, layouts: list }, null, 2);
    }
    function loadLibrary() {
        try {
            var raw = localStorage.getItem(LIBRARY_KEY);
            if (!raw) { return []; }
            var obj = JSON.parse(raw);
            return Array.isArray(obj.layouts) ? obj.layouts : [];
        } catch (err) { return []; }
    }
    function cacheLibrary(list) {
        try { localStorage.setItem(LIBRARY_KEY, JSON.stringify({ format: 'pc-barcode-layouts', version: 1, layouts: list })); } catch (err) { }
    }

    /* A linked layouts file (File System Access, Edge and Chrome): the
       handle is kept in IndexedDB, since it cannot go in localStorage, and
       the browser asks again for permission after a restart. Everything
       here fails soft: without the API or the database, the library is
       simply the browser's own copy. */
    var FILE_API = typeof window.showOpenFilePicker === 'function' && typeof window.showSaveFilePicker === 'function';
    var DB_NAME = 'pc-barcodes', HANDLE_KEY = 'library-file';
    function idb(op, value) {
        return new Promise(function (resolve, reject) {
            if (!window.indexedDB) { reject(new Error('no IndexedDB')); return; }
            var open = indexedDB.open(DB_NAME, 1);
            open.onupgradeneeded = function () { open.result.createObjectStore('kv'); };
            open.onerror = function () { reject(open.error); };
            open.onsuccess = function () {
                var db = open.result;
                try {
                    var tx = db.transaction('kv', op === 'get' ? 'readonly' : 'readwrite'), store = tx.objectStore('kv');
                    var req = op === 'get' ? store.get(HANDLE_KEY) : op === 'delete' ? store.delete(HANDLE_KEY) : store.put(value, HANDLE_KEY);
                    req.onsuccess = function () { resolve(req.result); };
                    req.onerror = function () { reject(req.error); };
                    tx.oncomplete = function () { db.close(); };
                } catch (err) {
                    /* put() throws at once for a value it cannot store. */
                    db.close();
                    reject(err);
                }
            };
        });
    }
    function readHandle(handle) {
        return handle.getFile().then(function (f) { return f.text(); }).then(function (text) { return JSON.parse(text); });
    }
    function writeHandle(handle, list) {
        return handle.createWritable().then(function (w) {
            return w.write(libraryFile(list)).then(function () { return w.close(); });
        });
    }

    function parseState(s) {
        var q = new URLSearchParams((s || '').replace(/^[?]/, ''));
        var st = { mode: q.get('m') === 'read' ? 'read' : 'make', sym: q.get('s') || 'ean13', data: q.get('d'), layout: q.get('l') || '', fields: {}, opts: {}, flags: {}, mm: q.get('mw') || '0.33', scan: q.get('scan') || '' };
        q.forEach(function (v, k) {
            if (k.indexOf('f.') === 0) { st.fields[k.slice(2)] = v; }
            if (k.indexOf('x.') === 0) { st.opts[k.slice(2)] = v; }
        });
        var o = q.get('o');
        st.flags = o === null ? { text: true, checks: true, colors: true } : { text: /t/.test(o), checks: /c/.test(o), structure: /s/.test(o), colors: /f/.test(o), annotate: /a/.test(o) };
        return st;
    }

    function stateString(st) {
        var q = new URLSearchParams();
        if (st.mode === 'read') {
            q.set('m', 'read');
            if (st.scan) { q.set('scan', st.scan); }
            return q.toString();
        }
        q.set('s', st.sym);
        if (st.layout) {
            q.set('l', st.layout);
            Object.keys(st.fields).forEach(function (k) { if (st.fields[k] !== '' && st.fields[k] != null) { q.set('f.' + k, st.fields[k]); } });
        } else if (st.data != null) {
            q.set('d', st.data);
        }
        Object.keys(st.opts).forEach(function (k) { if (st.opts[k] !== '' && st.opts[k] != null) { q.set('x.' + k, st.opts[k]); } });
        var f = st.flags, o = (f.text ? 't' : '') + (f.checks ? 'c' : '') + (f.structure ? 's' : '') + (f.colors ? 'f' : '') + (f.annotate ? 'a' : '');
        if (o !== 'tcf') { q.set('o', o || '-'); }
        if (st.mm !== '0.33') { q.set('mw', st.mm); }
        return q.toString();
    }

    function init(root, opts) {
        opts = opts || {};
        var ownUrl = !!opts.ownsUrl;
        root.classList.add('pc-barcodes');
        root.innerHTML = '<p class="bt-loading">Loading the barcode engine…</p>';
        var instance = { destroyed: false, destroy: function () { this.destroyed = true; if (this.cleanup) { this.cleanup(); } } };

        var initial = ownUrl && location.search ? location.search : (typeof opts.state === 'string' ? opts.state : '');
        loadEngine().then(function (B) {
            if (instance.destroyed) { return; }
            build(root, opts, B, parseState(initial), instance);
        }, function (err) {
            root.innerHTML = '<p class="form-error">The barcode engine did not load: ' + esc(err.message) + '</p>';
        });
        return instance;
    }

    function build(root, opts, B, st, instance) {
        var n = ++uid;
        var ownUrl = !!opts.ownsUrl;
        var library = loadLibrary();
        /* The demonstration layouts are the engine's, which the scanner
           shares. */
        var DEMOS = B.demos;

        function allLayouts() { return DEMOS.concat(library); }
        function findLayout(id) {
            for (var i = 0; i < library.length; i++) { if (library[i].id === id) { return library[i]; } }
            for (var j = 0; j < DEMOS.length; j++) { if (DEMOS[j].id === id) { return DEMOS[j]; } }
            return null;
        }
        function isDemo(id) { return DEMOS.some(function (d) { return d.id === id; }); }

        /* A state naming a layout but no values (a preset link, say) starts
           from the layout's sample; one naming neither starts from the
           symbology's sample data. */
        function fillDefaults() {
            var L = st.layout ? findLayout(st.layout) : null;
            if (L) {
                st.sym = L.symbology;
                if (!Object.keys(st.fields).length && L.sample) { Object.keys(L.sample).forEach(function (k) { st.fields[k] = L.sample[k]; }); }
                if (!Object.keys(st.opts).length && L.options) { st.opts = Object.assign({}, L.options); }
            } else if (st.data == null) {
                st.data = SAMPLE_DATA[st.sym] || '';
            }
        }
        fillDefaults();

        var symOptions = SYM_GROUPS.map(function (g) {
            return '<optgroup label="' + g[0] + '">' + g[1].map(function (id) {
                return '<option value="' + id + '">' + esc(B.symbologies[id].name) + '</option>';
            }).join('') + '</optgroup>';
        }).join('');

        root.innerHTML =
            '<div class="bt-toolbar">' +
            '<div class="seg" role="group" aria-label="Mode">' +
            '<button type="button" data-mode="make">Make</button>' +
            '<button type="button" data-mode="read">Read</button>' +
            '</div>' +
            '<span class="bt-make-only bt-tools">' +
            '<select class="form-select" data-role="sym" aria-label="Symbology">' + symOptions + '</select>' +
            '<span class="menu">' +
            '<button type="button" class="btn menu-btn" popovertarget="bt-layouts-' + n + '" data-role="layout-btn">Layout</button>' +
            '<nav class="menu-panel" id="bt-layouts-' + n + '" popover aria-label="Layouts" data-role="layout-menu"></nav>' +
            '</span>' +
            '</span>' +
            '<span class="bt-spacer"></span>' +
            '<button type="button" class="btn" data-action="help" aria-haspopup="dialog">Help</button>' +
            '</div>' +
            '<div class="notice" data-role="notice" hidden><span data-role="notice-text"></span>' +
            '<button type="button" class="btn btn-primary" data-role="notice-action" hidden></button>' +
            '<button type="button" class="btn" data-action="notice-close">Dismiss</button></div>' +
            '<section class="bt-editor" data-role="editor" hidden aria-labelledby="bt-editor-title-' + n + '">' +
            '<header class="bt-editor-head">' +
            '<h2 class="bt-editor-title" id="bt-editor-title-' + n + '" data-role="editor-title">New layout</h2>' +
            '<button type="button" class="btn" data-action="editor-cancel">Cancel</button>' +
            '<button type="button" class="btn btn-primary" data-action="editor-save">Save layout</button>' +
            '</header>' +
            '<div class="bt-editor-body" data-role="editor-body">' +
            '<div class="form-error bt-editor-errors" data-role="editor-errors" role="alert" hidden></div>' +
            '<section class="bt-editor-section">' +
            '<h3 class="bt-editor-heading">Layout</h3>' +
            '<div class="bt-editor-grid">' +
            '<div class="form-group"><label class="form-label" for="bt-editor-name-' + n + '">Name</label><input class="form-input" id="bt-editor-name-' + n + '" data-editor="name" autocomplete="off" /></div>' +
            '<div class="form-group"><label class="form-label" for="bt-editor-id-' + n + '">Identifier</label><input class="form-input" id="bt-editor-id-' + n + '" data-editor="id" autocomplete="off" spellcheck="false" /></div>' +
            '<div class="form-group"><label class="form-label" for="bt-editor-sym-' + n + '">Symbology</label><select class="form-select" id="bt-editor-sym-' + n + '" data-editor="sym">' + symOptions + '</select></div>' +
            '</div>' +
            '<div class="form-group"><label class="form-label" for="bt-editor-description-' + n + '">Description</label><textarea class="form-textarea" id="bt-editor-description-' + n + '" data-editor="description" rows="2"></textarea></div>' +
            '<div class="form-group"><label class="form-label" for="bt-editor-explain-' + n + '">Explanation</label><input class="form-input" id="bt-editor-explain-' + n + '" data-editor="explain" autocomplete="off" placeholder="Item {item} at {price}." />' +
            '<p class="form-help">The line under the barcode. Write a field\'s identifier in braces to show its value.</p></div>' +
            '</section>' +
            '<section class="bt-editor-section">' +
            '<div class="bt-editor-section-head"><h3 class="bt-editor-heading">Fields, in barcode order</h3>' +
            '<button type="button" class="btn btn-sm" data-action="editor-add-field">Add field</button></div>' +
            '<p class="form-help" data-role="editor-empty" hidden>There are no fields yet. Add one to start the barcode\'s data.</p>' +
            '<ol class="bt-editor-fields" data-role="editor-fields"></ol>' +
            '<p class="form-help">Type test values into the fields on the left.</p>' +
            '</section>' +
            '</div>' +
            '</section>' +
            '<section class="bt-make" data-role="make">' +
            '<p class="bt-layout-desc" data-role="layout-desc" hidden></p>' +
            '<div class="bt-free" data-role="free">' +
            '<div class="form-group">' +
            '<label class="form-label" for="bt-data-' + n + '">Data</label>' +
            '<input class="form-input bt-data" id="bt-data-' + n + '" data-role="data" autocomplete="off" spellcheck="false" />' +
            '<p class="form-help" data-role="help"></p>' +
            '<p class="form-error" data-role="error" hidden></p>' +
            '</div>' +
            '</div>' +
            '<div class="bt-fields" data-role="fields" hidden></div>' +
            '<div class="bt-symopts" data-role="symopts"></div>' +
            '<div class="bt-preview">' +
            '<div class="bt-well"><canvas data-role="canvas" role="img" aria-label="Barcode"></canvas></div>' +
            '<p class="bt-status" data-role="status"></p>' +
            '<ul class="bt-legend" data-role="legend" hidden></ul>' +
            '<p class="bt-explain" data-role="explain" hidden></p>' +
            '</div>' +
            '<div class="bt-actions">' +
            '<div class="bt-controls">' +
            '<label class="check" data-linear-only><input type="checkbox" data-flag="text" /> Text</label>' +
            '<label class="check" data-linear-only><input type="checkbox" data-flag="checks" /> Check digits</label>' +
            '<label class="check"><input type="checkbox" data-flag="structure" /> <span data-role="structure-label">Guards, start and stop</span></label>' +
            '<label class="check" data-role="colors-flag"><input type="checkbox" data-flag="colors" /> Field colors</label>' +
            '</div>' +
            '<div class="bt-controls">' +
            '<select class="form-select" data-role="mm" aria-label="Module width for downloads">' +
            MODULE_MM.map(function (m) { return '<option value="' + m[0] + '">' + m[1] + '</option>'; }).join('') +
            '</select>' +
            '<label class="check"><input type="checkbox" data-flag="annotate" /> Highlights in downloads</label>' +
            '<button type="button" class="btn" data-action="svg">Save SVG…</button>' +
            '<button type="button" class="btn" data-action="png">Save PNG…</button>' +
            '<button type="button" class="btn" data-action="link">Copy link</button>' +
            '</div>' +
            '</div>' +
            '</section>' +
            '<section class="bt-read" data-role="read" hidden>' +
            '<div class="form-group">' +
            '<label class="form-label" for="bt-scan-' + n + '">Scanned or typed value</label>' +
            '<input class="form-input bt-data" id="bt-scan-' + n + '" data-role="scan" autocomplete="off" spellcheck="false" placeholder="Digits, or GS1 element strings like (01)09501101530003(17)271231" />' +
            '<p class="form-help">Every layout whose shape fits is tried, and the value is split into its fields.</p>' +
            '</div>' +
            '<div data-role="results"></div>' +
            '</section>' +
            '<dialog class="dialog bt-json-dialog" data-role="json-dialog" aria-labelledby="bt-json-title-' + n + '">' +
            '<h3 class="dialog-title" id="bt-json-title-' + n + '">Layout JSON</h3>' +
            '<div class="dialog-body">' +
            '<p class="form-help">One layout object. The <a href="' + GUIDE_URL + '#format" data-win-open="' + GUIDE_KEY + '">guide</a> describes every key. It is saved in this browser, and in your layouts file if one is linked.</p>' +
            '<textarea class="form-textarea bt-json" data-role="json" spellcheck="false" aria-label="Layout JSON"></textarea>' +
            '<ul class="form-error bt-json-errors" data-role="json-errors" hidden></ul>' +
            '<p class="form-help" data-role="json-file" hidden>Or <a href="#" data-action="edit-file">edit every layout at once</a>, as the file ~/barcode-layouts.json. This dialog closes without saving.</p>' +
            '</div>' +
            '<div class="dialog-actions">' +
            '<button type="button" class="btn" data-action="json-cancel">Cancel</button>' +
            '<button type="button" class="btn btn-primary" data-action="json-save">Save layout</button>' +
            '</div>' +
            '</dialog>' +
            '<dialog class="dialog bt-remove-dialog" data-role="remove-dialog" aria-labelledby="bt-remove-title-' + n + '">' +
            '<h3 class="dialog-title" id="bt-remove-title-' + n + '">Remove this layout</h3>' +
            '<div class="dialog-body"><p data-role="remove-text"></p></div>' +
            '<div class="dialog-actions">' +
            '<button type="button" class="btn" data-action="remove-cancel">Cancel</button>' +
            '<button type="button" class="btn btn-danger" data-action="remove-confirm">Remove</button>' +
            '</div>' +
            '</dialog>' +
            '<dialog class="dialog bt-help-dialog" data-role="help-dialog" aria-labelledby="bt-help-title-' + n + '">' +
            '<h3 class="dialog-title" id="bt-help-title-' + n + '">Using the barcode tool</h3>' +
            '<div class="dialog-body bt-help">' +
            '<p><strong>Make</strong> draws a barcode. Pick a symbology and type the data; the barcode redraws as you type. ' +
            'A problem is shown under the field, and a wrong check digit comes with a button that puts the right one in.</p>' +
            '<p><strong>Layouts</strong> describe data inside a barcode, such as an item and a price. Choose one from the ' +
            '<strong>Layout</strong> menu to fill in named fields instead of raw digits; each field gets its own color and ' +
            'the line under the barcode explains the result.</p>' +
            '<p><strong>Read</strong> works the other way: paste a scanned value and the tool splits it into the fields of ' +
            'every layout that fits, and checks its check digits and dates.</p>' +
            '<p>The check boxes mark check digits, guards and fields. <strong>Save SVG</strong> is sized in millimetres ' +
            'for printing; saved files leave the highlights out unless you ask for them. Saving puts a file in your ' +
            'home directory (~) on this site, or downloads it to your computer if you choose. <strong>Copy link</strong> ' +
            'reproduces the exact barcode.</p>' +
            '<p>To make, edit, open or save layouts, use the window menu at the left of the title bar, or on the ' +
            'tool\'s own page the <strong>Commands</strong> menu above it. <strong>New layout</strong> and ' +
            '<strong>Edit</strong> open an editor beside the barcode, and the form shows the layout as you change it.</p>' +
            '<p>Your own layouts stay in this browser, or in a file on your disk if you link one. ' +
            'This site never receives them.</p>' +
            '<p><a href="' + GUIDE_URL + '" data-win-open="' + GUIDE_KEY + '">Read the full guide</a>, with the layout ' +
            'format and examples.</p>' +
            '</div>' +
            '<div class="dialog-actions">' +
            '<button type="button" class="btn btn-primary" data-action="help-close">Close</button>' +
            '</div>' +
            '</dialog>';

        var q = function (sel) { return root.querySelector(sel); };
        var el = {
            sym: q('[data-role="sym"]'), layoutBtn: q('[data-role="layout-btn"]'), layoutMenu: q('[data-role="layout-menu"]'),
            notice: q('[data-role="notice"]'), noticeText: q('[data-role="notice-text"]'),
            editor: q('[data-role="editor"]'), editorFields: q('[data-role="editor-fields"]'), editorEmpty: q('[data-role="editor-empty"]'), editorErrors: q('[data-role="editor-errors"]'), editorTitle: q('[data-role="editor-title"]'), editorBody: q('[data-role="editor-body"]'),
            make: q('[data-role="make"]'), read: q('[data-role="read"]'),
            layoutDesc: q('[data-role="layout-desc"]'), free: q('[data-role="free"]'), data: q('[data-role="data"]'),
            help: q('[data-role="help"]'), error: q('[data-role="error"]'), fields: q('[data-role="fields"]'),
            symopts: q('[data-role="symopts"]'), canvas: q('[data-role="canvas"]'), well: q('[data-role="make"] .bt-well'),
            status: q('[data-role="status"]'), legend: q('[data-role="legend"]'), explain: q('[data-role="explain"]'),
            mm: q('[data-role="mm"]'), scan: q('[data-role="scan"]'), results: q('[data-role="results"]'),
            dialog: q('[data-role="json-dialog"]'), json: q('[data-role="json"]'),
            jsonErrors: q('[data-role="json-errors"]'), jsonFile: q('[data-role="json-file"]'), colorsFlag: q('[data-role="colors-flag"]'),
            helpDialog: q('[data-role="help-dialog"]'), noticeAction: q('[data-role="notice-action"]'),
            removeDialog: q('[data-role="remove-dialog"]'), removeText: q('[data-role="remove-text"]')
        };

        var current = null;   /* the last good encode, for downloads */
        var currentBands = [], currentColors = [];

        /* A notice may carry one action, such as reopening a linked file,
           which needs the click to count as the reader's own gesture. */
        var noticeHandler = null;
        function notify(msg, actionLabel, handler) {
            el.noticeText.textContent = msg;
            el.noticeAction.hidden = !actionLabel;
            el.noticeAction.textContent = actionLabel || '';
            noticeHandler = handler || null;
            el.notice.hidden = false;
        }

        /* === The library: this browser, and a linked file if there is one */

        var linked = null;   /* the linked file's handle, once permission is granted */
        var pendingHandle = null;   /* a linked file awaiting permission after a restart */

        function writeLinked(list) {
            if (!linked) { return; }
            writeHandle(linked, list).catch(function (err) {
                notify('Your layouts are saved in this browser, but writing ' + linked.name + ' failed: ' + err.message);
            });
        }

        /* The site shows the library as ~/barcode-layouts.json in its
           shared filesystem, and pc:fs-change is how that filesystem says
           something changed; saying it here lets an editor with the file
           open in this page see the change. */
        function saveLibrary(list) {
            cacheLibrary(list);
            writeLinked(list);
            document.dispatchEvent(new CustomEvent('pc:fs-change', { detail: { reason: 'layouts' } }));
        }

        /* The library changed somewhere else: in an editor, the terminal
           or another tab. The tool takes the new library, passes it on to
           a linked file, and redraws; a layout that has gone is let go. */
        function onLibraryChange() {
            var fresh = loadLibrary();
            if (JSON.stringify(fresh) === JSON.stringify(library)) { return; }
            library = fresh;
            writeLinked(library);
            if (st.layout && !findLayout(st.layout)) { selectLayout(''); }
            else { buildForm(); update(); }
            renderLayoutMenu();
        }
        function onStorage(e) { if (e.key === LIBRARY_KEY || e.key === null) { onLibraryChange(); } }
        document.addEventListener('pc:fs-change', onLibraryChange);
        window.addEventListener('storage', onStorage);

        /* Adds layouts from a file to the library: file entries win on the
           same id, and demonstration ids are skipped. */
        function mergeLayouts(fromFile) {
            var incoming = fromFile.filter(function (L) { return !isDemo(L.id); });
            var ids = incoming.map(function (L) { return L.id; });
            library = library.filter(function (L) { return ids.indexOf(L.id) < 0; }).concat(incoming);
            return { added: incoming.length, skipped: fromFile.length - incoming.length };
        }

        function adoptHandle(handle, fromOpen) {
            return readHandle(handle).then(function (obj) {
                var res = B.layouts.validateFile(obj);
                if (!res.ok) { throw new Error(res.errors.slice(0, 2).join(' ')); }
                var inFile = res.layouts.filter(function (L) { return !isDemo(L.id); }).length;
                mergeLayouts(res.layouts);
                linked = handle; pendingHandle = null;
                cacheLibrary(library);
                /* Layouts that were only in the browser go into the file. */
                if (library.length !== inFile) { return writeHandle(handle, library); }
            }).then(function () {
                renderLayoutMenu();
                if (fromOpen) { notify('Linked to ' + handle.name + '. Changes to your layouts are written to it.'); }
                else { el.notice.hidden = true; }
            });
        }

        function linkExisting() {
            window.showOpenFilePicker({ types: [{ description: 'Barcode layouts', accept: { 'application/json': ['.json'] } }] })
                .then(function (handles) {
                    var h = handles[0];
                    return h.requestPermission({ mode: 'readwrite' }).then(function (p) {
                        if (p !== 'granted') { throw new Error('permission to write the file was refused'); }
                        return adoptHandle(h, true).then(function () { return idb('put', h).catch(function () { }); });
                    });
                })
                .catch(function (err) { if (err && err.name !== 'AbortError') { notify('The file was not linked: ' + err.message); } });
        }

        function linkNew() {
            window.showSaveFilePicker({ suggestedName: 'barcode-layouts.json', types: [{ description: 'Barcode layouts', accept: { 'application/json': ['.json'] } }] })
                .then(function (h) {
                    return writeHandle(h, library).then(function () {
                        linked = h; pendingHandle = null;
                        renderLayoutMenu();
                        notify('Created ' + h.name + ' with ' + library.length + ' layout' + (library.length === 1 ? '' : 's') + '. Changes are written to it.');
                        return idb('put', h).catch(function () { });
                    });
                })
                .catch(function (err) { if (err && err.name !== 'AbortError') { notify('The file was not created: ' + err.message); } });
        }

        function unlink() {
            var name = linked ? linked.name : pendingHandle ? pendingHandle.name : 'the file';
            linked = null; pendingHandle = null;
            idb('delete').catch(function () { });
            renderLayoutMenu();
            notify('Unlinked ' + name + '. Your layouts stay in this browser, and the file is left as it is.');
        }

        /* After a restart the browser keeps the handle but asks again for
           permission, which only a click can grant. */
        function restoreLink() {
            if (!FILE_API) { return; }
            idb('get').then(function (h) {
                if (!h || typeof h.queryPermission !== 'function') { return; }
                return h.queryPermission({ mode: 'readwrite' }).then(function (p) {
                    if (p === 'granted') { return adoptHandle(h, false); }
                    pendingHandle = h;
                    renderLayoutMenu();
                    notify('Your layouts file ' + h.name + ' is linked. Allow the tool to use it again?', 'Reopen', function () {
                        h.requestPermission({ mode: 'readwrite' }).then(function (p2) {
                            if (p2 === 'granted') { return adoptHandle(h, true); }
                            notify('The file stays linked, but the tool cannot use it until you allow it.');
                        }).catch(function (err) { notify('The file could not be reopened: ' + err.message); });
                    });
                });
            }).catch(function () { });
        }

        /* === State plumbing ============================================== */

        var writeTimer = null;
        function commit() {
            var s = stateString(st);
            if (ownUrl) {
                clearTimeout(writeTimer);
                writeTimer = setTimeout(function () {
                    history.replaceState(history.state, '', location.pathname + (s ? '?' + s : '') + location.hash);
                }, 250);
            }
            if (opts.changed) { opts.changed(s); }
        }

        /* === The layout editor ===========================================
           The editor works on a copy, the draft. While it is open the form
           on the left shows the draft, so its fields take test values and
           the barcode is the draft's; nothing reaches the library, the
           address or a link until Save. New starts an empty draft under an
           identifier no layout has; Edit starts from the layout on show, or
           from a copy of it when it is a demonstration. */

        var editorLayout = null;      /* the draft */
        var editorEditingId = null;   /* the saved layout the draft replaces, if any */
        var editorHeading = '';
        var editorIdAuto = false;     /* a new layout's identifier follows its name until typed */
        var editorOpen = new Set();   /* the draft's fields whose settings are showing */
        var formWidth = 0;            /* the form column's preferred width while editing */
        var EDITOR_TYPES = [['fixed', 'Fixed value'], ['number', 'Number'], ['decimal', 'Decimal'], ['text', 'Text'], ['date', 'Date'], ['enum', 'Enumeration'], ['check', 'Check digit']];

        function activeLayout() { return editorLayout || (st.layout ? findLayout(st.layout) : null); }

        function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'layout'; }
        function unusedLayoutId(base) {
            var id = base, i = 2;
            while (findLayout(id) && id !== editorEditingId) { id = base + '-' + i++; }
            return id;
        }

        /* The engine's messages name the layout "layout"; in the editor the
           reader already knows which layout. */
        function tidyLayoutError(msg) {
            var s = String(msg).replace(/^layout:? /, '');
            return s.charAt(0).toUpperCase() + s.slice(1);
        }

        function editorDefaultField() {
            var id = 'field', i = 2;
            while (editorLayout.fields.some(function (f) { return f.id === id; })) { id = 'field-' + i++; }
            return { id: id, name: 'New field', type: 'number', length: 4, color: 'gray' };
        }

        function fieldSummary(f) {
            var t = EDITOR_TYPES.filter(function (x) { return x[0] === f.type; })[0], d = '';
            switch (f.type) {
                case 'fixed': d = (Array.isArray(f.values) ? f.values : []).join(' or '); break;
                case 'number': d = f.length ? f.length + ' digits' : ''; break;
                case 'decimal': d = f.length ? f.length + ' digits, ' + (f.decimals || 0) + ' after the point' : ''; break;
                case 'text': d = f.length ? f.length + ' characters' : f.maxLength ? 'up to ' + f.maxLength + ' characters' : ''; break;
                case 'date': d = (f.format || '').toUpperCase(); break;
                case 'enum': var k = Object.keys(f.values || {}).length; d = k + (k === 1 ? ' code' : ' codes'); break;
                case 'check': d = (B.checks[f.algorithm] || {}).name || f.algorithm || ''; break;
            }
            if (f.ai) { d += (d ? ', ' : '') + 'AI (' + f.ai + ')'; }
            return (t ? t[1] : f.type) + (d ? ': ' + d : '');
        }

        function editorFieldRow(f, i) {
            var count = editorLayout.fields.length;
            var fid = function (key) { return 'bt-ef-' + n + '-' + i + '-' + key; };
            var attrs = function (key) { return ' id="' + fid(key) + '" data-editor-field="' + key + '" data-index="' + i + '"'; };
            var group = function (key, label, control, help) {
                return '<div class="form-group"><label class="form-label" for="' + fid(key) + '">' + label + '</label>' + control + (help ? '<p class="form-help">' + help + '</p>' : '') + '</div>';
            };
            var input = function (key, label, value, extra, help) {
                return group(key, label, '<input class="form-input"' + attrs(key) + ' value="' + esc(value == null ? '' : value) + '" autocomplete="off" spellcheck="false"' + (extra || '') + ' />', help);
            };
            var select = function (key, label, choices, current) {
                return group(key, label, '<select class="form-select"' + attrs(key) + '>' + choices.map(function (c) {
                    return '<option value="' + esc(c[0]) + '"' + (c[0] === current ? ' selected' : '') + '>' + esc(c[1]) + '</option>';
                }).join('') + '</select>');
            };
            var textarea = function (key, label, value, help) {
                return group(key, label, '<textarea class="form-textarea" rows="2"' + attrs(key) + ' spellcheck="false">' + esc(value) + '</textarea>', help);
            };
            var colors = B.layouts.colors.map(function (c) { return [c, c.charAt(0).toUpperCase() + c.slice(1)]; });
            var body = '<div class="bt-editor-grid">' +
                input('name', 'Name', f.name) + input('id', 'Identifier', f.id) +
                select('type', 'Type', EDITOR_TYPES, f.type) + select('color', 'Color', colors, f.color || 'gray') + '</div>';
            if (f.type === 'fixed') {
                body += textarea('values', 'Allowed values', (Array.isArray(f.values) ? f.values : []).join('\n'), 'One per line, all the same length.');
            } else if (f.type === 'enum') {
                body += textarea('enum', 'Codes', Object.keys(f.values || {}).map(function (k) { return k + '=' + f.values[k]; }).join('\n'), 'One per line, as code=meaning. Every code the same length.');
            } else if (f.type === 'number') {
                body += '<div class="bt-editor-grid">' + input('length', 'Digits', f.length, ' type="number" min="1"') +
                    select('pad', 'Shorter values', [['zeroes', 'Pad with zeroes'], ['none', 'Refuse']], f.pad === 'none' ? 'none' : 'zeroes') + '</div>';
            } else if (f.type === 'decimal') {
                body += '<div class="bt-editor-grid">' + input('length', 'Digits', f.length, ' type="number" min="1"') +
                    input('decimals', 'After the point', f.decimals, ' type="number" min="0"') +
                    input('prefix', 'Shown before', f.prefix, ' placeholder="$"') + input('suffix', 'Shown after', f.suffix, ' placeholder=" kg"') + '</div>';
            } else if (f.type === 'text') {
                body += '<div class="bt-editor-grid">' + input('length', 'Exact length', f.length, ' type="number" min="1"') +
                    input('maxLength', 'Maximum length', f.maxLength, ' type="number" min="1"') + '</div>' +
                    '<p class="form-help">Give one or the other. Only the last field may vary in length, except in GS1-128.</p>';
            } else if (f.type === 'date') {
                body += input('format', 'Format', f.format, ' placeholder="yymmdd"', 'Built from dd, mm, yy and yyyy.');
            } else if (f.type === 'check') {
                var covered = f.over || editorLayout.fields.slice(0, i).filter(function (g) { return g.type !== 'check'; }).map(function (g) { return g.id; });
                body += select('algorithm', 'Algorithm', Object.keys(B.checks).map(function (k) { return [k, B.checks[k].name || k]; }), f.algorithm) +
                    '<fieldset class="bt-editor-checks"><legend class="form-label">Computed over</legend>' +
                    editorLayout.fields.map(function (g, j) {
                        return j === i || g.type === 'check' ? '' : '<label class="check"><input type="checkbox" data-editor-field="over" data-index="' + i + '" value="' + esc(g.id) + '"' +
                            (covered.indexOf(g.id) >= 0 ? ' checked' : '') + ' /> <span data-cover-label="' + esc(g.id) + '">' + esc(g.name || g.id) + '</span></label>';
                    }).join('') + '</fieldset>';
            }
            if (editorLayout.symbology === 'gs1-128') {
                body += input('ai', 'Application Identifier', f.ai, ' placeholder="01"', 'Starts a new element string. Leave empty to continue the one before.');
            }
            body += '<div class="bt-ef-actions">' +
                '<button type="button" class="btn btn-sm" data-action="editor-up" data-index="' + i + '"' + (i ? '' : ' disabled') + '>Move up</button>' +
                '<button type="button" class="btn btn-sm" data-action="editor-down" data-index="' + i + '"' + (i + 1 < count ? '' : ' disabled') + '>Move down</button>' +
                '<button type="button" class="btn btn-sm btn-danger" data-action="editor-delete" data-index="' + i + '">Delete field</button></div>';
            return '<li class="bt-editor-field" data-color="' + esc(f.color || 'gray') + '" data-editor-row="' + i + '">' +
                '<details data-index="' + i + '"' + (editorOpen.has(f) ? ' open' : '') + '>' +
                '<summary><span class="bt-ef-name" data-role="ef-name">' + esc((i + 1) + '. ' + (f.name || f.id || 'Unnamed field')) + '</span>' +
                '<span class="bt-ef-meta" data-role="ef-meta">' + esc(fieldSummary(f)) + '</span></summary>' +
                '<div class="bt-ef-body">' + body + '</div></details></li>';
        }

        /* Brings one row's summary, color and the check boxes that name it
           up to date, without rebuilding the row the reader is typing in. */
        function refreshFieldRow(i) {
            var f = editorLayout.fields[i], row = el.editorFields.querySelector('[data-editor-row="' + i + '"]');
            if (!f || !row) { return; }
            row.setAttribute('data-color', f.color || 'gray');
            row.querySelector('[data-role="ef-name"]').textContent = (i + 1) + '. ' + (f.name || f.id || 'Unnamed field');
            row.querySelector('[data-role="ef-meta"]').textContent = fieldSummary(f);
            el.editorFields.querySelectorAll('[data-cover-label="' + CSS.escape(f.id) + '"]').forEach(function (s) { s.textContent = f.name || f.id; });
        }

        function renderEditor() {
            if (!editorLayout) { return; }
            el.editorTitle.textContent = editorHeading;
            q('[data-editor="name"]').value = editorLayout.name || '';
            q('[data-editor="id"]').value = editorLayout.id || '';
            q('[data-editor="sym"]').value = editorLayout.symbology || 'ean13';
            q('[data-editor="description"]').value = editorLayout.description || '';
            q('[data-editor="explain"]').value = editorLayout.explain || '';
            el.editorFields.innerHTML = editorLayout.fields.map(editorFieldRow).join('');
            el.editorEmpty.hidden = editorLayout.fields.length > 0;
            updateEditorPreview();
        }

        function readEditor() {
            if (!editorLayout) { return; }
            editorLayout.name = q('[data-editor="name"]').value;
            editorLayout.id = q('[data-editor="id"]').value.trim();
            editorLayout.symbology = q('[data-editor="sym"]').value;
            editorLayout.description = q('[data-editor="description"]').value;
            editorLayout.explain = q('[data-editor="explain"]').value;
            var renames = {};
            editorLayout.fields.forEach(function (f, i) {
                var previousId = f.id;
                el.editorFields.querySelectorAll('[data-index="' + i + '"][data-editor-field]').forEach(function (input) {
                    var key = input.getAttribute('data-editor-field'), value = input.value;
                    if (key === 'over') {
                        if (!f.over) { f.over = []; }
                        if (input.checked) { if (f.over.indexOf(value) < 0) { f.over.push(value); } }
                        else { f.over = f.over.filter(function (id) { return id !== value; }); }
                    }
                    else if (key === 'values') { f.values = value.split(/\r?\n/).map(function (v) { return v.trim(); }).filter(Boolean); }
                    else if (key === 'enum') {
                        f.values = {};
                        value.split(/\r?\n/).forEach(function (line) { var p = line.split('='); if (p[0].trim() && p.length > 1) { f.values[p[0].trim()] = p.slice(1).join('=').trim(); } });
                    }
                    else if (key === 'length' || key === 'maxLength' || key === 'decimals') { if (value === '') { delete f[key]; } else { f[key] = +value; } }
                    else if (key === 'ai' || key === 'prefix' || key === 'suffix') { if (value === '') { delete f[key]; } else { f[key] = value; } }
                    else if (key === 'pad') { if (value === 'none') { f.pad = 'none'; } else { delete f.pad; } }
                    else { f[key] = key === 'id' ? value.trim() : value; }
                });
                if (previousId !== f.id) { renames[previousId] = f.id; }
            });
            /* A renamed field keeps its test value and its place in the
               check digits that cover it. */
            Object.keys(renames).forEach(function (from) {
                var to = renames[from];
                editorLayout.fields.forEach(function (f) { if (f.over) { f.over = f.over.map(function (id) { return id === from ? to : id; }); } });
                if (Object.prototype.hasOwnProperty.call(editorLayout.sample, from)) { editorLayout.sample[to] = editorLayout.sample[from]; delete editorLayout.sample[from]; }
                el.editorFields.querySelectorAll('[data-editor-field="over"]').forEach(function (cb) { if (cb.value === from) { cb.value = to; } });
                el.editorFields.querySelectorAll('[data-cover-label]').forEach(function (s) { if (s.getAttribute('data-cover-label') === from) { s.setAttribute('data-cover-label', to); } });
            });
        }

        function updateEditorPreview() {
            buildForm(); update();
        }

        /* A field that changes type keeps only what every type has. */
        function changeEditorType(index, type) {
            var old = editorLayout.fields[index];
            var f = { id: old.id, name: old.name, type: type, color: old.color };
            if (old.ai) { f.ai = old.ai; }
            if (type === 'fixed') { f.values = ['0']; }
            else if (type === 'enum') { f.values = { '0': 'Option' }; }
            else if (type === 'date') { f.format = 'yymmdd'; }
            else if (type === 'check') { f.algorithm = Object.keys(B.checks)[0]; }
            else if (type === 'text') { f.maxLength = 20; }
            else if (type === 'decimal') { f.length = 5; f.decimals = 2; }
            else { f.length = 4; }
            editorLayout.fields[index] = f;
            if (editorOpen.delete(old)) { editorOpen.add(f); }
            delete editorLayout.sample[f.id];
        }

        function openEditor(L) {
            /* The menu can be used from Read, but the draft is shown in Make. */
            if (st.mode !== 'make') { setMode('make'); commit(); }
            if (L) {
                editorLayout = JSON.parse(JSON.stringify(L));
                editorLayout.sample = Object.assign({}, L.sample || {}, st.layout === L.id ? st.fields : {});
                if (isDemo(L.id)) {
                    editorEditingId = null;
                    editorLayout.id = unusedLayoutId(L.id.replace(/^demo-/, 'my-'));
                    editorLayout.name += ' (copy)';
                    editorHeading = 'Copy of ' + L.name;
                } else {
                    editorEditingId = L.id;
                    editorHeading = 'Edit layout';
                }
                editorIdAuto = false;
            } else {
                editorEditingId = null;
                editorLayout = { id: unusedLayoutId('new-layout'), name: 'New layout', symbology: st.sym, description: '', explain: '', sample: {}, fields: [] };
                editorHeading = 'New layout';
                editorIdAuto = true;
            }
            editorOpen = new Set();
            el.editorErrors.hidden = true;
            /* The form keeps the width it has now; the editor is added
               beside it rather than taking width from it. */
            formWidth = root.getBoundingClientRect().width;
            root.style.setProperty('--bt-form-w', formWidth + 'px');
            root.classList.add('bt-editing'); el.editor.hidden = false;
            renderEditor();
            el.editorBody.scrollTop = 0;
            var name = q('[data-editor="name"]');
            name.focus();
            if (!L) { name.select(); }
        }

        function closeEditor(saved) {
            if (!editorLayout) { return; }
            editorLayout = null; editorEditingId = null; editorOpen = new Set();
            root.classList.remove('bt-editing'); el.editor.hidden = true;
            root.style.removeProperty('--bt-form-w');
            if (!saved) { buildForm(); update(); setMode(st.mode); el.layoutBtn.focus(); }
        }

        function saveEditor() {
            readEditor();
            var errs = B.layouts.validate(editorLayout).map(tidyLayoutError);
            var other = findLayout(editorLayout.id);
            if (other && editorLayout.id !== editorEditingId) {
                errs.unshift(isDemo(other.id)
                    ? 'The identifier "' + editorLayout.id + '" belongs to a demonstration layout. Choose another.'
                    : 'The layout "' + other.name + '" already uses the identifier "' + editorLayout.id + '". Choose another.');
            }
            if (errs.length) {
                /* Open the fields the problems name, so each is in view. */
                errs.forEach(function (e) { var m = /^Field (\d+)/.exec(e); if (m && editorLayout.fields[m[1] - 1]) { editorOpen.add(editorLayout.fields[m[1] - 1]); } });
                renderEditor();
                el.editorErrors.innerHTML = '<ul>' + errs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>';
                el.editorErrors.hidden = false;
                el.editorBody.scrollTop = 0;
                return;
            }
            library = library.filter(function (x) { return x.id !== editorLayout.id && x.id !== editorEditingId; });
            library.push(editorLayout); saveLibrary(library); el.editorErrors.hidden = true;
            var id = editorLayout.id; closeEditor(true); selectLayout(id); el.layoutBtn.focus();
        }

        function onEditorToggle(e) {
            var d = e.target;
            if (!editorLayout || d.tagName !== 'DETAILS' || !el.editorFields.contains(d)) { return; }
            var f = editorLayout.fields[+d.getAttribute('data-index')];
            if (f) { if (d.open) { editorOpen.add(f); } else { editorOpen.delete(f); } }
        }

        /* === Layout menu =================================================
           The Layout menu only chooses a layout; what is done with layouts
           is in the commands below it. */

        function renderLayoutMenu() {
            var L = st.layout ? findLayout(st.layout) : null;
            el.layoutBtn.textContent = editorLayout ? 'Layout: ' + (editorLayout.name || 'Untitled') + ' (draft)' : L ? 'Layout: ' + L.name : 'Layout: none';
            el.layoutBtn.disabled = !!editorLayout;
            var html = '<button type="button" class="menu-action" data-layout="">No layout (free data)</button>';
            html += '<hr class="menu-sep" /><div class="md-section-label">Demonstrations</div>';
            DEMOS.forEach(function (d) {
                html += '<button type="button" class="menu-action" data-layout="' + esc(d.id) + '">' + esc(d.name) + ' <span class="bt-menu-sym">' + esc(B.symbologies[d.symbology].name) + '</span></button>';
            });
            if (library.length) {
                var where = linked ? 'in ' + linked.name : 'in this browser';
                html += '<hr class="menu-sep" /><div class="md-section-label">Your layouts (' + esc(where) + ')</div>';
                library.forEach(function (d) {
                    html += '<button type="button" class="menu-action" data-layout="' + esc(d.id) + '">' + esc(d.name) + ' <span class="bt-menu-sym">' + esc((B.symbologies[d.symbology] || {}).name || d.symbology) + '</span></button>';
                });
            }
            el.layoutMenu.innerHTML = html;
        }

        /* === Commands ====================================================
           What the tool does with layouts, as distinct from choosing one.
           On a page with PUDL's menu bar they are the Barcode Tool's menu
           there, from menus(); on a page without one, such as a page framed
           in a window, they are PUDL's window menu or Commands menu, from
           commands(), which PUDL ignores while a menu bar is on the page.
           They are built afresh each time a menu opens, so their names are
           always those of the layout on show. While a layout is being
           edited the editor's own Cancel and Save are the only way out, so
           the commands are off. */
        function menus() {
            var L = st.layout ? findLayout(st.layout) : null, demo = L && isDemo(L.id), busy = !!editorLayout;
            var cmd = function (label, run, off) { return { label: label, run: run, disabled: busy || !!off }; };
            var file = [
                cmd('Open layouts…', openLayouts),
                cmd('Save this layout as…', saveLayoutAs, !L),
                cmd('Save all layouts as…', exportLayouts)
            ];
            /* A linked file is a different thing from opening and saving:
               the library kept in step with a file on the reader's disk. */
            if (FILE_API) {
                file.push('-');
                if (linked || pendingHandle) { file.push(cmd('Unlink the layouts file ' + (linked || pendingHandle).name, unlink)); }
                else { file.push(cmd('Create a linked layouts file…', linkNew), cmd('Link an existing layouts file…', linkExisting)); }
            }
            return {
                titles: [
                    { label: 'Barcode Tool', items: window.pcAppletIdentity(root) },
                    /* File comes first after the tool's own name, as it
                       does in every desktop application. */
                    { id: 'file', label: 'File', items: file },
                    {
                        label: 'Layout', items: [
                            cmd('New layout…', function () { openEditor(null); }),
                            cmd(L ? (demo ? 'Edit a copy of ' : 'Edit ') + L.name + '…' : 'Edit the layout…', function () { openEditor(L); }, !L),
                            '-',
                            cmd('New layout from JSON…', function () { openJson(null); }),
                            cmd(demo ? 'Copy this layout as JSON…' : 'Edit this layout as JSON…', function () { openJson(L); }, !L),
                            '-',
                            { label: 'Remove this layout…', run: askRemove, danger: true, disabled: busy || !L || demo }
                        ]
                    }
                ], into: { help: [{ label: 'Barcode Tool help', run: function () { el.helpDialog.showModal(); } }] }
            };
        }

        /* The same commands as one list, for PUDL's window menu on a page
           with no menu bar; those that are off are left out, as before. */
        function commands() {
            if (editorLayout) { return []; }
            var out = [];
            menus().titles.slice(1).forEach(function (t) {
                t.items.forEach(function (it) { if (it && it.run && !it.disabled) { out.push({ label: it.label, run: it.run }); } });
            });
            return out;
        }

        function saveLayoutAs() {
            var cur = findLayout(st.layout);
            if (!cur) { return; }
            var copy = JSON.parse(JSON.stringify(cur));
            /* A demonstration saves as a copy under its own id, so it
               imports as a layout of your own. */
            if (isDemo(copy.id)) { copy.id = copy.id.replace(/^demo-/, 'my-'); copy.name += ' (copy)'; }
            saveFile(copy.id + '.json', 'Save this layout as', new Blob([libraryFile([copy])], { type: 'application/json' }));
        }

        /* Everything the menu lists, demonstrations included; opening the
           file again skips those. */
        function exportLayouts() {
            saveFile('all-layouts.json', 'Save all layouts as', new Blob([libraryFile(DEMOS.concat(library))], { type: 'application/json' }));
        }

        function askRemove() {
            var L = findLayout(st.layout);
            if (!L || isDemo(L.id)) { return; }
            el.removeText.textContent = 'Remove "' + L.name + '" from your layouts? Links that use it will no longer show its fields.' +
                (linked ? ' It is also removed from ' + linked.name + '.' : '');
            el.removeDialog.showModal();
        }

        function removeLayout() {
            el.removeDialog.close();
            library = library.filter(function (L) { return L.id !== st.layout; });
            saveLibrary(library);
            selectLayout('');
        }

        function selectLayout(id) {
            var L = id ? findLayout(id) : null;
            st.layout = L ? L.id : '';
            if (L) {
                st.sym = L.symbology;
                st.fields = {};
                if (L.sample) { Object.keys(L.sample).forEach(function (k) { st.fields[k] = L.sample[k]; }); }
                st.opts = Object.assign({}, L.options || {});
            } else {
                st.opts = {};
                if (st.data == null || st.data === '') { st.data = SAMPLE_DATA[st.sym] || ''; }
            }
            buildForm();
            update();
            commit();
        }

        /* === The make form =============================================== */

        function buildSymOptions() {
            var L = activeLayout(), sym = L ? L.symbology : st.sym;
            var def = B.symbologies[sym], html = '';
            var options = L ? L.options || {} : st.opts;
            var locked = !!L;
            (def.options || []).forEach(function (o) {
                if (o === 'check') {
                    html += '<label class="check"><input type="checkbox" data-opt="check"' + (options.check ? ' checked' : '') + (locked ? ' disabled' : '') + ' /> ' +
                        (sym === 'code39' ? 'Modulo 43 check character' : sym === 'codabar' ? 'Modulo 16 check character' : 'Add a check digit') + '</label>';
                } else if (o === 'bearer') {
                    html += '<label class="check"><input type="checkbox" data-opt="bearer"' + (options.bearer !== '0' ? ' checked' : '') + (locked ? ' disabled' : '') + ' /> Bearer bars</label>';
                } else if (o === 'start' || o === 'stop') {
                    var v = (options[o] || 'A').toUpperCase();
                    html += '<label class="bt-inline">' + (o === 'start' ? 'Start' : 'Stop') + ' <select class="form-select" data-opt="' + o + '"' + (locked ? ' disabled' : '') + '>' +
                        ['A', 'B', 'C', 'D'].map(function (c) { return '<option' + (c === v ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label>';
                } else if (o === 'ecc') {
                    var lv = (options.ecc || 'M').toUpperCase();
                    html += '<label class="bt-inline">Error correction <select class="form-select" data-opt="ecc"' + (locked ? ' disabled' : '') + '>' +
                        ECC_LEVELS.map(function (e) { return '<option value="' + e[0] + '"' + (e[0] === lv ? ' selected' : '') + '>' + e[1] + '</option>'; }).join('') + '</select></label>';
                }
            });
            el.symopts.innerHTML = html;
            el.symopts.hidden = !html;
        }

        function buildForm() {
            var L = activeLayout(), sym = L ? L.symbology : st.sym;
            el.sym.value = sym;
            el.sym.disabled = !!L;
            el.free.hidden = !!L;
            el.fields.hidden = !L;
            el.colorsFlag.hidden = !L;
            el.layoutDesc.hidden = !(L && L.description);
            el.layoutDesc.textContent = L && L.description ? L.description : '';
            if (!editorLayout && st.layout && !L) {
                notify('This link uses the layout "' + st.layout + '", which is not in this browser. Import it to see its fields.');
                st.layout = '';
            }
            if (!L) {
                el.data.value = st.data || '';
                el.help.textContent = B.symbologies[sym].help;
            } else {
                var html = '';
                L.fields.forEach(function (f) {
                    var color = f.color || 'gray';
                    var len = f.type === 'enum' && (!f.values || !Object.keys(f.values).length) ? null : B.layouts.fieldLength(f);
                    var input;
                    if (f.type === 'check') {
                        input = '<output class="bt-computed" data-field-out="' + esc(f.id) + '"></output>';
                    } else if (f.type === 'fixed' && Array.isArray(f.values) && f.values.length === 1) {
                        input = '<output class="bt-computed" data-field-out="' + esc(f.id) + '">' + esc(f.values[0]) + '</output>';
                    } else if (f.type === 'fixed' || f.type === 'enum') {
                        var opts = f.type === 'fixed'
                            ? (Array.isArray(f.values) ? f.values : []).map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; })
                            : Object.keys(f.values || {}).map(function (k) { return '<option value="' + esc(k) + '">' + esc(k) + ': ' + esc(f.values[k]) + '</option>'; });
                        input = '<select class="form-select" data-field="' + esc(f.id) + '" id="bt-f-' + n + '-' + esc(f.id) + '">' + opts.join('') + '</select>';
                    } else {
                        var ph = f.type === 'date' ? f.format : f.type === 'decimal' ? (f.decimals ? '0.' + '0'.repeat(f.decimals) : '0') : '';
                        var size = Math.max(4, Math.min(24, (len || f.maxLength || 8) + 2));
                        input = '<input class="form-input" data-field="' + esc(f.id) + '" id="bt-f-' + n + '-' + esc(f.id) + '" autocomplete="off" spellcheck="false" size="' + size + '" placeholder="' + esc(ph) + '" />';
                    }
                    html += '<div class="bt-field" data-color="' + esc(color) + '" data-field-box="' + esc(f.id) + '">' +
                        '<label class="bt-field-name" for="bt-f-' + n + '-' + esc(f.id) + '">' + esc(f.name) + ' <span class="bt-pos" data-field-pos="' + esc(f.id) + '"></span></label>' +
                        input +
                        '<span class="bt-field-note" data-field-note="' + esc(f.id) + '"></span>' +
                        '</div>';
                });
                el.fields.innerHTML = html;
                var values = editorLayout ? editorLayout.sample || {} : st.fields;
                L.fields.forEach(function (f) {
                    var inp = el.fields.querySelector('[data-field="' + CSS.escape(f.id) + '"]');
                    if (inp) { inp.value = values[f.id] != null ? values[f.id] : (inp.tagName === 'SELECT' ? inp.value : ''); }
                });
            }
            buildSymOptions();
            /* A matrix symbol has no text line and no check characters to
               mark; its structure is the finder patterns. */
            var matrix = B.symbologies[sym].family === 'matrix';
            root.querySelectorAll('[data-linear-only]').forEach(function (l) { l.hidden = matrix; });
            q('[data-role="structure-label"]').textContent = matrix ? 'Finder patterns' : 'Guards, start and stop';
            renderLayoutMenu();
            root.querySelectorAll('[data-action="svg"], [data-action="png"], [data-action="link"], [data-mode]').forEach(function (btn) { btn.disabled = !!editorLayout; });
            root.querySelectorAll('[data-flag]').forEach(function (cb) { cb.checked = !!st.flags[cb.getAttribute('data-flag')]; cb.disabled = !!editorLayout; });
            root.querySelectorAll('[data-opt]').forEach(function (input) { if (editorLayout) { input.disabled = true; } });
            el.mm.value = st.mm; el.mm.disabled = !!editorLayout;
        }

        /* === Encoding and drawing ======================================== */

        function symOpts(opts) {
            opts = opts || {};
            return {
                check: opts.check === '1' || opts.check === true || opts.check === 'true',
                bearer: opts.bearer !== '0',
                start: opts.start, stop: opts.stop, ecc: opts.ecc
            };
        }

        function update() {
            var L = activeLayout(), sym = L ? L.symbology : st.sym;
            var values = editorLayout ? editorLayout.sample || {} : st.fields;
            var input, composed = null, hriOverride;
            currentBands = []; currentColors = [];
            el.legend.hidden = true; el.explain.hidden = true;
            if (editorLayout) {
                var errors = B.layouts.validate(editorLayout);
                if (!editorLayout.fields.length || errors.length) {
                    el.status.textContent = editorLayout.fields.length ? tidyLayoutError(errors[0]) : 'Add a field to start the layout.';
                    el.status.classList.toggle('bt-status-error', editorLayout.fields.length > 0);
                    current = null; clearCanvas(); return;
                }
            }
            if (L) {
                composed = B.layouts.compose(L, values);
                var pos = 0;
                composed.spans.forEach(function (sp) {
                    var posEl = el.fields.querySelector('[data-field-pos="' + CSS.escape(sp.id) + '"]');
                    if (posEl) { posEl.textContent = sp.to > sp.from ? (sp.to - sp.from === 1 ? 'position ' + (sp.from + 1) : 'positions ' + (sp.from + 1) + '–' + sp.to) : ''; }
                });
                L.fields.forEach(function (f) {
                    var r = composed.fields[f.id];
                    var note = el.fields.querySelector('[data-field-note="' + CSS.escape(f.id) + '"]');
                    var inp = el.fields.querySelector('[data-field="' + CSS.escape(f.id) + '"]');
                    var out = el.fields.querySelector('[data-field-out="' + CSS.escape(f.id) + '"]');
                    if (out && f.type === 'check') { out.textContent = r.error ? '…' : r.raw; }
                    if (inp) { inp.setAttribute('aria-invalid', r.error ? 'true' : 'false'); }
                    if (note) {
                        /* The note says something the input does not: an
                           error, a meaning, a formatted date, or the padded
                           form actually encoded. */
                        var typed = values[f.id] == null ? '' : String(values[f.id]).trim();
                        var text = '';
                        if (r.error) { text = r.error; }
                        else if (r.meaning) { text = r.meaning; }
                        else if (f.type === 'date') { text = r.display; }
                        else if (f.type !== 'fixed' && f.type !== 'check' && r.raw !== typed) { text = 'Encoded as ' + r.raw; }
                        note.textContent = text;
                        note.classList.toggle('bt-note-error', !!r.error);
                    }
                });
                input = composed.input;
                if (!composed.ok) {
                    el.status.textContent = 'Fill in the fields to see the barcode.';
                    el.status.classList.add('bt-status-error');
                    current = null; clearCanvas();
                    return;
                }
            } else {
                input = st.data || '';
            }

            var r = B.encode(sym, input, symOpts(L ? L.options : st.opts));
            if (!L) {
                el.data.setAttribute('aria-invalid', r.ok ? 'false' : 'true');
                el.error.hidden = r.ok;
                el.error.innerHTML = r.ok ? '' : esc(r.error) + (r.fix ? ' <button type="button" class="btn" data-action="fix" data-fix="' + esc(r.fix) + '">Use ' + esc(r.fix) + '</button>' : '');
            }
            if (!r.ok) {
                el.status.textContent = L ? r.error : '';
                el.status.classList.toggle('bt-status-error', !!L);
                clearCanvas();
                current = null;
                return;
            }
            current = r.symbol;
            if (L) {
                hriOverride = B.layouts.hri(L, composed.fields, r.symbol.hri);
                if (hriOverride !== r.symbol.hri) {
                    current = Object.assign({}, r.symbol, { hri: hriOverride, hriMap: null, textMode: hriOverride == null ? 'center' : (r.symbol.textMode === 'ean' && hriOverride === r.symbol.hri ? 'ean' : 'center') });
                }
                if (st.flags.colors) { colorFields(L, composed, r.symbol); }
                renderLegend(L, composed);
                var ex = B.layouts.explain(L, composed.fields);
                el.explain.textContent = ex;
                el.explain.hidden = !ex;
            }
            el.status.classList.remove('bt-status-error');
            el.status.textContent = statusLine(r);
            draw();
        }

        function statusLine(r) {
            var parts = [];
            if (r.check != null) { parts.push((r.computed === false ? 'Check digit ' + r.check + ' verified.' : 'Check digit ' + r.check + ' computed.')); }
            if (r.expanded) { parts.push('Expands to UPC-A ' + r.expanded + '.'); }
            if (r.symbol && r.symbol.symbology === 'ean13') {
                var name = B.gs1.prefixName(r.symbol.data);
                if (name) { parts.push('GS1 prefix ' + r.symbol.data.slice(0, 3) + ': ' + name + '.'); }
            }
            if (r.elements) { parts.push(r.elements.map(function (e) { return '(' + e.ai + ') ' + e.info.name; }).join(', ') + '.'); }
            if (r.version) { parts.push('Version ' + r.version + ', ' + r.symbol.size + ' by ' + r.symbol.size + ' modules, error correction level ' + r.ecc + '.'); }
            return parts.join(' ');
        }

        function colorFields(L, composed, sym) {
            composed.spans.forEach(function (sp) {
                var f = null;
                for (var i = 0; i < L.fields.length; i++) { if (L.fields[i].id === sp.id) { f = L.fields[i]; } }
                var color = sp.ai ? B.palette.gray : B.palette[(f && f.color) || 'gray'];
                var x0 = Infinity, x1 = -Infinity;
                for (var k = sp.from; k < sp.to; k++) {
                    currentColors[k] = color;
                    var c = sym.chars[k];
                    if (c && c.x0 != null) { x0 = Math.min(x0, c.x0); x1 = Math.max(x1, c.x1); }
                }
                if (x1 > x0) { currentBands.push({ x0: x0, x1: x1, color: color }); }
            });
        }

        function renderLegend(L, composed) {
            var html = '';
            composed.spans.forEach(function (sp) {
                if (sp.ai) { return; }
                var f = L.fields.filter(function (x) { return x.id === sp.id; })[0];
                var r = composed.fields[sp.id];
                var shown = r.meaning ? r.display + ' (' + r.meaning + ')' : r.display;
                html += '<li data-color="' + esc(f.color || 'gray') + '"><span class="bt-swatch" aria-hidden="true"></span>' +
                    '<span class="bt-legend-name">' + esc(f.name) + '</span> ' +
                    '<span class="bt-pos">' + (sp.to - sp.from === 1 ? 'position ' + (sp.from + 1) : 'positions ' + (sp.from + 1) + '–' + sp.to) + '</span> ' +
                    '<span class="bt-legend-value num">' + esc(shown) + '</span></li>';
            });
            el.legend.innerHTML = html;
            el.legend.hidden = !html;
        }

        function drawOptions(forExport) {
            var annotate = !forExport || st.flags.annotate;
            var bands = annotate ? B.roleBands(current, { checks: st.flags.checks, structure: st.flags.structure }) : [];
            var colors = [];
            if (annotate) {
                bands = currentBands.concat(bands);
                colors = currentColors.slice();
                if (st.flags.checks) { current.chars.forEach(function (c, i) { if (c.role === 'check') { colors[i] = B.roleColors.check; } }); }
            }
            return { showText: !!st.flags.text, bands: bands, charColors: colors };
        }

        function clearCanvas() {
            el.canvas.width = 1; el.canvas.height = 1;
            el.canvas.style.width = '0px'; el.canvas.style.height = '0px';
        }

        function drawSymbol(symbol, o) {
            var g = B.geometry(symbol, o);
            var dpr = window.devicePixelRatio || 1;
            var avail = el.well.clientWidth - 24;
            if (avail <= 0) { return; }
            /* The symbol fills the width it has, but never at less than two
               screen pixels a module: below that, bars one and two modules
               wide look alike and the text is too small to read. A wide
               symbol at that size is wider than the well, which then widens
               a window sized by its content, or scrolls where it cannot. */
            var fit = Math.floor(avail * dpr / g.width);
            var px = Math.max(Math.ceil(2 * dpr), Math.min(Math.floor((symbol.matrix ? 8 : 4) * dpr), fit));
            o.px = px; o.cssScale = dpr;
            B.render(el.canvas, symbol, o);
            el.canvas.setAttribute('aria-label', B.symbologies[symbol.symbology].name + ' barcode encoding ' + (symbol.hri || symbol.data));
            /* A draft that turns wider than the form, such as one switched
               to GS1-128, widens the form's column to hold it, as the
               window would if the editor were closed. It never narrows it,
               so the editor does not move about while the draft changes. */
            if (editorLayout) {
                var wanted = Math.ceil(el.canvas.getBoundingClientRect().width + el.well.offsetWidth - avail);
                if (wanted > formWidth) {
                    formWidth = wanted;
                    root.style.setProperty('--bt-form-w', formWidth + 'px');
                }
            }
        }

        function draw() {
            if (current) { drawSymbol(current, drawOptions(false)); }
        }

        /* === Read mode =================================================== */

        function renderRead() {
            var s = el.scan.value.trim();
            st.scan = s;
            if (!s) { el.results.innerHTML = ''; return; }
            var html = '';
            var matches = [];
            allLayouts().forEach(function (L) {
                if (B.layouts.validate(L).length) { return; }
                var m = B.layouts.interpret(L, s);
                if (m) { matches.push(m); }
            });
            matches.sort(function (a, b) { return a.issues.length - b.issues.length; });
            matches.forEach(function (m) {
                var L = m.layout, c = m.composed;
                html += '<div class="card bt-match">' +
                    '<h4 class="bt-match-title">' + esc(L.name) + ' <span class="bt-menu-sym">' + esc(B.symbologies[L.symbology].name) + '</span></h4>' +
                    (m.issues.length ? '<div class="notice warn">' + m.issues.map(esc).join('<br />') + '</div>' : '') +
                    '<div class="data-table-wrap"><table class="data-table"><thead><tr><th scope="col">Field</th><th scope="col">Positions</th><th scope="col">Encoded</th><th scope="col">Meaning</th></tr></thead><tbody>';
                c.spans.forEach(function (sp) {
                    if (sp.ai) { return; }
                    var f = L.fields.filter(function (x) { return x.id === sp.id; })[0];
                    var r = c.fields[sp.id], raw = m.values[sp.id];
                    html += '<tr data-color="' + esc(f.color || 'gray') + '"><td><span class="bt-swatch" aria-hidden="true"></span>' + esc(f.name) + '</td>' +
                        '<td class="num">' + (sp.from + 1) + (sp.to - sp.from > 1 ? '–' + sp.to : '') + '</td>' +
                        '<td class="num">' + esc(raw) + '</td>' +
                        '<td>' + esc(r.error ? r.error : (r.meaning || r.display)) + '</td></tr>';
                });
                html += '</tbody></table></div>';
                var ex = B.layouts.explain(L, c.fields);
                if (ex) { html += '<p class="bt-explain">' + esc(ex) + '</p>'; }
                html += '<button type="button" class="btn" data-action="open-layout" data-layout="' + esc(L.id) + '" data-values="' + esc(JSON.stringify(m.values)) + '">Open in Make</button></div>';
            });
            var ids = B.identify(s);
            if (ids.length) {
                html += '<div class="card bt-match"><h4 class="bt-match-title">' + (matches.length ? 'Also, as a plain symbol' : 'As a plain symbol') + '</h4><ul class="bt-ident">';
                ids.forEach(function (d) {
                    if (d.elements) {
                        html += '<li><strong>' + esc(d.title) + '</strong><ul>' + d.elements.map(function (e) {
                            return '<li><span class="num">(' + esc(e.ai) + ')</span> ' + esc(e.name) + ': <span class="num">' + esc(e.shown) + '</span></li>';
                        }).join('') + '</ul></li>';
                    } else {
                        html += '<li><strong>' + esc(d.title) + '</strong>: ' + (d.problem ? esc(d.problem) : (d.valid ? 'valid.' : 'not valid.') + (d.note ? ' ' + esc(d.note) : '')) + '</li>';
                    }
                });
                html += '</ul></div>';
            }
            if (!matches.length && !ids.length) {
                html = '<p class="form-help">No layout fits this value, and it is not a standard retail symbol. Import the layout it was made with, or check its length.</p>';
            }
            el.results.innerHTML = html;
        }

        function setMode(mode) {
            if (mode === 'read' && editorLayout) { closeEditor(); }
            st.mode = mode;
            root.querySelectorAll('[data-mode]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === mode)); });
            el.make.hidden = mode !== 'make';
            el.read.hidden = mode !== 'read';
            root.querySelector('.bt-tools').hidden = mode !== 'make';
            if (mode === 'read') { el.scan.value = st.scan || ''; renderRead(); }
            else { draw(); }
        }

        /* === JSON authoring and the library ============================== */

        var editingId = null;
        function openJson(L) {
            editingId = L && !isDemo(L.id) ? L.id : null;
            var obj = L ? JSON.parse(JSON.stringify(L)) : {
                id: 'my-layout', name: 'My layout', symbology: 'ean13', explain: '',
                fields: [{ id: 'prefix', name: 'Prefix', type: 'fixed', values: ['20'], color: 'blue' }, { id: 'item', name: 'Item', type: 'number', length: 10, color: 'gray' }]
            };
            if (L && isDemo(L.id)) { obj.id = L.id.replace(/^demo-/, 'my-'); }
            el.json.value = JSON.stringify(obj, null, 2);
            el.jsonErrors.hidden = true;
            el.jsonFile.hidden = !canEditFile();
            el.dialog.showModal();
        }

        /* On this site the library is also a file, and whichever applet
           the site has for opening files can edit it whole. The tool asks
           through PUDL's requests (0.27.0) and offers it only when one
           answers; under an older PUDL, which has no requests, it offers
           nothing. */
        var LIBRARY_FILE = '~/barcode-layouts.json';
        function canEditFile() { return !!window.pudlApplets.can && window.pudlApplets.can('open', 'file'); }
        function editFile() {
            el.dialog.close();
            if (!window.pudlApplets.request || !window.pudlApplets.request('open', { path: LIBRARY_FILE, kind: 'file' }, root)) {
                notify('Nothing on this page can open the layouts file.');
            }
        }

        function saveJson() {
            var obj;
            try { obj = JSON.parse(el.json.value); }
            catch (err) { showJsonErrors(['This is not valid JSON: ' + err.message]); return; }
            var errs = B.layouts.validate(obj);
            if (!errs.length && isDemo(obj.id)) { errs.push('The id "' + obj.id + '" belongs to a demonstration layout; choose another.'); }
            if (errs.length) { showJsonErrors(errs); return; }
            library = library.filter(function (x) { return x.id !== obj.id && x.id !== editingId; });
            library.push(obj);
            saveLibrary(library);
            el.dialog.close();
            selectLayout(obj.id);
        }

        function showJsonErrors(errs) {
            el.jsonErrors.innerHTML = errs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('');
            el.jsonErrors.hidden = false;
        }

        /* Adds the layouts in a file's text to the library. */
        function importText(text, name) {
            var obj;
            try { obj = JSON.parse(text); }
            catch (err) { notify(name + ' is not valid JSON.'); return; }
            var res = B.layouts.validateFile(obj);
            if (!res.ok) { notify('Nothing imported from ' + name + '. ' + res.errors.slice(0, 3).join(' ') + (res.errors.length > 3 ? ' (and ' + (res.errors.length - 3) + ' more)' : '')); return; }
            var m = mergeLayouts(res.layouts);
            saveLibrary(library);
            renderLayoutMenu();
            notify('Added ' + m.added + ' layout' + (m.added === 1 ? '' : 's') + ' from ' + name +
                (m.skipped ? ', skipping ' + m.skipped + ' demonstration layout' + (m.skipped === 1 ? '' : 's') + ' the tool already has' : '') +
                '. They are kept ' + (linked ? 'in ' + linked.name + ' and this browser.' : 'in this browser.'));
        }

        /* === Open and Save as ============================================
           The site's shared dialog (pcFileBrowser.pick): files go to and
           come from the reader's home directory first, and the dialog
           offers their computer beside its buttons. */

        var lastDir = '~';
        function pickFile(options) {
            return loadFiles().then(function (x) {
                var o = Object.assign({ host: root, start: lastDir, computer: true }, options);
                return x.FB.pick(x.F, o).then(function (res) {
                    if (res && res.path) { lastDir = res.path.slice(0, res.path.lastIndexOf('/')) || '/'; }
                    return { res: res, F: x.F };
                });
            }, function (err) {
                notify('Files could not be opened: ' + err.message + '.');
                return { res: null };
            });
        }

        function openLayouts() {
            pickFile({
                mode: 'open', title: 'Open layouts', accept: ['.json'],
                check: function (r) { return r.special === 'layouts' ? r.name + ' is this tool\'s own library, which it already has.' : null; }
            }).then(async function (x) {
                var res = x.res;
                if (!res) { return; }
                if (res.file) { importText(await res.file.text(), res.file.name); return; }
                try { importText(await x.F.read(res.node), res.node.name); }
                catch (err) { notify(res.node.name + ' could not be read: ' + err.message); }
            });
        }

        /* Saves text, or with picture a PNG, under a suggested name. This
           browser's ~ holds text only, so a PNG can be saved only where the
           site keeps files on its server; elsewhere it is downloaded. */
        function saveFile(name, title, blob, picture) {
            pickFile({
                mode: 'save', title: title, name: name,
                canSaveIn: picture ? function (dir) {
                    return dir.server ? null : 'Pictures can\'t be kept in ~ in this browser, which holds only text. Download the PNG instead, or save the SVG.';
                } : null
            }).then(async function (x) {
                var res = x.res, out;
                if (!res) { return; }
                if (res.download) { download(res.download, blob); return; }
                var F = x.F, existing = F.childNamed(res.dir, res.name);
                if (existing && existing.special) { notify(res.name + ' is this tool\'s own library; use Open layouts instead.'); return; }
                if (picture) { out = await F.upload(res.dir, new File([blob], res.name, { type: blob.type })); }
                else { out = await F.write(F.home(), res.path, await blob.text(), false); }
                notify(out && out.error ? 'Not saved: ' + out.error + '.' : 'Saved ' + res.path + '.');
            });
        }

        function download(name, blob) {
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            document.body.appendChild(a);
            a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        }

        function fileBase() {
            var s = (current && (current.data || '')) || 'barcode';
            return (st.sym + '-' + s).replace(/[^A-Za-z0-9-]+/g, '_').slice(0, 60);
        }

        /* === Wiring ====================================================== */

        function onClick(e) {
            var t = e.target.closest('[data-mode], [data-action], [data-layout]');
            if (!t || !root.contains(t)) { return; }
            /* A menu choice rebuilds the menu, which detaches the clicked
               item before the menu script can find its panel, so the panel
               is closed here. */
            if (el.layoutMenu.contains(t) && el.layoutMenu.matches(':popover-open')) { el.layoutMenu.hidePopover(); }
            if (t.hasAttribute('data-mode')) { setMode(t.getAttribute('data-mode')); commit(); return; }
            var action = t.getAttribute('data-action');
            if (!action && t.hasAttribute('data-layout')) { selectLayout(t.getAttribute('data-layout')); return; }
            switch (action) {
                case 'notice-close': el.notice.hidden = true; break;
                case 'help': el.helpDialog.showModal(); break;
                case 'help-close': el.helpDialog.close(); break;
                case 'editor-cancel': closeEditor(); break;
                case 'editor-save': saveEditor(); break;
                case 'editor-add-field': {
                    readEditor();
                    var added = editorDefaultField();
                    editorLayout.fields.push(added); editorOpen.add(added);
                    renderEditor();
                    var addedName = q('#bt-ef-' + n + '-' + (editorLayout.fields.length - 1) + '-name');
                    if (addedName) { addedName.focus(); addedName.select(); }
                    break;
                }
                case 'editor-delete': {
                    readEditor();
                    var gone = editorLayout.fields.splice(+t.getAttribute('data-index'), 1)[0];
                    editorOpen.delete(gone);
                    delete editorLayout.sample[gone.id];
                    editorLayout.fields.forEach(function (f) { if (f.over) { f.over = f.over.filter(function (id) { return id !== gone.id; }); } });
                    renderEditor();
                    q('[data-action="editor-add-field"]').focus();
                    break;
                }
                case 'editor-up':
                case 'editor-down': {
                    readEditor();
                    var from = +t.getAttribute('data-index'), to = from + (action === 'editor-up' ? -1 : 1);
                    if (to < 0 || to >= editorLayout.fields.length) { break; }
                    editorLayout.fields.splice(to, 0, editorLayout.fields.splice(from, 1)[0]);
                    renderEditor();
                    var again = q('[data-action="' + action + '"][data-index="' + to + '"]');
                    if (again && again.disabled) { again = q('[data-action="' + (action === 'editor-up' ? 'editor-down' : 'editor-up') + '"][data-index="' + to + '"]'); }
                    if (again) { again.focus(); }
                    break;
                }
                case 'fix': st.data = t.getAttribute('data-fix'); el.data.value = st.data; update(); commit(); break;
                case 'json-cancel': el.dialog.close(); break;
                case 'edit-file': e.preventDefault(); editFile(); break;
                case 'json-save': saveJson(); break;
                case 'remove-cancel': el.removeDialog.close(); break;
                case 'remove-confirm': removeLayout(); break;
                case 'open-layout': {
                    var vals = JSON.parse(t.getAttribute('data-values'));
                    var L = findLayout(t.getAttribute('data-layout'));
                    st.layout = L.id; st.sym = L.symbology; st.opts = Object.assign({}, L.options || {});
                    st.fields = {};
                    L.fields.forEach(function (f) { if (f.type !== 'check') { st.fields[f.id] = vals[f.id]; } });
                    buildForm(); setMode('make'); update(); commit();
                    break;
                }
                case 'svg':
                    if (current) {
                        var o = drawOptions(true); o.moduleMM = +st.mm;
                        saveFile(fileBase() + '.svg', 'Save SVG', new Blob([B.toSVG(current, o)], { type: 'image/svg+xml' }));
                    }
                    break;
                case 'png':
                    if (current) {
                        var c = document.createElement('canvas'), po = drawOptions(true);
                        po.px = Math.max(1, Math.round(+st.mm / 25.4 * 300));
                        B.render(c, current, po);
                        c.toBlob(function (blob) { saveFile(fileBase() + '.png', 'Save PNG', blob, true); }, 'image/png');
                    }
                    break;
                case 'link': {
                    var base = opts.pageUrl || location.pathname;
                    var url = new URL(base, location.origin);
                    url.search = stateString(st);
                    var btn = t;
                    (navigator.clipboard ? navigator.clipboard.writeText(url.href) : Promise.reject()).then(function () {
                        btn.textContent = 'Link copied';
                        setTimeout(function () { btn.textContent = 'Copy link'; }, 1600);
                    }, function () { notify(url.href); });
                    break;
                }
            }
        }

        function onInput(e) {
            var t = e.target;
            /* Typing in the editor updates the draft and the form beside it,
               and leaves the editor's own rows alone so focus stays put. */
            if (editorLayout && el.editor.contains(t) && (t.hasAttribute('data-editor') || t.hasAttribute('data-editor-field'))) {
                readEditor(); el.editorErrors.hidden = true;
                var key = t.getAttribute('data-editor');
                if (key === 'id') { editorIdAuto = false; }
                if (key === 'name' && editorIdAuto) { editorLayout.id = unusedLayoutId(slug(t.value)); q('[data-editor="id"]').value = editorLayout.id; }
                if (t.hasAttribute('data-editor-field')) { refreshFieldRow(+t.getAttribute('data-index')); }
                updateEditorPreview(); return;
            }
            if (t === el.data) { st.data = t.value; update(); commit(); return; }
            if (t === el.scan) { renderRead(); commit(); return; }
            if (t.hasAttribute('data-field')) {
                var id = t.getAttribute('data-field');
                if (editorLayout) { editorLayout.sample[id] = t.value; update(); }
                else { st.fields[id] = t.value; update(); commit(); }
                return;
            }
        }

        function onChange(e) {
            var t = e.target;
            /* Only a new type or symbology changes which settings a field
               has, so only those rebuild the rows. */
            if (editorLayout && el.editor.contains(t)) {
                if (t.getAttribute('data-editor-field') === 'type') {
                    var i = +t.getAttribute('data-index');
                    readEditor(); changeEditorType(i, t.value); renderEditor();
                    var typeSelect = q('#bt-ef-' + n + '-' + i + '-type');
                    if (typeSelect) { typeSelect.focus(); }
                } else if (t.getAttribute('data-editor') === 'sym') {
                    readEditor(); renderEditor();
                }
                return;
            }
            if (t === el.sym) {
                st.sym = t.value; st.opts = {};
                st.data = SAMPLE_DATA[st.sym] || '';
                buildForm(); update(); commit();
                return;
            }
            if (t === el.mm) { st.mm = t.value; commit(); return; }
            if (t.hasAttribute('data-flag')) { st.flags[t.getAttribute('data-flag')] = t.checked; update(); commit(); return; }
            if (t.hasAttribute('data-opt')) {
                var k = t.getAttribute('data-opt');
                st.opts[k] = t.type === 'checkbox' ? (t.checked ? '1' : '0') : t.value;
                update(); commit();
                return;
            }
            if (t.hasAttribute('data-field') && t.tagName === 'SELECT') { onInput(e); }
        }

        root.addEventListener('click', onClick);
        root.addEventListener('input', onInput);
        root.addEventListener('change', onChange);
        /* toggle does not bubble, so it is caught on the way down. */
        root.addEventListener('toggle', onEditorToggle, true);

        var ro = window.ResizeObserver ? new ResizeObserver(function () { if (st.mode === 'make') { draw(); } }) : null;
        if (ro) { ro.observe(el.well); }
        var onTheme = function () { draw(); };
        document.addEventListener('pudl:theme-change', onTheme);

        instance.state = function () { return stateString(st); };
        instance.commands = commands;
        instance.menus = menus;
        /* The menu bar was drawn while the engine loaded, from commands()
           alone; now that the menus are here, it is drawn again. */
        if (window.pudlMenubar) { window.pudlMenubar.refresh(); }
        instance.setState = function (s) {
            if (editorLayout) { closeEditor(true); }
            st = parseState(s || '');
            fillDefaults();
            buildForm(); update(); setMode(st.mode);
            commit();
        };
        instance.cleanup = function () {
            clearTimeout(writeTimer);
            if (ro) { ro.disconnect(); }
            document.removeEventListener('pudl:theme-change', onTheme);
            document.removeEventListener('pc:fs-change', onLibraryChange);
            window.removeEventListener('storage', onStorage);
            root.removeEventListener('click', onClick);
            root.removeEventListener('input', onInput);
            root.removeEventListener('change', onChange);
            root.removeEventListener('toggle', onEditorToggle, true);
            if (el.dialog.open) { el.dialog.close(); }
            if (el.removeDialog.open) { el.removeDialog.close(); }
        };

        el.noticeAction.addEventListener('click', function () {
            var h = noticeHandler;
            el.notice.hidden = true;
            if (h) { h(); }
        });

        buildForm();
        update();
        setMode(st.mode);
        restoreLink();
    }

    window.pudlApplets.register('barcodes', {
        init: function (root, opts) {
            var inst = init(root, opts);
            return {
                state: function () { return inst.state ? inst.state() : ''; },
                setState: function (s) { if (inst.setState) { inst.setState(s); } },
                /* PUDL looks for commands() and menus() as soon as the tool
                   is running, while the engine may still be loading, so
                   both are always here; until the tool is ready, menus()
                   gives nothing and the menu bar falls back to commands(). */
                commands: function () { return inst.commands ? inst.commands() : []; },
                menus: function () { return inst.menus ? inst.menus() : null; },
                destroy: function () { inst.destroy(); }
            };
        }
    });
})();
