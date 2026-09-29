/* The image lightbox, for both the window and the classic views. The
   dialog shell is server-rendered in the layout (PUDL: dialogs come from
   the server); this script fills it and runs it.

   - The gallery is the images in the clicked image's own region: one
     window's body, or the page's content.
   - An image shows at its natural size up to the screen, scaled down
     beyond that. When it is larger than the screen, a click zooms to full
     size; drag or scroll to pan, and click again to fit.
   - Previous and next come from the buttons, the arrow keys, Home and
     End, and a swipe on a touch screen. Neighbours are preloaded.
   - Opening adds a history entry, so Back closes the lightbox, as a phone
     reader expects. On a classic page the entry carries #image-N, so an
     address can open an article at one of its images.
   - A page rendered in a frame hands its images to the top page's
     lightbox, so a framed article's images fill the screen, not the
     frame. */
(function () {
    'use strict';

    var dialog, stage, img, caption, counter, prevBtn, nextBtn;
    var items = [];     /* { src, alt, caption } */
    var index = 0;
    var ownEntry = false;   /* whether the current history entry is ours */
    var classic = false;    /* whether the gallery is a classic page's content */

    var IMAGE_HREF = /\.(jpe?g|png|gif|webp|avif|svg)([?#].*)?$/i;

    function regionOf(el) {
        return el.closest('.win-body') || el.closest('.content-body') || document.body;
    }

    /* An image counts when it is unlinked, or its link just points at an
       image file (the WordPress full-size link). Applets and marked images
       keep their own clicks. */
    function eligible(i) {
        if (i.closest('.lightbox') || i.closest('[data-applet]') || i.hasAttribute('data-no-lightbox')) { return false; }
        var a = i.closest('a');
        return !a || (!a.hasAttribute('data-win-open') && IMAGE_HREF.test(a.getAttribute('href') || ''));
    }

    function captionOf(image) {
        var figure = image.closest('figure');
        var fc = figure && figure.querySelector('figcaption');
        return fc ? fc.textContent.trim() : (image.alt || '');
    }

    /* The full-size source: a surrounding image link's target when there is
       one, since WordPress-era articles link a thumbnail to the original. */
    function sourceOf(image) {
        var a = image.closest('a');
        return a && IMAGE_HREF.test(a.getAttribute('href') || '') ? a.href : (image.currentSrc || image.src);
    }

    function galleryFor(image) {
        var list = Array.from(regionOf(image).querySelectorAll('img')).filter(eligible);
        return { items: list.map(function (i) { return { src: sourceOf(i), alt: i.alt || '', caption: captionOf(i) }; }), index: Math.max(0, list.indexOf(image)) };
    }

    function preload(i) {
        if (i >= 0 && i < items.length) { var p = new Image(); p.src = items[i].src; }
    }

    function unzoom() {
        dialog.classList.remove('lightbox-zoomed');
        stage.scrollLeft = 0; stage.scrollTop = 0;
    }

    /* Zoom is offered only when the image is shown smaller than it is. */
    function markZoomable() {
        var shrunk = img.naturalWidth > img.clientWidth + 1 || img.naturalHeight > img.clientHeight + 1;
        dialog.classList.toggle('lightbox-zoomable', shrunk || dialog.classList.contains('lightbox-zoomed'));
    }

    function show(i) {
        if (i < 0 || i >= items.length) { return; }
        index = i;
        unzoom();
        dialog.classList.remove('lightbox-zoomable');
        img.src = items[i].src;
        img.alt = items[i].alt;
        caption.textContent = items[i].caption;
        caption.hidden = !items[i].caption;
        counter.textContent = items.length > 1 ? (i + 1) + ' of ' + items.length : '';
        prevBtn.hidden = i <= 0;
        nextBtn.hidden = i >= items.length - 1;
        if (img.complete) { markZoomable(); }
        preload(i + 1); preload(i - 1);
        if (ownEntry && classic) {
            history.replaceState(history.state, '', location.pathname + location.search + '#image-' + (i + 1));
        }
    }

    /* Opens the lightbox on a list, as the top page does for a framed one. */
    function openList(list, at, isClassic) {
        items = list;
        classic = !!isClassic;
        show(at || 0);
        if (!dialog.open) {
            dialog.showModal();
            var hash = classic ? '#image-' + (index + 1) : location.hash;
            history.pushState({ pcLightbox: true }, '', location.pathname + location.search + hash);
            ownEntry = true;
        }
    }

    function close() { if (dialog.open) { dialog.close(); } }

    function inFrame() {
        try { return window.top !== window && window.top.pcLightbox; } catch (e) { return null; }
    }

    function init() {
        dialog = document.getElementById('image-lightbox');
        if (!dialog) { return; }
        stage = dialog.querySelector('.lightbox-stage');
        img = dialog.querySelector('.lightbox-img');
        caption = dialog.querySelector('.lightbox-caption');
        counter = dialog.querySelector('.lightbox-counter');
        prevBtn = dialog.querySelector('.lightbox-prev');
        nextBtn = dialog.querySelector('.lightbox-next');

        window.pcLightbox = { openList: openList };

        /* Delegated, so images in windows that arrive later need nothing. */
        document.addEventListener('click', function (e) {
            if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) { return; }
            var image = e.target.closest && e.target.closest('img');
            if (!image || dialog.open || !(image.closest('.content-body') || image.closest('.win-body')) || !eligible(image)) { return; }
            e.preventDefault();
            var g = galleryFor(image);
            var top = inFrame();
            if (top) {
                /* Absolute sources, so the top page resolves them the same. */
                top.openList(g.items.map(function (it) { return { src: new URL(it.src, location.href).href, alt: it.alt, caption: it.caption }; }), g.index, false);
                return;
            }
            openList(g.items, g.index, !image.closest('.win-body'));
        });

        prevBtn.addEventListener('click', function () { show(index - 1); });
        nextBtn.addEventListener('click', function () { show(index + 1); });
        dialog.querySelector('.lightbox-close').addEventListener('click', close);

        dialog.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowLeft') { e.preventDefault(); show(index - 1); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); show(index + 1); }
            else if (e.key === 'Home') { e.preventDefault(); show(0); }
            else if (e.key === 'End') { e.preventDefault(); show(items.length - 1); }
        });

        img.addEventListener('load', markZoomable);
        window.addEventListener('resize', function () { if (dialog.open) { markZoomable(); } });

        /* Pointer handling on the stage: a click toggles zoom, a drag pans a
           zoomed image, a horizontal swipe steps an unzoomed one. */
        var down = null;
        stage.addEventListener('pointerdown', function (e) {
            if (e.button !== 0) { return; }
            /* Where the press began decides what a click means, since a
               captured pointer reports the stage as every later target. */
            down = { x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop, moved: false, type: e.pointerType, onImg: e.target === img };
            if (dialog.classList.contains('lightbox-zoomed') && e.pointerType === 'mouse') { stage.setPointerCapture(e.pointerId); }
        });
        stage.addEventListener('pointermove', function (e) {
            if (!down) { return; }
            var dx = e.clientX - down.x, dy = e.clientY - down.y;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) { down.moved = true; }
            if (dialog.classList.contains('lightbox-zoomed') && down.type === 'mouse') {
                stage.scrollLeft = down.sl - dx; stage.scrollTop = down.st - dy;
            }
        });
        stage.addEventListener('pointerup', function (e) {
            if (!down) { return; }
            var d = down; down = null;
            var dx = e.clientX - d.x, dy = e.clientY - d.y;
            var zoomed = dialog.classList.contains('lightbox-zoomed');
            if (!zoomed && d.type !== 'mouse' && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                show(index + (dx < 0 ? 1 : -1));
                return;
            }
            if (d.moved) { return; }
            if (!d.onImg && !zoomed) { close(); return; }
            if (!d.onImg) { return; }
            if (zoomed) { unzoom(); markZoomable(); return; }
            if (!dialog.classList.contains('lightbox-zoomable')) { return; }
            /* Zoom about the clicked point. */
            var r = img.getBoundingClientRect();
            var fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
            dialog.classList.add('lightbox-zoomed');
            stage.scrollLeft = fx * img.naturalWidth - stage.clientWidth / 2;
            stage.scrollTop = fy * img.naturalHeight - stage.clientHeight / 2;
        });
        stage.addEventListener('pointercancel', function () { down = null; });

        /* A click on the backdrop, outside everything, closes it. */
        dialog.addEventListener('click', function (e) { if (e.target === dialog) { close(); } });

        /* However it closes, the history entry it added goes with it. */
        dialog.addEventListener('close', function () {
            unzoom();
            img.removeAttribute('src');
            if (ownEntry) {
                ownEntry = false;
                if (history.state && history.state.pcLightbox) { history.back(); }
            }
        });

        /* Back while it is open closes it, and the entry is already gone. */
        window.addEventListener('popstate', function () {
            if (dialog.open) { ownEntry = false; close(); }
        });

        /* A classic page at #image-N opens that image, whether it arrived
           that way or a link on the page changed the fragment. */
        var content = document.querySelector('.content-body');
        function openFromHash() {
            var m = /^#image-([0-9]+)$/.exec(location.hash);
            if (!m || !content || dialog.open || document.body.classList.contains('desktop')) { return; }
            var list = Array.from(content.querySelectorAll('img')).filter(eligible);
            var image = list[+m[1] - 1];
            if (!image) { return; }
            history.replaceState(history.state, '', location.pathname + location.search);
            var g = galleryFor(image);
            openList(g.items, g.index, true);
        }
        if (document.readyState === 'complete') { openFromHash(); } else { window.addEventListener('load', openFromHash); }
        window.addEventListener('hashchange', openFromHash);
    }

    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
    else { init(); }
})();
