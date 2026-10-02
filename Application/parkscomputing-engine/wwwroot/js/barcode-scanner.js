/* Camera, image and text input for the shared retail barcode layouts. */
(function () {
    'use strict';
    var src = document.currentScript.src, ready, decoderReady, serial = 0;
    function beside(name) { return new URL(name + new URL(src).search, src).href; }
    function script(url) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script'); s.src = url;
            s.onload = resolve; s.onerror = function () { s.remove(); reject(new Error('A scanner component could not load. Reload the page to retry.')); };
            document.head.appendChild(s);
        });
    }
    function load() {
        if (!ready) {
            ready = (window.pcBarcode && window.pcBarcode.demos && window.pcBarcode.layouts.preservesWhitespace ? Promise.resolve() : script(beside('barcode-engine.js')))
                .then(function () { return window.pcBarcodeScanner ? null : script(beside('barcode-scanner-core.js')); })
                .then(function () { return window.pcBarcodeLookup ? null : script(beside('barcode-lookup.js')); })
                .then(function () { return window.pcBarcodeLookupUI ? null : script(beside('barcode-lookup-ui.js')); })
                .catch(function (e) { ready = null; throw e; });
        }
        return ready;
    }
    function decoder() {
        if (!decoderReady) {
            var base = new URL('vendor/zxing-wasm-3.1.4/', src);
            decoderReady = (window.ZXingWASM ? Promise.resolve() : script(new URL('zxing-reader.js', base).href))
                .then(function () {
                    return window.ZXingWASM.prepareZXingModule({ overrides: {
                        locateFile: function (name) { return new URL(name, base).href; }
                    }, fireImmediately: true });
                }).then(function () { return window.ZXingWASM; })
                .catch(function (e) { decoderReady = null; throw e; });
        }
        return decoderReady;
    }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    pudlApplets.register('barcode-scanner', { init: function (root, opts) {
        var destroyed = false, cleanup = function () {}, pendingState = opts.state || '', instance = {};
        root.textContent = 'Loading scanner…';
        load().then(function () { if (!destroyed) { build(); } }).catch(function (e) { if (!destroyed) { root.textContent = e.message; } });
        function build() {
            var B = window.pcBarcode, C = window.pcBarcodeScanner, id = 'scanner-' + (++serial),
                stream = null, timer, generation = 0, capture = null, library = [], layout = '', format = '', cameraOn = false;
            root.classList.add('barcode-scanner');
            root.innerHTML = `
                <div class="bs-toolbar">
                    <button class="btn btn-primary" type="button" data-action="camera" aria-pressed="false" title="Start camera">Camera</button>
                    <div class="menu">
                        <button class="btn menu-btn" type="button" popovertarget="${id}-actions">Actions</button>
                        <nav class="menu-panel" id="${id}-actions" data-role="actions" popover aria-label="Scanner actions">
                            <button class="menu-action" type="button" data-action="image"><span class="glyph" style="--glyph: var(--glyph-file)" aria-hidden="true"></span>Open image</button>
                            <button class="menu-action" type="button" data-action="type"><span class="glyph" style="--glyph: var(--glyph-file)" aria-hidden="true"></span>Type or paste</button>
                            <button class="menu-action" type="button" data-action="import"><span class="glyph" style="--glyph: var(--glyph-folder)" aria-hidden="true"></span>Import layouts</button>
                            <hr class="menu-sep">
                            <button class="menu-action" type="button" data-action="copy" disabled><span class="glyph" style="--glyph: var(--glyph-copy)" aria-hidden="true"></span>Copy result</button>
                            <button class="menu-action" type="button" data-action="details" disabled><span class="glyph" style="--glyph: var(--glyph-info)" aria-hidden="true"></span>Scan details</button>
                            <button class="menu-action" type="button" data-action="clear"><span class="glyph" style="--glyph: var(--glyph-close)" aria-hidden="true"></span>Clear</button>
                            <hr class="menu-sep">
                            <button class="menu-action" type="button" data-action="sources"><span class="glyph" style="--glyph: var(--glyph-folder)" aria-hidden="true"></span>Lookup sources</button>
                            <button class="menu-action" type="button" data-action="install"><span class="glyph" style="--glyph: var(--glyph-info)" aria-hidden="true"></span>Install scanner</button>
                        </nav>
                    </div>
                </div>
                <div class="bs-layout">
                    <label class="form-label" for="${id}-layout">Layout</label>
                    <select class="form-select" id="${id}-layout" data-role="layout"></select>
                </div>
                <div class="bs-stage" data-role="stage">
                    <div class="bs-reading" data-role="reading">
                        <div data-role="symbols" hidden></div>
                        <div data-role="results" tabindex="-1" aria-live="polite"></div>
                    </div>
                    <div class="bs-camera" data-role="camera-layer" hidden>
                        <video data-role="video" muted playsinline aria-label="Camera preview"></video>
                        <p class="bs-camera-hint">Hold the barcode in view</p>
                    </div>
                </div>
                <p class="bs-status" data-role="status" role="status">Ready to scan</p>
                <input type="file" accept="image/*" data-role="image-file" hidden>
                <input type="file" accept="application/json,.json" data-role="layout-file" hidden>
                <dialog class="dialog" data-role="input-dialog" aria-labelledby="${id}-input-title">
                    <h2 class="dialog-title" id="${id}-input-title">Enter a barcode</h2>
                    <form data-role="text-form">
                        <label class="form-label" for="${id}-text">Scanned or pasted value</label>
                        <textarea class="form-input" id="${id}-text" data-role="text" rows="3" spellcheck="false" autocomplete="off"></textarea>
                        <label class="form-label" for="${id}-format">Input format</label>
                        <select class="form-select" id="${id}-format" data-role="format"><option value="">Unknown / try all</option>
                        ${Object.keys(B.symbologies).map(function (key) { return '<option value="' + esc(key) + '">' + esc(B.symbologies[key].name || key) + '</option>'; }).join('')}</select>
                        <p class="form-help">Enter decodes; Shift+Enter inserts a line break. You can also use a keyboard scanner.</p>
                        <div class="dialog-actions"><button class="btn" type="button" data-action="close-input">Cancel</button><button class="btn btn-primary" type="submit">Decode value</button></div>
                    </form>
                </dialog>
                <dialog class="dialog" data-role="details-dialog" aria-labelledby="${id}-details-title">
                    <h2 class="dialog-title" id="${id}-details-title">Scan details</h2>
                    <div data-role="details"></div>
                    <div class="dialog-actions"><button class="btn" type="button" data-action="close-details">Close</button></div>
                </dialog>
                <dialog class="dialog" data-role="install-dialog" aria-labelledby="${id}-install-title">
                    <h2 class="dialog-title" id="${id}-install-title">Install scanner</h2>
                    <p><a href="/page/barcode-scanner?frame" target="_blank" rel="noopener">Open the standalone scanner</a> in your browser, then install it from there.</p>
                    <ul>
                        <li>On iPhone or iPad, use Share, then Add to Home Screen.</li>
                        <li>On Android, use the browser menu's Install app or Add to Home screen option.</li>
                        <li>On desktop Chrome or Edge, use the address bar's install icon or the browser's app installation menu.</li>
                        <li>On Safari for Mac, use File, then Add to Dock.</li>
                    </ul>
                    <p class="form-help">Installation adds a Scanner icon that opens this app on its own. An internet connection is still needed to load the scanner.</p>
                    <div class="dialog-actions"><button class="btn" type="button" data-action="close-install">Close</button></div>
                </dialog>
                <dialog class="dialog" data-role="copy-fallback" aria-labelledby="${id}-export-title">
                    <h2 class="dialog-title" id="${id}-export-title">Copy result</h2>
                    <label class="form-label" for="${id}-export">Select and copy this result</label>
                    <textarea class="form-input" id="${id}-export" readonly rows="6"></textarea>
                    <div class="dialog-actions"><button class="btn" type="button" data-action="close-copy">Close</button></div>
                </dialog>`;
            function q(role) { return root.querySelector('[data-role="' + role + '"]'); }
            function button(action) { return root.querySelector('[data-action="' + action + '"]'); }
            var video = q('video'), lookup;
            function status(message, error) {
                if (destroyed) { return; }
                q('status').textContent = message;
                q('status').classList.toggle('notice', !!error);
                q('status').classList.toggle('danger', !!error);
            }
            function state() { var p = new URLSearchParams(lookup ? lookup.state() : ''); if (layout) { p.set('layout', layout); } if (format) { p.set('format', format); } return p.toString(); }
            function commit() { if (opts.changed) { opts.changed(state()); } }
            function refresh() { if (window.pudlMenubar) { window.pudlMenubar.refresh(); } }
            function readLibrary() {
                library = [];
                try {
                    var saved = localStorage.getItem('pc-barcode-layouts');
                    if (saved) {
                        var result = B.layouts.validateFile(JSON.parse(saved));
                        if (!result.ok) { throw new Error(result.errors.join(' ')); }
                        library = result.layouts.filter(function (L) { return !B.demos.some(function (d) { return d.id === L.id; }); });
                    }
                } catch (e) { status('The saved layout library could not be read: ' + e.message, true); }
                q('layout').innerHTML = '<option value="">Automatic: try all layouts</option>' + B.demos.concat(library).map(function (L) {
                    return '<option value="' + esc(L.id) + '">' + esc(L.name) + '</option>';
                }).join('');
                if (layout && !B.demos.concat(library).some(function (L) { return L.id === layout; })) {
                    var o = document.createElement('option'); o.value = layout; o.textContent = 'Missing layout: ' + layout; q('layout').appendChild(o);
                }
                q('layout').value = layout;
            }
            function render() {
                if (lookup) { lookup.render(); }
                button('copy').disabled = !capture; button('details').disabled = !capture;
                if (!capture) {
                    q('results').innerHTML = '<div class="bs-empty"><h2>Ready for a barcode</h2><p>Turn on the camera, or use Actions to open an image or enter a value.</p><p class="form-help">Images stay in this browser. Lookup sends a value only when you ask.</p></div>';
                    q('details').textContent = ''; return;
                }
                var result = C.inspect(capture, B.demos.concat(library), layout, B);
                var html = '<header class="bs-result-head"><span class="chip">' + esc(capture.format || result.symbology || 'Typed value') + '</span>' +
                    '<h2 class="bs-value">' + esc(C.visible(capture.text)) + '</h2></header>';
                result.issues.forEach(function (s) { html += '<p class="notice warn">' + esc(s) + '</p>'; });
                result.matches.forEach(function (m) {
                    html += '<section class="bs-match"><div class="bs-match-head"><h3>' + esc(m.layout.name) + '</h3><span class="badge ' +
                        (m.issues.length ? 'danger' : 'positive') + '">' + (m.issues.length ? 'Check failed' : 'Valid') + '</span></div>';
                    m.issues.forEach(function (s) { html += '<p class="notice danger">' + esc(s) + '</p>'; });
                    html += '<table class="kv-table bs-fields"><caption class="bs-sr-only">Decoded fields</caption><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>';
                    m.layout.fields.forEach(function (f) {
                        var value = m.composed.fields[f.id], raw = C.visible(m.values[f.id]), display = value.error || value.meaning || value.display;
                        html += '<tr><th scope="row">' + esc(f.name) + '</th><td><span>' + esc(display) + '</span>' +
                            (String(display) !== raw ? '<small>' + esc(raw) + '</small>' : '') + '</td></tr>';
                    });
                    html += '</tbody></table>';
                    if (m.normalization) { html += '<p class="form-help">' + esc(m.normalization) + '</p>'; }
                    html += '</section>';
                });
                q('results').innerHTML = html;
                q('details').innerHTML = '<table class="kv-table"><tbody>' +
                    '<tr><th>Source</th><td>' + esc(capture.source) + '</td></tr>' +
                    '<tr><th>Format</th><td>' + esc(capture.format || 'Not detected (typed input)') + '</td></tr>' +
                    '<tr><th>AIM identifier</th><td>' + esc(result.aim || 'Not supplied') + '</td></tr>' +
                    '<tr><th>Raw value</th><td><code>' + esc(C.visible(capture.text)) + '</code></td></tr>' +
                    (capture.bytes ? '<tr><th>Bytes (hex)</th><td><code>' + capture.bytes.map(function (n) { return n.toString(16).padStart(2, '0'); }).join(' ') + '</code></td></tr>' : '') +
                    '</tbody></table><p class="form-help">Images stay in this browser. Lookup sends a value only when you ask. Copy result includes the raw capture and layout identifier.</p>';
            }
            function fit() {
                if (destroyed) { return; }
                var viewport = window.visualViewport, bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
                var host = root.closest('.win-body');
                if (host) { bottom = Math.min(bottom, host.getBoundingClientRect().bottom); }
                var available = Math.max(160, bottom - root.getBoundingClientRect().top - 12);
                root.style.setProperty('--bs-height', Math.floor(available) + 'px');
            }
            function reveal() { fit(); q('reading').scrollTop = 0; }
            function cameraState(on) {
                root.classList.toggle('is-scanning', on);
                cameraOn = on; button('camera').setAttribute('aria-pressed', String(on));
                button('camera').title = on ? 'Stop camera' : 'Start camera';
                q('camera-layer').hidden = !on; q('reading').hidden = on;
            }
            function typeInput() { stop(); q('input-dialog').showModal(); q('text').focus(); }
            function toggleCamera() { if (cameraOn) { stop(); status('Camera stopped'); } else { start(); } }
            function stop() {
                generation++; clearTimeout(timer);
                if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
                video.pause(); video.srcObject = null; cameraState(false);
            }
            function accept(result, source) {
                lookup.invalidate();
                if (q('copy-fallback').open) { q('copy-fallback').close(); }
                q('copy-fallback').querySelector('textarea').value = '';
                capture = { source: source, text: result.text, format: result.format || '',
                    bytes: result.bytes ? Array.from(result.bytes) : null,
                    contentType: result.contentType || '', symbologyIdentifier: result.symbologyIdentifier || '',
                    isValid: result.isValid, error: result.error || '' };
                render(); reveal(); refresh();
            }
            function showResults(results, source) {
                var valid = results.filter(function (r) { return r.isValid; });
                if (!valid.length) { status('No barcode was decoded. Try better light, a closer view or another image.'); return false; }
                accept(valid[0], source);
                if (valid.length > 1) {
                    var label = document.createElement('label'); label.className = 'form-label'; label.textContent = 'Barcode in this image';
                    var select = document.createElement('select'); select.className = 'form-select';
                    valid.forEach(function (r, i) { var option = document.createElement('option'); option.value = i; option.textContent = (i + 1) + '. ' + r.format + ': ' + C.visible(r.text).slice(0, 80); select.appendChild(option); });
                    select.addEventListener('change', function () { accept(valid[Number(select.value)], source); });
                    label.appendChild(select); q('symbols').replaceChildren(label); q('symbols').hidden = false; status(valid.length + ' barcodes found');
                } else { q('symbols').hidden = true; status('Captured'); }
                return true;
            }
            async function start() {
                stop(); var token = generation;
                cameraState(true); reveal(); status('Requesting camera...');
                try {
                    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { throw new Error('Camera access needs HTTPS and a browser with camera support. You can still open an image or enter a value.'); }
                    var media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
                    if (destroyed || generation !== token) { media.getTracks().forEach(function (t) { t.stop(); }); return; }
                    stream = media; video.srcObject = media; await video.play();
                    var reader = await decoder();
                    if (destroyed || generation !== token) { return; }
                    status('Scanning...');
                    var canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
                    async function frame() {
                        if (destroyed || generation !== token) { return; }
                        try {
                            if (video.readyState >= 2 && video.videoWidth) {
                                var scale = Math.min(1, 1920 / video.videoWidth);
                                canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
                                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                                var results = await reader.readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), { textMode: 'Plain', maxNumberOfSymbols: 8 });
                                if (destroyed || generation !== token) { return; }
                                if (results.some(function (r) { return r.isValid; })) { stop(); showResults(results, 'camera'); return; }
                            }
                            timer = setTimeout(frame, 250);
                        } catch (e) { if (!destroyed && generation === token) { stop(); status('Camera decoding failed: ' + e.message, true); } }
                    }
                    frame();
                } catch (e) { if (!destroyed && generation === token) { stop(); status('Camera unavailable: ' + e.message, true); } }
            }
            async function imageFile(file) {
                stop(); var token = generation;
                if (!file) { return; }
                lookup.invalidate(); capture = null; render();
                if (file.size > 20 * 1024 * 1024) { status('Choose an image smaller than 20 MB.'); return; }
                status('Reading image…');
                try {
                    var reader = await decoder();
                    if (destroyed || generation !== token) { return; }
                    var results = await reader.readBarcodes(file, { textMode: 'Plain', maxNumberOfSymbols: 32 });
                    if (!destroyed && generation === token) { showResults(results, 'image'); }
                } catch (e) { if (!destroyed && generation === token) { status('The image could not be decoded: ' + e.message, true); } }
            }
            async function importFile(file) {
                if (!file) { return; }
                try {
                    if (file.size > 2 * 1024 * 1024) { throw new Error('Choose a layout file smaller than 2 MB.'); }
                    var imported = B.layouts.validateFile(JSON.parse(await file.text()));
                    if (destroyed) { return; }
                    if (!imported.ok) { throw new Error(imported.errors.join(' ')); }
                    readLibrary();
                    var merged = new Map(library.map(function (L) { return [L.id, L]; }));
                    imported.layouts.forEach(function (L) { if (!B.demos.some(function (d) { return d.id === L.id; })) { merged.set(L.id, L); } });
                    localStorage.setItem('pc-barcode-layouts', JSON.stringify({ format: 'pc-barcode-layouts', version: 1, layouts: Array.from(merged.values()) }));
                    document.dispatchEvent(new CustomEvent('pc:fs-change', { detail: { reason: 'layouts' } }));
                    status('Layouts imported into this browser. The Barcode Tool uses the same library.');
                } catch (e) { status('Layouts were not imported: ' + e.message, true); }
            }
            async function copy() {
                if (!capture) { return; }
                var json = JSON.stringify({ version: 1, capture: capture, layout: layout || null }, null, 2);
                try { await navigator.clipboard.writeText(json); status('Result copied as JSON.'); }
                catch (e) { if (!destroyed) { q('copy-fallback').showModal(); var text = q('copy-fallback').querySelector('textarea'); text.value = json; text.focus(); text.select(); } }
            }
            function clear() { stop(); lookup.invalidate(); capture = null; q('text').value = ''; q('symbols').hidden = true; if (q('copy-fallback').open) { q('copy-fallback').close(); } q('copy-fallback').querySelector('textarea').value = ''; render(); status('Scan cleared.'); refresh(); }
            function submit(e) { e.preventDefault(); stop(); q('input-dialog').close(); q('symbols').hidden = true; accept({ text: q('text').value, format: format }, 'text'); q('results').focus({ preventScroll: true }); status('Decoded'); }
            function click(e) {
                var target = e.target.closest('[data-action]'); if (!target) { return; }
                if (q('actions').matches(':popover-open')) { q('actions').hidePopover(); }
                var actions = { camera: toggleCamera, type: typeInput, details: function () { q('details-dialog').showModal(); },
                    'close-input': function () { q('input-dialog').close(); }, 'close-details': function () { q('details-dialog').close(); },
                    'close-copy': function () { q('copy-fallback').close(); },
                    sources: function () { lookup.manage(); }, install: function () { stop(); q('install-dialog').showModal(); },
                    'close-install': function () { q('install-dialog').close(); }, image: function () { q('image-file').click(); },
                    import: function () { q('layout-file').click(); }, copy: copy, clear: clear };
                if (actions[target.dataset.action]) { actions[target.dataset.action](); }
            }
            function change(e) {
                if (e.target === q('layout')) { layout = e.target.value; render(); commit(); }
                if (e.target === q('format')) { lookup.invalidate(); format = e.target.value; if (capture && capture.source === 'text') { capture.format = format; render(); } commit(); }
                if (e.target === q('image-file')) { imageFile(e.target.files[0]); e.target.value = ''; }
                if (e.target === q('layout-file')) { importFile(e.target.files[0]); e.target.value = ''; }
            }
            function key(e) { if (e.target === q('text') && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { submit(e); } }
            function hidden() { if (document.hidden || root.closest('.win[hidden]')) { stop(); status('Camera stopped while the scanner was hidden.'); } }
            function libraryChanged(e) { if (!e || !e.key || e.key === 'pc-barcode-layouts') { readLibrary(); render(); } }
            function setState(s) {
                if (lookup) { lookup.setState(s); }
                var p = new URLSearchParams(s || ''); layout = p.get('layout') || ''; format = p.get('format') || '';
                if (!Object.prototype.hasOwnProperty.call(B.symbologies, format)) { format = ''; }
                readLibrary(); q('format').value = format;
                if (capture && capture.source === 'text') { capture.format = format; } render();
            }
            root.addEventListener('click', click); root.addEventListener('change', change); root.addEventListener('keydown', key);
            q('text-form').addEventListener('submit', submit);
            document.addEventListener('visibilitychange', hidden); document.addEventListener('pudl:windows-change', hidden);
            document.addEventListener('pc:fs-change', libraryChanged); window.addEventListener('storage', libraryChanged);
            window.addEventListener('pagehide', stop);
            instance.state = state; instance.setState = setState;
            instance.menus = function () { return { titles: [{ label: 'Barcode Scanner', items: [
                { label: 'Camera', run: toggleCamera, checked: cameraOn },
                { label: 'Type or paste', run: typeInput },
                { label: 'Scan details', run: function () { q('details-dialog').showModal(); }, disabled: !capture },
                { label: 'Open image', run: function () { q('image-file').click(); } },
                { label: 'Import layouts', run: function () { q('layout-file').click(); } },
                { label: 'Copy result', run: copy, disabled: !capture }, { label: 'Clear', run: clear },
                { label: 'Lookup sources', run: function () { lookup.manage(); } },
                { label: 'Install scanner', run: function () { stop(); q('install-dialog').showModal(); } }
            ] }] }; };
            var resize = new ResizeObserver(fit); resize.observe(root.parentElement);
            window.addEventListener('resize', fit);
            if (window.visualViewport) { window.visualViewport.addEventListener('resize', fit); }
            cleanup = function () {
                resize.disconnect(); window.removeEventListener('resize', fit);
                if (window.visualViewport) { window.visualViewport.removeEventListener('resize', fit); }
                root.querySelectorAll('dialog[open]').forEach(function (d) { d.close(); });
                if (q('actions').matches(':popover-open')) { q('actions').hidePopover(); }
                lookup.destroy(); stop(); root.removeEventListener('click', click); root.removeEventListener('change', change); root.removeEventListener('keydown', key);
                q('text-form').removeEventListener('submit', submit); document.removeEventListener('visibilitychange', hidden);
                document.removeEventListener('pudl:windows-change', hidden); document.removeEventListener('pc:fs-change', libraryChanged);
                window.removeEventListener('storage', libraryChanged); window.removeEventListener('pagehide', stop);
            };
            lookup = window.pcBarcodeLookupUI(root, { capture: function () { return capture; }, engine: B, changed: commit, stop: stop });
            setState(pendingState); fit(); refresh();
        }
        return { state: function () { return instance.state ? instance.state() : pendingState; },
            setState: function (s) { pendingState = s; if (instance.setState) { instance.setState(s); } },
            menus: function () { return instance.menus ? instance.menus() : null; },
            destroy: function () { destroyed = true; cleanup(); } };
    } });
})();
