/* Diff viewer (Architecture/applet-roadmap.md): two texts compared line by
   line, side by side or in one column, with the words that changed within
   a changed line marked. Either side is typed or pasted, or opened from the
   site's files or the reader's computer through the file browser's Open
   dialog (js/filebrowser.js, over js/sitefs.js). The comparison is
   js/textdiff.js, which the file history uses too.

   The address keeps the view and its choices, and the texts themselves
   while they are short: two files of the site by their paths, otherwise
   up to MAX_STATE characters of text between the two sides, encoded.
   Longer pasted texts are not kept, and the status line says so.

   State: "view=one&ws=1&all=1&pa=/wwwroot/x&pb=~/y" or "ta=...&tb=...". */
(function () {
    'use strict';

    var SELF = document.currentScript && document.currentScript.src;
    function beside(file) { return SELF ? SELF.replace(/diff\.js(\?.*)?$/, file + (SELF.match(/\?.*$/) || [''])[0]) : '/js/' + file; }
    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = function () { reject(new Error('could not load ' + src)); };
            document.head.appendChild(s);
        });
    }
    var ready = {};
    function need(global, src) {
        if (window[global]) { return Promise.resolve(window[global]); }
        if (!ready[global]) {
            ready[global] = loadScript(src).then(function () { return window[global]; })
                .catch(function (err) { ready[global] = null; throw err; });
        }
        return ready[global];
    }
    function engine() { return need('pcTextDiff', beside('textdiff.js')); }
    var fsReady = null;
    function files() {
        if (!fsReady) {
            fsReady = Promise.all([
                need('pcSiteFs', window.pcSiteFsSrc || '/js/sitefs.js').then(function (F) { return F.load().then(function () { return F; }); }),
                need('pcFileBrowser', window.pcFileBrowserSrc || '/js/filebrowser.js')
            ]).catch(function (err) { fsReady = null; throw err; });
        }
        return fsReady;
    }

    var MAX_STATE = 2000;
    /* Unchanged lines kept around a change when only the changes show. */
    var CONTEXT = 3;
    var SIDES = [['a', 'Original'], ['b', 'Changed']];
    var count = 0;

    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function b64(s) { var bytes = new TextEncoder().encode(s), bin = ''; bytes.forEach(function (c) { bin += String.fromCharCode(c); }); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    function unb64(s) {
        try {
            var bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
            return new TextDecoder().decode(Uint8Array.from(bin, function (c) { return c.charCodeAt(0); }));
        } catch (err) { return null; }
    }
    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

    function parseState(s) {
        var q = new URLSearchParams(String(s || '').replace(/^\?/, ''));
        var st = { view: q.get('view') === 'one' ? 'one' : 'split', ws: q.get('ws') === '1', all: q.get('all') === '1', a: {}, b: {} };
        SIDES.forEach(function (side) {
            var k = side[0], path = q.get('p' + k), text = q.get('t' + k);
            if (path) { st[k].path = path; }
            else if (text != null) { var t = unb64(text); if (t != null) { st[k].text = t; } }
        });
        return st;
    }

    function init(root, opts) {
        opts = opts || {};
        var n = ++count, ownUrl = !!opts.ownsUrl;
        var st = parseState(ownUrl && location.search ? location.search : (typeof opts.state === 'string' ? opts.state : ''));
        /* Each side: its text, and where it came from (a path of the site's
           files, a file from the computer, or typed). */
        var sides = { a: { text: st.a.text || '', path: st.a.path || null, name: null }, b: { text: st.b.text || '', path: st.b.path || null, name: null } };
        var D = null, result = null, unkept = false;

        root.classList.add('pc-diff');
        root.innerHTML =
            '<details class="df-inputs" open><summary>The two texts</summary><div class="df-sides">' +
            SIDES.map(function (side) {
                var id = 'df-' + n + '-' + side[0];
                return '<div class="df-side">' +
                    '<div class="df-side-head"><label class="form-label" for="' + id + '">' + side[1] + '</label>' +
                    '<span class="df-source" data-df-source="' + side[0] + '"></span>' +
                    '<button type="button" class="btn btn-sm" data-df-open="' + side[0] + '">Open…</button></div>' +
                    '<textarea class="form-textarea df-text" id="' + id + '" data-df-text="' + side[0] + '" spellcheck="false" wrap="off" ' +
                    'placeholder="Type or paste a text, or open a file"></textarea></div>';
            }).join('') +
            '</div></details>' +
            '<div class="df-bar">' +
            '<div class="seg" role="group" aria-label="Show the comparison">' +
            '<button type="button" data-df-view="split" aria-pressed="false">Side by side</button>' +
            '<button type="button" data-df-view="one" aria-pressed="false">One column</button></div>' +
            '<label class="check"><input type="checkbox" data-df-opt="ws" /> Ignore spaces</label>' +
            '<label class="check"><input type="checkbox" data-df-opt="all" /> Show every line</label>' +
            '<button type="button" class="btn btn-sm" data-df="swap">Swap the sides</button>' +
            '<p class="df-summary" role="status" aria-live="polite"></p>' +
            '</div>' +
            '<div class="df-out"></div>' +
            '<p class="df-status" aria-live="polite"></p>' +
            '<dialog class="dialog df-about" aria-labelledby="df-about-' + n + '">' +
            '<h3 class="dialog-title" id="df-about-' + n + '">About the diff viewer</h3>' +
            '<div class="dialog-body"><p>The diff viewer compares two texts line by line. Type or paste each one, or open a file from the site or from your computer. ' +
            'Removed lines are marked with a minus and added lines with a plus, and within a changed line the words that changed are marked as well.</p>' +
            '<p>Ignore spaces treats lines that differ only in their spacing as the same. Unless Show every line is on, only the changes show, with ' +
            CONTEXT + ' lines around each. The address keeps two files of the site by their paths, and short texts themselves, so a link shares the comparison.</p></div>' +
            '<div class="dialog-actions"><button type="button" class="btn btn-primary" data-df="about-close">Close</button></div>' +
            '</dialog>';

        function q(sel) { return root.querySelector(sel); }
        var out = q('.df-out'), summary = q('.df-summary'), status = q('.df-status'), about = q('.df-about');
        function say(msg) { status.textContent = msg || ''; }

        /* === State ======================================================= */

        function stateString() {
            var parts = [];
            if (st.view === 'one') { parts.push('view=one'); }
            if (st.ws) { parts.push('ws=1'); }
            if (st.all) { parts.push('all=1'); }
            var texts = sides.a.text.length + sides.b.text.length;
            unkept = false;
            SIDES.forEach(function (side) {
                var s = sides[side[0]];
                if (s.path) { parts.push('p' + side[0] + '=' + encodeURIComponent(s.path)); }
                else if (s.text && texts <= MAX_STATE) { parts.push('t' + side[0] + '=' + b64(s.text)); }
                else if (s.text) { unkept = true; }
            });
            return parts.join('&');
        }

        var writeTimer = null;
        function commit() {
            var s = stateString();
            clearTimeout(writeTimer);
            writeTimer = setTimeout(function () {
                if (ownUrl) { history.replaceState(history.state, '', location.pathname + (s ? '?' + s : '') + location.hash); }
                if (opts.changed) { opts.changed(s); }
            }, 250);
        }

        /* === Drawing ===================================================== */

        function lineHtml(row) {
            if (!row.words) { return esc(row.text) || '\u200b'; }
            return row.words.map(function (w) { return w.changed ? '<span class="df-word">' + esc(w.text) + '</span>' : esc(w.text); }).join('') || '\u200b';
        }

        /* The rows to show: every row, or the changes with CONTEXT lines
           around each and a note where unchanged lines are left out. */
        function shown(rows) {
            if (st.all) { return rows; }
            var keep = rows.map(function () { return false; });
            rows.forEach(function (r, i) {
                if (r.op === '=') { return; }
                for (var j = Math.max(0, i - CONTEXT); j <= Math.min(rows.length - 1, i + CONTEXT); j++) { keep[j] = true; }
            });
            var list = [], skipped = 0;
            rows.forEach(function (r, i) {
                if (keep[i]) {
                    if (skipped) { list.push({ gap: skipped }); skipped = 0; }
                    list.push(r);
                } else { skipped++; }
            });
            if (skipped) { list.push({ gap: skipped }); }
            return list;
        }

        function gapRow(cols, g) {
            return '<tr class="df-gap"><td colspan="' + cols + '">' + plural(g.gap, 'line', 'lines') + ' the same</td></tr>';
        }

        function cell(row, side) {
            if (!row) { return '<td class="df-num"></td><td class="df-sign"></td><td class="df-line df-empty"></td>'; }
            var kind = row.op === '-' ? ' df-del' : row.op === '+' ? ' df-add' : '';
            var num = side === 'a' ? row.a : row.b;
            var sign = row.op === '-' ? '\u2212' : row.op === '+' ? '+' : '';
            return '<td class="df-num">' + num + '</td><td class="df-sign' + kind + '">' + sign + '</td><td class="df-line' + kind + '">' + lineHtml(row) + '</td>';
        }

        function drawSplit(list) {
            var html = '', i = 0;
            while (i < list.length) {
                var r = list[i];
                if (r.gap) { html += gapRow(6, r); i++; continue; }
                if (r.op === '=') { html += '<tr>' + cell(r, 'a') + cell(r, 'b') + '</tr>'; i++; continue; }
                /* A run of removed lines and the added lines after it stand
                   side by side, pair by pair. */
                var dels = [], adds = [];
                while (i < list.length && list[i].op === '-') { dels.push(list[i++]); }
                while (i < list.length && list[i].op === '+') { adds.push(list[i++]); }
                for (var k = 0; k < Math.max(dels.length, adds.length); k++) { html += '<tr>' + cell(dels[k], 'a') + cell(adds[k], 'b') + '</tr>'; }
            }
            return '<table class="df-table df-split"><caption class="visually-hidden">The original on the left and the changed text on the right</caption>' +
                '<colgroup><col class="df-c-num"><col class="df-c-sign"><col><col class="df-c-num"><col class="df-c-sign"><col></colgroup><tbody>' + html + '</tbody></table>';
        }

        function drawOne(list) {
            var html = list.map(function (r) {
                if (r.gap) { return gapRow(4, r); }
                var kind = r.op === '-' ? ' df-del' : r.op === '+' ? ' df-add' : '';
                var sign = r.op === '-' ? '\u2212' : r.op === '+' ? '+' : '';
                return '<tr><td class="df-num">' + (r.a || '') + '</td><td class="df-num">' + (r.b || '') + '</td>' +
                    '<td class="df-sign' + kind + '">' + sign + '</td><td class="df-line' + kind + '">' + lineHtml(r) + '</td></tr>';
            }).join('');
            return '<table class="df-table df-one"><caption class="visually-hidden">Both texts in one column, with the line numbers of the original and of the changed text</caption>' +
                '<colgroup><col class="df-c-num"><col class="df-c-num"><col class="df-c-sign"><col></colgroup><tbody>' + html + '</tbody></table>';
        }

        function drawControls() {
            root.querySelectorAll('[data-df-view]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-df-view') === st.view ? 'true' : 'false'); });
            q('[data-df-opt="ws"]').checked = st.ws;
            q('[data-df-opt="all"]').checked = st.all;
            SIDES.forEach(function (side) {
                var s = sides[side[0]], ta = q('[data-df-text="' + side[0] + '"]');
                if (ta.value !== s.text) { ta.value = s.text; }
                q('[data-df-source="' + side[0] + '"]').textContent = s.path || s.name || '';
            });
        }

        function compare() {
            if (!D) { return; }
            result = D.lines(sides.a.text, sides.b.text, { ignoreWhitespace: st.ws });
            if (!sides.a.text && !sides.b.text) {
                summary.textContent = '';
                out.innerHTML = '<p class="df-empty-note">Type, paste or open the two texts to compare them.</p>';
                return;
            }
            summary.textContent = result.same ? (st.ws ? 'The texts are the same, apart from spacing.' : 'The texts are the same.')
                : plural(result.removed, 'line', 'lines') + ' removed, ' + plural(result.added, 'line', 'lines') + ' added' +
                  (result.gaveUp ? '. The texts differ in too many places to line up, so all of each is shown.' : '.');
            out.innerHTML = result.same && !st.all ? '' : (st.view === 'one' ? drawOne : drawSplit)(shown(result.rows));
        }

        function draw() { drawControls(); compare(); }

        function update() {
            draw();
            commit();
            say(unkept ? 'The texts are too long for the address to keep, so a link to this page won\'t bring them back. Two files of the site are kept by their paths.' : '');
        }

        /* === Sources ===================================================== */

        async function openSide(k) {
            var api;
            try { api = await files(); } catch (err) { say('The files could not be loaded: ' + err.message + '.'); return; }
            var F = api[0], FB = api[1], s = sides[k];
            var at = s.path ? F.resolve(F.home(), s.path) : null;
            var res = await FB.pick(F, {
                mode: 'open', title: 'Open the ' + (k === 'a' ? 'original' : 'changed') + ' text', host: root, computer: true,
                start: at ? F.displayPath(F.realOf(at).parent) : '~',
                check: function (r) { return F.isText(r) ? null : r.name + ' isn\'t a text file, so it can\'t be compared.'; }
            });
            if (!res) { return; }
            try {
                if (res.file) { s.text = await res.file.text(); s.path = null; s.name = res.file.name; }
                else { s.text = await F.read(res.node); s.path = res.path; s.name = null; }
            } catch (err) { say('That file could not be read: ' + err.message + '.'); return; }
            update();
        }

        /* Two sides named by path in the address are read when the applet
           starts, or when the state changes to name them. */
        async function readPaths() {
            if (!sides.a.path && !sides.b.path) { return; }
            var F;
            try { F = (await files())[0]; } catch (err) { say('The files could not be loaded: ' + err.message + '.'); return; }
            for (var i = 0; i < SIDES.length; i++) {
                var k = SIDES[i][0], s = sides[k];
                if (!s.path) { continue; }
                var node = F.resolve(F.home(), s.path);
                if (!node || node.children) { say('There\'s no file at ' + s.path + '.'); s.path = null; continue; }
                try { s.text = await F.read(F.realOf(node)); } catch (err) { say(s.path + ' could not be read: ' + err.message + '.'); s.path = null; }
            }
            draw();
        }

        function swap() {
            var t = sides.a;
            sides.a = sides.b;
            sides.b = t;
            update();
        }

        /* === Menus ======================================================= */

        function menus() {
            var empty = !sides.a.text && !sides.b.text;
            return { titles: [
                { label: 'Diff Viewer', items: window.pcAppletIdentity(root, [{ label: 'About the diff viewer', run: function () { about.showModal(); } }]) },
                { id: 'file', label: 'File', items: [
                    { label: 'Open the original…', run: function () { openSide('a'); } },
                    { label: 'Open the changed text…', run: function () { openSide('b'); } }, '-',
                    { label: 'Clear both sides', run: function () { sides.a = { text: '', path: null, name: null }; sides.b = { text: '', path: null, name: null }; update(); }, disabled: empty }
                ] },
                { label: 'Compare', items: [
                    { label: 'Swap the sides', run: swap, disabled: empty },
                    { label: 'Ignore spaces', checked: st.ws, run: function () { st.ws = !st.ws; update(); } }
                ] }
            ], into: { view: [
                { label: 'Side by side', radio: 'view', checked: st.view === 'split', run: function () { st.view = 'split'; update(); } },
                { label: 'One column', radio: 'view', checked: st.view === 'one', run: function () { st.view = 'one'; update(); } },
                { label: 'Show every line', checked: st.all, run: function () { st.all = !st.all; update(); } }
            ] } };
        }

        /* === Events ====================================================== */

        var typeTimer = null;
        function onInput(e) {
            var t = e.target;
            if (t.hasAttribute('data-df-text')) {
                var s = sides[t.getAttribute('data-df-text')];
                s.text = t.value;
                /* A text typed over is no longer the file it came from. */
                s.path = null;
                s.name = null;
                clearTimeout(typeTimer);
                typeTimer = setTimeout(update, 250);
            }
        }
        function onChange(e) {
            var t = e.target;
            if (t.hasAttribute('data-df-opt')) { st[t.getAttribute('data-df-opt')] = t.checked; update(); }
        }
        function onClick(e) {
            var b = e.target.closest('button');
            if (!b || !root.contains(b)) { return; }
            if (b.hasAttribute('data-df-view')) { st.view = b.getAttribute('data-df-view'); update(); return; }
            if (b.hasAttribute('data-df-open')) { openSide(b.getAttribute('data-df-open')); return; }
            var what = b.getAttribute('data-df');
            if (what === 'swap') { swap(); }
            else if (what === 'about-close') { about.close(); }
        }
        root.addEventListener('input', onInput);
        root.addEventListener('change', onChange);
        root.addEventListener('click', onClick);

        drawControls();
        engine().then(function (api) {
            D = api;
            draw();
            readPaths();
        }, function (err) { say('The comparison could not start: ' + err.message + '.'); });

        return {
            menus: menus,
            state: stateString,
            setState: function (s) {
                st = parseState(s);
                sides.a = { text: st.a.text || '', path: st.a.path || null, name: null };
                sides.b = { text: st.b.text || '', path: st.b.path || null, name: null };
                draw();
                readPaths();
            },
            destroy: function () {
                clearTimeout(writeTimer);
                clearTimeout(typeTimer);
                root.removeEventListener('input', onInput);
                root.removeEventListener('change', onChange);
                root.removeEventListener('click', onClick);
                if (about.open) { about.close(); }
            }
        };
    }

    window.pudlApplets.register('diff', { init: init });
})();
