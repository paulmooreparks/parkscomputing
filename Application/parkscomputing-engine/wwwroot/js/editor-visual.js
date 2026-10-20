/* The Editor's visual view (Architecture/wysiwyg-editor-design.md, step 3).
   It runs inside the article's own draft page, the preview the Editor
   shows, and turns the article's body into the editing surface, so what is
   edited is the page itself: its fonts, widths, colours, header and every
   stylesheet are the page's. The Editor (js/editor.js) loads ProseMirror
   (js/vendor/prosemirror-1.42) and this script into the page, then calls
   window.pcVisualEditor.attach(host).

   The document comes from the server (Pages/Services/EditorDocument.cs) as
   blocks: rich text in ProseMirror's JSON, or a source block with the HTML
   the page renders for it. Rich text is drawn by the schema below, whose
   elements are the ones Markdig writes; a source block, a shortcode and a
   container's frame are drawn from the server's HTML and then given the
   page's own finishing steps (window.pcEnhanceArticle), so they look as
   they do on the page. Nothing here renders Markdown.

   host gives:
     model                    the document, from /api/admin/editor/document
     serialize(nodes)         a promise of the Markdown for edited blocks
     inline(src)              a promise of a shortcode's HTML
     changed(text)            the article's text after an edit
     reload()                 asks for the document again, after an edit the
                              server must look at (a source block, a shortcode)
     prompt(title, value)     a promise of text the person types, or null
     figure(src)              a promise of a {{figure}} shortcode from a form
                              for the one given (null for a new one), '' to
                              remove it, or null for no change (optional)
     say(text, isError)       a line in the Editor's status bar

   An untouched block is written back as its own text: each top-level node
   carries the uid of the block it came from, and a node equal to the one
   loaded keeps that block's text and the space after it. */
