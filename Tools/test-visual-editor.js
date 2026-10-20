/* Browser checks for the Editor's visual view (js/editor-visual.js,
   Architecture/wysiwyg-editor-design.md): an article edited on its own page,
   with every change written back to exactly the Markdown it touched.

     PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… UI_SITE=http://localhost:8102 \
       PC_SIGNIN_LINK=<a sign-in link for a super-user> node Tools/test-visual-editor.js

   The link comes from the server: account-link <email> prints one. The test
   writes /wwwroot/content/visual-editor-test.md through the admin mount,
   edits it, and removes it, so run it on a test instance, never the live
   site. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.UI_SITE || 'http://localhost:8102';
const LINK = process.env.PC_SIGNIN_LINK;
const FILE = '/wwwroot/content/visual-editor-test.md';

let failures = 0;
function log(name, ok, detail) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + String(detail || '').slice(0, 400))); if (!ok) { failures++; } }

const SOURCE = [
    '---', 'title: Visual editor test', 'date: 2026-10-17', '---', '',
    '# Visual editor test', '',
    'The first paragraph, with *emphasis*.', '',
    '{{tip:A tip}}', 'Inside the tip.', '{{/tip}}', '',
    '```js', 'let x = 1;', '```', '',
    'The last paragraph.', '',
    '{{figure:/images/pelican-bicycle.png alt="A pelican" width=50% caption="A pelican."}}', '',
    '{{draft-note}}', '## A heading first', '', 'Then a line.', '{{/draft-note}}', ''
].join('\n');

/* What changed between two texts: the one stretch each has that the other doesn't. */
function diff(a, b) {
    let s = 0; while (s < a.length && a[s] === b[s]) { s++; }
    let e = 0; while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) { e++; }
    return { from: a.slice(s, a.length - e), to: b.slice(s, b.length - e) };
}

