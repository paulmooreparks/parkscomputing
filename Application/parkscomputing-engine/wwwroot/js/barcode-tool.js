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

    var ENGINE_SRC = (function () {
        var cur = document.currentScript && document.currentScript.src;
        return cur ? cur.replace(/barcode-tool\.js/, 'barcode-engine.js') : '/js/barcode-engine.js';
    })();
    var engineReady = null;
    function loadEngine() {
        if (window.pcBarcode) { return Promise.resolve(window.pcBarcode); }
        if (!engineReady) {
            engineReady = new Promise(function (resolve, reject) {
                var s = document.createElement('script');
                s.src = ENGINE_SRC;
                s.onload = function () { resolve(window.pcBarcode); };
                s.onerror = function () { reject(new Error('could not load the barcode engine')); };
                document.head.appendChild(s);
            });
        }
        return engineReady;
    }

    var LIBRARY_KEY = 'pc-barcode-layouts';
    var GUIDE_URL = '/page/barcode-tool-guide', GUIDE_KEY = 'barcode-tool-guide';

    /* Demonstration layouts. They are generic and invented: nothing here
       comes from a customer or a real scheme. */
    var DEMOS = [
        {
            id: 'demo-price-embedded', name: 'Price-embedded item', symbology: 'ean13',
            description: 'An in-store EAN-13 in the restricted-circulation range, carrying an item number and a price.',
            explain: 'Item {item} at {price}.',
            fields: [
                { id: 'prefix', name: 'Prefix', type: 'fixed', values: ['21'], color: 'blue', description: 'Restricted-circulation prefix chosen for priced items' },
                { id: 'item', name: 'Item', type: 'number', length: 5, color: 'gray' },
                { id: 'price', name: 'Price', type: 'decimal', length: 5, decimals: 2, color: 'green' }
            ],
            sample: { item: '4213', price: '3.49' }
        },
        {
            id: 'demo-weight-embedded', name: 'Weight-embedded item', symbology: 'ean13',
            description: 'An in-store EAN-13 carrying an item number and a net weight in kilograms.',
            explain: 'Item {item}, weighing {weight}.',
            fields: [
                { id: 'prefix', name: 'Prefix', type: 'fixed', values: ['22'], color: 'blue' },
                { id: 'item', name: 'Item', type: 'number', length: 5, color: 'gray' },
                { id: 'weight', name: 'Weight', type: 'decimal', length: 5, decimals: 3, suffix: ' kg', color: 'teal' }
            ],
            sample: { item: '1102', weight: '1.250' }
        },
        {
            id: 'demo-logistics', name: 'Logistics label', symbology: 'gs1-128',
            description: 'A case label with its GTIN, expiry date, net weight and batch, as GS1 Application Identifiers.',
            explain: 'GTIN {gtin:raw}{check:raw}, expires {expiry}, {weight} net, batch {batch}.',
            fields: [
                { id: 'gtin', name: 'GTIN', type: 'number', length: 13, ai: '01', color: 'blue' },
                { id: 'check', name: 'GTIN check', type: 'check', algorithm: 'gs1-mod10', over: ['gtin'], color: 'purple' },
                { id: 'expiry', name: 'Expiry', type: 'date', format: 'yymmdd', ai: '17', color: 'orange' },
                { id: 'weight', name: 'Net weight', type: 'decimal', length: 6, decimals: 3, suffix: ' kg', ai: '3103', color: 'teal' },
                { id: 'batch', name: 'Batch', type: 'text', maxLength: 20, ai: '10', color: 'gray' }
            ],
            sample: { gtin: '0950110153000', expiry: '271231', weight: '12.500', batch: 'LOT42A' }
        },
        {
            id: 'demo-receipt', name: 'Receipt lookup', symbology: 'itf',
            description: 'A receipt footer code for returns: store, register, date and transaction, all numeric.',
            explain: 'Store {store}, register {register}, {date}, transaction {txn}.',
            fields: [
                { id: 'store', name: 'Store', type: 'number', length: 4, color: 'blue' },
                { id: 'register', name: 'Register', type: 'number', length: 3, color: 'gray' },
                { id: 'date', name: 'Date', type: 'date', format: 'yymmdd', color: 'orange' },
                { id: 'txn', name: 'Transaction', type: 'number', length: 5, color: 'green' }
            ],
            sample: { store: '17', register: '3', date: '260929', txn: '1234' }
        },
        {
            id: 'demo-membership', name: 'Membership card', symbology: 'codabar',
            description: 'A Codabar membership card with a tier code, a member number and a Luhn check digit.',
            options: { start: 'A', stop: 'B' },
            explain: '{tier:meaning} member {member}.',
            fields: [
                { id: 'tier', name: 'Tier', type: 'enum', values: { '10': 'Standard', '20': 'Silver', '30': 'Gold' }, color: 'blue' },
                { id: 'member', name: 'Member', type: 'number', length: 10, color: 'gray' },
                { id: 'check', name: 'Check digit', type: 'check', algorithm: 'luhn', color: 'purple' }
            ],
            sample: { tier: '20', member: '4410023' }
        },
        {
            id: 'demo-coupon', name: 'Store coupon', symbology: 'code128',
            description: 'A numeric coupon carrying a campaign, a discount type and value, an expiry date and a check digit.',
            explain: 'Campaign {campaign}: {type:meaning}, value {value}, valid until {expiry}.',
            fields: [
                { id: 'prefix', name: 'Coupon prefix', type: 'fixed', values: ['99'], color: 'blue' },
                { id: 'campaign', name: 'Campaign', type: 'number', length: 4, color: 'gray' },
                { id: 'type', name: 'Discount type', type: 'enum', values: { '1': 'percent off one item', '2': 'amount off the transaction', '3': 'free item', '9': 'recorded only, no discount' }, color: 'orange' },
                { id: 'value', name: 'Value', type: 'number', length: 4, color: 'green' },
                { id: 'expiry', name: 'Expiry', type: 'date', format: 'yymmdd', color: 'teal' },
                { id: 'check', name: 'Check digit', type: 'check', algorithm: 'gs1-mod10', color: 'purple' }
            ],
            sample: { campaign: '318', type: '1', value: '15', expiry: '261231' }
        }
    ];

    var SYM_GROUPS = [
        ['Retail', ['ean13', 'ean8', 'upca', 'upce']],
        ['Logistics', ['gs1-128', 'itf14', 'itf']],
        ['General', ['code128', 'code39', 'codabar']]
    ];
    var SAMPLE_DATA = {
        ean13: '480036140036', ean8: '9638507', upca: '03600029145', upce: '0425261',
        'gs1-128': '(01)09501101530003(17)271231(10)LOT42A', itf14: '1540014128876', itf: '123420260929001234',
        code128: 'Hello, PUDL 2026', code39: 'CODE-39', codabar: '40156'
    };
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
                '<label class="check"><input type="checkbox" data-flag="text" /> Text</label>' +
                '<label class="check"><input type="checkbox" data-flag="checks" /> Check digits</label>' +
                '<label class="check"><input type="checkbox" data-flag="structure" /> Guards, start and stop</label>' +
                '<label class="check" data-role="colors-flag"><input type="checkbox" data-flag="colors" /> Field colors</label>' +
              '</div>' +
              '<div class="bt-controls">' +
                '<select class="form-select" data-role="mm" aria-label="Module width for downloads">' +
                  MODULE_MM.map(function (m) { return '<option value="' + m[0] + '">' + m[1] + '</option>'; }).join('') +
                '</select>' +
                '<label class="check"><input type="checkbox" data-flag="annotate" /> Highlights in downloads</label>' +
                '<button type="button" class="btn" data-action="svg">Download SVG</button>' +
                '<button type="button" class="btn" data-action="png">Download PNG</button>' +
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
            '<input type="file" accept=".json,application/json" data-role="file" hidden />' +
            '<dialog class="dialog bt-json-dialog" data-role="json-dialog" aria-labelledby="bt-json-title-' + n + '">' +
              '<h3 class="dialog-title" id="bt-json-title-' + n + '">Layout JSON</h3>' +
              '<div class="dialog-body">' +
                '<p class="form-help">One layout object. The <a href="' + GUIDE_URL + '#format" data-win-open="' + GUIDE_KEY + '">guide</a> describes every key. It is saved in this browser, and in your layouts file if one is linked.</p>' +
                '<textarea class="form-textarea bt-json" data-role="json" spellcheck="false" aria-label="Layout JSON"></textarea>' +
                '<ul class="form-error bt-json-errors" data-role="json-errors" hidden></ul>' +
              '</div>' +
              '<div class="dialog-actions">' +
                '<button type="button" class="btn" data-action="json-cancel">Cancel</button>' +
                '<button type="button" class="btn btn-primary" data-action="json-save">Save layout</button>' +
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
                '<p>The check boxes mark check digits, guards and fields. <strong>Download SVG</strong> is sized in millimetres ' +
                  'for printing; downloads leave the highlights out unless you ask for them. <strong>Copy link</strong> ' +
                  'reproduces the exact barcode.</p>' +
                '<p>Your own layouts stay in this browser, or in a file on your disk if you link one from the Layout menu. ' +
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
            make: q('[data-role="make"]'), read: q('[data-role="read"]'),
            layoutDesc: q('[data-role="layout-desc"]'), free: q('[data-role="free"]'), data: q('[data-role="data"]'),
            help: q('[data-role="help"]'), error: q('[data-role="error"]'), fields: q('[data-role="fields"]'),
            symopts: q('[data-role="symopts"]'), canvas: q('[data-role="canvas"]'), well: q('.bt-well'),
            status: q('[data-role="status"]'), legend: q('[data-role="legend"]'), explain: q('[data-role="explain"]'),
            mm: q('[data-role="mm"]'), scan: q('[data-role="scan"]'), results: q('[data-role="results"]'),
            file: q('[data-role="file"]'), dialog: q('[data-role="json-dialog"]'), json: q('[data-role="json"]'),
            jsonErrors: q('[data-role="json-errors"]'), colorsFlag: q('[data-role="colors-flag"]'),
            helpDialog: q('[data-role="help-dialog"]'), noticeAction: q('[data-role="notice-action"]')
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

        function saveLibrary(list) {
            cacheLibrary(list);
            if (linked) {
                writeHandle(linked, list).catch(function (err) {
                    notify('Your layouts are saved in this browser, but writing ' + linked.name + ' failed: ' + err.message);
                });
            }
        }

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

        /* === Layout menu ================================================= */

        function renderLayoutMenu() {
            var L = st.layout ? findLayout(st.layout) : null;
            el.layoutBtn.textContent = L ? 'Layout: ' + L.name : 'Layout: none';
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
            html += '<hr class="menu-sep" />';
            html += '<button type="button" class="menu-action" data-action="new-json">New layout from JSON…</button>';
            if (L) {
                html += '<button type="button" class="menu-action" data-action="edit-json">' + (isDemo(L.id) ? 'Copy this layout as JSON…' : 'Edit this layout as JSON…') + '</button>';
                html += '<button type="button" class="menu-action" data-action="save-json">Save this layout as JSON</button>';
            }
            html += '<button type="button" class="menu-action" data-action="import">Import layouts…</button>';
            html += '<button type="button" class="menu-action" data-action="export">Export all layouts</button>';
            if (FILE_API) {
                html += '<hr class="menu-sep" />';
                if (linked || pendingHandle) {
                    html += '<button type="button" class="menu-action" data-action="unlink">Unlink the layouts file (' + esc((linked || pendingHandle).name) + ')</button>';
                } else {
                    html += '<button type="button" class="menu-action" data-action="link-new">Create a layouts file…</button>';
                    html += '<button type="button" class="menu-action" data-action="link-open">Open a layouts file…</button>';
                }
            }
            if (L && !isDemo(L.id)) { html += '<hr class="menu-sep" /><button type="button" class="menu-action danger" data-action="remove">Remove this layout</button>'; }
            el.layoutMenu.innerHTML = html;
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
            var def = B.symbologies[st.sym], html = '';
            var L = st.layout ? findLayout(st.layout) : null;
            var locked = !!L;
            (def.options || []).forEach(function (o) {
                if (o === 'check') {
                    html += '<label class="check"><input type="checkbox" data-opt="check"' + (st.opts.check ? ' checked' : '') + (locked ? ' disabled' : '') + ' /> ' +
                        (st.sym === 'code39' ? 'Modulo 43 check character' : st.sym === 'codabar' ? 'Modulo 16 check character' : 'Add a check digit') + '</label>';
                } else if (o === 'bearer') {
                    html += '<label class="check"><input type="checkbox" data-opt="bearer"' + (st.opts.bearer !== '0' ? ' checked' : '') + ' /> Bearer bars</label>';
                } else if (o === 'start' || o === 'stop') {
                    var v = (st.opts[o] || 'A').toUpperCase();
                    html += '<label class="bt-inline">' + (o === 'start' ? 'Start' : 'Stop') + ' <select class="form-select" data-opt="' + o + '"' + (locked ? ' disabled' : '') + '>' +
                        ['A', 'B', 'C', 'D'].map(function (c) { return '<option' + (c === v ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label>';
                }
            });
            el.symopts.innerHTML = html;
            el.symopts.hidden = !html;
        }

        function buildForm() {
            var L = st.layout ? findLayout(st.layout) : null;
            el.sym.value = st.sym;
            el.sym.disabled = !!L;
            el.free.hidden = !!L;
            el.fields.hidden = !L;
            el.colorsFlag.hidden = !L;
            el.layoutDesc.hidden = !(L && L.description);
            el.layoutDesc.textContent = L && L.description ? L.description : '';
            if (st.layout && !L) {
                notify('This link uses the layout "' + st.layout + '", which is not in this browser. Import it to see its fields.');
                st.layout = '';
            }
            if (!L) {
                el.data.value = st.data || '';
                el.help.textContent = B.symbologies[st.sym].help;
            } else {
                var html = '';
                L.fields.forEach(function (f) {
                    var color = f.color || 'gray';
                    var len = B.layouts.fieldLength(f);
                    var input;
                    if (f.type === 'check') {
                        input = '<output class="bt-computed" data-field-out="' + esc(f.id) + '"></output>';
                    } else if (f.type === 'fixed' && f.values.length === 1) {
                        input = '<output class="bt-computed" data-field-out="' + esc(f.id) + '">' + esc(f.values[0]) + '</output>';
                    } else if (f.type === 'fixed' || f.type === 'enum') {
                        var opts = f.type === 'fixed'
                            ? f.values.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; })
                            : Object.keys(f.values).map(function (k) { return '<option value="' + esc(k) + '">' + esc(k) + ': ' + esc(f.values[k]) + '</option>'; });
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
                L.fields.forEach(function (f) {
                    var inp = el.fields.querySelector('[data-field="' + CSS.escape(f.id) + '"]');
                    if (inp) { inp.value = st.fields[f.id] != null ? st.fields[f.id] : (inp.tagName === 'SELECT' ? inp.value : ''); }
                });
            }
            buildSymOptions();
            renderLayoutMenu();
            root.querySelectorAll('[data-flag]').forEach(function (cb) { cb.checked = !!st.flags[cb.getAttribute('data-flag')]; });
            el.mm.value = st.mm;
        }

        /* === Encoding and drawing ======================================== */

        function symOpts() {
            return {
                check: st.opts.check === '1' || st.opts.check === true || st.opts.check === 'true',
                bearer: st.opts.bearer !== '0',
                start: st.opts.start, stop: st.opts.stop
            };
        }

        function update() {
            var L = st.layout ? findLayout(st.layout) : null;
            var input, composed = null, hriOverride;
            currentBands = []; currentColors = [];
            el.legend.hidden = true; el.explain.hidden = true;
            if (L) {
                composed = B.layouts.compose(L, st.fields);
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
                        var typed = st.fields[f.id] == null ? '' : String(st.fields[f.id]).trim();
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
                    clearCanvas();
                    return;
                }
            } else {
                input = st.data || '';
            }

            var r = B.encode(st.sym, input, symOpts());
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
            if (st.sym === 'ean13' && r.symbol) {
                var name = B.gs1.prefixName(r.symbol.data);
                if (name) { parts.push('GS1 prefix ' + r.symbol.data.slice(0, 3) + ': ' + name + '.'); }
            }
            if (r.elements) { parts.push(r.elements.map(function (e) { return '(' + e.ai + ') ' + e.info.name; }).join(', ') + '.'); }
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

        function draw() {
            if (!current) { return; }
            var o = drawOptions(false);
            var g = B.geometry(current, o);
            var dpr = window.devicePixelRatio || 1;
            var avail = Math.max(120, el.well.clientWidth - 24);
            var px = Math.max(1, Math.min(Math.floor(4 * dpr), Math.floor(avail * dpr / g.width)));
            o.px = px; o.cssScale = dpr;
            B.render(el.canvas, current, o);
            el.canvas.setAttribute('aria-label', B.symbologies[current.symbology].name + ' barcode encoding ' + (current.hri || current.data));
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
            el.dialog.showModal();
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

        function importFile(file) {
            var reader = new FileReader();
            reader.onload = function () {
                var obj;
                try { obj = JSON.parse(reader.result); }
                catch (err) { notify('That file is not valid JSON.'); return; }
                var res = B.layouts.validateFile(obj);
                if (!res.ok) { notify('Nothing imported. ' + res.errors.slice(0, 3).join(' ') + (res.errors.length > 3 ? ' (and ' + (res.errors.length - 3) + ' more)' : '')); return; }
                var m = mergeLayouts(res.layouts);
                saveLibrary(library);
                renderLayoutMenu();
                notify('Imported ' + m.added + ' layout' + (m.added === 1 ? '' : 's') +
                    (m.skipped ? ', skipping ' + m.skipped + ' demonstration layout' + (m.skipped === 1 ? '' : 's') + ' the tool already has' : '') +
                    '. They are kept ' + (linked ? 'in ' + linked.name + ' and this browser.' : 'in this browser.'));
            };
            reader.readAsText(file);
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
                case 'save-json': {
                    var cur = findLayout(st.layout);
                    if (!cur) { break; }
                    var copy = JSON.parse(JSON.stringify(cur));
                    /* A demonstration saves as a copy under its own id, so it
                       imports as a layout of your own. */
                    if (isDemo(copy.id)) { copy.id = copy.id.replace(/^demo-/, 'my-'); copy.name += ' (copy)'; }
                    download(copy.id + '.json', new Blob([libraryFile([copy])], { type: 'application/json' }));
                    break;
                }
                case 'link-new': linkNew(); break;
                case 'link-open': linkExisting(); break;
                case 'unlink': unlink(); break;
                case 'fix': st.data = t.getAttribute('data-fix'); el.data.value = st.data; update(); commit(); break;
                case 'import': el.file.value = ''; el.file.click(); break;
                case 'new-json': openJson(null); break;
                case 'edit-json': openJson(findLayout(st.layout)); break;
                case 'json-cancel': el.dialog.close(); break;
                case 'json-save': saveJson(); break;
                case 'remove':
                    library = library.filter(function (L) { return L.id !== st.layout; });
                    saveLibrary(library);
                    selectLayout('');
                    break;
                case 'export':
                    /* Everything the menu lists, demonstrations included;
                       importing the file back skips those. */
                    download('barcode-layouts.json', new Blob([libraryFile(DEMOS.concat(library))], { type: 'application/json' }));
                    break;
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
                        download(fileBase() + '.svg', new Blob([B.toSVG(current, o)], { type: 'image/svg+xml' }));
                    }
                    break;
                case 'png':
                    if (current) {
                        var c = document.createElement('canvas'), po = drawOptions(true);
                        po.px = Math.max(1, Math.round(+st.mm / 25.4 * 300));
                        B.render(c, current, po);
                        c.toBlob(function (blob) { download(fileBase() + '.png', blob); }, 'image/png');
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
            if (t === el.data) { st.data = t.value; update(); commit(); return; }
            if (t === el.scan) { renderRead(); commit(); return; }
            if (t.hasAttribute('data-field')) { st.fields[t.getAttribute('data-field')] = t.value; update(); commit(); return; }
        }

        function onChange(e) {
            var t = e.target;
            if (t === el.sym) {
                st.sym = t.value; st.opts = {};
                st.data = SAMPLE_DATA[st.sym] || '';
                buildForm(); update(); commit();
                return;
            }
            if (t === el.mm) { st.mm = t.value; commit(); return; }
            if (t === el.file && t.files && t.files[0]) { importFile(t.files[0]); return; }
            if (t.hasAttribute('data-flag')) { st.flags[t.getAttribute('data-flag')] = t.checked; update(); commit(); return; }
            if (t.hasAttribute('data-opt')) {
                var k = t.getAttribute('data-opt');
                st.opts[k] = t.type === 'checkbox' ? (t.checked ? '1' : '0') : t.value;
                update(); commit();
                return;
            }
            if (t.hasAttribute('data-field') && t.tagName === 'SELECT') { st.fields[t.getAttribute('data-field')] = t.value; update(); commit(); }
        }

        root.addEventListener('click', onClick);
        root.addEventListener('input', onInput);
        root.addEventListener('change', onChange);

        var ro = window.ResizeObserver ? new ResizeObserver(function () { if (st.mode === 'make') { draw(); } }) : null;
        if (ro) { ro.observe(el.well); }
        var onTheme = function () { draw(); };
        document.addEventListener('pudl:theme-change', onTheme);

        instance.state = function () { return stateString(st); };
        instance.setState = function (s) {
            st = parseState(s || '');
            fillDefaults();
            buildForm(); update(); setMode(st.mode);
            commit();
        };
        instance.cleanup = function () {
            clearTimeout(writeTimer);
            if (ro) { ro.disconnect(); }
            document.removeEventListener('pudl:theme-change', onTheme);
            root.removeEventListener('click', onClick);
            root.removeEventListener('input', onInput);
            root.removeEventListener('change', onChange);
            if (el.dialog.open) { el.dialog.close(); }
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
                destroy: function () { inst.destroy(); }
            };
        }
    });
})();
