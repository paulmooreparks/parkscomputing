/* Editor: a graphical text editor for the reader's own files
   (Architecture/files-editor-design.md). The editing surface is
   CodeMirror 6 (MIT), vendored as one bundle in js/vendor; the files come
   from js/sitefs.js, the sandbox the terminal and Files share. A reader's
   files in ~ are edited and saved; a page of the site opens read-only,
   with a way to save a copy to ~. */
(function () {
    'use strict';

    var SELF_SRC = document.currentScript && document.currentScript.src;
    function beside(file) { return SELF_SRC ? SELF_SRC.replace(/editor\.js/, file) : '/js/' + file; }
    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = function () { reject(new Error('could not load ' + src)); };
            document.head.appendChild(s);
        });
    }
    var cmReady = null;
    function loadCodeMirror() {
        if (window.CM && window.CM.EditorView) { return Promise.resolve(window.CM); }
        if (!cmReady) {
            cmReady = loadScript(beside('vendor/codemirror-6.43/codemirror.js'))
                .then(function () { return window.CM; })
                .catch(function (err) { cmReady = null; throw err; });
        }
        return cmReady;
    }
    var siteFsReady = null;
    function loadSiteFs() {
        if (window.pcSiteFs) { return Promise.resolve(window.pcSiteFs); }
        if (!siteFsReady) {
            siteFsReady = loadScript(window.pcSiteFsSrc || beside('sitefs.js'))
                .then(function () { return window.pcSiteFs; })
                .catch(function (err) { siteFsReady = null; throw err; });
        }
        return siteFsReady;
    }

    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    /* Colours from PUDL's tokens, as CSS variables, so the editor follows
       the theme with no code of its own. */
    function makeTheme(CM) {
        var tint = function (pct) { return 'color-mix(in srgb, var(--accent) ' + pct + '%, transparent)'; };
        return [
            CM.EditorView.theme({
                '&': { color: 'var(--text)', backgroundColor: 'var(--input-bg)', height: '100%', fontSize: '14px' },
                '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.5' },
                '.cm-content': { caretColor: 'var(--accent)' },
                '.cm-gutters': { backgroundColor: 'var(--surface)', color: 'var(--text-muted)', borderRight: '1px solid var(--border)' },
                '.cm-activeLine': { backgroundColor: tint(6) },
                '.cm-activeLineGutter': { backgroundColor: tint(12), color: 'var(--text)' },
                '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent)' },
                '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: tint(26) + ' !important' },
                '.cm-selectionMatch': { backgroundColor: tint(14) },
                '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: tint(22), outline: '1px solid ' + tint(50) },
                '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--warn) 30%, transparent)' },
                '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--warn) 55%, transparent)' },
                '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--border)' },
                '.cm-panels input, .cm-panels button': { font: 'inherit', fontSize: '13px' },
                '.cm-tooltip': { backgroundColor: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' },
                '.cm-diagnostic-error': { borderLeftColor: 'var(--syntax-error)' },
                '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--syntax-error)' },
                '&.cm-focused': { outline: 'none' }
            }),
            /* PUDL's syntax tokens (0.26.0), after the README's CodeMirror
               recipe, with the Markdown and shell tags this editor meets. */
            CM.syntaxHighlighting(CM.HighlightStyle.define([
                { tag: [CM.tags.keyword, CM.tags.operator], color: 'var(--syntax-keyword)' },
                { tag: [CM.tags.string, CM.tags.special(CM.tags.string), CM.tags.regexp, CM.tags.monospace], color: 'var(--syntax-string)' },
                { tag: [CM.tags.number, CM.tags.bool, CM.tags.null], color: 'var(--syntax-number)' },
                { tag: [CM.tags.comment, CM.tags.meta, CM.tags.quote, CM.tags.processingInstruction], color: 'var(--syntax-comment)', fontStyle: 'italic' },
                { tag: [CM.tags.function(CM.tags.variableName), CM.tags.variableName, CM.tags.definition(CM.tags.variableName)], color: 'var(--syntax-name)' },
                { tag: [CM.tags.tagName, CM.tags.typeName, CM.tags.angleBracket], color: 'var(--syntax-tag)' },
                { tag: [CM.tags.attributeName, CM.tags.propertyName], color: 'var(--syntax-attr)' },
                { tag: CM.tags.heading, color: 'var(--syntax-heading)', fontWeight: '700' },
                { tag: [CM.tags.link, CM.tags.url], color: 'var(--syntax-link)', textDecoration: 'underline' },
                { tag: CM.tags.invalid, color: 'var(--syntax-error)' },
                { tag: CM.tags.strong, fontWeight: '700' },
                { tag: CM.tags.emphasis, fontStyle: 'italic' }
            ]))
        ];
    }

    var uid = 0;

    function init(root, opts) {
        opts = opts || {};
        var n = ++uid;
        root.classList.add('pc-editor');
        if (opts.fit === 'fill') { root.classList.add('pc-editor-fill'); }
        root.innerHTML =
            '<div class="ed-toolbar" role="toolbar" aria-label="Editor">' +
              '<button type="button" class="btn btn-sm" data-action="new">New</button>' +
              '<button type="button" class="btn btn-sm" data-action="open">Open&#8230;</button>' +
              '<button type="button" class="btn btn-sm btn-primary" data-action="save">Save</button>' +
              '<button type="button" class="btn btn-sm" data-action="save-as">Save as&#8230;</button>' +
              '<span class="ed-sep"></span>' +
              '<button type="button" class="icon-btn" data-action="undo" aria-label="Undo" title="Undo (Ctrl+Z)"><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 3.5L2.5 6.5l3 3"/><path d="M2.5 6.5h7a4 4 0 0 1 0 8H7"/></svg></button>' +
              '<button type="button" class="icon-btn" data-action="redo" aria-label="Redo" title="Redo (Ctrl+Y)"><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 3.5l3 3-3 3"/><path d="M13.5 6.5h-7a4 4 0 0 0 0 8H9"/></svg></button>' +
              '<button type="button" class="icon-btn" data-action="find" aria-label="Find and replace" title="Find and replace (Ctrl+F)"><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/></svg></button>' +
              '<label class="check ed-wrap"><input type="checkbox" data-role="wrap" checked /> Wrap lines</label>' +
              '<span class="ed-spacer"></span>' +
              '<span class="ed-readonly" data-role="readonly" hidden><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="7" width="10" height="7.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>Read-only</span>' +
            '</div>' +
            '<div class="tablist doc-tabs ed-tabs" role="tablist" aria-label="Open files" data-role="tabs"></div>' +
            '<div class="code-surface ed-surface" data-role="surface"></div>' +
            '<div class="ed-status" data-role="status-bar">' +
              '<span data-role="where"></span><span data-role="lang"></span><span data-role="pos"></span>' +
              '<span class="ed-message" data-role="message" role="status" aria-live="polite"></span>' +
            '</div>' +
            '<dialog class="dialog ed-dialog" data-role="dialog" aria-labelledby="ed-dlg-title-' + n + '">' +
              '<form method="dialog" data-role="dialog-form">' +
                '<h3 class="dialog-title" id="ed-dlg-title-' + n + '" data-role="dialog-title"></h3>' +
                '<div class="dialog-body">' +
                  '<p data-role="dialog-text"></p>' +
                  '<input class="form-input" data-role="dialog-input" list="ed-paths-' + n + '" autocomplete="off" spellcheck="false" />' +
                  '<datalist id="ed-paths-' + n + '" data-role="paths"></datalist>' +
                  '<p class="form-error" data-role="dialog-error" hidden></p>' +
                '</div>' +
                '<div class="dialog-actions" data-role="dialog-actions"></div>' +
              '</form>' +
            '</dialog>';

        var q = function (sel) { return root.querySelector(sel); };
        var el = {
            tabs: q('[data-role="tabs"]'), surface: q('[data-role="surface"]'), where: q('[data-role="where"]'),
            lang: q('[data-role="lang"]'), pos: q('[data-role="pos"]'), message: q('[data-role="message"]'),
            readonly: q('[data-role="readonly"]'), wrap: q('[data-role="wrap"]'),
            dialog: q('[data-role="dialog"]'), dlgForm: q('[data-role="dialog-form"]'), dlgTitle: q('[data-role="dialog-title"]'),
            dlgText: q('[data-role="dialog-text"]'), dlgInput: q('[data-role="dialog-input"]'), dlgError: q('[data-role="dialog-error"]'),
            dlgActions: q('[data-role="dialog-actions"]'), paths: q('[data-role="paths"]')
        };

        var CM = null, F = null, view = null, destroyed = false, unsubscribe = null;
        var tabs = [], active = -1, untitled = 0;
        var wrapComp = null, langComp = null, lintComp = null, roComp = null;
        var startFile = fileFrom(opts.state) || (opts.ownsUrl ? fileFrom(location.search) : null);

        function fileFrom(s) {
            if (!s) { return null; }
            var v = new URLSearchParams(String(s).replace(/^\?/, '')).get('file');
            return v || null;
        }

        /* === State ====================================================== */

        function current() { return tabs[active] || null; }
        function stateString() { var t = current(); return t && t.path ? 'file=' + encodeURIComponent(t.path).replace(/%2F/g, '/').replace(/%7E/g, '~') : ''; }
        function announce() {
            if (opts.ownsUrl) {
                var qs = new URLSearchParams(location.search), t = current();
                if (t && t.path) { qs.set('file', t.path); } else { qs.delete('file'); }
                var s = qs.toString().replace(/%2F/g, '/').replace(/%7E/g, '~');
                history.replaceState(history.state, '', location.pathname + (s ? '?' + s : '') + location.hash);
            }
            if (opts.changed) { opts.changed(stateString()); }
        }

        function say(msg, isError) {
            el.message.textContent = msg || '';
            el.message.classList.toggle('ed-message-error', !!isError);
        }

        /* === Languages ==================================================== */

        function isLayouts(path) { return path === '~/barcode-layouts.json'; }
        function languageFor(path) {
            var p = String(path || '');
            if (/\.(md|markdown)$/i.test(p)) { return 'markdown'; }
            if (/\.json$/i.test(p)) { return 'json'; }
            if (/^~\/bin\/|^\/bin\/|\.sh$/i.test(p)) { return 'script'; }
            return 'text';
        }
        var LANG_NAMES = { markdown: 'Markdown', json: 'JSON', script: 'Script', text: 'Plain text' };
        function langExtension(lang) {
            if (lang === 'markdown') { return CM.markdown(); }
            if (lang === 'json') { return CM.json(); }
            if (lang === 'script') { return CM.StreamLanguage.define(CM.shell); }
            return [];
        }

        /* JSON is checked as it is typed; the barcode layouts are checked
           further, with the barcode tool's own rules, and cannot be saved
           while they fail. */
        function lintExtension(tab) {
            if (tab.lang !== 'json' || tab.readOnly) { return []; }
            var parse = CM.jsonParseLinter();
            if (!isLayouts(tab.path)) { return [CM.linter(parse), CM.lintGutter()]; }
            return [CM.linter(async function (v) {
                var d = parse(v);
                if (d.length) { tab.layoutsError = d[0].message; return d; }
                var c = await F.checkLayouts(v.state.doc.toString());
                tab.layoutsError = c.error || null;
                if (!c.error) { return []; }
                return (c.errors || [c.error]).slice(0, 20).map(function (m) {
                    return { from: 0, to: Math.min(1, v.state.doc.length), severity: 'error', message: m };
                });
            }, { delay: 400 }), CM.lintGutter()];
        }

        function stateFor(tab, text) {
            return CM.EditorState.create({
                doc: text,
                extensions: [
                    CM.lineNumbers(), CM.highlightActiveLineGutter(), CM.highlightSpecialChars(),
                    CM.history(), CM.drawSelection(), CM.dropCursor(), CM.indentOnInput(),
                    CM.bracketMatching(), CM.closeBrackets(), CM.rectangularSelection(), CM.crosshairCursor(),
                    CM.highlightActiveLine(), CM.highlightSelectionMatches(),
                    CM.keymap.of([].concat(
                        [{ key: 'Mod-s', preventDefault: true, run: function () { save(); return true; } },
                         { key: 'Mod-o', preventDefault: true, run: function () { openDialog(); return true; } }],
                        CM.closeBracketsKeymap, CM.defaultKeymap, CM.searchKeymap, CM.historyKeymap, CM.lintKeymap, [CM.indentWithTab])),
                    CM.search({ top: true }),
                    makeTheme(CM),
                    wrapComp.of(el.wrap.checked ? CM.EditorView.lineWrapping : []),
                    langComp.of(langExtension(tab.lang)),
                    lintComp.of(lintExtension(tab)),
                    roComp.of([CM.EditorState.readOnly.of(!!tab.readOnly), CM.EditorView.editable.of(!tab.readOnly)]),
                    CM.EditorView.contentAttributes.of({ 'aria-label': 'Text of ' + tab.name }),
                    CM.EditorView.updateListener.of(function (u) {
                        if (u.docChanged && tabs[active] === tab) { markModified(tab); }
                        if (u.selectionSet || u.docChanged) { showPos(); }
                    })
                ]
            });
        }

        /* === Tabs ======================================================== */

        function markModified(tab) {
            var mod = view.state.doc.toString() !== tab.saved;
            if (mod !== tab.modified) { tab.modified = mod; renderTabs(); }
        }

        /* PUDL's document tabs (pudl-tabs.js): the arrow keys move along
           them, and the close button or Delete asks, through
           pudl:tab-close, for the tab to close. */
        function renderTabs() {
            el.tabs.innerHTML = tabs.map(function (t, i) {
                var on = i === active;
                return '<button type="button" role="tab" data-tab="' + i + '" aria-selected="' + on + '" tabindex="' + (on ? '0' : '-1') + '" title="' + esc(t.path || t.name) + '">' +
                    esc(t.name) + (t.readOnly ? '<span class="ed-ro-mark">(read-only)</span>' : '') +
                    (t.modified ? '<span class="doc-tab-dirty">unsaved</span>' : '') +
                    '<span class="doc-tab-close" aria-hidden="true" title="Close"></span></button>';
            }).join('');
            var t = current();
            el.where.textContent = t ? (t.path || 'Not saved yet') : '';
            el.lang.textContent = t ? LANG_NAMES[t.lang] : '';
            el.readonly.hidden = !(t && t.readOnly);
            q('[data-action="save"]').disabled = !t || t.readOnly;
            q('[data-action="save"]').textContent = t && t.readOnly ? 'Save' : 'Save';
            q('[data-action="save-as"]').textContent = t && t.readOnly ? 'Save a copy to ~…' : 'Save as…';
            q('[data-action="save-as"]').disabled = !t;
        }

        function showPos() {
            if (!view) { return; }
            var head = view.state.selection.main.head, line = view.state.doc.lineAt(head);
            el.pos.textContent = 'Line ' + line.number + ', column ' + (head - line.from + 1);
        }

        function activate(i) {
            var prev = current();
            if (prev && view) { prev.state = view.state; }
            active = i;
            var t = current();
            if (!t) { view.setState(CM.EditorState.create({ doc: '' })); renderTabs(); announce(); return; }
            view.setState(t.state);
            renderTabs();
            showPos();
            announce();
            say(t.external ? 'This file was changed somewhere else since you opened it.' : '', !!t.external);
        }

        function addTab(t, text) {
            t.saved = text;
            t.modified = false;
            t.state = stateFor(t, text);
            tabs.push(t);
            activate(tabs.length - 1);
            view.focus();
        }

        /* Opens a file by path: switches to it if it is open already. */
        async function openPath(path) {
            var node = F.resolve(F.home(), path);
            if (!node) { say(path + ': no such file', true); return false; }
            if (node.children) { say(path + ' is a folder', true); return false; }
            var r = F.realOf(node), display = F.displayPath(r);
            for (var i = 0; i < tabs.length; i++) { if (tabs[i].path === display) { activate(i); view.focus(); return true; } }
            var text;
            try { text = await F.read(r); } catch (err) { say(err.message, true); return false; }
            var readOnly = !r.home;
            addTab({ path: display, name: r.name, lang: languageFor(display), readOnly: readOnly }, text);
            say(readOnly ? 'This is part of the site, so it opens read-only. "Save a copy to ~" keeps an editable copy.' : '');
            return true;
        }

        /* A file that does not exist yet, in a folder of ~: a tab that
           creates it when saved. */
        function newNamed(path) {
            var sp = F.splitPath(path), dir = F.resolve(F.home(), sp.dir);
            if (!dir || !dir.children || !dir.home || !F.validName(sp.base)) {
                newTab();
                say(path + ': no such file, and one can\'t be made there', true);
                return;
            }
            var display = F.displayPath(dir).replace(/\/$/, '') + '/' + sp.base;
            addTab({ path: display, name: sp.base, lang: languageFor(display), readOnly: false, fresh: true }, '');
            say(display + ' is a new file. Saving creates it.');
        }

        function newTab() {
            untitled++;
            addTab({ path: null, name: 'untitled-' + untitled, lang: 'text', readOnly: false }, '');
        }

        async function closeTab(i) {
            var t = tabs[i];
            if (!t) { return; }
            if (t.modified) {
                if (active !== i) { activate(i); }
                var choice = await ask('Save changes to ' + t.name + '?', 'Your changes will be lost if you don\'t save them.', null,
                    [['cancel', 'Cancel'], ['discard', 'Don\'t save'], ['save', 'Save', true]]);
                if (choice === 'cancel' || choice == null) { return; }
                if (choice === 'save' && !(await save())) { return; }
            }
            tabs.splice(i, 1);
            if (!tabs.length) { active = -1; newTab(); return; }
            active = Math.min(active, tabs.length - 1);
            if (i < active) { active--; }
            activate(Math.max(0, Math.min(i, tabs.length - 1)));
        }

        /* === Saving ====================================================== */

        async function save() {
            var t = current();
            if (!t || t.readOnly) { return false; }
            if (!t.path) { return saveAs(); }
            return writeTo(t, t.path);
        }

        async function writeTo(t, path) {
            var text = view.state.doc.toString();
            say('Saving…');
            var res = await F.write(F.home(), path, text, false);
            if (res.error) { say('Not saved: ' + res.error, true); return false; }
            var display = F.displayPath(res.node);
            var renamed = t.path !== display;
            t.path = display;
            t.name = res.node.name;
            t.saved = text;
            t.modified = false;
            t.external = false;
            t.fresh = false;
            t.readOnly = false;
            if (renamed) {
                var lang = languageFor(display);
                t.lang = lang;
                view.dispatch({ effects: [langComp.reconfigure(langExtension(lang)), lintComp.reconfigure(lintExtension(t)),
                    roComp.reconfigure([CM.EditorState.readOnly.of(false), CM.EditorView.editable.of(true)])] });
            }
            renderTabs();
            announce();
            say('Saved ' + display + '.');
            return true;
        }

        async function saveAs() {
            var t = current();
            if (!t) { return false; }
            var suggestion = t.path && !t.readOnly ? t.path : '~/' + (t.readOnly ? t.name + (/\.[a-z0-9]+$/i.test(t.name) ? '' : '.txt') : t.name);
            var path = await ask(t.readOnly ? 'Save a copy to ~' : 'Save as', 'Where in your home directory (~)? For example ~/notes/today.md', suggestion,
                [['cancel', 'Cancel'], ['ok', 'Save', true]], function (v) {
                    if (!v) { return 'Give it a path.'; }
                    var sp = F.splitPath(v), dir = F.resolve(F.home(), sp.dir);
                    if (!dir || !dir.children) { return 'There\'s no folder at ' + sp.dir + '.'; }
                    if (!dir.home) { return 'Files can only be saved in your home directory (~).'; }
                    if (!F.validName(sp.base)) { return sp.base + ' isn\'t a valid file name.'; }
                    var existing = F.childNamed(dir, sp.base);
                    if (existing && existing.children) { return v + ' is a folder.'; }
                    return null;
                }, true);
            if (!path || path === 'cancel') { return false; }
            var existing = F.resolve(F.home(), path);
            if (existing && F.displayPath(F.realOf(existing)) !== t.path) {
                var ok = await ask('Replace ' + F.realOf(existing).name + '?', path + ' already exists. Replace it with this text?', null,
                    [['cancel', 'Cancel'], ['ok', 'Replace', true]]);
                if (ok !== 'ok') { return false; }
            }
            return writeTo(t, path);
        }

        /* === Dialogs ====================================================== */

        /* One dialog for questions and paths: resolves to the chosen
           button's name, or with an input, to the text entered. */
        function ask(title, text, value, buttons, validate, withInput) {
            return new Promise(function (done) {
                el.dlgTitle.textContent = title;
                el.dlgText.textContent = text || '';
                el.dlgInput.hidden = !withInput;
                el.dlgInput.value = value || '';
                el.dlgError.hidden = true;
                el.dlgActions.innerHTML = buttons.map(function (b) {
                    return '<button type="' + (b[2] ? 'submit' : 'button') + '" class="btn' + (b[2] ? ' btn-primary' : '') + '" data-choice="' + b[0] + '">' + esc(b[1]) + '</button>';
                }).join('');
                var finished = false;
                function finish(v) { if (finished) { return; } finished = true; cleanup(); if (el.dialog.open) { el.dialog.close(); } done(v); }
                function onClick(e) {
                    var b = e.target.closest('[data-choice]');
                    if (!b || b.type === 'submit') { return; }
                    finish(b.getAttribute('data-choice'));
                }
                function onSubmit(e) {
                    e.preventDefault();
                    if (!withInput) { finish(el.dlgActions.querySelector('[type="submit"]').getAttribute('data-choice')); return; }
                    var v = el.dlgInput.value.trim(), err = validate ? validate(v) : null;
                    if (err) { el.dlgError.textContent = err; el.dlgError.hidden = false; el.dlgInput.focus(); return; }
                    finish(v);
                }
                function onClose() { finish(null); }
                function cleanup() {
                    el.dlgActions.removeEventListener('click', onClick);
                    el.dlgForm.removeEventListener('submit', onSubmit);
                    el.dialog.removeEventListener('close', onClose);
                }
                el.dlgActions.addEventListener('click', onClick);
                el.dlgForm.addEventListener('submit', onSubmit);
                el.dialog.addEventListener('close', onClose);
                el.dialog.showModal();
                if (withInput) { el.dlgInput.focus(); el.dlgInput.select(); }
                else { el.dlgActions.querySelector('[type="submit"]').focus(); }
            });
        }

        /* Every file in ~, for the Open dialog's suggestions. */
        function homeFiles() {
            var out = [];
            (function walk(d) {
                (d.children || []).forEach(function (c) { if (c.children) { walk(c); } else { out.push(F.displayPath(c)); } });
            })(F.home());
            return out;
        }

        async function openDialog() {
            el.paths.innerHTML = homeFiles().map(function (p) { return '<option value="' + esc(p) + '"></option>'; }).join('');
            var path = await ask('Open', 'A file in your home directory, such as ~/README, or any page of the site, such as /articles/coincidences, which opens read-only.', '~/',
                [['cancel', 'Cancel'], ['ok', 'Open', true]], function (v) {
                    var node = v ? F.resolve(F.home(), v) : null;
                    if (!node) { return 'There\'s nothing at ' + (v || 'that path') + '.'; }
                    if (node.children) { return v + ' is a folder.'; }
                    if (F.realOf(node).kind === 'link' || F.realOf(node).kind === 'app') { return v + ' isn\'t a file the editor can open.'; }
                    return null;
                }, true);
            if (path && path !== 'cancel') { await openPath(path); }
        }

        /* === Changes made elsewhere ======================================= */

        /* A file saved by the terminal, Files or another tab: an open tab
           with no unsaved changes takes the new text; one with changes is
           told, and keeps the reader's version. */
        function onFsChange() {
            tabs.forEach(function (t, i) {
                if (!t.path || t.readOnly) { return; }
                var node = F.resolve(F.home(), t.path);
                if (!node && t.fresh) { return; }
                if (!node) { t.external = true; if (i === active) { say(t.path + ' was deleted or moved somewhere else. Save to keep this text.', true); } return; }
                var text = F.readHome(F.realOf(node));
                if (text === t.saved) { return; }
                var edited = (i === active ? view.state.doc.toString() : t.state.doc.toString()) !== t.saved;
                if (!edited) {
                    t.saved = text;
                    if (i === active) { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }); t.modified = false; }
                    else { t.state = stateFor(t, text); }
                } else {
                    t.external = true;
                    if (i === active) { say(t.path + ' was changed somewhere else. Saving will replace that version with yours.', true); }
                }
            });
            renderTabs();
        }

        /* A file asked of a running editor through the site's handlers
           (js/handlers.js) opens in a tab, or a new file by that name. */
        function onOpenRequest(e) {
            var f = fileFrom(e.detail && e.detail.state);
            if (!f || !F || !CM) { return; }
            openPath(f).then(function (opened) { if (!opened && !F.resolve(F.home(), f)) { newNamed(f); } });
        }
        root.addEventListener('pc:applet-request', onOpenRequest);

        function onBeforeUnload(e) {
            if (tabs.some(function (t) { return t.modified; })) { e.preventDefault(); e.returnValue = ''; }
        }
        window.addEventListener('beforeunload', onBeforeUnload);

        /* === Controls ===================================================== */

        /* A tab closed from the keyboard leaves the focus on the tab that
           takes its place, so Delete can close one after another. */
        el.tabs.addEventListener('pudl:tab-close', function (e) {
            var fromList = el.tabs.contains(document.activeElement);
            closeTab(+e.target.getAttribute('data-tab')).then(function () {
                var b = el.tabs.querySelector('[aria-selected="true"]');
                if (fromList && b) { b.focus(); }
            });
        });
        root.addEventListener('click', function (e) {
            var tabBtn = e.target.closest('[data-tab]');
            if (tabBtn) { activate(+tabBtn.getAttribute('data-tab')); view.focus(); return; }
            var a = e.target.closest('[data-action]');
            if (!a || !CM) { return; }
            switch (a.getAttribute('data-action')) {
                case 'new': newTab(); break;
                case 'open': openDialog(); break;
                case 'save': save(); break;
                case 'save-as': saveAs(); break;
                case 'undo': CM.undo(view); view.focus(); break;
                case 'redo': CM.redo(view); view.focus(); break;
                case 'find': CM.openSearchPanel(view); break;
            }
        });
        el.wrap.addEventListener('change', function () {
            if (view) { view.dispatch({ effects: wrapComp.reconfigure(el.wrap.checked ? CM.EditorView.lineWrapping : []) }); }
        });

        /* === Start ======================================================== */

        var boot = Promise.all([loadCodeMirror(), loadSiteFs().then(function (api) { F = api; return F.load(); })]).then(async function (res) {
            if (destroyed) { return; }
            CM = res[0];
            wrapComp = new CM.Compartment(); langComp = new CM.Compartment(); lintComp = new CM.Compartment(); roComp = new CM.Compartment();
            view = new CM.EditorView({ parent: el.surface });
            unsubscribe = F.onChange(onFsChange);
            var opened = startFile ? await openPath(startFile) : false;
            if (!opened) {
                if (startFile && !F.resolve(F.home(), startFile)) { newNamed(startFile); } else { newTab(); }
            }
            if (!(opts.ownsUrl || root.closest('.win.active'))) { view.contentDOM.blur(); }
        }).catch(function (err) {
            if (destroyed) { return; }
            root.innerHTML = '<p class="ed-failed">The editor could not start: ' + esc(err.message) + '.</p>';
        });

        return {
            state: function () { return stateString() || null; },
            setState: function (s) { onOpenRequest({ detail: { state: s } }); },
            destroy: function () {
                destroyed = true;
                if (unsubscribe) { unsubscribe(); }
                root.removeEventListener('pc:applet-request', onOpenRequest);
                window.removeEventListener('beforeunload', onBeforeUnload);
                if (el.dialog.open) { el.dialog.close(); }
                if (view) { view.destroy(); }
            },
            ready: boot
        };
    }

    window.pudlApplets.register('editor', { init: init });
})();
