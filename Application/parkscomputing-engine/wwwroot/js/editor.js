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
    var browserReady = null;
    function loadBrowser() {
        if (window.pcFileBrowser) { return Promise.resolve(window.pcFileBrowser); }
        if (!browserReady) {
            browserReady = loadScript(window.pcFileBrowserSrc || beside('filebrowser.js'))
                .then(function () { return window.pcFileBrowser; })
                .catch(function (err) { browserReady = null; throw err; });
        }
        return browserReady;
    }

    /* Whether the Explorer pane shows, kept per browser; with no choice
       made, it shows on a wide screen. */
    var EXPLORER_KEY = 'pc-editor-explorer';
    function explorerWanted() {
        try { var v = localStorage.getItem(EXPLORER_KEY); if (v != null) { return v === '1'; } } catch (err) { }
        return window.matchMedia('(min-width: 900px)').matches;
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
              '<button type="button" class="icon-btn" data-action="explorer" aria-label="Show the files" title="Show the files" aria-pressed="false"><span class="glyph" style="--glyph: var(--glyph-folder)" aria-hidden="true"></span></button>' +
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
              /* On the edit origin: a site page's source, a file's place on
                 the public site, and a preview of unsaved text. */
              '<button type="button" class="btn btn-sm" data-action="source" hidden>Edit the source</button>' +
              '<button type="button" class="btn btn-sm" data-action="preview" hidden>Preview</button>' +
              '<a class="ed-view" data-role="view" target="_blank" rel="noopener" hidden>View on the site</a>' +
              '<span class="ed-readonly" data-role="readonly" hidden><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="7" width="10" height="7.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>Read-only</span>' +
            '</div>' +
            '<div class="tablist doc-tabs ed-tabs" role="tablist" aria-label="Open files" data-role="tabs"></div>' +
            '<div class="ed-panes" data-role="panes">' +
              /* The Explorer: the shared file browser's tree, files and all
                 (js/filebrowser.js), filled once the filesystem loads. */
              '<nav class="ed-explorer" data-role="explorer" aria-label="Files" hidden></nav>' +
              '<div class="code-surface ed-surface" data-role="surface"></div>' +
              /* The preview is the public site's own page for the draft, so
                 an article's scripts run there and never here (A11). */
              '<iframe class="ed-preview" data-role="preview" title="Preview of the unsaved page" hidden></iframe>' +
            '</div>' +
            '<div class="ed-status" data-role="status-bar">' +
              '<span data-role="where"></span><span data-role="lang"></span><span data-role="pos"></span>' +
              '<span class="ed-message" data-role="message" role="status" aria-live="polite"></span>' +
            '</div>' +
            '<dialog class="dialog ed-dialog" data-role="dialog" aria-labelledby="ed-dlg-title-' + n + '">' +
              '<form method="dialog" data-role="dialog-form">' +
                '<h3 class="dialog-title" id="ed-dlg-title-' + n + '" data-role="dialog-title"></h3>' +
                '<div class="dialog-body">' +
                  '<p data-role="dialog-text"></p>' +
                  '<input class="form-input" data-role="dialog-input" autocomplete="off" spellcheck="false" />' +
                  '<p class="form-error" data-role="dialog-error" hidden></p>' +
                '</div>' +
                '<div class="dialog-actions" data-role="dialog-actions"></div>' +
              '</form>' +
            '</dialog>';

        var q = function (sel) { return root.querySelector(sel); };
        var el = {
            tabs: q('[data-role="tabs"]'), surface: q('[data-role="surface"]'), where: q('[data-role="where"]'),
            panes: q('[data-role="panes"]'), preview: q('[data-role="preview"]'),
            lang: q('[data-role="lang"]'), pos: q('[data-role="pos"]'), message: q('[data-role="message"]'),
            readonly: q('[data-role="readonly"]'), wrap: q('[data-role="wrap"]'),
            dialog: q('[data-role="dialog"]'), dlgForm: q('[data-role="dialog-form"]'), dlgTitle: q('[data-role="dialog-title"]'),
            dlgText: q('[data-role="dialog-text"]'), dlgInput: q('[data-role="dialog-input"]'), dlgError: q('[data-role="dialog-error"]'),
            dlgActions: q('[data-role="dialog-actions"]'),
            explorer: q('[data-role="explorer"]'), explorerBtn: q('[data-action="explorer"]')
        };
        var FB = null, explorer = null;

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
            var node = t && t.path && F ? F.resolve(F.home(), t.path) : null;
            q('[data-action="source"]').hidden = !(F && F.mounted && node && t.readOnly && F.sourceOf(node));
            q('[data-action="preview"]').hidden = !(F && F.mounted && node && previewable(node));
            var url = node && F.mounted ? F.publicUrl(node) : null;
            var viewLink = q('[data-role="view"]');
            viewLink.hidden = !url;
            if (url) { viewLink.href = url; } else { viewLink.removeAttribute('href'); }
        }

        /* An article's source under /wwwroot/content can be previewed (A11). */
        function previewable(node) {
            var r = F.realOf(node);
            return r.server === 'wwwroot' && /^content\/[A-Za-z0-9_-]+\.(md|html)$/.test(r.rel);
        }

        function showPos() {
            if (!view) { return; }
            var head = view.state.selection.main.head, line = view.state.doc.lineAt(head);
            el.pos.textContent = 'Line ' + line.number + ', column ' + (head - line.from + 1);
        }

        function activate(i) {
            var prev = current();
            if (prev && view) { prev.state = view.state; }
            /* A preview belongs to the file it was made for. */
            if (i !== active) { hidePreview(); }
            active = i;
            var t = current();
            if (!t) { view.setState(CM.EditorState.create({ doc: '' })); renderTabs(); announce(); return; }
            view.setState(t.state);
            renderTabs();
            showPos();
            announce();
            markExplorer();
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
            if (!F.isText(r)) { say(display + ' isn\'t a text file, so the editor can\'t open it.', true); return false; }
            var text;
            try { text = await F.read(r); } catch (err) { say(err.message, true); return false; }
            var readOnly = !r.home;
            /* A server file remembers its time, which tells a change made
               elsewhere from this tab's own save. */
            addTab({ path: display, name: r.name, lang: languageFor(display), readOnly: readOnly, mtime: r.server ? +r.mtime : null }, text);
            say(readOnly
                ? (F.mounted && F.sourceOf(r) ? 'This is the page as the site shows it, read-only. "Edit the source" opens the file it\'s made from.'
                    : 'This is part of the site, so it opens read-only. "Save a copy to ~" keeps an editable copy.')
                : '');
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
            t.mtime = res.node.server ? +res.node.mtime : null;
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
            markExplorer();
            say('Saved ' + display + '.');
            return true;
        }

        async function saveAs() {
            var t = current();
            if (!t) { return false; }
            /* A file of yours saves beside itself; anything else starts in ~. */
            var node = t.path ? F.resolve(F.home(), t.path) : null, r = node ? F.realOf(node) : null;
            var startDir = r && r.home && !t.readOnly ? F.displayPath(r.parent) : '~';
            var name = t.readOnly ? t.name + (/\.[a-z0-9]+$/i.test(t.name) ? '' : '.txt') : t.name;
            var res = await FB.pick(F, {
                mode: 'save', title: t.readOnly ? 'Save a copy' : 'Save as', host: root,
                start: startDir, name: name, current: t.readOnly ? null : t.path, computer: true
            });
            if (!res) { return false; }
            if (res.download) {
                download(res.download, new Blob([view.state.doc.toString()], { type: 'text/plain' }));
                say('Downloaded ' + res.download + '. The tab still holds your text.');
                return false;
            }
            return writeTo(t, res.path);
        }

        function download(name, blob) {
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            document.body.appendChild(a);
            a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
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

        async function openDialog() {
            var t = current(), node = t && t.path ? F.resolve(F.home(), t.path) : null;
            /* It opens beside the file in front, or in ~. */
            var res = await FB.pick(F, {
                mode: 'open', title: 'Open', host: root, computer: true,
                start: node ? F.displayPath(F.realOf(node).parent) : '~',
                check: function (r) { return F.isText(r) ? null : r.name + ' isn\'t a text file, so the editor can\'t open it.'; }
            });
            if (!res) { return; }
            if (res.file) { await openFromComputer(res.file); return; }
            await openPath(res.path);
        }

        /* A file from the reader's computer opens as a new tab that belongs
           nowhere yet, so saving it asks where. */
        var COMPUTER_MAX = 5 * 1024 * 1024;
        async function openFromComputer(file) {
            if (file.size > COMPUTER_MAX) { say(file.name + ' is larger than 5 MB, too large to edit here.', true); return; }
            var text = await file.text();
            if (text.indexOf('\0') >= 0) { say(file.name + ' isn\'t a text file, so the editor can\'t open it.', true); return; }
            addTab({ path: null, name: file.name, lang: languageFor(file.name), readOnly: false }, text);
            /* It stays unsaved until it is saved somewhere on the site. */
            var t = current();
            t.saved = null;
            t.modified = true;
            renderTabs();
            say('Opened ' + file.name + ' from your computer. Save puts it in ~, and Save as can download it again.');
        }

        /* === The Explorer pane ============================================ */

        function setupExplorer() {
            el.explorer.innerHTML = FB.markup.body({ list: false, treeLabel: 'Files' });
            explorer = FB.create(el.explorer, F, {
                treeFiles: true,
                toggleFolders: true,
                onOpen: function (node) {
                    var r = F.realOf(node);
                    if (r.kind === 'link') { window.open(r.url, '_blank', 'noopener'); return; }
                    if (r.kind === 'app' || !F.isText(r)) {
                        var url = F.publicUrl(r);
                        if (url) { window.open(url, '_blank', 'noopener'); } else { say(node.name + ' isn\'t a file the editor can open.', true); }
                        return;
                    }
                    openPath(F.displayPath(r));
                },
                say: function (m, isError) { if (m) { say(m, isError); } }
            });
            showExplorer(explorerWanted());
            markExplorer();
        }

        function showExplorer(on) {
            el.explorer.hidden = !on;
            el.explorerBtn.setAttribute('aria-pressed', String(on));
            el.explorerBtn.setAttribute('aria-label', on ? 'Hide the files' : 'Show the files');
            el.explorerBtn.title = on ? 'Hide the files' : 'Show the files';
        }

        /* The Explorer marks the file in front and opens its way to it. */
        function markExplorer() {
            if (!explorer) { return; }
            var t = current(), node = t && t.path ? F.resolve(F.home(), t.path) : null;
            explorer.markCurrent(node ? F.pathOf(F.realOf(node)) : null);
        }

        /* === Preview (edit origin) ======================================== */

        /* Sends the unsaved text to the server as a draft, and shows the
           public site's page for it beside the text. Pressing Preview again
           shows the latest text; Save publishes (A11). */
        async function preview() {
            var t = current(), node = t && F.resolve(F.home(), t.path);
            if (!node || !previewable(node)) { return; }
            var token = (document.querySelector('meta[name="request-verification-token"]') || {}).content || '';
            say('Making a preview…');
            var r;
            try {
                r = await fetch('/api/admin/preview', {
                    method: 'POST', credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json', RequestVerificationToken: token },
                    body: JSON.stringify({ path: F.realOf(node).rel, text: view.state.doc.toString() })
                });
            } catch (err) { say('The preview could not be made: ' + err.message, true); return; }
            var body = await r.json().catch(function () { return {}; });
            if (!r.ok || !body.url) { say('The preview could not be made' + (body.error ? ': ' + body.error : '.'), true); return; }
            el.preview.src = body.url;
            el.preview.hidden = false;
            root.classList.add('ed-previewing');
            say('This preview is the unsaved text as the site would show it. It works for an hour; Save publishes.');
        }

        function hidePreview() {
            el.preview.hidden = true;
            el.preview.removeAttribute('src');
            root.classList.remove('ed-previewing');
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
                var r = F.realOf(node);
                /* A server file changed elsewhere shows a new time; only then
                   is its text fetched. */
                if (r.server) {
                    if (t.mtime != null && +r.mtime === t.mtime) { return; }
                    F.read(r).then(function (text) { t.mtime = +r.mtime; takeOutside(t, tabs.indexOf(t), text); renderTabs(); }).catch(function () { });
                    return;
                }
                takeOutside(t, i, F.readHome(r));
            });
            renderTabs();
        }

        function takeOutside(t, i, text) {
            if (i < 0 || text === t.saved) { return; }
            var edited = (i === active ? view.state.doc.toString() : t.state.doc.toString()) !== t.saved;
            if (!edited) {
                t.saved = text;
                if (i === active) { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }); t.modified = false; }
                else { t.state = stateFor(t, text); }
            } else {
                t.external = true;
                if (i === active) { say(t.path + ' was changed somewhere else. Saving will replace that version with yours.', true); }
            }
        }

        /* A file handed to a running editor, by an open request
           (pudlApplets.request) or a preset, opens in a tab, or as a new
           file by that name. */
        function takeFile(s) {
            var f = fileFrom(s);
            if (!f || !F || !CM) { return; }
            openPath(f).then(function (opened) { if (!opened && !F.resolve(F.home(), f)) { newNamed(f); } });
        }

        function onBeforeUnload(e) {
            if (tabs.some(function (t) { return t.modified; })) { e.preventDefault(); e.returnValue = ''; }
        }
        window.addEventListener('beforeunload', onBeforeUnload);

        /* Closing the editor's window with unsaved changes asks first
           (pudl:window-closing, PUDL 0.28.0): Cancel keeps the window,
           Don't save closes it, and Save all saves every changed file and
           then closes, unless a save fails. */
        var win = root.closest('.win[data-win]'), closeAgreed = false;
        function onWindowClosing(e) {
            if (e.target !== win || closeAgreed) { return; }
            var changed = tabs.filter(function (t) { return t.modified; });
            if (!changed.length) { return; }
            e.preventDefault();
            var key = win.getAttribute('data-win');
            var names = changed.map(function (t) { return t.name; });
            ask('Save changes before closing?',
                (names.length === 1 ? names[0] + ' has' : names.length + ' files have') + ' unsaved changes, which are lost if you close without saving.' +
                (names.length > 1 ? ' (' + names.join(', ') + ')' : ''), null,
                [['cancel', 'Cancel'], ['discard', 'Don\'t save'], ['save', 'Save all', true]]).then(async function (choice) {
                    if (choice === 'save') {
                        for (var i = 0; i < tabs.length; i++) {
                            if (!tabs[i].modified) { continue; }
                            activate(i);
                            if (!(await save())) { return; }
                        }
                    } else if (choice !== 'discard') { return; }
                    closeAgreed = true;
                    window.pudlWindows.close(key);
                });
        }
        if (win) { win.addEventListener('pudl:window-closing', onWindowClosing); }

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
                case 'source': {
                    var cur = current(), node = cur && F.resolve(F.home(), cur.path), src = node && F.sourceOf(node);
                    if (src) { openPath(F.displayPath(src)); }
                    break;
                }
                case 'preview': preview(); break;
                case 'explorer': {
                    if (!explorer) { break; }
                    var on = el.explorer.hidden;
                    showExplorer(on);
                    try { localStorage.setItem(EXPLORER_KEY, on ? '1' : '0'); } catch (err) { }
                    break;
                }
            }
        });
        el.wrap.addEventListener('change', function () {
            if (view) { view.dispatch({ effects: wrapComp.reconfigure(el.wrap.checked ? CM.EditorView.lineWrapping : []) }); }
        });

        /* === Start ======================================================== */

        var boot = Promise.all([loadCodeMirror(), loadSiteFs().then(function (api) { F = api; return F.load(); }), loadBrowser()]).then(async function (res) {
            if (destroyed) { return; }
            CM = res[0];
            FB = res[2];
            setupExplorer();
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
            setState: takeFile,
            destroy: function () {
                destroyed = true;
                if (unsubscribe) { unsubscribe(); }
                window.removeEventListener('beforeunload', onBeforeUnload);
                if (win) { win.removeEventListener('pudl:window-closing', onWindowClosing); }
                if (el.dialog.open) { el.dialog.close(); }
                if (explorer) { explorer.destroy(); }
                if (view) { view.destroy(); }
            },
            ready: boot
        };
    }

    window.pudlApplets.register('editor', { init: init });
})();
