/* Sight Reader: practise reading a piece of music by naming each note as a
   cursor reaches it (Architecture/sight-reader-design.md). The score is
   drawn by OpenSheetMusicDisplay (BSD-3-Clause), vendored in js/vendor and
   loaded only when the applet opens. A score is MusicXML, plain or
   compressed; the samples are listed in content/scores/index.json, and one
   from the reader's own device opens as well.

   The quiz takes steps through the score. A step is the notes that start
   together at the cursor, so one note, an interval or a chord, and a tied
   note's continuation, a rest and a grace note make no step of their own.
   The reader names a note by its letter, with the keys A to G or the
   buttons under the score, and the cursor moves on once every note of the
   step is named. A wrong letter marks an error and the cursor stays. After
   a number of wrong tries the answer is shown, and any key goes on. */
(function () {
    'use strict';

    var SELF_SRC = document.currentScript && document.currentScript.src;
    function beside(file) { return SELF_SRC ? SELF_SRC.replace(/sight-reader\.js(\?.*)?$/, file) : '/js/' + file; }
    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = function () { reject(new Error('could not load ' + src)); };
            document.head.appendChild(s);
        });
    }
    var osmdReady = null;
    function loadOsmd() {
        if (window.opensheetmusicdisplay) { return Promise.resolve(window.opensheetmusicdisplay); }
        if (!osmdReady) {
            osmdReady = loadScript(beside('vendor/osmd-2.2.1/osmd.js'))
                .then(function () { return window.opensheetmusicdisplay; })
                .catch(function (err) { osmdReady = null; throw err; });
        }
        return osmdReady;
    }
    var configReady = null;
    function loadConfig() {
        if (window.pcConfig) { return Promise.resolve(window.pcConfig); }
        if (!configReady) {
            configReady = loadScript(window.pcConfigSrc || beside('config.js'))
                .then(function () { return window.pcConfig; })
                .catch(function (err) { configReady = null; throw err; });
        }
        return configReady;
    }

    /* The settings are the applet's own, kept in ~/.config/sight-reader.json
       (js/config.js), so they follow the reader wherever ~ does. */
    var SETTINGS = { revealAfter: 3 };
    var REVEAL_CHOICES = [[0, 'Never show the answer'], [1, 'After 1 wrong try'], [2, 'After 2 wrong tries'], [3, 'After 3 wrong tries'], [5, 'After 5 wrong tries']];

    var SAMPLES = '/content/scores/';
    var LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    /* The marks drawn on the score: right in green, a missed note in red,
       on the white page the score is always drawn on. */
    var GREEN = '#2e7d32', RED = '#b42318';
    var MARK = { applyToNoteheads: true, applyToStem: true, applyToFlag: true };

    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    /* A path from a link or the snapshot is taken only if it is a relative path to
       a MusicXML file, with no folder that goes back up. */
    function validRel(rel) {
        return typeof rel === 'string' && /\.(mxl|musicxml|xml)$/i.test(rel) && rel.split('/').every(function (p) { return p && p !== '.' && p !== '..'; });
    }
    function sampleUrl(file) { return SAMPLES + String(file).split('/').map(encodeURIComponent).join('/'); }

    /* A score's bytes as what OpenSheetMusicDisplay loads: compressed
       MusicXML (a zip, which starts with PK) as a binary string, and plain
       MusicXML as text, in whichever encoding its byte order mark says. */
    function contentOf(buffer) {
        var bytes = new Uint8Array(buffer);
        if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
            var out = '';
            for (var i = 0; i < bytes.length; i += 0x8000) { out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); }
            return out;
        }
        if (bytes[0] === 0xff && bytes[1] === 0xfe) { return new TextDecoder('utf-16le').decode(bytes.subarray(2)); }
        if (bytes[0] === 0xfe && bytes[1] === 0xff) { return new TextDecoder('utf-16be').decode(bytes.subarray(2)); }
        var start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
        return new TextDecoder('utf-8').decode(bytes.subarray(start));
    }

    function init(root, opts) {
        opts = opts || {};
        var ownUrl = !!opts.ownsUrl;
        var destroyed = false;
        var OS = null, osmd = null;
        var settings = Object.assign({}, SETTINGS), unConfig = null;

        /* The score open: where it came from, its steps, and how far the
           reader has got. A step is { adv, measure, notes, result }, where
           adv is how many times the cursor's iterator moves on from the
           start to reach it, and a note is { note, letter, state }. */
        var score = null;
        var steps = [], cur = -1, curAdv = 0;
        var named = {}, tries = 0, revealed = false, finished = false;
        var tally = { first: 0, retried: 0, missed: 0 };
        var pending = null, loadId = 0, needsDraw = false, resizeTimer = null, flashTimer = null, narrow = false, lastWidth = 0;

        root.classList.add('pc-sight-reader');
        if (opts.fit === 'fill') { root.classList.add('pc-sight-reader-fill'); }
        if (!root.hasAttribute('tabindex')) { root.tabIndex = 0; }
        root.innerHTML =
            '<div class="sr-top">' +
              '<button type="button" class="btn" data-sr="choose">Scores…</button>' +
              '<span class="sr-title" data-role="title"></span>' +
            '</div>' +
            '<div class="sr-score" data-role="score">' +
              '<div class="sr-sheet" data-role="sheet"></div>' +
              '<div class="sr-empty" data-role="empty">' +
                '<p>Choose a score to practise reading it.</p>' +
                '<button type="button" class="btn btn-primary" data-sr="choose">Choose a score</button>' +
              '</div>' +
            '</div>' +
            '<div class="sr-info">' +
              '<span class="sr-pos" data-role="pos"></span>' +
              '<span class="badge sr-feedback" data-role="feedback" role="status" aria-live="polite"></span>' +
              '<span class="sr-tally" data-role="tally"></span>' +
            '</div>' +
            '<div class="sr-keys" role="group" aria-label="Note names">' +
              LETTERS.map(function (l) { return '<button type="button" class="btn sr-note" data-note="' + l + '" aria-label="' + l + '">' + l + '</button>'; }).join('') +
            '</div>' +
            '<input type="file" class="sr-file" accept=".mxl,.musicxml,.xml" hidden />' +
            '<dialog class="dialog sr-dialog" data-role="chooser" aria-labelledby="sr-choose-title">' +
              '<h3 class="dialog-title" id="sr-choose-title">Choose a score</h3>' +
              '<div class="dialog-body" data-role="chooser-body"></div>' +
              '<div class="dialog-actions">' +
                '<button type="button" class="btn" data-sr="file">From this device…</button>' +
                '<button type="button" class="btn btn-primary" data-sr="close-chooser">Close</button>' +
              '</div>' +
            '</dialog>' +
            '<dialog class="dialog sr-dialog" data-role="help" aria-labelledby="sr-help-title">' +
              '<h3 class="dialog-title" id="sr-help-title">About Sight Reader</h3>' +
              '<div class="dialog-body sr-help">' +
                '<p>Sight Reader helps you learn to read music from a piece you are working on. A cursor sits on the first note. Type its letter, A to G, or press its button. When you are right the cursor moves to the next note, and for an interval or a chord you name every note in it first. A wrong letter marks an error and the cursor stays where it is. Rests are skipped.</p>' +
                '<p>The Practice menu sets how many wrong tries it takes before the answer is shown, and Restart starts the piece again. Octaves, sharps and flats are not asked for yet.</p>' +
                '<p>Scores are MusicXML files, compressed (.mxl) or not. Notation programs such as MuseScore export them, and MuseScore.com offers them as downloads. A piece that exists only as a PDF has to be converted first: MuseScore 4 can import a PDF, and Audiveris is a free program that reads one.</p>' +
              '</div>' +
              '<div class="dialog-actions"><button type="button" class="btn btn-primary" data-sr="close-help">Close</button></div>' +
            '</dialog>';

        var q = function (sel) { return root.querySelector(sel); };
        var el = {
            title: q('[data-role="title"]'), score: q('[data-role="score"]'), sheet: q('[data-role="sheet"]'),
            empty: q('[data-role="empty"]'), pos: q('[data-role="pos"]'), feedback: q('[data-role="feedback"]'),
            tally: q('[data-role="tally"]'), file: q('.sr-file'), chooser: q('[data-role="chooser"]'),
            chooserBody: q('[data-role="chooser-body"]'), help: q('[data-role="help"]')
        };

        /* === What the reader sees =========================================== */

        /* The line under the score: one message at a time, with its glyph and
           colour from PUDL's badge. tone is positive, danger, warn or none. */
        function say(text, tone) {
            el.feedback.textContent = text || '';
            el.feedback.className = 'badge sr-feedback' + (tone ? ' ' + tone : '');
            el.feedback.hidden = !text;
        }

        function showPos() {
            if (!score || !steps.length || cur < 0) { el.pos.textContent = ''; return; }
            el.pos.textContent = 'Bar ' + steps[Math.min(cur, steps.length - 1)].measure + ' · ' + (Math.min(cur, steps.length - 1) + 1) + ' of ' + steps.length;
        }

        function showTally() {
            var done = tally.first + tally.retried + tally.missed;
            el.tally.textContent = done ? tally.first + ' right first time' + (tally.retried ? ', ' + tally.retried + ' after a retry' : '') + (tally.missed ? ', ' + tally.missed + ' missed' : '') : '';
        }

        function refresh() {
            el.empty.hidden = !!score;
            el.title.textContent = score ? score.name : '';
            showPos();
            showTally();
        }

        /* The cursor flashes red for a wrong letter; the shake is left out
           for a reader who asked for less motion, the colour is not. */
        function flash() {
            var c = osmd && osmd.cursor && osmd.cursor.cursorElement;
            if (!c) { return; }
            c.classList.add('sr-wrong');
            clearTimeout(flashTimer);
            flashTimer = setTimeout(function () { c.classList.remove('sr-wrong'); }, 420);
        }

        /* Keeps the cursor in view by scrolling the score's own box, which
           is the only thing that moves: nothing else on the page scrolls. */
        function keepInView() {
            var c = osmd && osmd.cursor && osmd.cursor.cursorElement;
            if (!c || !c.isConnected) { return; }
            var box = el.score.getBoundingClientRect(), r = c.getBoundingClientRect();
            if (r.height === 0) { return; }
            if (r.top < box.top + 12 || r.bottom > box.bottom - 12) {
                var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                el.score.scrollTo({ top: el.score.scrollTop + (r.top + r.height / 2) - (box.top + box.height / 2), behavior: calm ? 'auto' : 'smooth' });
            }
        }

        /* === Drawing the score ================================================ */

        function draw() {
            if (!el.score.clientWidth) { needsDraw = true; return false; }
            needsDraw = false;
            narrow = el.score.clientWidth < 600;
            lastWidth = el.score.clientWidth;
            osmd.setOptions({ drawPartNames: !narrow });
            osmd.Zoom = narrow ? 0.8 : 1;
            osmd.render();
            osmd.cursor.show();
            curAdv = -1;
            return true;
        }

        /* A note counts as a step's note when it is pitched, new and not a
           grace note. Which staves, clefs and parts the reader chose will
           narrow this further. */
        function counts(n) {
            if (n.isRest() || n.IsGraceNote || !n.Pitch) { return false; }
            if (n.NoteTie && n.NoteTie.StartNote !== n) { return false; }
            return true;
        }
        function keyOf(n) { return OS.Pitch.getNoteEnumString(n.Pitch.FundamentalNote); }

        /* Walks the whole score once, noting each step. The iterator moves
           without drawing, and the cursor goes back to the start after. */
        function build() {
            steps = [];
            var cursor = osmd.cursor;
            cursor.reset();
            var it = cursor.Iterator, adv = 0;
            while (!it.EndReached) {
                var found = [];
                cursor.NotesUnderCursor().forEach(function (n) { if (counts(n)) { found.push({ note: n, key: keyOf(n), state: '' }); } });
                if (found.length) { steps.push({ adv: adv, measure: it.CurrentMeasure.MeasureNumber, notes: found, result: '' }); }
                it.moveToNext();
                adv++;
            }
            cursor.reset();
            curAdv = 0;
        }

        /* Puts the cursor on a step. It moves forward by the iterator, and
           from the start when the step is behind it; the cursor is drawn
           once, where it ends. */
        function moveTo(k, show) {
            var target = steps[k].adv, cursor = osmd.cursor;
            if (curAdv < 0 || curAdv > target) { cursor.reset(); curAdv = 0; }
            var it = cursor.Iterator;
            while (curAdv < target) { it.moveToNext(); curAdv++; }
            if (show !== false) { cursor.update(); keepInView(); }
        }

        /* Colours the notes of the step the cursor is on that have a state. */
        function paintHere(k) {
            var graphical = osmd.cursor.GNotesUnderCursor();
            steps[k].notes.forEach(function (s) {
                if (!s.state) { return; }
                graphical.forEach(function (g) { if (g.sourceNote === s.note) { g.setColor(s.state === 'ok' ? GREEN : RED, MARK); } });
            });
        }

        /* Draws the marks again after the score was drawn again, which clears
           them: every step that has been read, up to the one in front. */
        function repaint() {
            for (var k = 0; k <= cur && k < steps.length; k++) {
                if (!steps[k].notes.some(function (s) { return s.state; })) { continue; }
                moveTo(k, false);
                paintHere(k);
            }
            if (cur >= 0 && cur < steps.length) { moveTo(cur); }
        }

        /* === The quiz ======================================================== */

        function begin(k) {
            cur = k;
            named = {};
            tries = 0;
            revealed = false;
            moveTo(k);
            showPos();
            say(steps[k].notes.length > 1 && distinct(steps[k]).length > 1 ? 'Name every note of the ' + (distinct(steps[k]).length === 2 ? 'interval' : 'chord') : '', '');
        }

        function distinct(step) {
            var seen = {};
            step.notes.forEach(function (s) { seen[s.key] = true; });
            return Object.keys(seen).sort();
        }

        function conclude(result) {
            var step = steps[cur];
            step.result = result;
            if (result === 'first') { tally.first++; } else if (result === 'retried') { tally.retried++; } else { tally.missed++; }
            showTally();
        }

        function advance() {
            if (cur + 1 < steps.length) { begin(cur + 1); keepSnapshot(); return; }
            finished = true;
            var total = tally.first + tally.retried + tally.missed;
            say('Finished: ' + tally.first + ' of ' + total + ' right first time' + (tally.missed ? ', ' + tally.missed + ' missed' : ''), tally.missed ? 'warn' : 'positive');
            keepSnapshot();
        }

        function wrong() {
            tries++;
            flash();
            if (settings.revealAfter > 0 && tries >= settings.revealAfter) { reveal(); return; }
            say('Not that one', 'danger');
        }

        /* Shows the answer: the notes still unnamed turn red and the status
           says what they are. Any key goes on from here. */
        function reveal() {
            var step = steps[cur], missing = distinct(step).filter(function (k) { return !named[k]; });
            step.notes.forEach(function (s) { if (!named[s.key]) { s.state = 'missed'; } });
            paintHere(cur);
            revealed = true;
            conclude('missed');
            say('The answer is ' + missing.join(', ') + '. Press any key to go on.', 'warn');
        }

        function answer(letter) {
            if (!score || cur < 0 || finished || !steps.length) { return; }
            if (revealed) { advance(); return; }
            var step = steps[cur], key = letter;
            if (distinct(step).indexOf(key) < 0) { wrong(); return; }
            if (named[key]) { return; }
            named[key] = true;
            step.notes.forEach(function (s) { if (s.key === key) { s.state = 'ok'; } });
            paintHere(cur);
            var left = distinct(step).filter(function (k) { return !named[k]; });
            if (left.length) { say('Right. ' + left.length + ' more to name', 'positive'); return; }
            conclude(tries ? 'retried' : 'first');
            advance();
        }

        function restart() {
            if (!score) { return; }
            finished = false;
            tally = { first: 0, retried: 0, missed: 0 };
            steps.forEach(function (s) { s.result = ''; s.notes.forEach(function (n) { n.state = ''; }); });
            if (draw()) { begin(0); }
            say('', '');
            refresh();
            keepSnapshot();
        }

        /* === Opening a score ==================================================== */

        function fetchIndex() {
            return fetch(SAMPLES + 'index.json', { credentials: 'same-origin', cache: 'no-cache' })
                .then(function (r) { return r.ok ? r.json() : { groups: [] }; })
                .catch(function () { return { groups: [] }; });
        }

        /* src is { name, rel } for a sample, which is its path in the samples
           folder, or { name, file } for a file from the reader's device. A
           restored game brings back how far it had got. */
        function openScore(src, again) {
            if (src.rel && !validRel(src.rel)) { say('That is not a score this applet can open.', 'danger'); return Promise.resolve(); }
            var id = ++loadId;
            say('Opening ' + src.name + '…', '');
            return Promise.all([loadOsmd(), src.file ? src.file.arrayBuffer() : fetch(sampleUrl(src.rel), { credentials: 'same-origin' }).then(function (r) {
                if (!r.ok) { throw new Error(src.name + ' could not be fetched (' + r.status + ')'); }
                return r.arrayBuffer();
            })]).then(function (got) {
                if (destroyed || id !== loadId) { return; }
                OS = got[0];
                if (osmd) { osmd.clear(); }
                el.sheet.innerHTML = '';
                osmd = new OS.OpenSheetMusicDisplay(el.sheet, {
                    backend: 'svg', autoResize: false, followCursor: false, drawTitle: true, drawSubtitle: true,
                    cursorsOptions: [{ type: 0, color: '#2c5282', alpha: 0.35, follow: false }]
                });
                return osmd.load(contentOf(got[1])).then(function () {
                    if (destroyed || id !== loadId) { return; }
                    score = src;
                    finished = false;
                    tally = { first: 0, retried: 0, missed: 0 };
                    cur = -1;
                    if (!draw()) { pending = again || null; say('', ''); refresh(); return; }
                    build();
                    if (!steps.length) { say('This score has no notes to read.', 'warn'); refresh(); return; }
                    if (again) { restoreProgress(again); } else { begin(0); }
                    refresh();
                    announce();
                    keepSnapshot();
                    if (ownUrl || root.closest('.win.active')) { root.focus({ preventScroll: true }); }
                });
            }).catch(function (err) {
                if (destroyed || id !== loadId) { return; }
                say('Could not open ' + src.name + ': ' + (err && err.message ? err.message : err), 'danger');
            });
        }

        /* === Choosing a score ==================================================== */

        function openChooser() {
            el.chooserBody.innerHTML = '<p class="sr-muted">Looking for scores…</p>';
            if (!el.chooser.open) { el.chooser.showModal(); }
            fetchIndex().then(function (index) {
                if (destroyed) { return; }
                var groups = (index.groups || []).filter(function (g) { return g.scores && g.scores.length; });
                el.chooserBody.innerHTML = groups.length ? groups.map(function (g) {
                    return '<section class="sr-group">' + (g.name ? '<h4 class="sr-group-name">' + esc(g.name) + '</h4>' : '') +
                        '<ul class="sr-list">' + g.scores.map(function (s) {
                            return '<li><button type="button" class="btn sr-pick" data-sr-open="' + esc(s.file) + '" data-sr-name="' + esc(s.title) + '">' + esc(s.title) + '</button></li>';
                        }).join('') + '</ul></section>';
                }).join('') : '<p class="sr-muted">No sample scores were found. Open a file from this device instead.</p>';
            });
        }

        /* === The address and the snapshot ========================================= */

        /* A sample's path is what a link to the applet carries, so a link opens
           the same score. A file from the reader's device has no address. */
        function stateString() { return score && score.rel ? 'score=' + encodeURIComponent(score.rel).replace(/%2F/g, '/') : ''; }
        function announce() {
            if (ownUrl) {
                var qs = new URLSearchParams(location.search);
                if (score && score.rel) { qs.set('score', score.rel); } else { qs.delete('score'); }
                var s = qs.toString().replace(/%2F/g, '/');
                history.replaceState(history.state, '', location.pathname + (s ? '?' + s : '') + location.hash);
            }
            if (opts.changed) { opts.changed(stateString()); }
        }
        /* The score a state string or an address asks for, as it was written. */
        function askedFor(s) {
            if (!s) { return null; }
            return new URLSearchParams(String(s).replace(/^\?/, '')).get('score') || null;
        }
        function relFrom(s) { var v = askedFor(s); return validRel(v) ? v : null; }

        /* A reload brings back the step the reader was on and how each earlier
           one went (js/snapshot.js), for a sample, which can be fetched again. */
        var snap = window.pcSnapshot ? window.pcSnapshot.join(root, function () {
            if (!score || !score.rel || !steps.length) { return null; }
            return { rel: score.rel, name: score.name, k: cur, r: steps.map(function (s) { return s.result ? s.result.charAt(0) : '-'; }).join(''), t: tally };
        }) : null;
        function keepSnapshot() { if (snap) { snap.changed(); } }
        var CODES = { f: 'first', r: 'retried', m: 'missed' };
        function restoreProgress(kept) {
            var codes = String(kept.r || '');
            for (var i = 0; i < steps.length && i < codes.length; i++) {
                var result = CODES[codes.charAt(i)];
                if (!result) { continue; }
                steps[i].result = result;
                steps[i].notes.forEach(function (n) { n.state = result === 'missed' ? 'missed' : 'ok'; });
            }
            if (kept.t && typeof kept.t === 'object') { tally = { first: +kept.t.first || 0, retried: +kept.t.retried || 0, missed: +kept.t.missed || 0 }; }
            var k = Math.max(0, Math.min(+kept.k || 0, steps.length - 1));
            cur = k;
            repaint();
            begin(k);
        }

        /* === Input ============================================================== */

        function onClick(e) {
            var note = e.target.closest('[data-note]');
            if (note && root.contains(note)) { answer(note.getAttribute('data-note')); return; }
            var open = e.target.closest('[data-sr-open]');
            if (open) { el.chooser.close(); openScore({ name: open.getAttribute('data-sr-name'), rel: open.getAttribute('data-sr-open') }); return; }
            var act = e.target.closest('[data-sr]');
            if (!act) { return; }
            switch (act.getAttribute('data-sr')) {
                case 'choose': openChooser(); break;
                case 'file': el.file.click(); break;
                case 'close-chooser': el.chooser.close(); break;
                case 'close-help': el.help.close(); break;
            }
        }

        function onKeyDown(e) {
            if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) { return; }
            var t = e.target;
            if (t.closest && (t.closest('dialog') || t.closest('input, select, textarea, [contenteditable]'))) { return; }
            if (e.key.length === 1 && /[a-gA-G]/.test(e.key)) { e.preventDefault(); answer(e.key.toUpperCase()); return; }
            /* Enter and Space on a button press that button, which answers; on
               the score itself they go on from a shown answer. */
            if (revealed && (e.key === 'Enter' || e.key === ' ') && !(t.closest && t.closest('button'))) { e.preventDefault(); advance(); }
        }

        function fromDevice(file) {
            if (!file) { return; }
            if (el.chooser.open) { el.chooser.close(); }
            openScore({ name: file.name.replace(/\.[^.]*$/, ''), file: file });
        }

        el.file.addEventListener('change', function () { fromDevice(el.file.files && el.file.files[0]); el.file.value = ''; });
        root.addEventListener('click', onClick);
        root.addEventListener('keydown', onKeyDown);
        /* A press on the score puts the keyboard in the applet. */
        root.addEventListener('pointerdown', function (e) { if (!e.target.closest('button, dialog, input')) { root.focus({ preventScroll: true }); } });
        root.addEventListener('dragover', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { e.preventDefault(); } });
        root.addEventListener('drop', function (e) {
            if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) { return; }
            e.preventDefault();
            fromDevice(e.dataTransfer.files[0]);
        });

        /* The score is drawn again when its box changes width by more than a
           few pixels, with the part names left out and the page smaller on a
           narrow one, and the marks put back. */
        var observer = null;
        if (window.ResizeObserver) {
            observer = new ResizeObserver(function () {
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(function () {
                    if (destroyed || !osmd || !score) { return; }
                    var w = el.score.clientWidth;
                    if (!w || (!needsDraw && Math.abs(w - lastWidth) < 24)) { return; }
                    if (!draw()) { return; }
                    if (!steps.length) { build(); if (steps.length && cur < 0) { if (pending) { restoreProgress(pending); pending = null; } else { begin(0); } } refresh(); return; }
                    repaint();
                }, 250);
            });
            observer.observe(el.score);
        }

        /* === Menus ============================================================== */

        function menus() {
            var open = !!score;
            return {
                titles: [
                    { label: 'Sight Reader', items: window.pcAppletIdentity(root, [{ label: 'About Sight Reader', run: function () { el.help.showModal(); } }]) },
                    { label: 'Score', items: [
                        { label: 'Choose a score…', run: openChooser },
                        { label: 'Open a file from this device…', run: function () { el.file.click(); } }
                    ] },
                    { label: 'Practice', items: [
                        { label: 'Restart', disabled: !open, run: restart },
                        { label: 'Show the answer', disabled: !open || finished || revealed || cur < 0, run: function () { if (!revealed && !finished && cur >= 0) { reveal(); root.focus({ preventScroll: true }); } } },
                        '-'
                    ].concat(REVEAL_CHOICES.map(function (c) {
                        return { label: c[1], radio: 'reveal', checked: settings.revealAfter === c[0], run: function () { setReveal(c[0]); } };
                    })) }
                ]
            };
        }

        function setReveal(n) {
            settings.revealAfter = n;
            loadConfig().then(function (c) { return c.set('sight-reader', { revealAfter: n }); }).catch(function () { });
        }

        /* === Start ============================================================== */

        say('', '');
        refresh();
        var startAsked = askedFor(opts.state) || (ownUrl ? askedFor(location.search) : null);
        var startRel = validRel(startAsked) ? startAsked : null;
        var kept = snap && snap.kept && validRel(snap.kept.rel) ? snap.kept : null;
        var boot = loadConfig().then(function (c) {
            return c.load('sight-reader', SETTINGS).then(function (s) {
                settings = Object.assign({}, SETTINGS, s);
                unConfig = c.onChange('sight-reader', function (next) { settings = Object.assign({}, SETTINGS, next); });
            });
        }).catch(function () { }).then(function () {
            if (destroyed) { return; }
            /* An address that names the score the snapshot kept is a reload,
               and the reader carries on where they were. */
            if (startAsked && !startRel) { say('That is not a score this applet can open.', 'danger'); return; }
            if (startRel) { return openScore({ name: startRel.replace(/^.*\//, '').replace(/\.[^.]*$/, ''), rel: startRel }, kept && kept.rel === startRel ? kept : null); }
            if (kept) { return openScore({ name: kept.name || kept.rel, rel: kept.rel }, kept); }
        });

        return {
            state: function () { return stateString() || null; },
            setState: function (s) {
                var rel = relFrom(s);
                if (rel) { openScore({ name: rel.replace(/^.*\//, '').replace(/\.[^.]*$/, ''), rel: rel }); }
            },
            menus: menus,
            destroy: function () {
                destroyed = true;
                clearTimeout(resizeTimer);
                clearTimeout(flashTimer);
                if (observer) { observer.disconnect(); }
                if (unConfig) { unConfig(); }
                if (snap) { snap.leave(); }
                if (el.chooser.open) { el.chooser.close(); }
                if (el.help.open) { el.help.close(); }
                if (osmd) { try { osmd.clear(); } catch (err) { } }
            },
            ready: boot
        };
    }

    window.pudlApplets.register('sight-reader', { init: init });
})();
