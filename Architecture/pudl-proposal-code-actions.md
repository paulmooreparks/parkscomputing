# Proposal to PUDL: copy and download on code blocks

From parkscomputing.com, 2026-09-29, against PUDL 0.27.0. The site has about forty code blocks across its articles: C++ and C# listings, shell sessions, pbrain programs and spreadsheet formulas. A reader who wants one has to select it by hand, which is awkward for a listing longer than the screen and impossible to do cleanly on a phone. I'd like every code block to offer two actions, copy and download. The site has built nothing for this yet. This asks PUDL for it first, because the actions belong to any code block, and PUDL has no glyphs for them.

## What the reader sees

A code block gains a header strip above the code. The strip names the language on its left, when the block has one, and holds two small raised buttons on its right:

- **Copy** puts the block's text on the clipboard. The button's glyph turns into a check for two seconds, and a live region says "Copied".
- **Download** saves the text as a file, named from the block and with an extension for its language.

I considered two layouts and recommend the header strip:

- **A header strip.** It never covers code, it shows the language (which readers find useful on its own), and the buttons can stay visible all the time. It costs one row of height per block.
- **Buttons floating over the block's top corner,** as on GitHub. This takes no height, but the buttons cover the end of the first line, and they usually hide until hover, which a keyboard or touch reader can't discover.

The buttons are raised because they are pressable. The strip and the code are flat, because they are for reading, as `pre.code` already is.

## Proposed contract

**Glyphs.** Two new mask tokens join the file glyphs from 0.25.0:

- `--glyph-copy`: two overlapping rounded rectangles.
- `--glyph-download`: an arrow pointing down into a tray.

The confirmation uses the existing `--glyph-check`.

**Markup.** An author, or a server, marks a block that should carry actions:

```html
<pre class="code" data-code-actions data-code-filename="exercise-0-0.cpp"><code class="language-cpp">…</code></pre>
```

`data-code-filename` is optional. The optional `pudl-code.js` wraps each marked block, so the strip stays outside the `pre`, whose content is text:

```html
<div class="code-block">
  <div class="code-head">
    <span class="code-lang">C++</span>
    <span class="code-actions">
      <button type="button" class="icon-btn" data-code-copy aria-label="Copy code">
        <span class="glyph" style="--glyph: var(--glyph-copy)" aria-hidden="true"></span></button>
      <button type="button" class="icon-btn" data-code-download aria-label="Download code">
        <span class="glyph" style="--glyph: var(--glyph-download)" aria-hidden="true"></span></button>
    </span>
  </div>
  <pre class="code" data-code-actions>…</pre>
</div>
```

Without script, the block is the plain `pre.code` it always was. The buttons do nothing without script, so the script adds them rather than the server rendering them.

**Script.** `pudl-code.js` enhances every `pre[data-code-actions]` when the page loads, when a window opens and after regions swap, as the tree and grid scripts do. `pudlCode.enhance(scope)` takes in blocks a host adds by other means, and so does `pudlCode.enhance(preElement)` for a single block, which is how a site whose Markdown writes a bare `pre` would take part. Enhancing a block twice changes nothing.

**Copying.**
- The text is the `code` element's `textContent`, so highlighting markup never reaches the clipboard.
- The script uses `navigator.clipboard.writeText`. That is not available outside a secure context, and it can be refused. When it is missing or fails, the script selects the block's text and the live region says "Press Ctrl+C to copy" (Command+C on a Mac), so the reader is never left with nothing.
- The confirmation is on the button itself, not a toast, because the reader's attention is already there.

**Downloading.** The script makes a `text/plain` Blob and saves it through a temporary link with `download` set. It picks the name in this order:
1. The block's `data-code-filename`.
2. Otherwise `code` plus an extension for the block's language, taken from its `language-` class through a small built-in map. A project extends the map through `pudlCode.extensions`.
3. Otherwise `code.txt`.

A page with several unnamed blocks of the same language gives them the same name, and the browser numbers the copies. I'd rather have that than invent names.

