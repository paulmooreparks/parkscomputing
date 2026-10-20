// Snapshots (js/snapshot.js, Architecture/snapshots-design.md) across a
// reload: the Editor's tabs, cursor, scroll, undo history and search, on
// its own page and in a window, and an article window's scroll. With
// test-snapshots-terminal-files.js and test-snapshots-edges.js, run in
// that order against a site whose ~ is the browser's (signed out):
//   UI_SITE=http://localhost:8102 node Tools/test-snapshots-editor.js
// CHROMIUM_PATH names a browser when Playwright's own isn't installed,
// and SHOTS a folder for the screenshots.
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
  const shot = n => page.screenshot({ path: path.join(process.env.SHOTS || require('os').tmpdir(), 'snap-' + n + '.png') });
  const ed = () => page.evaluate(() => {
    const scroller = document.querySelector('.cm-scroller');
    return {
      tabs: [...document.querySelectorAll('[data-tab]')].map(b => b.textContent),
      front: document.querySelector('[data-tab][aria-selected="true"]')?.textContent,
      pos: document.querySelector('[data-role="pos"]')?.textContent,
      top: scroller ? scroller.scrollTop : null,
      search: !!document.querySelector('.cm-search'),
      query: document.querySelector('.cm-search input[name="search"]')?.value,
      text: document.querySelector('.cm-content')?.innerText || '',
      focused: !!document.activeElement?.closest?.('.cm-editor')
    };
  });

  // A long file in ~, which on the public site is this browser's.
  await page.goto(BASE + '/page/editor', { waitUntil: 'networkidle' });
  await page.waitForSelector('.cm-content');
  const long = Array.from({ length: 400 }, (_, i) => 'line ' + (i + 1) + ' of a long file').join('\n') + '\n';
  await page.evaluate(async t => { const F = window.pcSiteFs; await F.load(); await F.write(F.home(), '~/long.md', t, false); }, long);

  await page.goto(BASE + '/page/editor?file=~/long.md', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('[data-role="where"]')?.textContent === '~/long.md');
  // A scratch tab with text, then back to the long file.
  await page.click('.pc-editor [data-command="new"]');
  await page.keyboard.type('scratch notes');
  await page.click('[data-tab="0"]');
  await page.click('.cm-content');
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < 199; i++) { await page.keyboard.press('ArrowDown'); }
  await page.keyboard.press('End');
  await page.keyboard.type(' EDITED');
  await page.keyboard.press('Control+f');
  await page.keyboard.type('line 42 ');
  await page.click('.cm-content');
  await page.waitForTimeout(800);
  const before = await ed();
  log('before: two tabs, long file in front, edited', before.tabs.length === 2 && /long\.md/.test(before.front) && /EDITED/.test(before.text), JSON.stringify({ tabs: before.tabs, front: before.front, pos: before.pos, top: before.top }));
  await shot('editor-before');

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('[data-role="where"]')?.textContent === '~/long.md', null, { timeout: 15000 });
  await page.waitForTimeout(800);
  const after = await ed();
  await shot('editor-after');
  log('the same tabs come back', JSON.stringify(after.tabs) === JSON.stringify(before.tabs), JSON.stringify(after.tabs));
  log('the same tab is in front', after.front === before.front, after.front);
  log('the cursor is where it was', after.pos === before.pos, before.pos + ' / ' + after.pos);
  log('the scroll is where it was', Math.abs(after.top - before.top) < 30, before.top + ' / ' + after.top);
  log('the search panel is open with its query', after.search && after.query === 'line 42 ', after.query);
  log('the keyboard is in the text', after.focused);
  await page.click('.cm-content');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  const undone = await ed();
  log('undo history came back: undo takes the edit out', !/EDITED/.test(undone.text) && /line 200 of a long file/.test(undone.text));
  await page.keyboard.press('Control+y');
  await page.click('[data-tab="1"]');
  log('the scratch tab kept its text', /scratch notes/.test((await ed()).text));

  // The window view: an article window scrolled, and the Editor beside it.
  await page.goto(BASE + '/?open=coincidences,editor', { waitUntil: 'networkidle' });
  await page.waitForSelector('.win[data-win="coincidences"] .win-body');
  await page.waitForSelector('.win[data-win="editor"] .cm-content');
  await page.evaluate(() => { document.querySelector('.win[data-win="coincidences"] .win-body').scrollTop = 600; });
  await page.waitForTimeout(800);
  const winBefore = await page.evaluate(() => document.querySelector('.win[data-win="coincidences"] .win-body').scrollTop);
  const edBefore = await ed();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.win[data-win="coincidences"] .win-body');
  await page.waitForSelector('.win[data-win="editor"] .cm-content');
  await page.waitForTimeout(1500);
  const winAfter = await page.evaluate(() => document.querySelector('.win[data-win="coincidences"] .win-body').scrollTop);
  log('an article window keeps its scroll', winBefore > 0 && Math.abs(winAfter - winBefore) < 5, winBefore + ' / ' + winAfter);
  const edAfter = await ed();
  log('the windowed Editor keeps its tabs', JSON.stringify(edAfter.tabs) === JSON.stringify(edBefore.tabs), JSON.stringify(edBefore.tabs) + ' / ' + JSON.stringify(edAfter.tabs));
  await shot('window-after');

  // Closing the Editor's window forgets its snapshot.
  // The work from the classic page came along to the window, unsaved, so
  // closing asks first; Don't save closes it.
  await page.evaluate(() => window.pudlWindows.close('editor'));
  await page.waitForTimeout(400);
  const discard = page.locator('.win[data-win="editor"] [data-choice="discard"]');
  if (await discard.isVisible().catch(() => false)) { await discard.click(); }
  await page.waitForTimeout(800);
  const left = await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('pc-snap:win:editor')).length);
  log('closing the window forgets its snapshot', left === 0, left);
  log('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
