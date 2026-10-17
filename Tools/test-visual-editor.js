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
    'The last paragraph.', ''
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
    await page.waitForSelector('[data-role="views"]:not([hidden]) [data-view="visual"]:not([disabled])', { timeout: 30000 });
    /* The Editor's text, as CodeMirror shows it: the test article is short
       enough that every line is drawn. */
    const cmText = () => page.evaluate(() => [...document.querySelectorAll('.cm-content .cm-line')].map(l => l.textContent).join('\n'));

    await page.click('[data-view="visual"]');
    const frame = await (await page.waitForSelector('iframe.ed-preview')).contentFrame();
    await frame.waitForSelector('.pc-visual', { timeout: 30000 });
    await page.waitForTimeout(1500);
    log('Visual makes the article\'s own page the editor', await frame.isVisible('.post-body .pc-visual h1') && await page.isHidden('.ed-surface'));
    log('a container is drawn in the page\'s own frame', await frame.isVisible('.pc-visual .notice.positive .notice-title'));
    log('a code block is drawn as the page draws it', await frame.isVisible('.pc-visual .pm-source pre'));
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
    await page.click('[data-fmt="bold"]');
    await page.waitForTimeout(1500);
    now = await cmText(); d = diff(base, now);
    log('Bold from the toolbar writes **…**', now.includes('The **first** paragraph'), JSON.stringify(d));
    base = now;

    // A source block's Markdown, edited in place.
    await frame.dblclick('.pc-visual .pm-source');
    await frame.waitForSelector('.pm-source-edit textarea');
    await frame.fill('.pm-source-edit textarea', '```js\nlet y = 2;\n```');
    await frame.press('.pm-source-edit textarea', 'Control+Enter');
    await page.waitForTimeout(3000);
    now = await cmText();
    log('a source block\'s Markdown, edited in place, is written back', now.includes('```js\nlet y = 2;\n```') && !now.includes('let x = 1'), JSON.stringify(diff(base, now)));
    log('and the page draws it again', /let y = 2/.test(await frame.textContent('.pc-visual .pm-source pre')));
    base = now;

    // Split: the text on the left, the page on the right, each following the other.
    await page.click('[data-view="split"]');
    const frame2 = await (await page.waitForSelector('iframe.ed-preview')).contentFrame();
    await frame2.waitForSelector('.pc-visual', { timeout: 30000 });
    await page.waitForTimeout(1500);
    log('Split shows the text and the page', await page.isVisible('.ed-surface') && await frame2.isVisible('.pc-visual'));
    await page.click('.cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nA paragraph typed as text.\n');
    await page.waitForTimeout(2500);
    log('text typed on the left appears on the page', /A paragraph typed as text\./.test(await frame2.textContent('.pc-visual')));

    // Preview and back to Text.
    await page.click('[data-view="preview"]');
    await page.waitForTimeout(2500);
    const frame3 = await (await page.waitForSelector('iframe.ed-preview')).contentFrame();
    log('Preview is the page, not editable', !(await frame3.$('.pc-visual')) && /A paragraph typed as text/.test(await frame3.textContent('.post-body')));
    await page.click('[data-view="text"]');
    log('Text hides the page', await page.isHidden('iframe.ed-preview'));

    // Tidy up: the file goes, unsaved changes and all.
    await page.evaluate(async path => {
        const F = window.pcSiteFs; const n = F.resolve(F.home(), path);
        if (n) { await F.remove(n, false); }
    }, FILE);
    log('no page errors', errors.length === 0, errors.join(' | '));
    console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
    await browser.close();
    process.exit(failures ? 1 : 0);
})();