**Language names.** The strip shows a readable name ("C++" for `language-cpp`) from a matching map, `pudlCode.names`, and shows nothing for a block without a language.

**Events.** `pudl:code-copy` and `pudl:code-download` fire on the `pre` after each action, with `detail.ok` for the copy, for a host that wants to count or log them.

## Sample implementation

### CSS for `pudl.css`

```css
.code-block { margin: 0 0 var(--space-4); border-radius: var(--radius-sm); background: var(--surface-alt); }
.code-block > pre.code { margin: 0; border-radius: 0 0 var(--radius-sm) var(--radius-sm); }
.code-head {
  display: flex; align-items: center; gap: var(--space-2);
  padding: 4px 6px 4px var(--space-4);
  border-bottom: 1px solid var(--border);
  font: 600 var(--text-xs)/1.4 var(--font); color: var(--text-muted);
}
.code-lang { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.code-actions { display: inline-flex; gap: 4px; margin-inline-start: auto; }
.code-actions .icon-btn { --glyph-size: 14px; }
.code-actions .icon-btn[data-done] { color: var(--positive); }
@media (forced-colors: active) { .code-head { border-bottom-color: CanvasText; } }
```

### `pudl-code.js`

```js
/* PUDL code blocks. Load with defer. A pre marked data-code-actions gains a
   header strip naming its language, with Copy and Download buttons. */
(function () {
  'use strict';

  var EXT = { cpp: 'cpp', c: 'c', csharp: 'cs', cs: 'cs', javascript: 'js', js: 'js', typescript: 'ts',
              python: 'py', go: 'go', rust: 'rs', java: 'java', json: 'json', xml: 'xml', html: 'html',
              css: 'css', sh: 'sh', bash: 'sh', shell: 'sh', powershell: 'ps1', sql: 'sql', markdown: 'md',
              yaml: 'yml', brainfuck: 'b' };
  var NAMES = { cpp: 'C++', c: 'C', csharp: 'C#', cs: 'C#', javascript: 'JavaScript', js: 'JavaScript',
                typescript: 'TypeScript', python: 'Python', go: 'Go', rust: 'Rust', java: 'Java', json: 'JSON',
                xml: 'XML', html: 'HTML', css: 'CSS', sh: 'Shell', bash: 'Bash', shell: 'Shell',
                powershell: 'PowerShell', sql: 'SQL', markdown: 'Markdown', yaml: 'YAML', brainfuck: 'Brainf**k' };
  var DONE_MS = 2000;

  function langOf(pre) {
    var code = pre.querySelector('code') || pre;
    var m = /(?:^|\s)language-([\w+#-]+)/.exec(code.className);
    return m ? m[1].toLowerCase() : null;
  }
  function textOf(pre) { return (pre.querySelector('code') || pre).textContent; }

  function button(kind, label, glyph) {
    return '<button type="button" class="icon-btn" data-code-' + kind + ' aria-label="' + label + '">' +
           '<span class="glyph" style="--glyph: var(--glyph-' + glyph + ')" aria-hidden="true"></span></button>';
  }

  function enhanceOne(pre) {
    if (pre.parentElement && pre.parentElement.classList.contains('code-block')) return;
    var lang = langOf(pre);
    var wrap = document.createElement('div');
    wrap.className = 'code-block';
    wrap.innerHTML = '<div class="code-head"><span class="code-lang"></span><span class="code-actions">' +
      button('copy', 'Copy code', 'copy') + button('download', 'Download code', 'download') +
      '</span><span class="visually-hidden" role="status" aria-live="polite"></span></div>';
    wrap.querySelector('.code-lang').textContent = lang ? (window.pudlCode.names[lang] || lang) : '';
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);
  }

  function enhance(scope) {
    if (scope && scope.matches && scope.matches('pre')) { enhanceOne(scope); return; }
    (scope || document).querySelectorAll('pre[data-code-actions]').forEach(enhanceOne);
  }

  function say(wrap, text) { var s = wrap.querySelector('[role="status"]'); s.textContent = ''; s.textContent = text; }

  function done(btn, label) {
    var glyph = btn.querySelector('.glyph'), was = btn.getAttribute('aria-label');
    btn.setAttribute('data-done', '');
    glyph.style.setProperty('--glyph', 'var(--glyph-check)');
    setTimeout(function () {
      btn.removeAttribute('data-done');
      glyph.style.setProperty('--glyph', 'var(--glyph-copy)');
      btn.setAttribute('aria-label', was);
    }, DONE_MS);
  }

  function selectText(pre) {
    var r = document.createRange();
    r.selectNodeContents(pre.querySelector('code') || pre);
    var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }

  function copy(wrap, btn, pre) {
    var text = textOf(pre);
    var fire = function (ok) { pre.dispatchEvent(new CustomEvent('pudl:code-copy', { bubbles: true, detail: { ok: ok } })); };
    var fallback = function () {
      selectText(pre);
      say(wrap, /Mac|iPhone|iPad/.test(navigator.platform) ? 'Press Command+C to copy' : 'Press Ctrl+C to copy');
      fire(false);
    };
    if (!navigator.clipboard || !window.isSecureContext) { fallback(); return; }
    navigator.clipboard.writeText(text).then(function () { done(btn); say(wrap, 'Copied'); fire(true); }, fallback);
  }

  function download(pre) {
    var lang = langOf(pre);
    var name = pre.getAttribute('data-code-filename') ||
      ('code.' + ((lang && window.pudlCode.extensions[lang]) || 'txt'));
    var url = URL.createObjectURL(new Blob([textOf(pre)], { type: 'text/plain;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    pre.dispatchEvent(new CustomEvent('pudl:code-download', { bubbles: true, detail: { name: name } }));
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.code-block [data-code-copy], .code-block [data-code-download]');
    if (!btn) return;
    var wrap = btn.closest('.code-block'), pre = wrap.querySelector(':scope > pre');
    if (btn.hasAttribute('data-code-copy')) copy(wrap, btn, pre); else download(pre);
  });

  window.pudlCode = { enhance: enhance, extensions: EXT, names: NAMES };
  function init() { enhance(document); }
  document.addEventListener('pudl:window-open', function (e) { enhance(e.target); });
  document.addEventListener('pudl:regions-swap', init);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
```