(async () => {
    if (!LINK) { console.error('PC_SIGNIN_LINK is needed.'); process.exit(2); }
    const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
    const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(LINK);
    await page.locator('form[method="post"] button', { hasText: 'Sign in' }).last().click();
    await page.waitForTimeout(2500);

    // A file of our own, through the admin mount.
    await page.goto(BASE + '/page/editor', { waitUntil: 'load' });
    await page.waitForSelector('.cm-content', { timeout: 30000 });
    const wrote = await page.evaluate(async ([path, text]) => {
        const F = window.pcSiteFs; await F.load();
        const r = await F.write(F.home(), path, text, false);
        return r.error || null;
    }, [FILE, SOURCE]);
    log('the test article is written through the admin mount', !wrote, wrote);

    await page.goto(BASE + '/page/editor?file=' + FILE, { waitUntil: 'load' });
    await page.waitForSelector('.pc-editor [data-command="view-visual"]:not([disabled]):not([hidden])', { timeout: 30000 });
    /* The Editor's text, as CodeMirror shows it: the test article is short
       enough that every line is drawn. */
    const cmText = () => page.evaluate(() => [...document.querySelectorAll('.cm-content .cm-line')].map(l => l.textContent).join('\n'));
    /* An Editor command run as pressing it would, wherever the toolbar has folded it. */
    const runCmd = id => page.evaluate(id => window.pudlCommands.run(id, undefined, document.querySelector('.pc-editor')), id);

    await page.click('.pc-editor [data-command="view-visual"]');
    const frame = await (await page.waitForSelector('iframe.ed-preview')).contentFrame();
    await frame.waitForSelector('.pc-visual', { timeout: 30000 });
    await page.waitForTimeout(1500);
    log('Visual makes the article\'s own page the editor', await frame.isVisible('.post-body .pc-visual h1') && await page.isHidden('.ed-surface'));
    log('a container is drawn in the page\'s own frame', await frame.isVisible('.pc-visual .notice.positive .notice-title'));
    log('a code block is drawn as the page draws it', await frame.isVisible('.pc-visual .pm-source pre'));
    const lead = await frame.evaluate(() => {
        const label = document.querySelector('.pc-visual .sc-draft-note-label'), h = document.querySelector('.pc-visual .sc-draft-note h2');
        return h ? Math.round(h.getBoundingClientRect().top - label.getBoundingClientRect().bottom) : null;
    });
    log('a heading that opens a note sits close under its label', lead !== null && lead < 24, lead);
    /* The toolbar is PUDL's (0.68.0): one row whose groups fold as the room
       runs out, Format first. Widened, nothing folds into a menu; at the
       Classic page's width, Format has folded and the File group has not. */
    const folds = await page.evaluate(async () => {
        const box = document.querySelector('.pc-editor');
        const stages = () => Object.fromEntries([...box.querySelectorAll('.toolbar-group')].map(g => [g.getAttribute('data-toolbar-group'), +(g.getAttribute('data-toolbar-stage') || 1)]));
        const settle = () => new Promise(r => setTimeout(r, 400));
        /* Groups on one row share a middle, give or take their own heights. */
        const rows = () => {
            const mids = [...box.querySelectorAll('.toolbar-group')].filter(g => g.getClientRects().length).map(g => { const r = g.getBoundingClientRect(); return { mid: (r.top + r.bottom) / 2, h: r.height, top: Math.round(r.top) }; });
            const n = mids.filter((m, i) => !mids.slice(0, i).some(o => Math.abs(o.mid - m.mid) < Math.max(o.h, m.h) / 2)).length;
            return n === 1 ? 1 : n + ' ' + JSON.stringify(mids);
        };
        box.style.width = '1900px'; box.style.maxWidth = 'none';
        await settle();
        const wide = { stages: stages(), rows: rows() };
        box.style.width = '720px';
        await settle();
        const narrow = { stages: stages(), rows: rows() };
        box.style.width = ''; box.style.maxWidth = '';
        await settle();
        return { wide, narrow };
    });
    log('with room, no group folds into a menu, on one row', Object.values(folds.wide.stages).every(s => s <= 2) && folds.wide.rows === 1, JSON.stringify(folds.wide));
    log('narrow, Format folds into a menu before File and stays on one row', folds.narrow.stages.Format >= 3 && folds.narrow.stages.File <= 2 && folds.narrow.rows === 1, JSON.stringify(folds.narrow));
    const sorted = await page.evaluate(async () => {
        let ins = null;
        for (let i = 0; i < 50; i++) {
            ins = window.pudlCommands.list(document.querySelector('.pc-editor')).find(c => c.id === 'insert');
            if (ins && ins.items && ins.items.length > 1) { break; }
            await new Promise(r => setTimeout(r, 100));
        }
        const t = (ins && ins.items || []).map(o => o.label);
        return { t, ok: t.length > 1 && t.every((x, i) => i === 0 || t[i - 1].localeCompare(x, undefined, { sensitivity: 'base' }) <= 0) };
    });
    log('the Insert menu is in alphabetical order', sorted.ok, JSON.stringify(sorted.t));
    let base = await cmText();
    log('the Editor\'s text can be read', base === SOURCE, JSON.stringify(base && base.slice(0, 80)));

    // Typing in a paragraph changes only that text.
    await frame.click('.pc-visual > p >> nth=0');
    await page.keyboard.press('End');
    await page.keyboard.type(' Added "here".');
    await page.waitForTimeout(1500);
    let now = await cmText(), d = diff(base, now);
    log('typing in a paragraph writes only what was typed, with curly quotes', d.from === '' && d.to === ' Added “here”.', JSON.stringify(d));
    base = now;

    // Inside the tip.
    await frame.click('.pc-visual .notice .pm-hole p');
    await page.keyboard.press('End');
    await page.keyboard.type(' More inside.');
    await page.waitForTimeout(1500);
    now = await cmText(); d = diff(base, now);
    log('typing in a container\'s body writes only that', d.from === '' && d.to === ' More inside.' && now.includes('{{tip:A tip}}\nInside the tip. More inside.\n{{/tip}}'), JSON.stringify(d));
    base = now;

    // A shortcode typed in a line becomes one.
    await frame.click('.pc-visual > p >> nth=-1');
    await page.keyboard.press('End');
    await page.keyboard.type(' It is {{status:green Done}}');
    await page.waitForTimeout(2500);
    log('a shortcode typed in a line is drawn as the page draws it', await frame.isVisible('.pc-visual .pm-shortcode .badge.positive'));
    now = await cmText(); d = diff(base, now);
    log('and is written as typed', d.from === '' && d.to === ' It is {{status:green Done}}', JSON.stringify(d));
    base = now;

    // Bold from the toolbar, on a word chosen in the page.
    await frame.evaluate(() => {
        const p = document.querySelector('.pc-visual > p');
        const t = p.firstChild, i = t.textContent.indexOf('first');
        const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 5);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await page.waitForTimeout(300);
    /* Bold as the toolbar runs it; at this width the Format group is a
       menu, and its row runs the same command. */
    await page.evaluate(() => window.pudlCommands.run('bold', undefined, document.querySelector('.pc-editor')));
    await page.waitForTimeout(1500);
    now = await cmText(); d = diff(base, now);
    log('Bold from the toolbar\'s command writes **…**', now.includes('The **first** paragraph'), JSON.stringify(d));
    base = now;

    // The paragraph style's keys in the page: Ctrl+3 makes a third-level
    // heading, the style menu says so, and Ctrl+0 makes it a paragraph again.
    const styleNow = () => page.evaluate(() => { const s = window.pudlCommands.list(document.querySelector('.pc-editor')).find(c => c.id === 'style'); return s ? s.current : null; });
    /* At the line's start, since its middle may be the status badge. */
    await frame.click('.pc-visual > p >> nth=-1', { position: { x: 4, y: 6 } });
    await page.waitForTimeout(300);
    const caretIn = await frame.evaluate(() => { const n = getSelection().anchorNode; return n ? (n.nodeType === 3 ? n.parentElement : n).closest('.pc-visual > *').textContent.slice(0, 30) : null; });
    await page.keyboard.press('Control+3');
    await page.waitForTimeout(1500);
    now = await cmText();
    log('Ctrl+3 in the page makes the paragraph a third-level heading', /^### The last paragraph\./m.test(now) && await frame.isVisible('.pc-visual > h3'), now.split('\n').find(l => /last paragraph/.test(l)) + ' / page: ' + await frame.evaluate(() => [...document.querySelectorAll('.pc-visual > *')].map(e => e.tagName).join(',')) + ' / diff ' + JSON.stringify(diff(base, now)) + ' / caret in ' + caretIn);
    log('and the paragraph style says Heading 3', (await styleNow()) === 'Heading 3', await styleNow());
    await page.keyboard.press('Control+0');
    await page.waitForTimeout(1500);
    now = await cmText();
    log('Ctrl+0 in the page makes it a paragraph again', /^The last paragraph\./m.test(now) && (await styleNow()) === 'Paragraph', now.split('\n').find(l => /last paragraph/.test(l)) + ' / ' + await styleNow());
    base = now;

    // A figure pressed in the page opens its form, not the lightbox.
    await frame.click('.pc-visual .sc-figure img');
    await page.waitForSelector('[data-role="figure"][open]', { timeout: 5000 });
    log('pressing a figure opens the figure form with its settings', (await page.inputValue('[data-role="figure-src"]')) === '/images/pelican-bicycle.png' && (await page.inputValue('[data-role="figure-alt"]')) === 'A pelican' && (await page.inputValue('[data-role="figure-width"]')) === '50%' && (await page.inputValue('[data-role="figure-caption"]')) === 'A pelican.');
    log('and not the lightbox', !(await frame.$('.lightbox[open], dialog.lightbox[open]')));
    await page.fill('[data-role="figure-caption"]', 'A pelican, changed.');
    await page.click('[data-role="figure-ok"]');
    await page.waitForTimeout(3000);
    now = await cmText();
    log('the form writes the figure back', now.includes('{{figure:/images/pelican-bicycle.png alt="A pelican" width=50% caption="A pelican, changed."}}'), JSON.stringify(diff(base, now)));
    log('and the page draws it again', /A pelican, changed\./.test(await frame.textContent('.pc-visual .sc-figure')));
    base = now;

    // A source block's Markdown, edited in place.
    await frame.dblclick('.pc-visual .pm-source >> nth=0');
    await frame.waitForSelector('.pm-source-edit textarea');
    await frame.fill('.pm-source-edit textarea', '```js\nlet y = 2;\n```');
    await frame.press('.pm-source-edit textarea', 'Control+Enter');
    await page.waitForTimeout(3000);
    now = await cmText();
    log('a source block\'s Markdown, edited in place, is written back', now.includes('```js\nlet y = 2;\n```') && !now.includes('let x = 1'), JSON.stringify(diff(base, now)));
    log('and the page draws it again', /let y = 2/.test(await frame.textContent('.pc-visual .pm-source pre')));
    base = now;

    // Split: the text on the left, the page on the right, each following the other.
    await page.click('.pc-editor [data-command="view-split"]');
    const frame2 = await (await page.waitForSelector('iframe.ed-preview')).contentFrame();
    await frame2.waitForSelector('.pc-visual', { timeout: 30000 });
    await page.waitForTimeout(1500);
    log('Split shows the text and the page', await page.isVisible('.ed-surface') && await frame2.isVisible('.pc-visual'));
    await page.click('.cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nA paragraph typed as text.\n');
    await page.waitForTimeout(2500);
    log('text typed on the left appears on the page', /A paragraph typed as text\./.test(await frame2.textContent('.pc-visual')));

    // Each tab keeps its own view: another file in front shows its text,
    // and the article comes back in Split.
    await page.evaluate(() => pudlHost.fs.writeText('~/visual-editor-other.txt', 'Another file.\n'));
    await runCmd('open');
    await page.waitForSelector('dialog[open] [data-pick="input"]', { timeout: 10000 });
    await page.fill('dialog[open] [data-pick="input"]', '~/visual-editor-other.txt');
    await page.click('dialog[open] [data-pick="ok"]');
    await page.waitForFunction(() => /Another file/.test(document.querySelector('.cm-content').textContent), null, { timeout: 10000 });
    log('another tab in front shows its text, with no page', await page.isHidden('iframe.ed-preview'));
    await page.click('[data-role="tabs"] [data-tab][title*="visual-editor-test"]');
    await page.waitForTimeout(2500);
    log('the article comes back in the view it was in', (await page.getAttribute('.pc-editor [data-command="view-split"]', 'aria-pressed')) === 'true' && await page.isVisible('iframe.ed-preview'), await page.getAttribute('.pc-editor [data-command="view-split"]', 'aria-pressed'));

    // Preview is no longer a view: it opens the page on the site.
    log('the views are Text, Visual and Split', (await page.$$eval('.pc-editor [data-command-choice="ed-view"] [data-command]', bs => bs.map(b => b.getAttribute('data-command')).join())) === 'view-text,view-visual,view-split');
    const previewBtn = page.locator('.pc-editor [data-command="preview"]');
    log('Preview is a command of its own', /Preview/.test(await previewBtn.getAttribute('aria-label') || await previewBtn.textContent()));
    const [tab] = await Promise.all([page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null), previewBtn.click()]);
    /* The test instance's public origin may not resolve here, so the new
       tab is checked for being there, not for where it went. */
    log('on a page of its own it opens the page in a new tab', !!tab, 'no new tab');
    if (tab) { await tab.close(); }
    log('and says the unsaved text is not on the site yet', /save to see your changes/.test(await page.textContent('[data-role="message"]')), await page.textContent('[data-role="message"]'));
    await page.click('.pc-editor [data-command="view-text"]');
    log('Text hides the page', await page.isHidden('iframe.ed-preview'));

    // The formatting bar on the Markdown itself, in Text.
    log('the formatting commands stay for a Markdown file in Text', await page.evaluate(() => { const b = window.pudlCommands.list(document.querySelector('.pc-editor')).find(c => c.id === 'bold'); return !!b && !b.hidden; }));
    /* The cursor goes to the line by number, through Go to line, since a
       long line wraps and a click lands where the mouse is. */
    const lineNo = (await cmText()).split('\n').findIndex(l => /^The last paragraph\./.test(l)) + 1;
    await page.click('.cm-content');
    await page.keyboard.press('Control+Alt+g');
    await page.waitForSelector('.cm-panel input');
    await page.fill('.cm-panel input', String(lineNo));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await page.waitForTimeout(200);
    const beforeBold = await cmText(), selected = await page.evaluate(() => String(getSelection()).slice(0, 60));
    await runCmd('bold');
    await page.waitForTimeout(300);
    now = await cmText();
    log('Bold wraps the chosen text', /^\*\*The last paragraph\..*\*\*$/m.test(now), 'selected ' + JSON.stringify(selected) + ' change ' + JSON.stringify(diff(beforeBold, now)) + ' active ' + (await page.evaluate(() => document.activeElement.className)));
    await runCmd('bold');
    await page.waitForTimeout(300);
    now = await cmText();
    log('and again takes it off', !/\*\*The last/.test(now) && /^The last paragraph\./m.test(now), now.split('\n').find(l => /last paragraph/.test(l)));
    await runCmd('h2');
    await page.waitForTimeout(300);
    now = await cmText();
    log('H2 marks the line', /^## The last paragraph\./m.test(now), now.split('\n').find(l => /last paragraph/.test(l)));
    await runCmd('paragraph');
    await page.waitForTimeout(300);
    now = await cmText();
    log('Paragraph takes the mark off', /^The last paragraph\./m.test(now), now.split('\n').find(l => /last paragraph/.test(l)));
    // The same keys in the text, which the browser must not take for itself.
    await page.keyboard.press('Control+1');
    await page.waitForTimeout(300);
    now = await cmText();
    log('Ctrl+1 in the text makes the line a first-level heading', /^# The last paragraph\./m.test(now) && (await styleNow()) === 'Heading 1', now.split('\n').find(l => /last paragraph/.test(l)) + ' / ' + await styleNow());
    await page.keyboard.press('Control+6');
    await page.waitForTimeout(300);
    now = await cmText();
    log('Ctrl+6 changes it to a sixth-level heading', /^###### The last paragraph\./m.test(now), now.split('\n').find(l => /last paragraph/.test(l)));
    await page.keyboard.press('Control+0');
    await page.waitForTimeout(300);
    now = await cmText();
    log('Ctrl+0 makes it a paragraph again', /^The last paragraph\./m.test(now) && (await styleNow()) === 'Paragraph', now.split('\n').find(l => /last paragraph/.test(l)));
    const styles = await page.evaluate(() => { const s = window.pudlCommands.list(document.querySelector('.pc-editor')).find(c => c.id === 'style'); return s.items.map(i => i.label + ' ' + i.shortcut).join(', '); });
    log('the paragraph style menu lists Paragraph and six heading levels with their keys', styles === 'Paragraph Ctrl+0, Heading 1 Ctrl+1, Heading 2 Ctrl+2, Heading 3 Ctrl+3, Heading 4 Ctrl+4, Heading 5 Ctrl+5, Heading 6 Ctrl+6', styles);
    await runCmd('bullets');
    await page.waitForTimeout(300);
    now = await cmText();
    log('Bulleted list marks the line', /^- The last paragraph\./m.test(now), now.split('\n').find(l => /last paragraph/.test(l)));
    await runCmd('paragraph');
    await page.waitForTimeout(300);
    await runCmd('insert-figure');
    await page.waitForSelector('[data-role="figure"][open]', { timeout: 5000 });
    log('Insert a figure in Text opens the form, empty', (await page.inputValue('[data-role="figure-src"]')) === '' && (await page.textContent('[data-role="figure-ok"]')) === 'Insert');
    await page.fill('[data-role="figure-src"]', '/images/new.png');
    await page.fill('[data-role="figure-alt"]', 'A new picture');
    await page.fill('[data-role="figure-width"]', '600px');
    await page.click('[data-role="figure-ok"]');
    await page.waitForTimeout(500);
    now = await cmText();
    log('and writes the figure into the text', now.includes('{{figure:/images/new.png alt="A new picture" width=600px}}'), JSON.stringify(now.split('\n').filter(l => /figure/.test(l))));

    // Shortcodes in the text: marked, completed and explained.
    log('a shortcode in the text is marked as one, its name and arguments apart', (await page.locator('.cm-shortcode-name').count()) >= 2 && (await page.locator('.cm-shortcode-args').count()) >= 1, (await page.locator('.cm-shortcode-name').count()) + '/' + (await page.locator('.cm-shortcode-args').count()));
    await page.click('.cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n{{ti');
    await page.waitForSelector('.cm-tooltip-autocomplete', { timeout: 5000 });
    const offered = await page.locator('.cm-tooltip-autocomplete .cm-completionLabel').allTextContents();
    log('{{ offers the shortcodes that match', offered.includes('tip') && !offered.includes('figure'), offered.join());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    now = await cmText();
    log('and accepting one writes its name, inside the braces that closed themselves', /^\{\{tip:\}\}$/m.test(now), now.split('\n').pop());
    await page.keyboard.type('A tip ');
    await page.waitForTimeout(600);
    await page.keyboard.type('x');
    await page.waitForSelector('.cm-tooltip-autocomplete', { timeout: 5000 }).catch(() => { });
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(400);
    const figLine = page.locator('.cm-line', { hasText: '{{figure:/images/pelican' }).first();
    await figLine.locator('.cm-shortcode-name').first().hover();
    await page.waitForSelector('.ed-sc-tip', { timeout: 5000 });
    log('the pointer over a shortcode says what it is and takes', /Figure/.test(await page.textContent('.ed-sc-tip')) && /caption/.test(await page.textContent('.ed-sc-tip')), await page.textContent('.ed-sc-tip'));

    // Tidy up: the file goes, unsaved changes and all.
    await page.evaluate(async path => {
        const F = window.pcSiteFs; const n = F.resolve(F.home(), path);
        if (n) { await F.remove(n, false); }
        const o = F.resolve(F.home(), '~/visual-editor-other.txt');
        if (o) { await F.remove(o, false); }
        localStorage.removeItem('pc-editor-session');
    }, FILE);
    log('no page errors', errors.length === 0, errors.join(' | '));
    console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
    await browser.close();
    process.exit(failures ? 1 : 0);
})();
