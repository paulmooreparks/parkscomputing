/* Barcode flash cards as a PUDL applet (0.21.0): init(root, opts) builds
   the drill inside root, scopes every lookup and listener to it, and
   returns an instance with destroy(). The deck shuffles on every start,
   which is the nature of a drill, so the applet keeps no state and offers
   none to its host.

   There are two kinds of card. Scans are the reference images below.
   Generated cards are drawn by the barcode tool's engine, which this
   script loads beside itself, with fresh random data on every shuffle;
   revealing one names it, shows its data and colors its guards, start
   and stop patterns and check characters. */
(function () {
    'use strict';

    var SELF_SRC = document.currentScript && document.currentScript.src;
    function beside(file) { return SELF_SRC ? SELF_SRC.replace(/flashcards\.js/, file) : '/js/' + file; }
    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = function () { reject(new Error('could not load ' + src)); };
            document.head.appendChild(s);
        });
    }
    /* The engine, and the QR library it wraps; a deck without the library
       simply has no QR card. */
    var engineReady = null;
    function loadEngine() {
        if (window.pcBarcode) { return Promise.resolve(window.pcBarcode); }
        if (!engineReady) {
            var qr = window.qrcodegen ? Promise.resolve() : loadScript(beside('vendor/qrcodegen-1.8.0.js')).catch(function () { });
            engineReady = qr.then(function () { return loadScript(beside('barcode-engine.js')); })
                .then(function () { return window.pcBarcode; }, function (err) { engineReady = null; throw err; });
        }
        return engineReady;
    }

    function rnd(n) { return Math.floor(Math.random() * n); }
    function digits(n) { var s = ''; for (var i = 0; i < n; i++) { s += rnd(10); } return s; }
    function pick(s) { return s[rnd(s.length)]; }
    function chars(set, min, max) { var n = min + rnd(max - min + 1), s = ''; for (var i = 0; i < n; i++) { s += pick(set); } return s; }
    function yymmdd() {
        var d = new Date(Date.now() + (30 + rnd(700)) * 864e5);
        return String(d.getFullYear() % 100).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    }

    /* One generator per symbology the engine draws. Each returns encoder
       input and options; the data is random but always valid. */
    var GENERATED = [
        { name: 'EAN-13', sym: 'ean13', make: function () { return { input: (1 + rnd(9)) + digits(11) }; } },
        { name: 'EAN-8', sym: 'ean8', make: function () { return { input: digits(7) }; } },
        { name: 'UPC-A', sym: 'upca', make: function () { return { input: pick('0167') + digits(10) }; } },
        { name: 'UPC-E', sym: 'upce', make: function () { return { input: '0' + digits(6) }; } },
        { name: 'Interleaved 2 of 5', sym: 'itf', make: function () { return { input: digits(2 * (4 + rnd(4))) }; } },
        { name: 'ITF-14', sym: 'itf14', make: function () { return { input: (1 + rnd(8)) + digits(12) }; } },
        { name: 'Code 39', sym: 'code39', make: function () { return { input: chars('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-', 5, 9) }; } },
        { name: 'Codabar', sym: 'codabar', make: function () { var e = pick('ABCD'); return { input: digits(6 + rnd(5)), opts: { start: e, stop: e } }; } },
        { name: 'Code 128', sym: 'code128', make: function () { return { input: chars('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', 3, 5) + '-' + digits(3 + rnd(4)) }; } },
        {
            name: 'GS1-128', sym: 'gs1-128', make: function (B) {
                var gtin = digits(13), s = '(01)' + gtin + B.checks['gs1-mod10'].compute(gtin);
                if (rnd(2)) { s += '(17)' + yymmdd(); }
                return { input: s + '(10)' + chars('ABCDEFGHJKLMNPQRSTUVWXYZ0123456789', 4, 8) };
            }
        },
        {
            name: 'QR Code', sym: 'qr', make: function () {
                return { input: 'https://example.com/' + chars('abcdefghijkmnopqrstuvwxyz23456789', 4, 24), opts: { ecc: pick('LMQH') } };
            }
        }
    ];

    var CARDS = [
        { name: 'Aztec', src: '/images/barcodes/aztec-font-example.png' },
        { name: 'MICR CMC7', src: '/images/barcodes/CMC7.png' },
        { name: 'Codabar', src: '/images/barcodes/codabar.png' },
        { name: 'Code 11', src: '/images/barcodes/Code11.png' },
        { name: 'Industrial 2 of 5', src: '/images/barcodes/Code25.png' },
        { name: 'Code 39', src: '/images/barcodes/code39.png' },
        { name: 'Code 93', src: '/images/barcodes/Code93.png' },
        { name: 'Code 128 A', src: '/images/barcodes/code128a.png' },
        { name: 'Code 128 B', src: '/images/barcodes/code128b.png' },
        { name: 'Code 128 C / GS1-128', src: '/images/barcodes/code128c.png' },
        { name: 'GS1 DataBar Coupon Code', src: '/images/barcodes/coupon-code-example.png' },
        { name: 'Interleaved 2 of 5', src: '/images/barcodes/cropped-I2of5.png' },
        { name: 'DataBar GTIN Weight Sell-by Date', src: '/images/barcodes/databar-gtin-weight-sell-by-date.gif' },
        { name: 'DataBar Omni-directional Stacked', src: '/images/barcodes/databar-stacked-omni-directional.png' },
        { name: 'DataBar Truncated', src: '/images/barcodes/databar-truncated.png' },
        { name: 'Data Matrix ECC200', src: '/images/barcodes/DataMatrixImage.png' },
        { name: 'EAN-8', src: '/images/barcodes/ean8.png' },
        { name: 'EAN-13', src: '/images/barcodes/ean13.png' },
        { name: 'GS1 DataBar Limited', src: '/images/barcodes/gs1-databar-limited.png' },
        { name: 'GS1 DataBar Omni-directional', src: '/images/barcodes/gs1-databar-omnidirectional.png' },
        { name: 'GS1 DotCode', src: '/images/barcodes/gs1-dotcode-symbol.png' },
        { name: 'MaxiCode', src: '/images/barcodes/maxicode.png' },
        { name: 'MICR E13B', src: '/images/barcodes/MICR.png' },
        { name: 'MSI Plessey', src: '/images/barcodes/MSI.png' },
        { name: 'PDF417', src: '/images/barcodes/PDF417_Barcode_Font-150x57-1.png' },
        { name: 'PLANET', src: '/images/barcodes/PLANET.png' },
        { name: 'POSTNET', src: '/images/barcodes/POSTNET.png' },
        { name: 'QR Code', src: '/images/barcodes/qrcode-example.png' },
        { name: 'UPC-A', src: '/images/barcodes/UPCa.png' },
        { name: 'UPC-E', src: '/images/barcodes/UPCe.png' },
        { name: 'USPS Intelligent Mail Barcode', src: '/images/barcodes/USPS-IntelligentMail-Barcode.png' }
    ];

    function init(root, opts) {
        opts = opts || {};

        root.innerHTML =
            '<div class="seg" role="group" aria-label="Deck">' +
              '<button type="button" data-deck="both">All cards</button>' +
              '<button type="button" data-deck="scans">Scans</button>' +
              '<button type="button" data-deck="generated">Generated</button>' +
            '</div>' +
            '<p class="flashcard-help">Press Space to reveal or hide the name; the arrow keys or the buttons step through the deck.</p>' +
            '<div class="flashcard">' +
              '<div class="flashcard-face" data-role="face">' +
                '<img data-role="image" data-no-lightbox alt="" />' +
                '<canvas data-role="canvas" hidden></canvas>' +
              '</div>' +
              '<div class="flashcard-answer" data-role="answer">' +
                '<span data-role="name" class="flashcard-name"></span>' +
                '<span data-role="data" class="flashcard-data"></span>' +
                '<span data-role="key" class="flashcard-key">' +
                  '<span><i data-role="key-structure"></i><span data-role="key-structure-label"></span></span>' +
                  '<span data-role="key-check-item"><i data-role="key-check"></i>Check characters</span>' +
                '</span>' +
              '</div>' +
            '</div>' +
            '<div class="flashcard-controls">' +
              '<button type="button" class="btn" data-action="prev">&#8592; Prev</button>' +
              '<button type="button" class="btn" data-action="reveal" aria-pressed="false">Reveal</button>' +
              '<button type="button" class="btn" data-action="next">Next &#8594;</button>' +
              '<button type="button" class="btn" data-action="shuffle">Shuffle</button>' +
            '</div>' +
            '<div class="flashcard-count num"><span data-role="pos"></span> of <span data-role="total"></span></div>' +
            '<p class="flashcard-note" data-role="note" hidden></p>';

        root.classList.add('pc-flashcards');
        if (opts.fit === 'fill') { root.classList.add('pc-flashcards-fill'); }
        if (!root.hasAttribute('tabindex')) { root.tabIndex = 0; }

        var q = function (sel) { return root.querySelector(sel); };
        var faceEl = q('[data-role="face"]');
        var imgEl = q('[data-role="image"]');
        var canvasEl = q('[data-role="canvas"]');
        var answerEl = q('[data-role="answer"]');
        var nameEl = q('[data-role="name"]');
        var dataEl = q('[data-role="data"]');
        var posEl = q('[data-role="pos"]');
        var totalEl = q('[data-role="total"]');
        var noteEl = q('[data-role="note"]');
        var revealBtn = q('[data-action="reveal"]');

        var B = null;
        var mode = 'both';
        var deck = [];
        var idx = 0;
        var revealed = false;

        /* A fresh generated card: random data until the encoder accepts it,
           which the generators are written to manage the first time. */
        function generate(gen) {
            for (var i = 0; i < 5; i++) {
                var g = gen.make(B), r = B.encode(gen.sym, g.input, g.opts || {});
                if (r.ok) { return { name: gen.name, symbol: r.symbol }; }
            }
            return null;
        }

        function buildDeck() {
            var cards = [];
            if (mode !== 'generated' || !B) { cards = CARDS.slice(); }
            if (mode !== 'scans' && B) {
                var copies = mode === 'generated' ? 2 : 1;
                for (var c = 0; c < copies; c++) {
                    GENERATED.forEach(function (gen) { var card = generate(gen); if (card) { cards.push(card); } });
                }
            }
            return cards;
        }

        function drawGenerated(card) {
            var o = { showText: true, bands: [], charColors: [] };
            if (revealed) {
                o.bands = B.roleBands(card.symbol, { checks: true, structure: true });
                card.symbol.chars.forEach(function (ch, i) { if (ch.role === 'check') { o.charColors[i] = B.roleColors.check; } });
            }
            var g = B.geometry(card.symbol, o);
            var dpr = window.devicePixelRatio || 1;
            var availW = Math.max(160, faceEl.clientWidth - 32);
            var byW = Math.floor(availW * dpr / g.width);
            var byH = opts.fit === 'fill' ? Math.floor(Math.max(80, faceEl.clientHeight - 32) * dpr / g.height) : byW;
            o.px = Math.max(1, Math.min(Math.floor((card.symbol.matrix ? 8 : 4) * dpr), byW, byH));
            o.cssScale = dpr;
            B.render(canvasEl, card.symbol, o);
        }

        function render() {
            var card = deck[idx];
            var generated = !!card.symbol;
            imgEl.hidden = generated;
            canvasEl.hidden = !generated;
            if (generated) {
                imgEl.removeAttribute('src');
                drawGenerated(card);
                canvasEl.setAttribute('aria-label', 'Barcode example');
                dataEl.textContent = card.symbol.hri || card.symbol.data;
                q('[data-role="key-structure-label"]').textContent = card.symbol.matrix ? 'Finder patterns' : 'Guards, start and stop';
                q('[data-role="key-check-item"]').hidden = !!card.symbol.matrix;
            } else {
                imgEl.src = card.src;
                imgEl.alt = 'Barcode example';
                dataEl.textContent = '';
            }
            nameEl.textContent = card.name;
            answerEl.classList.toggle('revealed', revealed);
            answerEl.classList.toggle('generated', generated);
            revealBtn.setAttribute('aria-pressed', String(revealed));
            posEl.textContent = idx + 1;
            totalEl.textContent = deck.length;
        }

        function step(d) { idx = (idx + d + deck.length) % deck.length; revealed = false; render(); }
        function reveal() { revealed = !revealed; render(); }
        function shuffle() {
            deck = buildDeck();
            for (var i = deck.length - 1; i > 0; i--) {
                var j = Math.floor(Math.random() * (i + 1));
                var t = deck[i]; deck[i] = deck[j]; deck[j] = t;
            }
            idx = 0;
            revealed = false;
            render();
        }
        function setMode(m) {
            mode = m;
            root.querySelectorAll('[data-deck]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-deck') === mode)); });
            shuffle();
        }

        q('[data-action="prev"]').addEventListener('click', function () { step(-1); });
        q('[data-action="next"]').addEventListener('click', function () { step(1); });
        revealBtn.addEventListener('click', reveal);
        q('[data-action="shuffle"]').addEventListener('click', shuffle);
        root.querySelectorAll('[data-deck]').forEach(function (b) {
            b.addEventListener('click', function () { if (!b.disabled) { setMode(b.getAttribute('data-deck')); } });
        });

        /* Redraw a generated card when its box changes size. */
        var resizeObs = null, lastW = 0, lastH = 0;
        if (typeof ResizeObserver === 'function') {
            resizeObs = new ResizeObserver(function () {
                var w = faceEl.clientWidth, h = faceEl.clientHeight;
                if (w === lastW && h === lastH) { return; }
                lastW = w; lastH = h;
                if (deck.length && deck[idx].symbol) { drawGenerated(deck[idx]); }
            });
            resizeObs.observe(faceEl);
        }

        function onKeyDown(e) {
            if (e.altKey || e.ctrlKey || e.metaKey) { return; }
            if (e.code === 'ArrowLeft') { step(-1); e.preventDefault(); }
            else if (e.code === 'ArrowRight') { step(1); e.preventDefault(); }
            else if (e.code === 'Space') { reveal(); e.preventDefault(); }
        }
        root.addEventListener('keydown', onKeyDown);
        root.addEventListener('pointerdown', function () { root.focus({ preventScroll: true }); });

        /* The scans deal at once; the generated cards join when the engine
           arrives. Without it the deck is the scans alone. */
        var destroyed = false;
        setMode('scans');
        root.querySelectorAll('[data-deck]').forEach(function (b) { if (b.getAttribute('data-deck') !== 'scans') { b.disabled = true; } });
        loadEngine().then(function (engine) {
            if (destroyed) { return; }
            B = engine;
            q('[data-role="key-structure"]').style.background = B.roleColors.structure;
            q('[data-role="key-check"]').style.background = B.roleColors.check;
            root.querySelectorAll('[data-deck]').forEach(function (b) { b.disabled = false; });
            setMode('both');
        }, function () {
            if (destroyed) { return; }
            noteEl.textContent = 'The generated cards could not be loaded, so this deck has the scans only.';
            noteEl.hidden = false;
        });
        if (opts.ownsUrl || root.closest('.win.active')) { root.focus({ preventScroll: true }); }

        return {
            destroy: function () {
                destroyed = true;
                root.removeEventListener('keydown', onKeyDown);
                if (resizeObs) { resizeObs.disconnect(); }
            }
        };
    }

    window.pudlApplets.register('flashcards', { init: init });
})();
