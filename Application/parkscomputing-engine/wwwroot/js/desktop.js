/* Desktop-mode wiring on top of pudl-windows.js (v0.7.0).

   The windows module itself handles maximized-by-default (data-win-mode on
   the window markup), the sidebar's active and child rows, Escape on child
   windows, and the back link. What remains here is content enhancement:
   scripts inside fetched window markup do not run (PUDL rule), so
   highlight.js and Mermaid are run over each window as it arrives. */
(function () {
    'use strict';

    function enhance(win) {
        if (window.hljs) {
            win.querySelectorAll('pre code:not(.language-mermaid)').forEach(function (block) {
                window.hljs.highlightElement(block);
            });
        }
        win.querySelectorAll('pre > code[class*="language-mermaid"]').forEach(function (code) {
            var node = document.createElement('div');
            node.className = 'mermaid';
            node.textContent = code.textContent || '';
            code.parentElement.replaceWith(node);
        });
        if (window.mermaid && win.querySelector('.mermaid')) {
            window.mermaid.initialize({ startOnLoad: false });
            window.mermaid.run({ nodes: win.querySelectorAll('.mermaid') });
        }
    }

    /* The toolbar filter narrows the sidebar as you type. The server already
       renders the ?q= filtered list; this refines it live, and writes the
       value back into the URL once typing goes quiet so the state stays
       shareable. Submitting the form (Enter, or no script) does the same
       through the server. */
    function initFilter() {
        var input = document.querySelector('.md-filter');
        var sidebar = document.querySelector('.md-sidebar');
        if (!input || !sidebar) { return; }
        var timer = 0;

        input.addEventListener('input', function () {
            var q = input.value.trim().toLowerCase();
            var label = null, labelHasRow = false;

            Array.prototype.forEach.call(sidebar.children, function (el) {
                if (el.classList.contains('md-section-label')) {
                    if (label) { label.hidden = !labelHasRow; }
                    label = el;
                    labelHasRow = false;
                } else if (el.classList.contains('md-row')) {
                    if (el.classList.contains('md-row-child')) {
                        /* A child row follows its parent row's fate. */
                        el.hidden = !!(el.previousElementSibling && el.previousElementSibling.hidden);
                    } else {
                        var text = (el.textContent || '').toLowerCase();
                        el.hidden = q !== '' && text.indexOf(q) < 0;
                    }
                    if (!el.hidden) { labelHasRow = true; }
                }
            });
            if (label) { label.hidden = !labelHasRow; }

            clearTimeout(timer);
            timer = setTimeout(function () {
                var url = new URL(location.href);
                if (input.value.trim()) { url.searchParams.set('q', input.value.trim()); }
                else { url.searchParams.delete('q'); }
                history.replaceState(history.state, '', url);
            }, 400);
        });
    }

    function init() {
        initFilter();

        var layer = document.querySelector('[data-win-layer]');
        if (!layer) { return; }

        /* Applet start and teardown are pudl-applets.js's own wiring on the
           window open and close events; image stepping is a data-win-replace
           link that pudl-windows swaps in place. Only content enhancement
           remains site work. */
        layer.addEventListener('pudl:window-open', function (e) {
            enhance(e.target);
        });

        /* In an image window the plain arrow keys step between images, as
           they do in the classic lightbox. Captured before pudl-windows'
           own keyboard handling, which keeps Shift+arrows for resizing;
           windows without image nav keep arrow-key movement. */
        layer.addEventListener('keydown', function (e) {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') { return; }
            if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) { return; }
            if (e.target.closest && e.target.closest('input, textarea, select')) { return; }
            var win = e.target.closest && e.target.closest('.win');
            if (!win) { return; }
            var nav = win.querySelector('.win-img-nav');
            if (!nav) { return; }
            e.preventDefault();
            e.stopPropagation();
            var link = nav.querySelector('[data-img-nav="' + (e.key === 'ArrowLeft' ? 'prev' : 'next') + '"]');
            if (link) { link.click(); }
        }, true);

        /* Windows the server rendered from the URL fire no open event. */
        layer.querySelectorAll('.win').forEach(enhance);
    }

    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
    else { init(); }
})();
