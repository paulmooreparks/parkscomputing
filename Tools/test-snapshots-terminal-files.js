// Snapshots across a reload for the terminal and Files. See
// test-snapshots-editor.js for how to run these.
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
  const shot = n => page.screenshot({ path: path.join(process.env.SHOTS || require('os').tmpdir(), 'snap2-' + n + '.png') });
  const screen = () => page.evaluate(() => document.querySelector('.win[data-win="terminal"] .xterm-rows')?.innerText || '');

  await page.goto(BASE + '/page/editor', { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const F = window.pcSiteFs; await F.load();
    await F.write(F.home(), '~/long.md', Array.from({ length: 400 }, (_, i) => 'line ' + (i + 1) + ' of a long file').join('\n') + '\n', false);
    for (let i = 0; i < 40; i++) { await F.write(F.home(), '~/notes-' + String(i).padStart(2, '0') + '.txt', 'note ' + i, false); }
  });

  // The terminal: some output, and a command half typed.
  await page.goto(BASE + '/?open=terminal', { waitUntil: 'networkidle' });
  await page.waitForSelector('.win[data-win="terminal"] .xterm-rows');
  await page.click('.win[data-win="terminal"] .xterm-screen');
  await page.keyboard.type('cd ~\n'); await page.waitForTimeout(300);
  await page.keyboard.type('echo snapshot marker 123\n'); await page.waitForTimeout(300);
  await page.keyboard.type('cat lon');
  await page.waitForTimeout(900);
  const before = await screen();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.win[data-win="terminal"] .xterm-rows');
  await page.waitForTimeout(1200);
  const after = await screen();
  log('the terminal screen comes back', /snapshot marker 123/.test(after) && !/in terminal mode/.test(after.split('snapshot marker')[1] || ''), after.slice(-200));
  log('the half-typed command is still on the line', /cat lon\s*$/.test(after.trimEnd()), after.trimEnd().slice(-60));
  await page.keyboard.type('g.md | grep "line 7 of"\n');
  await page.waitForTimeout(800);
  log('it can be finished and run', /line 7 of a long file/.test(await screen()), (await screen()).trimEnd().slice(-120));
  log('the keyboard is in the terminal', await page.evaluate(() => !!document.activeElement?.closest?.('.win[data-win="terminal"]')));
  await shot('terminal');

  // A full-screen program running when the page reloads.
  await page.keyboard.type('less long.md\n');
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.win[data-win="terminal"] .xterm-rows');
  await page.waitForTimeout(1200);
  const ended = await screen();
  log('a program running at the reload is said to have ended', /ended the program that was running/.test(ended.replace(/\n/g, '')) && /line 7 of a long file/.test(ended), ended.trimEnd().slice(-160));
  await shot('terminal-ended');

  // Files: a folder, a selection and a scroll.
  await page.goto(BASE + '/?open=files', { waitUntil: 'networkidle' });
  await page.waitForSelector('.win[data-win="files"] [data-fb="rows"] tr');
  await page.evaluate(() => window.pudlApplets && 0);
  await page.evaluate(() => { const a = document.querySelector('.win[data-win="files"] [data-fb="tree"] a[data-path="/home"]') ; return !!a; });
  // Go to ~ through the tree, select a file further down, and scroll.
  await page.click('.win[data-win="files"] [data-fb="tree"] a[aria-current], .win[data-win="files"] [data-fb="tree"] a');
  await page.waitForTimeout(400);
  const target = page.locator('.win[data-win="files"] [data-fb="rows"] tr[data-name="notes-30.txt"]');
  await target.scrollIntoViewIfNeeded();
  await target.click();
  await page.waitForTimeout(900);
  const fb = () => page.evaluate(() => {
    const w = document.querySelector('.win[data-win="files"]');
    const sel = w.querySelector('[data-fb="rows"] tr[aria-selected="true"]');
    const s = ['list', 'main', 'tree'].map(k => { const e = w.querySelector('[data-fb="' + k + '"]'); return e ? e.scrollTop : null; });
    return { sel: sel && sel.getAttribute('data-name'), scroll: s, crumbs: w.querySelector('[data-fb="crumbs"]')?.innerText };
  });
  const fbBefore = await fb();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.win[data-win="files"] [data-fb="rows"] tr');
  await page.waitForTimeout(1200);
  const fbAfter = await fb();
  log('Files is in the same folder', fbAfter.crumbs === fbBefore.crumbs, fbBefore.crumbs + ' / ' + fbAfter.crumbs);
  log('Files keeps its selection', fbAfter.sel === fbBefore.sel && fbBefore.sel === 'notes-30.txt', fbBefore.sel + ' / ' + fbAfter.sel);
  log('Files keeps its scroll', JSON.stringify(fbAfter.scroll) === JSON.stringify(fbBefore.scroll), JSON.stringify(fbBefore.scroll) + ' / ' + JSON.stringify(fbAfter.scroll));
  await shot('files');
  log('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
