/* Barcode flash cards as a PUDL applet (0.21.0): init(root, opts) builds
   the drill inside root, scopes every lookup and listener to it, and
   returns an instance with destroy(). The deck shuffles on every start,
   which is the nature of a drill, so the applet keeps no state and offers
   none to its host. */
(function () {
    'use strict';

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
            '<p class="flashcard-help">Press Space to reveal or hide the name; the arrow keys or the buttons step through the deck.</p>' +
            '<div class="flashcard">' +
              '<div class="flashcard-face"><img data-role="image" data-no-lightbox alt="" /></div>' +
              '<div class="flashcard-answer"><span data-role="name" class="flashcard-name"></span></div>' +
            '</div>' +
            '<div class="flashcard-controls">' +
              '<button type="button" class="btn" data-action="prev">&#8592; Prev</button>' +
              '<button type="button" class="btn btn-primary" data-action="reveal" aria-pressed="false">Reveal</button>' +
              '<button type="button" class="btn" data-action="next">Next &#8594;</button>' +
              '<button type="button" class="btn" data-action="shuffle">Shuffle</button>' +
            '</div>' +
            '<div class="flashcard-count num"><span data-role="pos"></span> of ' + CARDS.length + '</div>';

        root.classList.add('pc-flashcards');
        if (opts.fit === 'fill') { root.classList.add('pc-flashcards-fill'); }
        if (!root.hasAttribute('tabindex')) { root.tabIndex = 0; }

        var q = function (sel) { return root.querySelector(sel); };
        var imgEl = q('[data-role="image"]');
        var nameEl = q('[data-role="name"]');
        var posEl = q('[data-role="pos"]');
        var revealBtn = q('[data-action="reveal"]');

        var deck = CARDS.slice();
        var idx = 0;
        var revealed = false;

        function render() {
            var card = deck[idx];
            imgEl.src = card.src;
            imgEl.alt = 'Barcode example';
            nameEl.textContent = card.name;
            nameEl.classList.toggle('revealed', revealed);
            revealBtn.setAttribute('aria-pressed', String(revealed));
            posEl.textContent = idx + 1;
        }

        function step(d) { idx = (idx + d + deck.length) % deck.length; revealed = false; render(); }
        function reveal() { revealed = !revealed; render(); }
        function shuffle() {
            for (var i = deck.length - 1; i > 0; i--) {
                var j = Math.floor(Math.random() * (i + 1));
                var t = deck[i]; deck[i] = deck[j]; deck[j] = t;
            }
            idx = 0;
            revealed = false;
            render();
        }

        q('[data-action="prev"]').addEventListener('click', function () { step(-1); });
        q('[data-action="next"]').addEventListener('click', function () { step(1); });
        revealBtn.addEventListener('click', reveal);
        q('[data-action="shuffle"]').addEventListener('click', shuffle);

        function onKeyDown(e) {
            if (e.altKey || e.ctrlKey || e.metaKey) { return; }
            if (e.code === 'ArrowLeft') { step(-1); e.preventDefault(); }
            else if (e.code === 'ArrowRight') { step(1); e.preventDefault(); }
            else if (e.code === 'Space') { reveal(); e.preventDefault(); }
        }
        root.addEventListener('keydown', onKeyDown);
        root.addEventListener('pointerdown', function () { root.focus({ preventScroll: true }); });

        shuffle();
        if (opts.ownsUrl || root.closest('.win.active')) { root.focus({ preventScroll: true }); }

        return {
            destroy: function () {
                root.removeEventListener('keydown', onKeyDown);
            }
        };
    }

    window.pudlApplets.register('flashcards', { init: init });
})();
