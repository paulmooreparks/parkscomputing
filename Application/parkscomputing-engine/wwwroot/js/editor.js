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
            cmReady = loadScript(beside('vendor/codemirror-6.43/codemirror.js?v=2'))
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
       made, it shows on a wide screen, unless the page has a file tree of
       its own at the side (the admin desktop says so in a meta tag). */
    /* The Editor's settings are its own toolbar's Wrap lines and Explorer
       controls, which remember themselves in ~/.config/editor.json
       (js/config.js), so they follow the reader wherever ~ does. */
    var SETTINGS = { wrap: true, explorer: null, explorerWidth: null, keys: null };

    /* === Key bindings ===================================================
       The Editor's commands have names, and a key is bound to a command by
       name. These are the bindings it starts with; ~/.config/editor.json's
       "keys" adds to them and overrides them, a key set to null does
       nothing at all (which turns off CodeMirror's own binding for it), and
       a change to the file applies at once. Keys are written as CodeMirror
       writes them: Mod- is Ctrl (Cmd on a Mac), then Alt-, Shift-, and the
       key, such as "Mod-Shift-;" or "Alt-d". */
    var DEFAULT_KEYS = {
        'Mod-s': 'save', 'Mod-o': 'open',
        'Mod-;': 'insert-timestamp', 'Mod-Shift-;': 'stamp-modified'
    };

    /* Now, in local time with its offset, as ISO 8601 and RFC 3339 write
       it (2026-10-06T16:12:00+08:00), or the local date alone, or in UTC
       with no offset, which is how an HTML page's meta dates are kept and
       read (Pages/page.cshtml.cs reads them in the "s" form). */
    function two(n) { return String(Math.floor(Math.abs(n))).padStart(2, '0'); }
    function now(form) {
        var d = new Date();
        if (form === 'utc') { return d.toISOString().slice(0, 19); }
        var date = d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
        if (form === 'date') { return date; }
        var off = -d.getTimezoneOffset();
        return date + 'T' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()) +
            (off >= 0 ? '+' : '-') + two(off / 60) + ':' + two(off % 60);
    }

    /* CodeMirror refuses a key with a modifier it doesn't know, and would
       refuse it at the first keypress, so a key is checked as it is read:
       its parts are those CodeMirror accepts (@codemirror/view's keymap). */
    function validKey(key) {
        var parts = String(key).split(/-(?!$)/), last = parts.pop();
        return !!last && parts.every(function (m) { return /^(cmd|meta|m|a|alt|c|ctrl|control|s|shift|mod)$/i.test(m); });
    }

    /* A key as a menu shows it: Mod-Shift-; as Ctrl+Shift+;. */
    function keyLabel(key) {
        var mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
        var names = { mod: mac ? 'Cmd' : 'Ctrl', c: 'Ctrl', ctrl: 'Ctrl', control: 'Ctrl', a: 'Alt', alt: 'Alt', s: 'Shift', shift: 'Shift', m: mac ? 'Cmd' : 'Meta', meta: mac ? 'Cmd' : 'Meta', cmd: mac ? 'Cmd' : 'Meta' };
        return String(key).split(/-(?!$)/).map(function (part, i, all) {
            if (i === all.length - 1) { return part.length === 1 ? part.toUpperCase() : part; }
            return names[part.toLowerCase()] || part;
        }).join('+');
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
    function explorerWanted(s) {
        if (s && typeof s.explorer === 'boolean') { return s.explorer; }
        if (document.querySelector('meta[name="pc-file-sidebar"]')) { return false; }
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
            /* PUDL's splitter divides the Explorer from the work. */
            '<div class="ed-panes split" data-role="panes">' +
              /* The Explorer: the shared file browser's tree, files and all
                 (js/filebrowser.js), filled once the filesystem loads. */
              '<nav class="ed-explorer split-pane" data-role="explorer" aria-label="Files" hidden></nav>' +
              '<div class="split-handle ed-split" data-role="explorer-split" aria-label="Resize the files" data-split-min="160" data-split-max="50%" hidden></div>' +
              '<div class="ed-work split-pane">' +
                '<div class="code-surface ed-surface" data-role="surface"></div>' +
                /* The preview is the public site's own page for the draft, so
                   an article's scripts run there and never here (A11). */
                '<iframe class="ed-preview" data-role="preview" title="Preview of the unsaved page" hidden></iframe>' +
              '</div>' +
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
            explorer: q('[data-role="explorer"]'), explorerBtn: q('[data-action="explorer"]'), explorerSplit: q('[data-role="explorer-split"]')
        };
        var FB = null, explorer = null;

        var CM = null, F = null, view = null, destroyed = false, unsubscribe = null;
        var tabs = [], active = -1, untitled = 0;
        var wrapComp = null, langComp = null, lintComp = null, roComp = null, keyComp = null;
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
            return CM.EditorState.create({ doc: text, extensions: extensionsFor(tab) });
        }
        function extensionsFor(tab) {
            return [
                    CM.lineNumbers(), CM.highlightActiveLineGutter(), CM.highlightSpecialChars(),
                    CM.history(), CM.drawSelection(), CM.dropCursor(), CM.indentOnInput(),
                    CM.bracketMatching(), CM.closeBrackets(), CM.rectangularSelection(), CM.crosshairCursor(),
                    CM.highlightActiveLine(), CM.highlightSelectionMatches(),
                    /* The Editor's own bindings come first, so they win over
                       CodeMirror's for the same key. */
                    keyComp.of(keyBindings()),
                    CM.keymap.of([].concat(
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
                        if (tabs[active] === tab && (u.selectionSet || u.docChanged ||
                            CM.searchPanelOpen(u.state) !== CM.searchPanelOpen(u.startState))) { keep(); }
                    })
            ];
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
            keep();
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
            if (prev && view) { prev.state = view.state; prev.scroll = scrollAnchor(); }
            /* A preview belongs to the file it was made for. */
            if (i !== active) { hidePreview(); }
            active = i;
            var t = current();
            if (!t) { view.setState(CM.EditorState.create({ doc: '' })); renderTabs(); announce(); return; }
            view.setState(t.state);
            /* A tab kept from before the key bindings last changed takes
               the bindings as they are now. */
            view.dispatch({ effects: keyComp.reconfigure(keyBindings()) });
            /* Each tab keeps its place, and a search panel kept open from
               before a reload opens again. */
            scrollTo(t.scroll);
            if (t.openSearch) { t.openSearch = false; CM.openSearchPanel(view); }
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
            /* Focus would raise the Editor's window over one the reader has
               since brought forward, so it waits for the window to be in
               front. */
            if (inFront()) { view.focus(); }
        }
        function inFront() { return opts.ownsUrl || !root.closest('.win') || !!root.closest('.win.active'); }

        /* Opens a file by path: switches to it if it is open already. */
        async function openPath(path) {
            /* An address or kept tab from before the site moved under /site
               still finds its file. */
            path = F.upgradePath(path);
            var node = F.resolve(F.home(), path);
            if (!node) { say(path + ': no such file', true); return false; }
            if (node.children) { say(path + ' is a folder', true); return false; }
            var r = F.realOf(node), display = F.displayPath(r);
            for (var i = 0; i < tabs.length; i++) { if (tabs[i].path === display) { if (i !== active) { activate(i); } view.focus(); return true; } }
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
            /* The editor's text belongs to the tab in front. Closing another
               tab leaves it there and only renumbers. Closing the tab in
               front drops its text with it: active is cleared first, or
               activate() would keep the closed file's text in whichever tab
               slid into its place, and a save would write it there. */
            var wasActive = active;
            tabs.splice(i, 1);
            if (!tabs.length) { active = -1; newTab(); return; }
            if (i !== wasActive) {
                active = i < wasActive ? wasActive - 1 : wasActive;
                renderTabs();
                return;
            }
            active = -1;
            activate(Math.min(i, tabs.length - 1));
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
            showExplorer(explorerWanted(settings));
            markExplorer();
            explorer.onChange(keep);
        }

        /* The settings, as last read or changed, and a change arriving from
           elsewhere: another Editor, another tab, or the file edited. */
        var settings = Object.assign({}, SETTINGS), unConfig = null;
        function applySettings(s) {
            settings = Object.assign({}, SETTINGS, s);
            if (el.wrap.checked !== !!settings.wrap) {
                el.wrap.checked = !!settings.wrap;
                if (view) { view.dispatch({ effects: wrapComp.reconfigure(el.wrap.checked ? CM.EditorView.lineWrapping : []) }); }
            }
            if (explorer && typeof settings.explorer === 'boolean' && el.explorer.hidden === settings.explorer) { showExplorer(settings.explorer); }
            if (explorerSplit) { explorerSplit.set(typeof settings.explorerWidth === 'number' ? settings.explorerWidth : null); }
            if (view && keyComp) {
                view.dispatch({ effects: keyComp.reconfigure(keyBindings()) });
                if (keyProblems) { say(keyProblems, true); }
            }
        }

        /* The Explorer's width, dragged at its divider and kept with the
           other settings. */
        var explorerSplit = null;
        function setupExplorerSplit() {
            if (!window.pcSplit) { return; }
            explorerSplit = window.pcSplit.of(el.explorerSplit, function (w) { saveSetting({ explorerWidth: w }); });
            explorerSplit.set(typeof settings.explorerWidth === 'number' ? settings.explorerWidth : null);
        }
        function saveSetting(changes) {
            Object.assign(settings, changes);
            loadConfig().then(function (c) { return c.set('editor', changes); }).catch(function () { });
        }

        function showExplorer(on) {
            el.explorer.hidden = !on;
            el.explorerSplit.hidden = !on;
            if (on && window.pudlSplit) { window.pudlSplit.refresh(); }
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
            say('Making a preview…');
            var payload = JSON.stringify({ path: F.realOf(node).rel, text: view.state.doc.toString() });
            /* The token is read at each try, since signing in again (a session
               that ended while the page was open) replaces it. */
            function send() {
                var token = (document.querySelector('meta[name="request-verification-token"]') || {}).content || '';
                return fetch('/api/admin/preview', {
                    method: 'POST', credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json', RequestVerificationToken: token },
                    body: payload
                });
            }
            var r;
            try {
                r = await send();
                if (r.status === 401 && window.pcAdmin && window.pcAdmin.signIn) {
                    try { await window.pcAdmin.signIn(); r = await send(); } catch (err) { /* The 401 stands. */ }
                }
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

        /* A change made somewhere else, as the text between what the two
           versions share at their start and at their end, so the cursor
           and the place in the file stay where they were. It isn't the
           reader's edit, so undo doesn't take it back. */
        function outsideChange(state, text) {
            var old = state.doc.toString(), start = 0, end = 0;
            var max = Math.min(old.length, text.length);
            while (start < max && old.charCodeAt(start) === text.charCodeAt(start)) { start++; }
            while (end < max - start && old.charCodeAt(old.length - 1 - end) === text.charCodeAt(text.length - 1 - end)) { end++; }
            return {
                changes: { from: start, to: old.length - end, insert: text.slice(start, text.length - end) },
                annotations: CM.Transaction.addToHistory.of(false)
            };
        }

        function takeOutside(t, i, text) {
            if (i < 0 || text === t.saved) { return; }
            var edited = (i === active ? view.state.doc.toString() : t.state.doc.toString()) !== t.saved;
            if (!edited) {
                t.saved = text;
                if (i === active) { view.dispatch(outsideChange(view.state, text)); t.modified = false; }
                else { t.state = t.state.update(outsideChange(t.state, text)).state; }
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

        /* === Keeping the work through a reload ============================ */

        /* The Editor's snapshot (js/snapshot.js): each open tab with its
           unsaved text, cursor and selection, how far it is scrolled, its
           undo history and its search, and which tab is in front and whether
           the preview is showing. A reload brings all of it back. A draft
           for a file that can't be reached when the Editor starts, as a
           server file can't while signed out, waits in the snapshot until it
           can. Closing the Editor's window on purpose forgets it. */
        var snap = window.pcSnapshot ? window.pcSnapshot.join(root, takeSnapshot) : null;
        var waiting = [], restoring = false;
        function keep() { if (snap && !restoring) { snap.changed(); } }

        /* Whether a file is the one a snapshot was taken against: its
           length and an FNV-1a hash of its text. */
        function fingerprint(text) {
            var h = 0x811c9dc5;
            for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
            return text.length + ':' + (h >>> 0).toString(16);
        }

        /* Where a tab is scrolled to, as the line at the top of the view and
           how far into it, which survives a window of another size. */
        var pendingScroll = null;
        function scrollAnchor() {
            if (!view) { return null; }
            /* A place asked for and not yet reached is still the place. */
            if (pendingScroll != null) { return pendingScroll; }
            var top = view.scrollDOM.scrollTop, block = view.lineBlockAtHeight(top);
            return block ? { at: block.from, off: Math.round(top - block.top) } : null;
        }
        function scrollTo(place) {
            pendingScroll = null;
            if (!place || typeof place !== 'object' || !view) { return; }
            var at = Math.min(place.at || 0, view.state.doc.length), off = place.off || 0, tab = current();
            var asked = pendingScroll = { at: at, off: off };
            requestAnimationFrame(function () {
                /* Unless another place was asked for meanwhile, or another
                   tab came to the front. */
                if (pendingScroll !== asked) { return; }
                pendingScroll = null;
                if (current() !== tab) { return; }
                /* The line is brought into view, which measures it, and the
                   offset into it then set in the same terms it was read in. */
                view.dispatch({ effects: CM.EditorView.scrollIntoView(at, { y: 'start', yMargin: 0 }) });
                requestAnimationFrame(function () {
                    if (current() === tab && view.state.doc.length >= at) { view.scrollDOM.scrollTop = view.lineBlockAt(at).top + off; }
                });
            });
        }

        function searchOf(state) {
            var q = CM.getSearchQuery(state), open = CM.searchPanelOpen(state);
            if (!open && !q.search) { return null; }
            return { open: open, search: q.search, replace: q.replace, caseSensitive: q.caseSensitive, regexp: q.regexp, wholeWord: q.wholeWord };
        }

        var SNAPSHOT_MAX = 1500000;
        function takeSnapshot() {
            /* Until what was kept is all back, it is still the whole of it. */
            if (restoring) { return snap.kept; }
            if (!view || !CM) { return null; }
            var front = current();
            if (front) { front.state = view.state; front.scroll = scrollAnchor(); }
            var list = [], frontAt = -1;
            tabs.forEach(function (t) {
                var st = t.state, text = st.doc.toString();
                if (!t.path && !t.modified) { return; }
                if (t === front) { frontAt = list.length; }
                var json = st.toJSON({ history: CM.historyField });
                list.push({
                    path: t.path, name: t.name, lang: t.lang, mtime: t.mtime, fresh: !!t.fresh,
                    draft: t.modified ? text : null, sum: t.modified ? null : fingerprint(text),
                    selection: json.selection, history: json.history, scroll: t.scroll == null ? null : t.scroll,
                    search: searchOf(st)
                });
            });
            var out = { tabs: list, front: frontAt, waiting: waiting, preview: !el.preview.hidden, explorer: explorer ? explorer.snapshot() : null };
            /* Undo history is the first thing let go when the whole would be
               too large for the browser to keep. */
            if (JSON.stringify(out).length > SNAPSHOT_MAX) { list.forEach(function (k) { k.history = null; }); }
            return out;
        }

        /* A tab's kept state on the text it now has. Its cursor and undo
           history only fit the text they were taken from: the draft, or for
           a tab without changes, the file as it was then. A file changed
           since keeps its cursor near where it was, without its history. */
        function applyKept(t, k) {
            var text = typeof k.draft === 'string' ? k.draft : t.saved;
            var exact = typeof k.draft === 'string' || (k.sum != null && k.sum === fingerprint(t.saved));
            var state = null;
            if (exact && k.selection) {
                try {
                    var json = { doc: text, selection: k.selection };
                    if (k.history) { json.history = k.history; }
                    state = CM.EditorState.fromJSON(json, { extensions: extensionsFor(t) }, k.history ? { history: CM.historyField } : undefined);
                } catch (err) { state = null; }
            }
            if (!state) {
                state = stateFor(t, text);
                var head = k.selection && k.selection.ranges && k.selection.ranges[k.selection.main || 0];
                if (head) {
                    var at = Math.min(head.head, text.length);
                    state = state.update({ selection: { anchor: at } }).state;
                }
            }
            if (k.search && k.search.search) {
                state = state.update({ effects: CM.setSearchQuery.of(new CM.SearchQuery(k.search)) }).state;
            }
            t.state = state;
            t.scroll = k.scroll;
            t.openSearch = !!(k.search && k.search.open);
            t.modified = text !== t.saved;
            /* The tab in front takes its new state through activate(), which
               would otherwise keep the old one. */
            var i = tabs.indexOf(t);
            if (i === active) { active = -1; activate(i); }
        }

        /* The snapshot kept before the reload, or the Editor's own record
           from before snapshots, which it kept the same way. */
        function readKept() {
            if (snap && snap.kept && Array.isArray(snap.kept.tabs)) { return snap.kept; }
            try {
                var old = JSON.parse(sessionStorage.getItem('pc-editor-work') || 'null');
                sessionStorage.removeItem('pc-editor-work');
                return old && Array.isArray(old.tabs) ? old : null;
            } catch (err) { return null; }
        }

        /* Reopens the kept tabs as they were; resolves to what to tell the
           reader, or null when there was nothing kept. */
        async function restoreKept() {
            var kept = readKept();
            if (!kept) { return null; }
            var back = [], all = (kept.waiting || []).concat(kept.tabs), frontTab = null;
            restoring = true;
            try { frontTab = await reopen(all, back, kept.tabs[kept.front] || null); } finally { restoring = false; }
            if (frontTab) { var fi = tabs.indexOf(frontTab); if (fi >= 0) { activate(fi); } }
            var msg = back.length ? 'Your unsaved changes to ' + back.join(', ') + ' are back.' : '';
            if (waiting.length) {
                msg += (msg ? ' ' : '') + 'Unsaved changes to ' + waiting.map(function (k) { return k.path; }).join(', ') +
                    ' are kept until the file can be reached again; you may need to sign in, then reload.';
            }
            if (explorer && kept.explorer) { explorer.restore(kept.explorer); }
            keep();
            return { text: msg, error: waiting.length > 0, preview: !!kept.preview };
        }
        async function reopen(all, back, frontKept) {
            var frontTab = null;
            for (var i = 0; i < all.length; i++) {
                var k = all[i], t = null;
                if (!k || typeof k !== 'object') { continue; }
                if (!k.path) {
                    if (typeof k.draft !== 'string') { continue; }
                    var n = /^untitled-(\d+)$/.exec(k.name || '');
                    if (n) { untitled = Math.max(untitled, +n[1]); }
                    addTab({ path: null, name: k.name || 'untitled', lang: k.lang || 'text', readOnly: false }, '');
                    t = current();
                } else {
                    var node = F.resolve(F.home(), F.upgradePath(k.path));
                    if (!node && k.fresh) {
                        newNamed(k.path);
                        t = current() && current().path === k.path ? current() : null;
                    } else if (node && await openPath(k.path)) {
                        t = current();
                        /* The file was saved somewhere else since: the
                           reader's text stays, and saving would replace
                           that version. */
                        if (typeof k.draft === 'string' && k.mtime != null && t.mtime != null && k.mtime !== t.mtime) { t.external = true; }
                    } else if (typeof k.draft === 'string') {
                        waiting.push(k);
                    }
                }
                if (!t) { continue; }
                applyKept(t, k);
                if (t.modified) { back.push(t.name); }
                if (k === frontKept) { frontTab = t; }
            }
            renderTabs();
            return frontTab;
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
        /* View on the site, in the window view, opens a page of this site as
           a window rather than a browser tab, and one already open comes to
           the front with its content fetched again, so it shows what was
           just saved. Anywhere else, or for an address that is not a page
           of this site, the link opens a new tab as the browser chooses. */
        function viewOnSite(e) {
            var link = e.target.closest('[data-role="view"]');
            if (!link || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) { return false; }
            if (!window.pudlWindows || !document.querySelector('[data-win-layer]')) { return false; }
            var url = new URL(link.href, location.href);
            var page = url.origin === location.origin && /^\/page\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
            if (!page) { return false; }
            e.preventDefault();
            var key = page[1], win = document.querySelector('.win[data-win="' + key + '"]');
            if (win && window.pudlWindows.state().open.indexOf(key) >= 0) {
                window.pudlWindows.raise(key);
                if (window.pcLoadWindow) { window.pcLoadWindow(win, '', true).catch(function () { }); }
            } else {
                window.pudlWindows.open(key);
            }
            return true;
        }

        root.addEventListener('click', function (e) {
            if (viewOnSite(e)) { return; }
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
                    saveSetting({ explorer: on });
                    break;
                }
            }
        });
        /* === Commands and their keys ===================================== */

        /* Every command a key can be bound to, by the name ~/.config/editor.json
           uses for it. */
        var COMMANDS = {
            'new': newTab,
            'open': openDialog,
            'save': save,
            'save-as': saveAs,
            'close-document': function () { if (current()) { closeTab(active); } },
            'undo': function () { CM.undo(view); },
            'redo': function () { CM.redo(view); },
            'find': function () { CM.openSearchPanel(view); },
            'go-to-line': goToLine,
            'toggle-files': function () { el.explorerBtn.click(); },
            'toggle-wrap': function () { el.wrap.click(); },
            'preview': preview,
            'insert-timestamp': function () { insertText(now()); },
            'insert-date': function () { insertText(now('date')); },
            'stamp-modified': stampModified,
            'key-bindings': editKeys
        };

        function goToLine() {
            var binding = CM.searchKeymap.find(function (key) { return key.key === 'Mod-Alt-g'; });
            if (binding) { binding.run(view); }
        }

        /* The bindings in force: the Editor's own, with the settings file's
           over them. A key set to null runs nothing and goes no further. */
        var keyProblems = '';
        function effectiveKeys() {
            var own = settings.keys && typeof settings.keys === 'object' && !Array.isArray(settings.keys) ? settings.keys : {};
            return Object.assign({}, DEFAULT_KEYS, own);
        }
        function keyBindings() {
            var map = effectiveKeys(), list = [], problems = [];
            Object.keys(map).forEach(function (key) {
                var name = map[key];
                if (!validKey(key)) { problems.push('"' + key + '" isn\'t a key CodeMirror knows'); return; }
                if (name === null) { list.push({ key: key, preventDefault: true, run: function () { return true; } }); return; }
                var run = COMMANDS[name];
                if (!run) { problems.push('there is no command called "' + name + '"'); return; }
                list.push({ key: key, preventDefault: true, run: function () { run(); return true; } });
            });
            keyProblems = problems.length ? 'In the key bindings, ' + problems.join(', and ') + '.' : '';
            return CM.keymap.of(list);
        }

        /* The key for a command, as a menu shows it. */
        function shortcutFor(name) {
            var map = effectiveKeys();
            var key = Object.keys(map).find(function (k) { return map[k] === name && validKey(k); });
            return key ? keyLabel(key) : undefined;
        }

        function insertText(text) {
            var t = current();
            if (!t || t.readOnly) { say('This file is read-only, so nothing can be added to it.', true); return; }
            view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true, userEvent: 'input' });
            view.focus();
        }

        /* Sets the page's last-modified date to now: the lastModified line
           of a Markdown page's front matter, in local time with its offset,
           or an HTML page's last-modified meta tag, in UTC as those are
           kept. Either is added if the page has none. */
        function stampModified() {
            var t = current();
            if (!t || t.readOnly) { say('This file is read-only, so its date can\'t be changed.', true); return; }
            var doc = view.state.doc.toString(), eol = /\r\n/.test(doc) ? '\r\n' : '\n', change, stamp;
            if (t.lang === 'markdown') {
                var fm = /^---[ \t]*\r?\n([\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(doc);
                if (!fm) { say('This page has no front matter (the lines between --- at its top), so there is no last-modified date to set.', true); return; }
                stamp = now();
                var body = fm[1] || '', from = fm[0].indexOf('\n') + 1;
                var line = /^lastmodified[ \t]*:.*$/im.exec(body);
                if (line) {
                    change = { from: from + line.index, to: from + line.index + line[0].length, insert: line[0].replace(/:.*$/, ': ' + stamp) };
                } else {
                    var date = /^date[ \t]*:.*(?:\r?\n|$)/im.exec(body);
                    change = { from: from + (date ? date.index + date[0].length : body.length), insert: 'lastModified: ' + stamp + eol };
                }
            } else if (/\.html?$/i.test(t.path || t.name)) {
                stamp = now('utc');
                var tag = '<meta http-equiv="last-modified" content="' + stamp + '" />';
                var meta = /<meta\s+http-equiv\s*=\s*["']last-modified["'][^>]*>/i.exec(doc);
                if (meta) {
                    change = { from: meta.index, to: meta.index + meta[0].length, insert: tag };
                } else {
                    var head = /<\/head\s*>/i.exec(doc);
                    if (!head) { say('This page has no <head>, so there is nowhere to put its last-modified date.', true); return; }
                    var indent = /[ \t]*$/.exec(doc.slice(0, head.index))[0];
                    change = { from: head.index, insert: tag + eol + indent };
                }
                stamp += ' UTC';
            } else {
                say('Update last-modified works in a Markdown or HTML page.', true);
                return;
            }
            view.dispatch({ changes: change, userEvent: 'input' });
            view.focus();
            say('Last modified ' + stamp + '.');
        }

        /* Opens the settings file at its key bindings, writing the Editor's
           own bindings into it first if it has none, so there is something
           to change. */
        async function editKeys() {
            if (!settings.keys) {
                var err = await loadConfig().then(function (c) { return c.set('editor', { keys: Object.assign({}, DEFAULT_KEYS) }); })
                    .catch(function (e) { return e.message; });
                if (err) { say('The key bindings could not be written: ' + err, true); return; }
            }
            if (await openPath('~/.config/editor.json')) {
                say('Under "keys", each key runs the command after it, and a key set to null does nothing. Saved changes apply at once. The commands are ' +
                    Object.keys(COMMANDS).join(', ') + '.');
            }
        }

        function menus() {
            var ready = !!(CM && view), tab = current();
            /* Each item shows the key bound to its command, or failing one,
               CodeMirror's own key for it. */
            function keyed(item, name, builtIn) {
                var key = ready ? shortcutFor(name) || (builtIn && keyLabel(builtIn)) : null;
                if (key) { item.shortcut = key; }
                return item;
            }
            function action(name, label, builtIn) { return keyed(window.pcAppletAction(root, '[data-action="' + name + '"]', label), name, builtIn); }
            function command(name, label, disabled, builtIn) {
                return keyed({ label: label, disabled: !ready || !!disabled, run: function () { COMMANDS[name](); } }, name, builtIn);
            }
            var editable = !!(tab && !tab.readOnly);
            var file = [action('new', 'New document'), action('open', 'Open…'),
                action('save', 'Save'), action('save-as', 'Save as…'), '-',
                command('close-document', 'Close document', !tab)];
            var viewItems = [
                keyed({ label: 'Show the files', disabled: !ready, checked: !el.explorer.hidden,
                    run: function () { el.explorerBtn.click(); } }, 'toggle-files'),
                keyed({ label: 'Wrap lines', disabled: !ready, checked: el.wrap.checked,
                    run: function () { el.wrap.click(); } }, 'toggle-wrap')
            ];
            var previewButton = q('[data-action="preview"]');
            if (previewButton && !previewButton.hidden) { viewItems.push(action('preview', 'Preview document')); }
            return { titles: [
                { label: 'Editor', items: window.pcAppletIdentity(root) },
                { id: 'file', label: 'File', items: file },
                { id: 'edit', label: 'Edit', items: [action('undo', 'Undo', 'Mod-z'), action('redo', 'Redo', 'Mod-y'), '-',
                    action('find', 'Find and replace…', 'Mod-f'), '-',
                    command('insert-timestamp', 'Insert date and time', !editable),
                    command('insert-date', 'Insert date', !editable),
                    command('stamp-modified', 'Update last-modified', !editable), '-',
                    command('key-bindings', 'Key bindings…')] }
            ], into: { view: viewItems, go: [command('go-to-line', 'Go to line…', false, 'Mod-Alt-g')] } };
        }

        el.wrap.addEventListener('change', function () {
            if (view) { view.dispatch({ effects: wrapComp.reconfigure(el.wrap.checked ? CM.EditorView.lineWrapping : []) }); }
            saveSetting({ wrap: el.wrap.checked });
        });

        /* === Start ======================================================== */

        var boot = Promise.all([loadCodeMirror(), loadSiteFs().then(function (api) { F = api; return F.load(); }), loadBrowser()]).then(async function (res) {
            if (destroyed) { return; }
            CM = res[0];
            FB = res[2];
            /* Settings that can't be read leave the defaults in place. */
            var config = await loadConfig().catch(function () { return null; });
            if (config) {
                settings = Object.assign({}, SETTINGS, await config.load('editor', SETTINGS).catch(function () { return SETTINGS; }));
                unConfig = config.onChange('editor', applySettings);
            }
            if (destroyed) { return; }
            el.wrap.checked = !!settings.wrap;
            setupExplorer();
            setupExplorerSplit();
            wrapComp = new CM.Compartment(); langComp = new CM.Compartment(); lintComp = new CM.Compartment(); roComp = new CM.Compartment();
            keyComp = new CM.Compartment();
            view = new CM.EditorView({ parent: el.surface });
            view.scrollDOM.addEventListener('scroll', keep, { passive: true });
            unsubscribe = F.onChange(onFsChange);
            var restored = await restoreKept();
            /* The file the address or window asks for comes to the front,
               which after a reload is the one that was in front. */
            var opened = startFile ? await openPath(startFile) : false;
            if (!opened) {
                if (startFile && !F.resolve(F.home(), startFile)) { newNamed(startFile); } else if (!tabs.length) { newTab(); }
            }
            if (restored && restored.text) { say(restored.text, restored.error); }
            /* A preview showing before the reload is made again, which asks
               the server, so it is not waited for. */
            if (restored && restored.preview && !q('[data-action="preview"]').hidden) { preview(); }
            /* The keyboard goes back where it was: into the text, unless the
               search panel had it, which opening it did. */
            if (snap && snap.focused) { if (!view.dom.contains(document.activeElement)) { view.focus(); } }
            else if (!(opts.ownsUrl || root.closest('.win.active'))) { view.contentDOM.blur(); }
        }).catch(function (err) {
            if (destroyed) { return; }
            root.innerHTML = '<p class="ed-failed">The editor could not start: ' + esc(err.message) + '.</p>';
        });

        return {
            state: function () { return stateString() || null; },
            setState: takeFile,
            menus: menus,
            destroy: function () {
                destroyed = true;
                if (snap) { snap.leave(); }
                if (unsubscribe) { unsubscribe(); }
                if (unConfig) { unConfig(); }
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
