/* Image lightbox. The dialog shell is server-rendered in the layout
   (PUDL: dialogs are rendered by the server and shown by script); this
   script fills it with the clicked image and steps through the gallery.
   The gallery is the set of images in the same content region as the
   clicked image, so each desktop-mode window is its own gallery. */
(function () {
    'use strict';

    var dialog, img, caption, counter, prevBtn, nextBtn;
    var images = [];
    var index = 0;

    function regionOf(el) {
        return el.closest('.win-body') || el.closest('.content-body') || document.body;
    }

    /* An image counts when it is unlinked, or its link just points at an
       image file (the WordPress full-size link). A data-win-open link
       belongs to the windows module instead. */
    function isImageLink(a) {
        return a && !a.hasAttribute('data-win-open') &&
            /\.(jpe?g|png|gif|webp|avif|svg)([?#].*)?$/i.test(a.getAttribute('href') || '');
    }

    function eligible(i) {
        if (i.closest('.lightbox') || i.hasAttribute('data-no-lightbox')) { return false; }
        var a = i.closest('a');
        return !a || isImageLink(a);
    }

    function imagesIn(region) {
        return Array.from(region.querySelectorAll('img')).filter(eligible);
    }

    function captionOf(image) {
        var figure = image.closest('figure');
        var fc = figure && figure.querySelector('figcaption');
        return fc ? fc.textContent.trim() : (image.alt || '');
    }

    function show(i) {
        if (i < 0 || i >= images.length) { return; }
        index = i;
        img.src = images[i].src;
        img.alt = images[i].alt || '';
        caption.textContent = captionOf(images[i]);
        counter.textContent = images.length > 1 ? (i + 1) + ' of ' + images.length : '';
        prevBtn.hidden = i <= 0;
        nextBtn.hidden = i >= images.length - 1;
    }

    function open(image) {
        images = imagesIn(regionOf(image));
        show(Math.max(0, images.indexOf(image)));
        dialog.showModal();
    }

    function init() {
        dialog = document.getElementById('image-lightbox');
        if (!dialog) { return; }
        img = dialog.querySelector('.lightbox-img');
        caption = dialog.querySelector('.lightbox-caption');
        counter = dialog.querySelector('.lightbox-counter');
        prevBtn = dialog.querySelector('.lightbox-prev');
        nextBtn = dialog.querySelector('.lightbox-next');

        /* Delegated, so images inside fetched windows need no re-wiring. */
        document.addEventListener('click', function (e) {
            if (e.defaultPrevented) { return; }
            var image = e.target.closest('img');
            if (image && !dialog.open &&
                (image.closest('.content-body') || image.closest('.win-body')) &&
                eligible(image)) {
                e.preventDefault();
                open(image);
            }
        });

        prevBtn.addEventListener('click', function () { show(index - 1); });
        nextBtn.addEventListener('click', function () { show(index + 1); });
        dialog.querySelector('.lightbox-close').addEventListener('click', function () { dialog.close(); });

        dialog.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowLeft') { e.preventDefault(); show(index - 1); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); show(index + 1); }
        });

        /* A click on the backdrop, outside the frame, closes it. */
        dialog.addEventListener('click', function (e) {
            if (e.target === dialog) { dialog.close(); }
        });

        dialog.addEventListener('close', function () { img.src = ''; });
    }

    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
    else { init(); }
})();