The sample assumes a visually-hidden utility class; PUDL may already have one under another name, in which case the live region should use it.

### Glyphs

These are drawn in PUDL's 16-unit stroke style:

```css
--glyph-copy: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.5' stroke-linejoin='round'%3E%3Crect x='5.5' y='5.5' width='8' height='8.5' rx='1.5'/%3E%3Cpath d='M10.5 5.5V3.5a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3.5V9A1.5 1.5 0 0 0 4 10.5h1.5'/%3E%3C/svg%3E");
--glyph-download: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M8 2.5v8M4.5 7.5L8 11l3.5-3.5'/%3E%3Cpath d='M2.5 11.5v1.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1.5'/%3E%3C/svg%3E");
```

## How the site would adopt it

The site's articles are Markdown and HTML, and both write a bare `pre`, so the site would call `pudlCode.enhance(pre)` from the pass that already highlights each block. That pass runs on classic pages, in every window, and after htmx inserts code into the three articles that load their listings that way. The articles that fetch C++ solutions from `/src/…/exercise-0-0.cpp` would set `data-code-filename` from the source's own name, so a download saves `exercise-0-0.cpp` rather than `code.cpp`. Nothing on the site needs deleting, because the site has built nothing for this.

## Questions for PUDL

1. **Header strip or corner overlay.** I recommend the strip for the reasons above. If PUDL prefers the overlay, the buttons should still never hide from keyboard or touch readers.
2. **The language maps.** The script needs some default maps. How large should PUDL's be before the rest is the project's business?
3. **Opting in.** The sample enhances only blocks marked `data-code-actions`, plus any block a host hands to `enhance()`. An alternative is to enhance every `pre.code`. I lean towards the explicit mark, because a short inline example doesn't want a toolbar.
