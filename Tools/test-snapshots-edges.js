// Snapshot edge cases: a minimised window, a file changed while open and
// between snapshot and reload, two terminals, switching views, and session
// storage that can't be used. See test-snapshots-editor.js for how to run
// these.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');
const BASE = process.env.UI_SITE || 'http://localhost:8102';
const log = (n, ok, x) => console.log((ok ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? ' ' + String(x).slice(0, 300) : ''));
(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  const body = k => page.evaluate(k => document.querySelector('.win[data-win="' + k + '"] .win-body')?.scrollTop, k);

  // 1. A window minimised at the reload keeps its place for when it is shown.
  await page.goto(BASE + '/?open=coincidences', { waitUntil: 'networkidle' });
  await page.waitForSelector('.win[data-win="coincidences"] .win-body');
  await page.evaluate(() => { document.querySelector('.win[data-win="coincidences"] .win-body').scrollTop = 500; });
  await page.waitForTimeout(700);
  await page.evaluate(() => window.pudlWindows.minimize('coincidences'));
  await page.waitForTimeout(700);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.pudlWindows.raise('coincidences'));
  await page.waitForTimeout(800);
  log('a minimised window keeps its place until shown', await body('coincidences') === 500, await body('coincidences'));

  // 2. The file changed somewhere else between the snapshot and the reload:
  //    the cursor stays near its line, and the old undo history is let go.
  await page.goto(BASE + '/page/editor', { waitUntil: 'networkidle' });
  await page.evaluate(async () => { const F = window.pcSiteFs; await F.load(); await F.write(F.home(), '~/changing.md', Array.from({ length: 100 }, (_, i) => 'row ' + (i + 1)).join('\n') + '\n', false); });
  await page.goto(BASE + '/page/editor?file=~/changing.md', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('[data-role="where"]')?.textContent === '~/changing.md');
  await page.click('.cm-content');
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < 49; i++) { await page.keyboard.press('ArrowDown'); }
  await page.waitForTimeout(800);
  // Changed elsewhere while open: a line added at the top, as another tab
  // or the terminal might.
  const where = () => page.evaluate(() => ({ pos: document.querySelector('[data-role="pos"]').textContent, text: document.querySelector('.cm-content').innerText }));
  await page.evaluate(async () => { const F = window.pcSiteFs; await F.write(F.home(), '~/changing.md', 'NEW FIRST LINE\n' + Array.from({ length: 100 }, (_, i) => 'row ' + (i + 1)).join('\n') + '\n', false); });
  await page.waitForTimeout(800);
  let w = await where();
  log('live: the change shows', /NEW FIRST LINE/.test(w.text));
  log('live: the cursor stays on its line, now one further down', /^Line 51,/.test(w.pos), w.pos);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  log('live: undo does not take back a change made elsewhere', /NEW FIRST LINE/.test((await where()).text));

  // Changed between the snapshot and the reload: away to another page,
  // the file changed there, and back.
  await page.waitForTimeout(800);
  await page.goto(BASE + '/page/files', { waitUntil: 'networkidle' });
  await page.evaluate(async () => { const F = window.pcSiteFs; await F.load(); await F.write(F.home(), '~/changing.md', 'TOP\nNEW FIRST LINE\n' + Array.from({ length: 100 }, (_, i) => 'row ' + (i + 1)).join('\n') + '\n', false); });
  await page.goto(BASE + '/page/editor?file=~/changing.md', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('[data-role="where"]')?.textContent === '~/changing.md');
  await page.waitForTimeout(800);
  w = await where();
  log('reload: a changed file opens as it is now', /^TOP/.test(w.text));
  log('reload: its cursor stays near where it was', /^Line 5[012],/.test(w.pos), w.pos);
  await page.click('.cm-content');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  log('reload: old undo history is not applied to new text', /^TOP/.test((await where()).text));

  // 3. Two terminal windows keep apart.
  await page.goto(BASE + '/?open=terminal,terminal-2', { waitUntil: 'networkidle' });
  await page.waitForSelector('.win[data-win="terminal-2"] .xterm-rows');
  for (const [k, word] of [['terminal', 'alpha-one'], ['terminal-2', 'beta-two']]) {
    await page.evaluate(k => window.pudlWindows.raise(k), k);
    await page.waitForTimeout(300);
    await page.click('.win[data-win="' + k + '"] .xterm-screen');
    await page.keyboard.type('echo ' + word + '\n');
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(700);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.win[data-win="terminal-2"] .xterm-rows');
  await page.waitForTimeout(1500);
  const t1 = await page.evaluate(() => document.querySelector('.win[data-win="terminal"] .xterm-rows').innerText);
  const t2 = await page.evaluate(() => document.querySelector('.win[data-win="terminal-2"] .xterm-rows').innerText);
  log('each terminal gets its own screen back', /alpha-one/.test(t1) && !/beta-two/.test(t1) && /beta-two/.test(t2) && !/alpha-one/.test(t2));

  // 3b. Switching views takes the Editor's work along, and moves it.
  await page.goto(BASE + '/?open=editor', { waitUntil: 'networkidle' });
  await page.waitForSelector('.win[data-win="editor"] .cm-content');
  await page.click('.win[data-win="editor"] [data-command="new"]');
  await page.keyboard.type('carried across views');
  await page.waitForTimeout(900);
  await page.goto(BASE + '/page/editor', { waitUntil: 'networkidle' });
  await page.waitForSelector('.cm-content');
  await page.waitForTimeout(800);
  const tabsClassic = await page.evaluate(() => [...document.querySelectorAll('[data-tab]')].map(b => b.textContent));
  const carried = await page.evaluate(async () => {
    const n = document.querySelectorAll('[data-tab]').length;
    for (let i = 0; i < n; i++) { document.querySelector('[data-tab="' + i + '"]').click(); await new Promise(r => setTimeout(r, 100)); if (/carried across views/.test(document.querySelector('.cm-content').innerText)) return true; }
    return false;
  });
  log('switching to the classic view brings the Editor\'s work', carried, JSON.stringify(tabsClassic));
  const leftInWindow = await page.evaluate(() => Object.keys(sessionStorage).filter(k => k === 'pc-snap:win:editor:editor').length);
  log('and moves it rather than copying it', leftInWindow === 0, leftInWindow);

  // 4. Session storage refused: the page works, and simply forgets.
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx2.addInitScript(() => {
    const no = () => { throw new DOMException('denied', 'SecurityError'); };
    Object.defineProperty(window, 'sessionStorage', { get: no });
  });
  const p2 = await ctx2.newPage();
  const errors2 = []; p2.on('pageerror', e => errors2.push(e.message));
  await p2.goto(BASE + '/?open=editor,terminal', { waitUntil: 'networkidle' });
  await p2.waitForSelector('.win[data-win="editor"] .cm-content');
  await p2.waitForSelector('.win[data-win="terminal"] .xterm-rows');
  await p2.reload({ waitUntil: 'networkidle' });
  await p2.waitForSelector('.win[data-win="editor"] .cm-content');
  log('without session storage the applets still start', errors2.length === 0, errors2.join(' | '));
  log('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