(function () {
    'use strict';
    if (window.pcVisualEditor) { return; }
    var PM = window.PM;

    function withUid(attrs) { return Object.assign({ uid: { default: null } }, attrs || {}); }

    var schema = new PM.Schema({
        nodes: {
            doc: { content: 'block+' },
            paragraph: {
                group: 'block', content: 'inline*', attrs: withUid(),
                parseDOM: [{ tag: 'p' }], toDOM: function () { return ['p', 0]; }
            },
            heading: {
                group: 'block', content: 'inline*', defining: true, attrs: withUid({ level: { default: 2 }, id: { default: null } }),
                parseDOM: [1, 2, 3, 4, 5, 6].map(function (l) { return { tag: 'h' + l, attrs: { level: l } }; }),
                toDOM: function (n) { return ['h' + n.attrs.level, n.attrs.id ? { id: n.attrs.id } : {}, 0]; }
            },
            bullet_list: {
                group: 'block', content: 'list_item+', attrs: withUid({ tight: { default: true }, marker: { default: '-' } }),
                parseDOM: [{ tag: 'ul' }],
                toDOM: function (n) { return ['ul', n.attrs.tight ? { 'data-tight': 'true' } : {}, 0]; }
            },
            ordered_list: {
                group: 'block', content: 'list_item+', attrs: withUid({ order: { default: 1 }, delimiter: { default: '.' }, tight: { default: true } }),
                parseDOM: [{ tag: 'ol', getAttrs: function (d) { return { order: d.hasAttribute('start') ? +d.getAttribute('start') || 1 : 1 }; } }],
                toDOM: function (n) {
                    var a = n.attrs.tight ? { 'data-tight': 'true' } : {};
                    if (n.attrs.order !== 1) { a.start = n.attrs.order; }
                    return ['ol', a, 0];
                }
            },
            list_item: {
                content: 'paragraph (paragraph | bullet_list | ordered_list)*', defining: true,
                parseDOM: [{ tag: 'li' }], toDOM: function () { return ['li', 0]; }
            },
            container: {
                group: 'block', content: 'block+', defining: true,
                attrs: withUid({ name: { default: '' }, args: { default: '' }, open: { default: '' }, close: { default: '' } }),
                toDOM: function () { return ['div', { class: 'pm-container' }, 0]; }
            },
            source_block: {
                group: 'block', atom: true, selectable: true, draggable: false,
                attrs: withUid({ src: { default: '' }, html: { default: '' } }),
                toDOM: function () { return ['div', { class: 'pm-source' }]; }
            },
            text: { group: 'inline' },
            hard_break: { inline: true, group: 'inline', selectable: false, parseDOM: [{ tag: 'br' }], toDOM: function () { return ['br']; } },
            /* A line break inside a paragraph, which the page shows as a space. */
            soft_break: { inline: true, group: 'inline', selectable: false, toDOM: function () { return ['span', { class: 'pm-soft' }, ' ']; } },
            shortcode: {
                inline: true, group: 'inline', atom: true, attrs: { src: { default: '' }, html: { default: '' } },
                toDOM: function (n) { return ['span', { class: 'pm-shortcode', 'data-src': n.attrs.src }]; }
            }
        },
        /* In the order the server gives a text's marks (EditorDocument.MarkOrder). */
        marks: {
            link: {
                attrs: { href: {}, title: { default: null } }, inclusive: false,
                parseDOM: [{ tag: 'a[href]', getAttrs: function (d) { return { href: d.getAttribute('href'), title: d.getAttribute('title') }; } }],
                toDOM: function (m) { return ['a', m.attrs.title ? { href: m.attrs.href, title: m.attrs.title } : { href: m.attrs.href }, 0]; }
            },
            em: { parseDOM: [{ tag: 'em' }, { tag: 'i' }], toDOM: function () { return ['em', 0]; } },
            strong: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }], toDOM: function () { return ['strong', 0]; } },
            strike: { parseDOM: [{ tag: 'del' }, { tag: 's' }], toDOM: function () { return ['del', 0]; } },
            code: { parseDOM: [{ tag: 'code' }], toDOM: function () { return ['code', 0]; } }
        }
    });

    var host = null, view = null, body = null, mount = null, model = null;
    var originals = {}, sources = {}, gaps = {}, order = {}, tail = '\n';
    var timer = 0, sending = 0, pending = false;

    /* The page's finishing steps, on HTML the server rendered. */
    function finish(el) {
        if (window.pcEnhanceArticle) { window.pcEnhanceArticle(el); }
        if (window.pudlApplets && window.pudlApplets.boot) { window.pudlApplets.boot(el); }
        /* A picture in the editor is edited, not shown in the lightbox. */
        el.querySelectorAll('img').forEach(function (i) { i.setAttribute('data-no-lightbox', ''); });
    }

    var FIGURE = /^\{\{figure[:}]/;

    /* === Node views ===================================================== */

    /* A block the editor can't edit as rich text: the page's HTML for it.
       Pressing it opens its Markdown in place; Done or Ctrl+Enter keeps the
       change, and Escape leaves it as it was. */
    function SourceView(node, v, getPos) {
        this.node = node;
        this.dom = document.createElement('div');
        this.dom.className = 'pm-source';
        this.dom.contentEditable = 'false';
        this.dom.title = 'Double-click to edit this as Markdown';
        this.show();
        var self = this;
        this.dom.addEventListener('dblclick', function (e) { e.preventDefault(); self.edit(v, getPos); });
        /* A figure pressed opens its form (host.figure), where there is one. */
        this.dom.addEventListener('click', function (e) {
            if (self.editing || !host.figure || !FIGURE.test(self.node.attrs.src) || !e.target.closest('figure, img')) { return; }
            e.preventDefault();
            host.figure(self.node.attrs.src).then(function (src) {
                if (src === null || src === undefined) { v.focus(); return; }
                var pos = getPos();
                if (typeof pos !== 'number') { return; }
                if (src === '') { v.dispatch(v.state.tr.delete(pos, pos + self.node.nodeSize)); }
                else { self.apply(v, pos, src); }
                emit(true);
                v.focus();
            });
        });
    }
    SourceView.prototype.show = function () {
        this.dom.innerHTML = this.node.attrs.html || '<p class="pm-empty">(nothing on the page)</p>';
        finish(this.dom);
        if (host && host.figure && FIGURE.test(this.node.attrs.src)) { this.dom.title = 'Click the picture to change the figure; double-click to edit it as Markdown'; }
    };
    /* The block's Markdown replaced; the server renders it again. */
    SourceView.prototype.apply = function (v, pos, src) {
        if (src === this.node.attrs.src) { return; }
        v.dispatch(v.state.tr.setNodeMarkup(pos, null, Object.assign({}, this.node.attrs, { src: src, html: '' })));
    };
    SourceView.prototype.edit = function (v, getPos) {
        if (this.editing) { return; }
        this.editing = true;
        var self = this, box = document.createElement('div');
        box.className = 'pm-source-edit';
        box.innerHTML = '<textarea class="form-textarea mono" spellcheck="false"></textarea>' +
            '<div class="pm-source-actions"><button type="button" class="btn btn-sm btn-primary" data-act="done">Done</button>' +
            '<button type="button" class="btn btn-sm" data-act="cancel">Cancel</button>' +
            '<span class="pm-source-hint">Markdown. Ctrl+Enter keeps it, Escape leaves it.</span></div>';
        var ta = box.querySelector('textarea');
        ta.value = this.node.attrs.src;
        ta.rows = Math.min(30, Math.max(3, ta.value.split('\n').length + 1));
        this.dom.replaceChildren(box);
        ta.focus();
        function close(keep) {
            if (!self.editing) { return; }
            self.editing = false;
            var pos = getPos();
            if (keep && ta.value !== self.node.attrs.src && typeof pos === 'number') {
                v.dispatch(v.state.tr.setNodeMarkup(pos, null, Object.assign({}, self.node.attrs, { src: ta.value, html: '' })));
                emit(true);
            } else {
                self.show();
            }
            v.focus();
        }
        box.addEventListener('click', function (e) {
            var act = e.target.closest('[data-act]');
            if (act) { close(act.getAttribute('data-act') === 'done'); }
        });
        ta.addEventListener('keydown', function (e) {
            e.stopPropagation();
            if (e.key === 'Escape') { e.preventDefault(); close(false); }
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); close(true); }
        });
    };
    SourceView.prototype.update = function (node) {
        if (node.type !== this.node.type) { return false; }
        var changed = node.attrs.html !== this.node.attrs.html;
        this.node = node;
        if (changed && !this.editing) { this.show(); }
        return true;
    };
    SourceView.prototype.stopEvent = function (e) { return !!this.editing || e.type === 'dblclick' || (e.type === 'click' && FIGURE.test(this.node.attrs.src)); };
    SourceView.prototype.ignoreMutation = function () { return true; };

    /* A container shortcode: the page's own frame (a notice, an expand)
       around the body, which is edited as any text is. */
    function ContainerView(node, v, getPos) {
        var wrap = document.createElement('div');
        wrap.innerHTML = (node.attrs.open || '<div>') + '<div class="pm-hole"></div>' + (node.attrs.close || '</div>');
        this.dom = wrap.firstElementChild || wrap;
        this.dom.classList.add('pm-container');
        this.dom.setAttribute('data-shortcode', node.attrs.name);
        if (this.dom.tagName === 'DETAILS') { this.dom.open = true; }
        this.contentDOM = this.dom.querySelector('.pm-hole');
        this.node = node;
        // The frame itself, outside the body, is not text to edit.
        Array.prototype.forEach.call(this.dom.querySelectorAll('*'), function (el) {
            if (!el.contains(wrap.querySelector('.pm-hole')) && !el.closest('.pm-hole')) { el.contentEditable = 'false'; }
        });
        var self = this;
        this.dom.addEventListener('dblclick', function (e) {
            if (self.contentDOM.contains(e.target)) { return; }
            e.preventDefault();
            host.prompt('{{' + node.attrs.name + '}} takes', self.node.attrs.args).then(function (args) {
                var pos = getPos();
                if (args == null || typeof pos !== 'number') { return; }
                v.dispatch(v.state.tr.setNodeMarkup(pos, null, Object.assign({}, self.node.attrs, { args: args })));
                emit(true);
            });
        });
    }
    ContainerView.prototype.update = function (node) {
        if (node.type !== this.node.type || node.attrs.open !== this.node.attrs.open || node.attrs.close !== this.node.attrs.close) { return false; }
        this.node = node;
        return true;
    };
    ContainerView.prototype.ignoreMutation = function (m) { return !this.contentDOM.contains(m.target); };

    /* A shortcode in a line of text, drawn as the page draws it. */
    function ShortcodeView(node, v, getPos) {
        this.dom = document.createElement('span');
        this.dom.className = 'pm-shortcode';
        this.dom.contentEditable = 'false';
        this.dom.title = node.attrs.src + ' (double-click to change)';
        this.dom.innerHTML = node.attrs.html || node.attrs.src;
        finish(this.dom);
        this.dom.addEventListener('dblclick', function (e) {
            e.preventDefault();
            host.prompt('Shortcode', node.attrs.src).then(function (src) {
                var pos = getPos();
                if (src == null || typeof pos !== 'number') { return; }
                if (src === '') {
                    v.dispatch(v.state.tr.delete(pos, pos + 1));
                    return;
                }
                host.inline(src).then(function (html) {
                    var p = getPos();
                    if (typeof p === 'number') { v.dispatch(v.state.tr.setNodeMarkup(p, null, { src: src, html: html })); }
                });
            });
        });
    }
    ShortcodeView.prototype.ignoreMutation = function () { return true; };

    /* === Typing ========================================================= */

    /* Quotes curl as they are typed, as the page shows them (decision 3),
       and a shortcode typed in a line becomes one when its }} closes it. */
    function textInput(v, from, to, text) {
        var $from = v.state.doc.resolve(from);
        if ($from.parent.type.spec.code || $from.marks().some(function (m) { return m.type === schema.marks.code; })) { return false; }
        var before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 200), $from.parentOffset, null, '￼');
        if (text === '"' || text === "'") {
            var opening = before.length === 0 || /[\s([{—–-]$/.test(before);
            var curly = text === '"' ? (opening ? '“' : '”') : (opening ? '‘' : '’');
            v.dispatch(v.state.tr.insertText(curly, from, to));
            return true;
        }
        if (text === '}') {
            var m = /\{\{(\/?)([a-z][a-z0-9-]*)(?::((?:(?!\}\}).)*))?\}$/.exec(before);
            if (m && !m[1]) {
                var src = m[0] + '}', start = from - (m[0].length);
                v.dispatch(v.state.tr.insertText('}', from, to));
                host.inline(src).then(function (html) {
                    // Only if the text is still there as typed; more typing in between leaves it as text.
                    var end = start + src.length;
                    if (!view || end > view.state.doc.content.size || view.state.doc.textBetween(start, end) !== src) { return; }
                    view.dispatch(view.state.tr.replaceWith(start, end, schema.nodes.shortcode.create({ src: src, html: html })));
                    emit(true);
                });
                return true;
            }
        }
        return false;
    }

    /* === Commands ======================================================= */

    function markActive(type) {
        var s = view.state, sel = s.selection;
        return sel.empty ? !!type.isInSet(s.storedMarks || sel.$from.marks()) : s.doc.rangeHasMark(sel.from, sel.to, type);
    }

    function setBlock(type, attrs) { return PM.setBlockType(type, attrs); }

    function toggleList(type) {
        return function (state, dispatch) {
            var $f = state.selection.$from;
            for (var d = $f.depth; d > 0; d--) {
                if ($f.node(d).type === type) { return PM.liftListItem(schema.nodes.list_item)(state, dispatch); }
            }
            return PM.wrapInList(type)(state, dispatch);
        };
    }

    function link(state, dispatch) {
        if (markActive(schema.marks.link)) { return PM.toggleMark(schema.marks.link)(state, dispatch); }
        if (state.selection.empty) { host.say('Select the text to link first.', true); return false; }
        host.prompt('Link to', 'https://').then(function (href) {
            if (!href) { return; }
            PM.toggleMark(schema.marks.link, { href: href })(view.state, view.dispatch);
            view.focus();
        });
        return true;
    }

    var COMMANDS = {
        bold: function (s, d) { return PM.toggleMark(schema.marks.strong)(s, d); },
        italic: function (s, d) { return PM.toggleMark(schema.marks.em)(s, d); },
        strike: function (s, d) { return PM.toggleMark(schema.marks.strike)(s, d); },
        code: function (s, d) { return PM.toggleMark(schema.marks.code)(s, d); },
        link: link,
        paragraph: function (s, d) { return setBlock(schema.nodes.paragraph)(s, d); },
        bullets: function (s, d) { return toggleList(schema.nodes.bullet_list)(s, d); },
        numbers: function (s, d) { return toggleList(schema.nodes.ordered_list)(s, d); },
        undo: PM.undo, redo: PM.redo
    };
    /* The six heading levels, h1 to h6, on Ctrl+1 to Ctrl+6 as in the
       Editor's paragraph style menu; Paragraph is Ctrl+0. */
    var STYLE_KEYS = { 'Mod-0': COMMANDS.paragraph };
    [1, 2, 3, 4, 5, 6].forEach(function (n) {
        COMMANDS['h' + n] = function (s, d) { return setBlock(schema.nodes.heading, { level: n })(s, d); };
        STYLE_KEYS['Mod-' + n] = COMMANDS['h' + n];
    });

    /* The paragraph style of the block the cursor is in: h1 to h6 for a
       heading, paragraph for anything else. */
    function block() {
        if (!view) { return null; }
        var p = view.state.selection.$from.parent;
        return p.type === schema.nodes.heading ? 'h' + p.attrs.level : 'paragraph';
    }

    function keys() {
        return PM.keymap(Object.assign({
            'Mod-b': COMMANDS.bold, 'Mod-i': COMMANDS.italic, 'Mod-`': COMMANDS.code, 'Mod-k': COMMANDS.link,
            'Mod-z': PM.undo, 'Mod-y': PM.redo, 'Mod-Shift-z': PM.redo,
            'Enter': PM.splitListItem(schema.nodes.list_item),
            'Tab': PM.sinkListItem(schema.nodes.list_item),
            'Shift-Tab': PM.liftListItem(schema.nodes.list_item),
            'Shift-Enter': function (s, d) { if (d) { d(s.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView()); } return true; }
        }, STYLE_KEYS));
    }

    /* === Writing back =================================================== */

    /* The article's text from the editor: an untouched block keeps its own
       text, an edited one is written by the server, and the space between
       two blocks that were neighbours stays as it was. */
    function emit(soon) {
        clearTimeout(timer);
        timer = setTimeout(send, soon ? 0 : 400);
    }

    function send() {
        if (!view) { return; }
        if (sending) { pending = true; return; }
        var tops = [], changedNodes = [], changedAt = [];
        view.state.doc.forEach(function (node) { tops.push(node); });
        tops.forEach(function (node, i) {
            var uid = node.attrs.uid, was = uid && originals[uid];
            if (!(was && node.eq(was))) { changedAt.push(i); changedNodes.push(node.toJSON()); }
        });
        var needsLook = tops.some(function (n) { return n.type === schema.nodes.source_block && !n.attrs.html; });
        sending = (changedNodes.length ? host.serialize(changedNodes) : Promise.resolve([])).then(function (written) {
            var parts = tops.map(function (node, i) {
                var at = changedAt.indexOf(i);
                return at >= 0 ? written[at] : sources[node.attrs.uid];
            });
            var text = model.front + model.lead;
            tops.forEach(function (node, i) {
                text += parts[i];
                var next = tops[i + 1], uid = node.attrs.uid;
                if (!next) { text += uid && order[uid] === model.blocks.length - 1 ? gaps[uid] : tail; }
                else if (uid && next.attrs.uid && order[next.attrs.uid] === order[uid] + 1 && next.attrs.uid !== uid) { text += gaps[uid]; }
                else { text += '\n\n'; }
            });
            host.changed(text);
            if (needsLook) { host.reload(); }
        }).catch(function (err) {
            host.say('The change could not be written: ' + (err && err.message || err), true);
        }).then(function () {
            sending = 0;
            if (pending) { pending = false; send(); }
        });
    }

    /* === Loading ======================================================== */

    function remember(m) {
        model = m;
        originals = {}; sources = {}; gaps = {}; order = {};
        m.blocks.forEach(function (b, i) {
            var node = schema.nodeFromJSON(b.node);
            originals[b.uid] = node; sources[b.uid] = b.source; gaps[b.uid] = b.gap; order[b.uid] = i;
        });
        tail = m.blocks.length ? m.blocks[m.blocks.length - 1].gap : '\n';
    }

    function docOf(m) {
        var content = m.blocks.map(function (b) { return originals[b.uid]; });
        if (!content.length) { content = [schema.nodes.paragraph.create()]; }
        return schema.nodes.doc.create(null, content);
    }

    function stateOf(m) {
        return PM.EditorState.create({
            doc: docOf(m),
            plugins: [PM.history(), keys(), PM.keymap(PM.baseKeymap), PM.dropCursor(), PM.gapCursor()]
        });
    }

    function attach(h) {
        host = h;
        body = document.querySelector('.post-body');
        if (!body) { throw new Error('this page has no article body to edit'); }
        document.documentElement.classList.add('pc-visual-editing');
        // What the page puts in the body besides the article (its menu) stays.
        var keepers = Array.prototype.filter.call(body.children, function (c) { return c.matches('nav[data-page-menu]'); });
        mount = document.createElement('div');
        body.replaceChildren.apply(body, keepers.concat([mount]));
        remember(h.model);
        view = new PM.EditorView({ mount: mount }, {
            state: stateOf(h.model),
            nodeViews: {
                source_block: function (n, v, g) { return new SourceView(n, v, g); },
                container: function (n, v, g) { return new ContainerView(n, v, g); },
                shortcode: function (n, v, g) { return new ShortcodeView(n, v, g); }
            },
            handleTextInput: textInput,
            dispatchTransaction: function (tr) {
                view.updateState(view.state.apply(tr));
                if (tr.docChanged) { emit(false); }
                if ((tr.docChanged || tr.selectionSet) && host.moved) { host.moved(); }
            }
        });
        view.dom.classList.add('pc-visual');
        /* The Editor's own keys (Ctrl+S, Ctrl+O and the rest) are heard in
           the Editor's page, which a key pressed in this frame never
           reaches. A key with Ctrl, Alt or Cmd that the page here did not
           take goes to the Editor, and the browser does nothing with it
           when the Editor runs a command for it. */
        document.addEventListener('keydown', function (e) {
            if (e.defaultPrevented || e.isComposing || !(e.ctrlKey || e.metaKey || e.altKey) || !host.key) { return; }
            if (host.key(e)) { e.preventDefault(); }
        });
        return api;
    }

    /* The document again, from text changed outside (Split's text, or a
       source block the server has now looked at), keeping the place. */
    function load(m) {
        if (!view) { return; }
        var y = window.scrollY, at = view.state.selection.from;
        remember(m);
        view.updateState(stateOf(m));
        try {
            var pos = Math.min(at, view.state.doc.content.size);
            view.dispatch(view.state.tr.setSelection(PM.TextSelection.near(view.state.doc.resolve(pos))));
        } catch (err) { /* The place no longer exists; the start will do. */ }
        window.scrollTo(0, y);
    }

    function run(name) {
        var cmd = COMMANDS[name];
        if (!view || !cmd) { return false; }
        var done = cmd(view.state, view.dispatch);
        view.focus();
        return done;
    }

    /* A shortcode's example, put where the cursor is: a shortcode in a line
       goes in as one; anything else goes in as its own block of Markdown,
       which the server then reads. */
    function insertShortcode(kind, example) {
        if (!view) { return; }
        if (kind === 'inline') {
            host.inline(example).then(function (html) {
                view.dispatch(view.state.tr.replaceSelectionWith(schema.nodes.shortcode.create({ src: example, html: html })).scrollIntoView());
                emit(true);
                view.focus();
            });
            return;
        }
        var $to = view.state.selection.$to, after = $to.depth > 0 ? $to.after(1) : view.state.doc.content.size;
        view.dispatch(view.state.tr.insert(after, schema.nodes.source_block.create({ src: example, html: '' })).scrollIntoView());
        emit(true);
    }

    var api = {
        attach: attach, load: load, run: run, insertShortcode: insertShortcode, block: block,
        active: function (name) {
            if (!view) { return false; }
            var marks = { bold: 'strong', italic: 'em', strike: 'strike', code: 'code', link: 'link' };
            return marks[name] ? markActive(schema.marks[marks[name]]) : false;
        },
        focus: function () { if (view) { view.focus(); } },
        destroy: function () { if (view) { view.destroy(); view = null; } }
    };
    window.pcVisualEditor = api;
})();
