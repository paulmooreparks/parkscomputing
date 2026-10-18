/* Sudoku as an installed applet package (pudl-sudoku, wwwroot/applets/sudoku):
   the site's page runs the package's script, the game plays, its state is
   kept under the key it always had, its window opens with its menu and
   icon, and its page still links the web-app manifest.

     PLAYWRIGHT_MODULE=... CHROMIUM_PATH=... UI_SITE=http://localhost:8102 node Tools/test-sudoku-package.js */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.UI_SITE || 'http://localhost:8102';

let failures = 0;
function log(name, ok, detail) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + String(detail || '').slice(0, 400))); if (!ok) { failures++; } }

(async () => {
  const browser = await chromium.launch(Object.assign({ args: process.env.HOST_MAP ? ['--host-resolver-rules=' + process.env.HOST_MAP] : [] }, process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}));
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const scripts = [];
  page.on('request', r => { if (/sudoku\.js/.test(r.url())) { scripts.push(new URL(r.url()).pathname); } });

  await page.goto(BASE + '/page/sudoku', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-applet="sudoku"] [data-cell="0-0"]', { timeout: 30000 });
  log('the page runs the package\'s script, not the site\'s old one', scripts.includes('/applets/sudoku/sudoku.js') && !scripts.includes('/js/sudoku.js'), scripts.join());
  log('the board has its 81 cells', (await page.locator('[data-applet="sudoku"] [data-cell]').count()) === 81);
  log('the page still links the web-app manifest', (await page.getAttribute('link[rel="manifest"]', 'href').catch(() => null)) === '/sudoku.webmanifest');

  const empty = await page.evaluate(() => { const c = [...document.querySelectorAll('[data-applet="sudoku"] [data-cell]')].find(e => !e.querySelector('.main-number').textContent.trim()); return c && c.getAttribute('data-cell'); });
  await page.click('[data-cell="' + empty + '"]');
  await page.keyboard.press('5');
  await page.waitForTimeout(300);
  log('a digit typed in an empty cell goes in', (await page.textContent('[data-cell="' + empty + '"] .main-number')).trim() === '5', empty);
  await page.waitForTimeout(500);
  log('the game is kept under the key it always had, pc-sudoku', !!(await page.evaluate(() => localStorage.getItem('pc-sudoku'))));

  await page.goto(BASE + '/?view=window&open=sudoku&top=sudoku', { waitUntil: 'networkidle' });
  await page.waitForSelector('.win[data-win="sudoku"] [data-cell="0-0"]', { timeout: 30000 });
  log('it opens in a window with its icon', (await page.getAttribute('.win[data-win="sudoku"]', 'data-window-icon')) === '/images/icons/sudoku.svg');
  const menu = await page.evaluate(() => {
    const src = pudlApplets.menuSourceIn(document.querySelector('.win[data-win="sudoku"]'));
    const m = src && src.menus && src.menus();
    return m ? m.titles.map(t => t.label + ':' + (t.items || []).map(i => typeof i === 'string' ? i : i.label).join('|')).join(' / ') : '';
  });
  log('its menus are the host kit\'s: the window\'s commands and its own', /^Sudoku:.*Open as a page/.test(menu) && /New/.test(menu), menu);

  log('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
