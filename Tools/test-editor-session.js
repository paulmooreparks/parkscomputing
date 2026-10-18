/* The Editor's session (js/editor.js): closing its window with documents
   open, unsaved text and all, and opening it again brings them back as
   they were, without asking whether to save; so does a new browser tab.
   It runs signed out, so the files are this browser's own ~.

     PLAYWRIGHT_MODULE=... CHROMIUM_PATH=... UI_SITE=http://localhost:8102 node Tools/test-editor-session.js */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.UI_SITE || 'http://localhost:8102';

let failures = 0;
function log(name, ok, detail) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + String(detail || '').slice(0, 400))); if (!ok) { failures++; } }

(async () => {
    const browser = await chromium.launch(Object.assign({ args: process.env.HOST_MAP ? ['--host-resolver-rules=' + process.env.HOST_MAP] : [] }, process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}));
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const tabs = p => p.$$eval('.win[data-win="editor"] [data-role="tabs"] [data-tab]', bs => bs.map(b => b.getAttribute('title') + (b.getAttribute('aria-selected') === 'true' ? '*' : '')));
    const text = p => p.evaluate(() => document.querySelector('.win[data-win="editor"] .cm-content').textContent);

    await page.goto(BASE + '/?view=window', { waitUntil: 'networkidle' });
    await page.evaluate(() => Promise.all([pudlHost.fs.writeText('~/session-a.txt', 'Alpha.\n'), pudlHost.fs.writeText('~/session-b.txt', 'Bravo.\n')]));
    await page.evaluate(() => pudlApplets.request('open', { path: '~/session-a.txt', kind: 'file' }));
    await page.waitForSelector('.win[data-win="editor"] .cm-content', { timeout: 30000 });
    await page.waitForFunction(() => /Alpha/.test(document.querySelector('.win[data-win="editor"] .cm-content').textContent));
    await page.evaluate(() => pudlApplets.request('open', { path: '~/session-b.txt', kind: 'file' }));
    await page.waitForFunction(() => /Bravo/.test(document.querySelector('.win[data-win="editor"] .cm-content').textContent));
    await page.click('.win[data-win="editor"] .cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('Unsaved line.');
    await page.waitForTimeout(800);
    const before = await tabs(page);

    // Close the window: nothing asks, and it goes.
    await page.evaluate(() => pudlWindows.close('editor'));
    await page.waitForTimeout(800);
    log('closing the window with unsaved text asks nothing and closes it', (await page.locator('.win[data-win="editor"]').count()) === 0 && (await page.locator('dialog[open]').count()) === 0);
    log('the session is kept', await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pc-editor-session') || 'null'); return !!s && s.tabs.length === 2; }));

    // Open it again.
    await page.evaluate(() => pudlWindows.open('editor'));
    await page.waitForSelector('.win[data-win="editor"] .cm-content', { timeout: 30000 });
    await page.waitForFunction(() => /Unsaved line/.test(document.querySelector('.win[data-win="editor"] .cm-content').textContent), null, { timeout: 10000 }).catch(() => { });
    log('opening it again brings back the same documents, the same one in front', JSON.stringify(await tabs(page)) === JSON.stringify(before), JSON.stringify(await tabs(page)) + ' vs ' + JSON.stringify(before));
    log('with the unsaved text', /Bravo\.\s*Unsaved line\./.test(await text(page)), await text(page));
    log('still marked unsaved', (await page.locator('.win[data-win="editor"] [data-role="tabs"] [aria-selected="true"] .doc-tab-dirty').count()) === 1);

    // A new browser tab, as after the browser restarts.
    const other = await context.newPage();
    other.on('pageerror', e => errors.push(e.message));
    await other.goto(BASE + '/?view=window&open=editor&top=editor', { waitUntil: 'networkidle' });
    await other.waitForSelector('.win[data-win="editor"] .cm-content', { timeout: 30000 });
    await other.waitForFunction(() => /Unsaved line/.test(document.querySelector('.win[data-win="editor"] .cm-content').textContent), null, { timeout: 10000 }).catch(() => { });
    log('a new browser tab opens the Editor as it was left', /Unsaved line/.test(await text(other)) && (await tabs(other)).length === 2, JSON.stringify(await tabs(other)));

    // Closing every document leaves no session.
    await page.evaluate(() => { localStorage.removeItem('pc-editor-session'); });
    await page.evaluate(async () => { for (const p of ['~/session-a.txt', '~/session-b.txt']) { const F = window.pcSiteFs; const n = F.resolve(F.home(), p); if (n) { await F.remove(n, false); } } });

    log('no page errors', errors.length === 0, errors.join(' | '));
    await browser.close();
    console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
    process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
