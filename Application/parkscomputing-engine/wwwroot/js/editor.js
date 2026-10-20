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
            cmReady = loadScript(beside('vendor/codemirror-6.43/codemirror.js?v=3'))
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
            /* The toolbar is PUDL's, drawn here from the Editor's command
               table and toolbars() (PUDL 0.68.0), folding its groups as the
               window narrows. */
            '<div class="ed-toolbar-slot" data-toolbar-slot></div>' +
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
              '<span class="ed-readonly" data-role="readonly" hidden><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="7" width="10" height="7.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>Read-only</span>' +
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
            '</dialog>' +
            /* The figure dialog: a {{figure}} shortcode's settings as a form,
               for a new figure from the Insert menu and for one pressed in
               the visual view (Architecture/wysiwyg-editor-design.md). */
            '<dialog class="dialog ed-dialog ed-figure" data-role="figure" aria-labelledby="ed-fig-title-' + n + '">' +
              '<form method="dialog" data-role="figure-form">' +
                '<h3 class="dialog-title" id="ed-fig-title-' + n + '" data-role="figure-title">Figure</h3>' +
                '<div class="dialog-body ed-figure-fields">' +
                  '<label class="form-label" for="ed-fig-src-' + n + '">Picture</label>' +
                  '<div class="ed-figure-src"><input class="form-input" id="ed-fig-src-' + n + '" data-role="figure-src" autocomplete="off" spellcheck="false" placeholder="/images/picture.png" required />' +
                  '<button type="button" class="btn" data-action="figure-browse">Browse…</button></div>' +
                  '<label class="form-label" for="ed-fig-alt-' + n + '">What it shows</label>' +
                  '<input class="form-input" id="ed-fig-alt-' + n + '" data-role="figure-alt" autocomplete="off" />' +
                  '<p class="form-help">For someone who can\'t see it. Leave it empty for a picture that only decorates.</p>' +
                  '<label class="form-label" for="ed-fig-width-' + n + '">Largest width</label>' +
                  '<input class="form-input" id="ed-fig-width-' + n + '" data-role="figure-width" autocomplete="off" spellcheck="false" placeholder="80%" />' +
                  '<p class="form-help">Such as 80% or 600px; the column\'s width if empty.</p>' +
                  '<label class="form-label" for="ed-fig-caption-' + n + '">Caption</label>' +
                  '<input class="form-input" id="ed-fig-caption-' + n + '" data-role="figure-caption" autocomplete="off" />' +
                  '<p class="form-help">Under the picture, in Markdown.</p>' +
                  '<p class="form-error" data-role="figure-error" hidden></p>' +
                '</div>' +
                '<div class="dialog-actions">' +
                  '<button type="button" class="btn" data-action="figure-remove" hidden>Remove</button>' +
                  '<button type="button" class="btn" data-action="figure-cancel">Cancel</button>' +
                  '<button type="submit" class="btn btn-primary" data-role="figure-ok">Insert</button>' +
                '</div>' +
              '</form>' +
            '</dialog>';

        var q = function (sel) { return root.querySelector(sel); };
        var el = {
            tabs: q('[data-role="tabs"]'), surface: q('[data-role="surface"]'), where: q('[data-role="where"]'),
            panes: q('[data-role="panes"]'), preview: q('[data-role="preview"]'),
            lang: q('[data-role="lang"]'), pos: q('[data-role="pos"]'), message: q('[data-role="message"]'),
            readonly: q('[data-role="readonly"]'),
            dialog: q('[data-role="dialog"]'), dlgForm: q('[data-role="dialog-form"]'), dlgTitle: q('[data-role="dialog-title"]'),
            dlgText: q('[data-role="dialog-text"]'), dlgInput: q('[data-role="dialog-input"]'), dlgError: q('[data-role="dialog-error"]'),
            dlgActions: q('[data-role="dialog-actions"]'),
            explorer: q('[data-role="explorer"]'), explorerSplit: q('[data-role="explorer-split"]'),
            figure: q('[data-role="figure"]'), figForm: q('[data-role="figure-form"]'), figTitle: q('[data-role="figure-title"]'),
            figSrc: q('[data-role="figure-src"]'), figAlt: q('[data-role="figure-alt"]'), figWidth: q('[data-role="figure-width"]'),
            figCaption: q('[data-role="figure-caption"]'), figError: q('[data-role="figure-error"]'), figOk: q('[data-role="figure-ok"]'),
            figRemove: q('[data-action="figure-remove"]'), figCancel: q('[data-action="figure-cancel"]'), figBrowse: q('[data-action="figure-browse"]')
        };
        var FB = null, explorer = null;
        /* What the toolbar's commands show (the command table below): lines
           wrapped, the Markdown views offered, the formatting offered, a
           site page's source to open, and the file's address on the site. */
        var wrapOn = true, viewsOffered = false, formatOffered = false, sourceOffered = false, siteUrl = null;
        function commandsChanged() { if (opts.commandsChanged) { opts.commandsChanged(); } }

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

        function languageFor(path) {
            var p = String(path || '');
            if (/\.(md|markdown)$/i.test(p)) { return 'markdown'; }
            if (/\.json$/i.test(p)) { return 'json'; }
            if (/^~\/bin\/|^\/bin\/|\.sh$/i.test(p)) { return 'script'; }
            return 'text';
        }
        var LANG_NAMES = { markdown: 'Markdown', json: 'JSON', script: 'Script', text: 'Plain text' };
        /* === Shortcodes in the text =========================================
           A {{shortcode}} is marked as one, its name and its arguments in
           their own colours; {{ offers the shortcodes' names and, inside a
           call, its parameters; and the pointer over one says what it is
           and takes. All from the server's table (/api/admin/editor/shortcodes),
           which the Insert menu reads too. */
        var SHORTCODE = /\{\{\/?[a-z][a-z0-9-]*(?::(?:[^}]|\}(?!\}))*)?\}\}/g;
        var shortcodeHighlight = null, shortcodeHover = null;
        /* Built when first asked for, since CodeMirror loads only when the
           first text is shown. */
        function shortcodeHighlighting() {
            if (shortcodeHighlight) { return shortcodeHighlight; }
            var marks = new CM.MatchDecorator({
                regexp: SHORTCODE,
                decorate: function (add, from, to, m) {
                    var head = /^\{\{\/?[a-z][a-z0-9-]*/.exec(m[0])[0].length;
                    add(from, from + head, CM.Decoration.mark({ class: 'cm-shortcode cm-shortcode-name' }));
                    if (to - 2 > from + head) { add(from + head, to - 2, CM.Decoration.mark({ class: 'cm-shortcode cm-shortcode-args' })); }
                    add(to - 2, to, CM.Decoration.mark({ class: 'cm-shortcode cm-shortcode-name' }));
                }
            });
            shortcodeHighlight = CM.ViewPlugin.define(function (v) {
                return { deco: marks.createDeco(v), update: function (u) { this.deco = marks.updateDeco(u, this.deco); } };
            }, { decorations: function (p) { return p.deco; } });
            return shortcodeHighlight;
        }
        function shortcodeByName(name) { return (shortcodes || []).find(function (s) { return s.name === name; }) || null; }
        function shortcodeComplete(ctx) {
            var name = ctx.matchBefore(/\{\{\/?[a-z0-9-]*$/);
            if (name) {
                var closing = name.text.indexOf('{{/') === 0;
                return loadShortcodes().then(function (list) {
                    return {
                        from: name.from + (closing ? 3 : 2),
                        validFor: /^[a-z0-9-]*$/,
                        options: list.filter(function (s) { return !closing || s.kind === 'container'; }).map(function (s) {
                            /* The braces close themselves as {{ is typed (closeBrackets), so only the name goes in, with a colon where arguments follow. */
                            return { label: s.name, type: 'keyword', detail: s.title, info: s.description + (s.example ? '\n\n' + s.example : ''),
                                apply: !closing && s.params.length ? s.name + ':' : s.name };
                        })
                    };
                });
            }
            var inside = ctx.matchBefore(/\{\{([a-z][a-z0-9-]*)(?::[^}]*)?[\s:]([a-z0-9-]*)$/);
            if (!inside) { return null; }
            var m = /\{\{([a-z][a-z0-9-]*)/.exec(inside.text), word = /[a-z0-9-]*$/.exec(inside.text)[0];
            return loadShortcodes().then(function () {
                var s = shortcodeByName(m[1]);
                if (!s || !s.params.length) { return null; }
                return {
                    from: ctx.pos - word.length,
                    validFor: /^[a-z0-9-]*$/,
                    options: s.params.map(function (p) { return { label: p.name, type: 'property', detail: p.required ? 'needed' : '', info: p.description, apply: p.name + '=' }; })
                };
            });
        }
        function shortcodeHovering() {
            if (shortcodeHover) { return shortcodeHover; }
            shortcodeHover = CM.hoverTooltip(function (v, pos) {
            var line = v.state.doc.lineAt(pos), text = line.text, m;
            SHORTCODE.lastIndex = 0;
            while ((m = SHORTCODE.exec(text))) {
                var from = line.from + m.index, to = from + m[0].length;
                if (pos < from || pos > to) { continue; }
                var name = /^\{\{\/?([a-z][a-z0-9-]*)/.exec(m[0])[1], s = shortcodeByName(name);
                if (!s) { loadShortcodes(); return null; }
                return { pos: from, end: to, above: true, create: function () {
                    var dom = document.createElement('div');
                    dom.className = 'ed-sc-tip';
                    dom.innerHTML = '<p class="ed-sc-tip-title"><strong>' + esc(s.title) + '</strong> <code>{{' + esc(s.name) + '}}</code></p><p>' + esc(s.description) + '</p>' +
                        (s.params.length ? '<dl>' + s.params.map(function (p) { return '<dt><code>' + esc(p.name) + '</code>' + (p.required ? ' (needed)' : '') + '</dt><dd>' + esc(p.description) + '</dd>'; }).join('') + '</dl>' : '');
                    return { dom: dom };
                } };
            }
            return null;
            }, { hoverTime: 350 });
            return shortcodeHover;
        }
        function shortcodeExtensions() {
            return [shortcodeHighlighting(), CM.autocompletion({ override: [shortcodeComplete], activateOnTyping: true, icons: false }), shortcodeHovering()];
        }

        function langExtension(lang) {
            if (lang === 'markdown') { return [CM.markdown(), shortcodeExtensions()]; }
            if (lang === 'json') { return CM.json(); }
            if (lang === 'script') { return CM.StreamLanguage.define(CM.shell); }
            return [];
        }

        /* JSON is checked as it is typed. */
        function lintExtension(tab) {
            if (tab.lang !== 'json' || tab.readOnly) { return []; }
            return [CM.linter(CM.jsonParseLinter()), CM.lintGutter()];
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
                    wrapComp.of(wrapOn ? CM.EditorView.lineWrapping : []),
                    langComp.of(langExtension(tab.lang)),
                    lintComp.of(lintExtension(tab)),
                    roComp.of([CM.EditorState.readOnly.of(!!tab.readOnly), CM.EditorView.editable.of(!tab.readOnly)]),
                    CM.EditorView.contentAttributes.of({ 'aria-label': 'Text of ' + tab.name }),
                    CM.EditorView.updateListener.of(function (u) {
                        if (u.docChanged && tabs[active] === tab) { markModified(tab); }
                        /* In Split, the page follows the text. */
                        if (u.docChanged && tabs[active] === tab && visual.api && !visual.fromVisual) { reloadVisual(articleNode()); }
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
            showFormat(viewMode);
            el.readonly.hidden = !(t && t.readOnly);
            var node = t && t.path && F ? F.resolve(F.home(), t.path) : null;
            sourceOffered = !!(F && F.mounted && node && t.readOnly && F.sourceOf(node));
            var page = !!(F && F.mounted && node && previewable(node));
            viewsOffered = page && /\.md$/i.test(F.realOf(node).rel);
            siteUrl = node && F.mounted ? F.publicUrl(node) : null;
            commandsChanged();
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
            var prev = current(), switching = i !== active;
            if (prev && view) { prev.state = view.state; prev.scroll = scrollAnchor(); }
            /* Each tab keeps its own view. The page belongs to the file it
               was made for, so the one coming to the front makes its own. */
            if (switching) {
                if (prev) { prev.view = viewMode; }
                if (viewMode !== 'text') { setView('text'); }
            }
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
            if (switching && t.view && t.view !== 'text' && canEditVisually()) { setView(t.view); }
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
        /* With strict, a file that can't be opened throws, for the Open
           dialog to show; otherwise the status line says why. */
        async function openPath(path, strict) {
            function fail(msg) { if (strict) { throw new Error(msg); } say(msg, true); return false; }
            /* An address or kept tab from before the site moved under /site
               still finds its file. */
            path = F.upgradePath(path);
            var node = F.resolve(F.home(), path);
            if (!node) { return fail(path + ': no such file'); }
            if (node.children) { return fail(path + ' is a folder'); }
            var r = F.realOf(node), display = F.displayPath(r);
            for (var i = 0; i < tabs.length; i++) { if (tabs[i].path === display) { if (i !== active) { activate(i); } view.focus(); return true; } }
            if (!F.isText(r)) { return fail(display + ' isn\'t a text file, so the editor can\'t open it.'); }
            var text;
            try { text = await F.read(r); } catch (err) { return fail(err.message); }
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

        /* With strict, a write that fails throws, for the Save as dialog to
           show; otherwise the status line says why. */
        async function writeTo(t, path, strict) {
            var text = view.state.doc.toString();
            say('Saving…');
            var res = await F.write(F.home(), path, text, false);
            if (res.error) {
                if (strict) { say(''); throw new Error('Not saved: ' + res.error); }
                say('Not saved: ' + res.error, true);
                return false;
            }
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
            /* The dialog stays open while the file is written, and says
               there why it couldn't be. */
            var res = await FB.pick(F, {
                mode: 'save', title: t.readOnly ? 'Save a copy' : 'Save as', host: root,
                start: startDir, name: name, current: t.readOnly ? null : t.path, computer: true,
                commit: function (c) { return c.download ? true : writeTo(t, c.path, true); }
            });
            if (!res) { return false; }
            if (res.download) {
                download(res.download, new Blob([view.state.doc.toString()], { type: 'text/plain' }));
                say('Downloaded ' + res.download + '. The tab still holds your text.');
                return false;
            }
            return true;
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

        /* === Shortcodes as forms ========================================== */

        /* A shortcode's call taken apart: {{name:positional key=value
           key="a value"}}, with \" inside quotes, as the server reads it
           (Pages/Services/Shortcodes.cs). */
        function parseShortcode(src) {
            var m = /^\{\{(\/?)([a-z][a-z0-9-]*)(?::([\s\S]*?))?\}\}$/.exec((src || '').trim());
            if (!m) { return null; }
            var out = { name: m[2], positional: [], named: {} }, s = m[3] || '', i = 0;
            while (i < s.length) {
                while (i < s.length && /\s/.test(s[i])) { i++; }
                if (i >= s.length) { break; }
                var key = null, start = i;
                while (i < s.length && /[A-Za-z0-9_-]/.test(s[i])) { i++; }
                if (s[i] === '=' && i > start) { key = s.slice(start, i); i++; } else { i = start; }
                var value = '';
                if (s[i] === '"') {
                    i++;
                    while (i < s.length && s[i] !== '"') { if (s[i] === '\\' && i + 1 < s.length) { i++; } value += s[i]; i++; }
                    i++;
                } else {
                    while (i < s.length && !/\s/.test(s[i])) { value += s[i]; i++; }
                }
                if (key === null) { out.positional.push(value); } else { out.named[key] = value; }
            }
            return out;
        }
        function quoteArg(v) { return /[\s"]/.test(v) || v === '' ? '"' + v.replace(/(["\\])/g, '\\$1') + '"' : v; }
        function buildFigure(f) {
            var parts = ['{{figure:' + quoteArg(f.src), 'alt=' + quoteArg(f.alt || '')];
            if (f.width) { parts.push('width=' + quoteArg(f.width)); }
            if (f.caption) { parts.push('caption=' + quoteArg(f.caption)); }
            return parts.join(' ') + '}}';
        }

        /* The figure dialog: a promise of the {{figure}} shortcode to write,
           '' to remove the figure, or null for no change. existing is the
           shortcode being changed, or null for a new one. */
        function figureDialog(existing) {
            var parsed = existing ? parseShortcode(existing) : null;
            el.figTitle.textContent = parsed ? 'Change the figure' : 'Insert a figure';
            el.figOk.textContent = parsed ? 'Change' : 'Insert';
            el.figRemove.hidden = !parsed;
            el.figSrc.value = parsed ? (parsed.named.src || parsed.positional[0] || '') : '';
            el.figAlt.value = parsed ? (parsed.named.alt || '') : '';
            el.figWidth.value = parsed ? (parsed.named.width || '') : '';
            el.figCaption.value = parsed ? (parsed.named.caption || '') : '';
            el.figError.hidden = true;
            return new Promise(function (done) {
                var finished = false;
                function finish(v) { if (finished) { return; } finished = true; cleanup(); if (el.figure.open) { el.figure.close(); } done(v); }
                function onSubmit(e) {
                    e.preventDefault();
                    var src = el.figSrc.value.trim(), width = el.figWidth.value.trim();
                    if (!src) { el.figError.textContent = 'The picture needs an address, such as /images/picture.png.'; el.figError.hidden = false; el.figSrc.focus(); return; }
                    if (width && !/^\d+(\.\d+)?(%|px|rem|em|ch)$/.test(width)) { el.figError.textContent = 'The width is a number with %, px, rem, em or ch, such as 80%.'; el.figError.hidden = false; el.figWidth.focus(); return; }
                    finish(buildFigure({ src: src, alt: el.figAlt.value.trim(), width: width, caption: el.figCaption.value.trim() }));
                }
                function onCancel() { finish(null); }
                function onRemove() { finish(''); }
                async function onBrowse() {
                    /* The standard Open dialog, for a picture on the site. */
                    var res = await FB.pick(F, {
                        mode: 'open', title: 'Choose a picture', host: root,
                        start: F.resolve(null, '/wwwroot/images') ? '/wwwroot/images' : '~',
                        check: function (r) { return /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(r.name) ? null : r.name + ' isn\'t a picture.'; },
                        commit: function (c) {
                            var node = c.path ? F.resolve(null, c.path) : null;
                            if (!node) { return 'Choose a picture on the site.'; }
                            var url = F.publicUrl(node);
                            el.figSrc.value = url ? new URL(url).pathname : c.path;
                            return true;
                        }
                    });
                    if (res) { el.figAlt.focus(); }
                }
                function onClose() { finish(null); }
                function cleanup() {
                    el.figForm.removeEventListener('submit', onSubmit);
                    el.figCancel.removeEventListener('click', onCancel);
                    el.figRemove.removeEventListener('click', onRemove);
                    el.figBrowse.removeEventListener('click', onBrowse);
                    el.figure.removeEventListener('close', onClose);
                }
                el.figForm.addEventListener('submit', onSubmit);
                el.figCancel.addEventListener('click', onCancel);
                el.figRemove.addEventListener('click', onRemove);
                el.figBrowse.addEventListener('click', onBrowse);
                el.figure.addEventListener('close', onClose);
                el.figure.showModal();
                (parsed ? el.figCaption : el.figSrc).focus();
            });
        }

        async function openDialog() {
            var t = current(), node = t && t.path ? F.resolve(F.home(), t.path) : null;
            /* It opens beside the file in front, or in ~. */
            var res = await FB.pick(F, {
                mode: 'open', title: 'Open', host: root, computer: true,
                start: node ? F.displayPath(F.realOf(node).parent) : '~',
                check: function (r) { return F.isText(r) ? null : r.name + ' isn\'t a text file, so the editor can\'t open it.'; },
                /* The dialog stays open while the file is read, and says
                   there why it couldn't be. */
                commit: function (c) { return c.file ? openFromComputer(c.file, true) : openPath(c.path, true); }
            });
        }

        /* A file from the reader's computer opens as a new tab that belongs
           nowhere yet, so saving it asks where. */
        var COMPUTER_MAX = 5 * 1024 * 1024;
        async function openFromComputer(file, strict) {
            function fail(msg) { if (strict) { throw new Error(msg); } say(msg, true); }
            if (file.size > COMPUTER_MAX) { return fail(file.name + ' is larger than 5 MB, too large to edit here.'); }
            var text = await file.text();
            if (text.indexOf('\0') >= 0) { return fail(file.name + ' isn\'t a text file, so the editor can\'t open it.'); }
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
            if (wrapOn !== !!settings.wrap) { setWrap(!!settings.wrap, false); }
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
            commandsChanged();
        }
        function toggleExplorer() {
            if (!explorer) { return; }
            var on = el.explorer.hidden;
            showExplorer(on);
            saveSetting({ explorer: on });
        }
        /* Wrap lines, as the toolbar, the View menu or a key switches it,
           kept with the settings when the reader changes it. */
        function setWrap(on, keepIt) {
            wrapOn = !!on;
            if (view) { view.dispatch({ effects: wrapComp.reconfigure(wrapOn ? CM.EditorView.lineWrapping : []) }); }
            if (keepIt) { saveSetting({ wrap: wrapOn }); }
            commandsChanged();
        }

        /* The Explorer marks the file in front and opens its way to it. */
        function markExplorer() {
            if (!explorer) { return; }
            var t = current(), node = t && t.path ? F.resolve(F.home(), t.path) : null;
            explorer.markCurrent(node ? F.pathOf(F.realOf(node)) : null);
        }

        /* === Views: Text, Visual and Split ================================= */

        /* A Markdown article's page is the public site's own page for the
           unsaved text, a draft the server keeps for an hour (A11). Visual
           and Split make that page the editing surface (js/editor-visual.js,
           Architecture/wysiwyg-editor-design.md), Visual alone and Split
           beside the text. Save publishes. Preview is not a view: it opens
           the page as it is on the site (openOnSite). */
        var viewMode = 'text';
        var visual = { api: null, front: null, fromVisual: false, timer: 0, loading: null, gen: 0 };

        /* A call to one of the server's admin APIs, signing in again when the
           session has ended. The token is read at each try, since signing in
           replaces it. */
        async function adminPost(url, data) {
            var payload = JSON.stringify(data);
            function send() {
                var token = (document.querySelector('meta[name="request-verification-token"]') || {}).content || '';
                return fetch(url, {
                    method: 'POST', credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json', RequestVerificationToken: token },
                    body: payload
                });
            }
            var r = await send();
            if (r.status === 401 && window.pcAdmin && window.pcAdmin.signIn) {
                try { await window.pcAdmin.signIn(); r = await send(); } catch (err) { /* The 401 stands. */ }
            }
            var body = await r.json().catch(function () { return {}; });
            if (!r.ok) { throw new Error(body.error || ('the server answered ' + r.status)); }
            return body;
        }

        function articleNode() {
            var t = current(), node = t && t.path && F ? F.resolve(F.home(), t.path) : null;
            return node && F.mounted && previewable(node) ? node : null;
        }
        function canEditVisually() { var node = articleNode(); return !!(node && /\.md$/i.test(F.realOf(node).rel)); }
        function slugOf(node) { return F.realOf(node).rel.replace(/^content\//, '').replace(/\.(md|html)$/i, ''); }

        /* Shows the article as asked: the page is made again from the text
           as it is now, and the editor is put into it. */
        async function setView(mode) {
            var node = articleNode();
            if (mode !== 'visual' && mode !== 'split') { mode = 'text'; }
            if (mode !== 'text' && !canEditVisually()) { mode = 'text'; }
            viewMode = mode;
            commandsChanged();
            root.classList.toggle('ed-previewing', mode !== 'text');
            root.classList.toggle('ed-visual-only', mode === 'visual');
            showFormat(mode);
            detachVisual();
            if (mode === 'text') {
                el.preview.hidden = true;
                el.preview.removeAttribute('src');
                keep();
                return;
            }
            var gen = ++visual.gen;
            say('Opening the page to edit…');
            var made;
            try { made = await adminPost('/api/admin/preview', { path: F.realOf(node).rel, text: view.state.doc.toString() }); }
            catch (err) { if (gen === visual.gen) { say('The page could not be made: ' + err.message, true); } return; }
            if (gen !== visual.gen) { return; }
            el.preview.hidden = false;
            el.preview.onload = function () { if (gen === visual.gen) { attachVisual(gen, node); } };
            el.preview.src = made.url;
            keep();
        }

        function detachVisual() {
            clearTimeout(visual.timer);
            if (visual.api) { try { visual.api.destroy(); } catch (err) { } }
            visual.api = null;
        }

        /* Loads a script or stylesheet into the page, once. */
        function into(doc, tag, url) {
            return new Promise(function (resolve, reject) {
                if (doc.querySelector('[data-ed-asset="' + url + '"]')) { resolve(); return; }
                var e = doc.createElement(tag);
                e.setAttribute('data-ed-asset', url);
                if (tag === 'link') { e.rel = 'stylesheet'; e.href = url; } else { e.src = url; }
                e.onload = function () { resolve(); };
                e.onerror = function () { reject(new Error('could not load ' + url)); };
                (tag === 'link' ? doc.head : doc.body).appendChild(e);
            });
        }

        /* The visual editor's files sit beside this one and carry its version,
           so a change to them ships with the Editor's own (js/applets.js). */
        var HERE = (SELF_SRC || '/js/editor.js').split('?')[0].replace(/editor\.js$/, '');
        var STAMP = SELF_SRC && SELF_SRC.indexOf('?') >= 0 ? SELF_SRC.slice(SELF_SRC.indexOf('?')) : '';
        async function attachVisual(gen, node) {
            var win = el.preview.contentWindow, doc = el.preview.contentDocument;
            if (!win || !doc) { say('The page can\'t be edited here.', true); return; }
            try {
                await into(doc, 'link', HERE + 'vendor/prosemirror-1.42/prosemirror.css');
                await into(doc, 'link', HERE + '../css/editor-visual.css' + STAMP);
                await into(doc, 'script', HERE + 'vendor/prosemirror-1.42/prosemirror.js');
                await into(doc, 'script', HERE + 'editor-visual.js' + STAMP);
                var model = await loadModel(node);
                if (gen !== visual.gen) { return; }
                visual.front = model.front;
                visual.api = win.pcVisualEditor.attach(visualHost(model, node));
                say(viewMode === 'split'
                    ? 'Edit the text or the page; each follows the other. Double-click a block the page draws to change its Markdown.'
                    : 'Edit the page as it will look. Double-click a block the page draws to change its Markdown.');
                visual.api.focus();
            } catch (err) {
                say('The page could not be edited: ' + err.message, true);
            }
        }

        function loadModel(node) {
            return adminPost('/api/admin/editor/document', { text: view.state.doc.toString(), slug: slugOf(node) });
        }

        function visualHost(model, node) {
            return {
                model: model,
                serialize: function (nodes) { return adminPost('/api/admin/editor/serialize', { nodes: nodes }).then(function (b) { return b.markdown; }); },
                inline: function (src) { return adminPost('/api/admin/editor/inline', { src: src, slug: slugOf(node) }).then(function (b) { return b.html; }); },
                changed: function (text) { takeVisualText(text); },
                reload: function () { reloadVisual(node); },
                prompt: function (title, value) {
                    return ask(title, '', value, [['cancel', 'Cancel'], ['ok', 'OK', true]], null, true).then(function (v) { return v === 'cancel' ? null : v; });
                },
                figure: figureDialog,
                say: function (text, isError) { say(text, isError); }
            };
        }

        /* The page's edit, as text: the least change that turns the text into
           the new text, so the cursor and the undo history in Split keep
           their sense. */
        function takeVisualText(text) {
            var old = view.state.doc.toString();
            if (old === text) { return; }
            var a = 0, b = 0;
            while (a < old.length && a < text.length && old[a] === text[a]) { a++; }
            while (b < old.length - a && b < text.length - a && old[old.length - 1 - b] === text[text.length - 1 - b]) { b++; }
            visual.fromVisual = true;
            try { view.dispatch({ changes: { from: a, to: old.length - b, insert: text.slice(a, text.length - b) }, userEvent: 'input.visual' }); }
            finally { visual.fromVisual = false; }
        }

        /* The text changed in Split, or a block the server must look at was
           changed on the page: the page's blocks again, from the text. A
           change to the front matter (the title, the date) makes the page
           again, since its header comes from there. */
        function reloadVisual(node) {
            clearTimeout(visual.timer);
            visual.timer = setTimeout(async function () {
                if (!visual.api) { return; }
                var gen = visual.gen;
                try {
                    var model = await loadModel(node);
                    if (gen !== visual.gen || !visual.api) { return; }
                    if (model.front !== visual.front) { setView(viewMode); return; }
                    visual.api.load(model);
                } catch (err) { say('The page could not follow the text: ' + err.message, true); }
            }, 300);
        }

        /* The formatting is offered for a Markdown file in any view, and
           in Visual and Split whatever the file. */
        function showFormat(mode) {
            var t = current();
            var on = !!(mode === 'visual' || mode === 'split' || (t && t.lang === 'markdown' && !t.readOnly));
            if (on !== formatOffered) { formatOffered = on; commandsChanged(); }
        }
        /* The formatting goes to the page in Visual, to the text in Text and
           Preview, and in Split to whichever has the keyboard, the text when
           it does and the page otherwise. A toolbar button keeps the
           keyboard where it was, so Split can still tell. */
        function formatsThePage() { return viewMode === 'visual' || (viewMode === 'split' && !!visual.api && !(view && view.hasFocus)); }
        function applyFormat(name) {
            if (formatsThePage()) { visual.api.run(name); } else { textFormat(name); }
        }

        /* The same formatting on the Markdown itself: a mark wraps the
           selection, or is taken off it when it is there; a heading or a
           list marks each selected line; Paragraph takes those marks off. */
        var WRAPS = { bold: '**', italic: '*', strike: '~~', code: '`' };
        function textFormat(name) {
            var t = current();
            if (!view || !t || t.readOnly) { return; }
            var state = view.state, sel = state.selection.main;
            if (WRAPS[name]) {
                var w = WRAPS[name], text = state.sliceDoc(sel.from, sel.to);
                var before = state.sliceDoc(Math.max(0, sel.from - w.length), sel.from), after = state.sliceDoc(sel.to, Math.min(state.doc.length, sel.to + w.length));
                if (text.startsWith(w) && text.endsWith(w) && text.length >= 2 * w.length) {
                    view.dispatch({ changes: { from: sel.from, to: sel.to, insert: text.slice(w.length, text.length - w.length) }, selection: { anchor: sel.from, head: sel.to - 2 * w.length }, userEvent: 'input' });
                } else if (before === w && after === w) {
                    view.dispatch({ changes: [{ from: sel.from - w.length, to: sel.from }, { from: sel.to, to: sel.to + w.length }], selection: { anchor: sel.from - w.length, head: sel.to - w.length }, userEvent: 'input' });
                } else {
                    view.dispatch({ changes: { from: sel.from, to: sel.to, insert: w + text + w }, selection: { anchor: sel.from + w.length, head: sel.to + w.length }, userEvent: 'input' });
                }
                view.focus();
                return;
            }
            if (name === 'link') {
                var chosen = state.sliceDoc(sel.from, sel.to);
                ask('Link to', '', /^https?:\/\//.test(chosen) ? chosen : 'https://', [['cancel', 'Cancel'], ['ok', 'OK', true]], null, true).then(function (href) {
                    if (href === 'cancel' || href == null || !href) { view.focus(); return; }
                    var label = chosen && !/^https?:\/\//.test(chosen) ? chosen : href;
                    var md = '[' + label + '](' + href + ')';
                    view.dispatch({ changes: { from: sel.from, to: sel.to, insert: md }, selection: { anchor: sel.from + 1, head: sel.from + 1 + label.length }, userEvent: 'input' });
                    view.focus();
                });
                return;
            }
            var first = state.doc.lineAt(sel.from), last = state.doc.lineAt(sel.to), changes = [];
            var prefix = name === 'h2' ? '## ' : name === 'h3' ? '### ' : name === 'bullets' ? '- ' : null;
            var every = true;
            for (var n = first.number; n <= last.number; n++) {
                var line = state.doc.line(n), m = /^(\s*)(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)?/.exec(line.text), marked = m[2] || '';
                if (name === 'numbers') { if (!/^\d+[.)]\s+$/.test(marked)) { every = false; } }
                else if (prefix && marked !== prefix) { every = false; }
            }
            var k = 1;
            for (var n2 = first.number; n2 <= last.number; n2++) {
                var ln = state.doc.line(n2), mm = /^(\s*)(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)?/.exec(ln.text);
                var indent = mm[1], old = mm[2] || '', put = '';
                if (name === 'paragraph' || every) { put = ''; }
                else if (name === 'numbers') { put = (k++) + '. '; }
                else { put = prefix; }
                if (old !== put) { changes.push({ from: ln.from + indent.length, to: ln.from + indent.length + old.length, insert: put }); }
            }
            if (changes.length) { view.dispatch({ changes: changes, userEvent: 'input' }); }
            view.focus();
        }

        /* The insert menu lists the shortcodes, from the server's table, in
           alphabetical order of the titles it shows. */
        var shortcodes = null, shortcodesLoading = null;
        function loadShortcodes() {
            if (shortcodes) { return Promise.resolve(shortcodes); }
            if (!shortcodesLoading) {
                shortcodesLoading = fetch('/api/admin/editor/shortcodes', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
                    /* The body is read either way: a refusal left unread (a
                       visitor not signed in) stays open in the browser. */
                    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return r.ok ? b : { shortcodes: [] }; }); })
                    .then(function (b) { shortcodes = (b.shortcodes || []).map(function (s) { s.params = s.params || []; return s; }); return shortcodes; })
                    .catch(function () { shortcodes = []; return shortcodes; });
            }
            return shortcodesLoading;
        }
        /* The Insert menu's items, one command a shortcode, in order of
           their titles; until the table has loaded, one saying so. */
        function insertItems() {
            if (!shortcodes) { return [{ id: 'insert-loading', label: 'Loading the shortcodes…', disabled: true }]; }
            return shortcodes.filter(function (s) { return s.name !== 'column'; }).sort(function (a, b) {
                return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
            }).map(function (s) {
                return { id: 'insert-' + s.name, label: s.title, run: function () { insertShortcode(s.name); } };
            });
        }
        function insertShortcode(name) {
            var s = (shortcodes || []).find(function (x) { return x.name === name; });
            if (!s) { return; }
            /* A figure is asked for as a form; the rest go in as their
               examples, into the page or into the text. */
            var asked = s.name === 'figure' ? figureDialog(null) : Promise.resolve(s.example);
            asked.then(function (src) {
                if (!src) { return; }
                if (formatsThePage()) { visual.api.insertShortcode(s.name === 'figure' ? 'block' : s.kind, src); }
                else { insertText(s.kind === 'inline' ? src : '\n' + src + '\n'); }
            });
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
           which view each is in. A reload brings all of it back. A draft
           for a file that can't be reached when the Editor starts, as a
           server file can't while signed out, waits in the snapshot until it
           can.

           The same record is the Editor's session, kept in this browser's
           storage under pc-editor-session, so closing the Editor's window
           and opening it again, in this tab or another, or after the browser
           restarts, brings back the documents it had open, unsaved text
           and all. A reload prefers the tab's own snapshot, which is newer
           when two tabs each have an Editor. The first instance keeps the
           session; a numbered one keeps only its snapshot. */
        var snap = window.pcSnapshot ? window.pcSnapshot.join(root, takeSnapshot) : null;
        var waiting = [], restoring = false;
        var SESSION_KEY = 'pc-editor-session';
        /* PUDL keys a numbered instance name-2 to name-9 (0.27.0). */
        var ownsSession = !/-[2-9]$/.test(String(opts.instance || ''));
        var sessionTimer = 0;
        function keep() {
            if (restoring) { return; }
            if (snap) { snap.changed(); }
            if (ownsSession) { clearTimeout(sessionTimer); sessionTimer = setTimeout(keepSession, 500); }
        }
        /* Writes the session now; false when the browser would not keep it. */
        function keepSession() {
            clearTimeout(sessionTimer);
            if (!ownsSession || restoring || !view || !CM) { return true; }
            var s = takeSnapshot();
            try {
                if (s && (s.tabs.length || s.waiting.length)) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
                else { localStorage.removeItem(SESSION_KEY); }
                return true;
            } catch (err) { return false; }
        }
        function readSession() {
            if (!ownsSession) { return null; }
            try { var s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); return s && Array.isArray(s.tabs) ? s : null; }
            catch (err) { return null; }
        }

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
                    search: searchOf(st), view: t === front ? viewMode : (t.view || 'text')
                });
            });
            var out = { tabs: list, front: frontAt, waiting: waiting, view: viewMode, explorer: explorer ? explorer.snapshot() : null };
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
            t.view = k.view === 'visual' || k.view === 'split' ? k.view : 'text';
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
            var session = readSession();
            if (session) { return session; }
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
            // A snapshot from before the views kept only whether the preview showed.
            return { text: msg, error: waiting.length > 0, view: kept.view || 'text' };
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

        /* Unsaved text kept in the session comes back with the Editor, so
           leaving or closing asks only when the session could not keep it. */
        function onBeforeUnload(e) {
            if (tabs.some(function (t) { return t.modified; }) && !(ownsSession && keepSession())) { e.preventDefault(); e.returnValue = ''; }
        }
        window.addEventListener('beforeunload', onBeforeUnload);

        /* Closing the editor's window with unsaved changes that the session
           could not keep asks first (pudl:window-closing, PUDL 0.28.0); when
           the session keeps them, the window closes and they come back with
           it. The question's Cancel keeps the window,
           Don't save closes it, and Save all saves every changed file and
           then closes, unless a save fails. */
        var win = root.closest('.win[data-win]'), closeAgreed = false;
        function onWindowClosing(e) {
            if (e.target !== win || closeAgreed) { return; }
            var changed = tabs.filter(function (t) { return t.modified; });
            if (!changed.length || (ownsSession && keepSession())) { return; }
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
        /* Preview opens the page as it is on the site. In the window view it
           opens a page of this site as a window rather than a browser tab,
           and one already open comes to the front with its content fetched
           again, so it shows what was just saved. Anywhere else, or for an
           address that is not a page of this site, it opens a new tab. Text
           not yet saved is not on the site, which the status line says. */
        function previewNote() {
            if (current() && current().modified) { say('Preview shows the page as it is on the site; save to see your changes there.'); }
        }
        /* Preview: the file's page on the site, in a window in the window
           view and in a new tab otherwise. */
        function preview() {
            if (!siteUrl) { return; }
            var href = new URL(siteUrl, location.href).href;
            previewNote();
            if (!inWindowView(href)) { window.open(href, '_blank', 'noopener'); }
        }
        function openSource() {
            var cur = current(), node = cur && F.resolve(F.home(), cur.path), src = node && F.sourceOf(node);
            if (src) { openPath(F.displayPath(src)); }
        }
        function inWindowView(href) {
            if (!window.pudlWindows || !document.querySelector('[data-win-layer]')) { return false; }
            var url = new URL(href, location.href);
            var page = url.origin === location.origin && /^\/page\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
            if (!page) { return false; }
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
            var tabBtn = e.target.closest('.ed-tabs [data-tab]');
            if (tabBtn) { activate(+tabBtn.getAttribute('data-tab')); view.focus(); }
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
            'toggle-files': toggleExplorer,
            'toggle-wrap': function () { setWrap(!wrapOn, true); },
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

        /* === The command table and the toolbar (PUDL 0.68.0) ===============
           Every command the toolbar, the menus, the keys and an agent reach,
           once, by the names ~/.config/editor.json binds keys to. A command's
           shortcut is the key bound to it, or failing one, CodeMirror's own;
           CodeMirror answers its keys in the text first, so PUDL answers a
           key only where CodeMirror did not. */
        var FORMATS = [
            ['bold', 'Bold', 'bold', 'Mod-b'], ['italic', 'Italic', 'italic', 'Mod-i'], ['strike', 'Strike Through', 'strike'],
            ['code', 'Code', 'code', 'Mod-`'], ['link', 'Link…', 'link', 'Mod-k'],
            ['paragraph', 'Paragraph', 'paragraph', 'Mod-Alt-0'], ['h2', 'Heading', 'heading-2', 'Mod-Alt-2'], ['h3', 'Subheading', 'heading-3', 'Mod-Alt-3'],
            ['bullets', 'Bulleted List', 'list'], ['numbers', 'Numbered List', 'list-numbered']
        ];
        function commandTable() {
            var ready = !!(CM && view), tab = current(), editable = !!(tab && !tab.readOnly);
            function key(name, builtIn) { return function () { return (ready && shortcutFor(name)) || (builtIn ? keyLabel(builtIn) : undefined); }; }
            function cmd(id, label, glyph, run, more) {
                return Object.assign({ id: id, label: label, glyph: glyph || undefined, shortcut: key(id, more && more.builtIn),
                    disabled: function () { return !ready; }, run: run }, more || {});
            }
            var table = [
                cmd('toggle-files', 'Files', 'panel', toggleExplorer, { checked: function () { return !el.explorer.hidden; } }),
                cmd('new', 'New', 'file', function () { newTab(); }),
                cmd('open', 'Open…', 'folder', function () { openDialog(); }),
                cmd('save', 'Save', 'save', function () { save(); }, { disabled: function () { var t = current(); return !ready || !t || t.readOnly; }, reason: 'This file is read-only.' }),
                cmd('save-as', 'Save As…', null, function () { saveAs(); }, { label: function () { var t = current(); return t && t.readOnly ? 'Save a Copy to ~…' : 'Save As…'; }, disabled: function () { return !ready || !current(); } }),
                cmd('close-document', 'Close Document', null, function () { COMMANDS['close-document'](); }, { disabled: function () { return !ready || !current(); } }),
                cmd('undo', 'Undo', 'undo', function () { CM.undo(view); }, { builtIn: 'Mod-z' }),
                cmd('redo', 'Redo', 'redo', function () { CM.redo(view); }, { builtIn: 'Mod-y' }),
                cmd('find', 'Find and Replace…', 'search', function () { CM.openSearchPanel(view); }, { builtIn: 'Mod-f' }),
                cmd('go-to-line', 'Go to Line…', null, goToLine, { builtIn: 'Mod-Alt-g' }),
                cmd('toggle-wrap', 'Wrap Lines', 'wrap', function () { setWrap(!wrapOn, true); }, { checked: function () { return wrapOn; } }),
                cmd('insert-timestamp', 'Insert Date and Time', null, COMMANDS['insert-timestamp'], { disabled: function () { return !ready || !editable; } }),
                cmd('insert-date', 'Insert Date', null, COMMANDS['insert-date'], { disabled: function () { return !ready || !editable; } }),
                cmd('stamp-modified', 'Update Last-Modified', null, stampModified, { disabled: function () { return !ready || !editable; } }),
                cmd('key-bindings', 'Key Bindings…', null, editKeys),
                cmd('insert', 'Insert', 'plus', null, { items: insertItems, hidden: function () { return !formatOffered; }, shortcut: undefined }),
                cmd('source', 'Edit the Source', 'code', openSource, { hidden: function () { return !sourceOffered; } }),
                cmd('preview', 'Preview', 'new-window', preview, { hidden: function () { return !siteUrl; } })
            ];
            FORMATS.forEach(function (f) {
                table.push(cmd(f[0], f[1], f[2], function () { applyFormat(f[0]); }, {
                    shortcut: f[3] ? keyLabel(f[3]) : undefined, hidden: function () { return !formatOffered; }
                }));
            });
            [['text', 'Text'], ['visual', 'Visual'], ['split', 'Split']].forEach(function (v) {
                table.push({ id: 'view-' + v[0], label: v[1], choice: 'ed-view', choiceLabel: 'View', value: v[0],
                    checked: function () { return viewMode === v[0]; },
                    hidden: function () { return !viewsOffered; }, disabled: function () { return !ready; },
                    run: function () { setView(v[0]); } });
            });
            return table;
        }

        /* The toolbar: what is used most stays named longest, and the view
           switch and Preview keep to the end of the row. */
        function toolbars() {
            return [{ label: 'Editor', groups: [
                { label: 'File', glyph: 'file', priority: 3, items: ['toggle-files', 'new', 'open', 'save', 'save-as'] },
                { label: 'Edit', glyph: 'undo', priority: 2, items: ['undo', 'redo', 'find', 'toggle-wrap'] },
                { label: 'Format', glyph: 'bold', priority: 1, items: ['bold', 'italic', 'strike', 'code', 'link', 'paragraph', 'h2', 'h3', 'bullets', 'numbers', 'insert'] },
                { label: 'View', glyph: 'new-window', priority: 4, end: true, items: ['source', { choice: 'ed-view' }, 'preview'] }
            ] }];
        }

        /* The menus name the same commands. */
        function menus() {
            var t = commandTable(), rows = function (ids) { return window.pcCommandRows(t, ids); };
            return { titles: [
                { label: 'Editor', items: window.pcAppletIdentity(root) },
                { id: 'file', label: 'File', items: rows(['new', 'open', 'save', 'save-as', '-', 'close-document']) },
                { id: 'edit', label: 'Edit', items: rows(['undo', 'redo', '-', 'find', '-', 'insert-timestamp', 'insert-date', 'stamp-modified', '-', 'key-bindings']) }
            ], into: { view: rows(['toggle-files', 'toggle-wrap', '-', 'view-text', 'view-visual', 'view-split', '-', 'preview']), go: rows(['go-to-line']) } };
        }

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
            wrapOn = !!settings.wrap;
            /* The shortcodes for the Insert menu, which draws again once they are here. */
            loadShortcodes().then(commandsChanged);
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
            /* The view showing before the reload comes back, which asks the
               server for the page, so it is not waited for. */
            if (restored && restored.view && restored.view !== 'text' && viewsOffered) { setView(restored.view); }
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
            commandTable: commandTable,
            toolbars: toolbars,
            destroy: function () {
                /* The session as the Editor closes, for when it opens again. */
                keepSession();
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
