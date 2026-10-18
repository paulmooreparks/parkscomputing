/* Conway (pudl-conway), Dice (pudl-dice), the Theme Studio and the Diff
   Viewer (pudl-tools) as installed applet packages: each page runs its
   package, Conway's 2015 article still opens a shared board from its own
   address and lists the game's source, Open this board reaches the game
   in a window, the Theme Studio's preview loads PUDL from where the site
   keeps it, and the Diff Viewer opens a file through the site's dialog and
   reads the paths its address keeps. It runs signed out, so ~ is this
   browser's own.

     PLAYWRIGHT_MODULE=... CHROMIUM_PATH=... UI_SITE=http://localhost:8102 node Tools/test-small-packages.js */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.UI_SITE || 'http://localhost:8102';

let failures = 0;
function log(name, ok, detail) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + String(detail || '').slice(0, 400))); if (!ok) { failures++; } }

(async () => {
  const browser = await chromium.launch(Object.assign({ args: process.env.HOST_MAP ? ['--host-resolver-rules=' + process.env.HOST_MAP] : [] }, process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}));
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
  const errors = [], scripts = [];
  page.on('pageerror', e => errors.push(page.url() + ': ' + e.message));
  page.on('request', r => { const p = new URL(r.url()).pathname; if (/\.js$/.test(p)) { scripts.push(p); } });
  const ran = (pkg, file) => scripts.includes('/applets/' + pkg + '/' + file) && !scripts.includes('/js/' + file);

  // Conway's article, opened from a link of the kind shared since 2015.
  const board = 'boardSize=30&cellSize=6&wrap=false&init=1,0;2,1;0,2;1,2;2,2';
  await page.goto(BASE + '/page/conways-game-of-life?' + board, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-applet="conway"] canvas', { timeout: 30000 });
  log('Conway\'s article runs the package\'s script', ran('conway', 'conway.js'), scripts.filter(s => /conway/.test(s)).join());
  const live = await page.evaluate(() => { const el = document.querySelector('[data-applet="conway"] [data-role="live"], [data-applet="conway"] .conway-live'); return el ? el.textContent.trim() : null; });
  log('the shared glider is on the board: five live cells', live === '5', live);
  await page.waitForFunction(() => { const c = document.querySelector('pre code[data-code-src="/applets/conway/conway.js"]'); return c && c.textContent.length > 1000; }, null, { timeout: 15000 }).catch(() => { });
  log('the article lists the game\'s source from the package', await page.evaluate(() => { const c = document.querySelector('pre code[data-code-src="/applets/conway/conway.js"]'); return !!c && /Conway/.test(c.textContent); }));

  // Conway in a window: Open this board through PUDL's request.
  await page.goto(BASE + '/?view=window&open=conway&top=conway', { waitUntil: 'networkidle' });
  await page.waitForSelector('.win[data-win="conway"] [data-applet="conway"] canvas', { timeout: 30000 });
  log('Conway opens in a window with its icon', (await page.getAttribute('.win[data-win="conway"]', 'data-window-icon')) === '/images/icons/conway.svg');
  const handled = await page.evaluate(b => {
    const p = new URLSearchParams(b), req = { path: p.get('init') };
    ['boardSize', 'cellSize', 'wrap'].forEach(k => { req[k] = p.get(k); });
    return pudlApplets.request('board', req, null);
  }, board);
  await page.waitForTimeout(500);
  const winLive = await page.evaluate(() => { const el = document.querySelector('.win[data-win="conway"] [data-role="live"], .win[data-win="conway"] .conway-live'); return el ? el.textContent.trim() : null; });
  log('a board request reaches the game in its window', handled === true && winLive === '5' && (await page.locator('.win[data-applet="conway"], .win [data-applet="conway"]').count()) === 1, handled + ' ' + winLive);

  // Dice.
  scripts.length = 0;
  await page.goto(BASE + '/page/dice', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-applet="dice"] .dice-roll', { timeout: 30000 });
  await page.click('[data-applet="dice"] .dice-roll');
  await page.waitForTimeout(300);
  log('Dice runs its package and rolls', ran('dice', 'dice.js') && /\d/.test(await page.textContent('[data-applet="dice"] .dice-total')), await page.textContent('[data-applet="dice"] .dice-total'));

  // The Theme Studio's preview.
  scripts.length = 0;
  await page.goto(BASE + '/page/theme-studio', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-applet="theme-studio"] iframe[data-ts-frame="light"]', { timeout: 30000 });
  await page.waitForTimeout(1500);
  const frame = await page.evaluate(() => {
    const f = document.querySelector('[data-applet="theme-studio"] iframe[data-ts-frame="light"]'), d = f.contentDocument;
    const sheet = [...d.styleSheets].find(s => /\/pudl\/pudl\.css/.test(s.href || ''));
    return { src: f.getAttribute('src'), pudl: !!sheet && sheet.cssRules.length > 50, theme: !!d.getElementById('theme') && d.getElementById('theme').textContent.length > 0, preview: [...d.styleSheets].some(s => /\/applets\/theme-studio\/preview\.css/.test(s.href || '')) };
  });
  log('the Theme Studio runs its package', ran('theme-studio', 'theme-studio.js'), scripts.filter(s => /theme/.test(s)).join());
  log('its preview is the package\'s page, with PUDL from where the site keeps it', /\/applets\/theme-studio\/preview\.html\?v=[^&]+&pudl=%2Fpudl%2F$/.test(frame.src) && frame.pudl && frame.preview, JSON.stringify(frame));
  log('and the studio writes its palette into the preview', frame.theme, JSON.stringify(frame));

  // The Diff Viewer.
  scripts.length = 0;
  await page.goto(BASE + '/page/diff', { waitUntil: 'networkidle' });
  await page.evaluate(() => Promise.all([pudlHost.fs.writeText('~/diff-a.txt', 'one\ntwo\nthree\n'), pudlHost.fs.writeText('~/diff-b.txt', 'one\n2\nthree\n')]));
  await page.goto(BASE + '/page/diff?pa=~/diff-a.txt&pb=~/diff-b.txt', { waitUntil: 'networkidle' });
  const sideText = k => page.evaluate(k => { const t = document.querySelector('[data-applet="diff"] [data-df-text="' + k + '"]'); return t ? t.value : null; }, k);
  await page.waitForFunction(() => { const t = document.querySelector('[data-applet="diff"] [data-df-text="b"]'); return t && /2/.test(t.value); }, null, { timeout: 15000 }).catch(() => { });
  log('the Diff Viewer runs its package', ran('diff', 'diff.js') && !scripts.includes('/js/textdiff.js'), scripts.filter(s => /diff/.test(s)).join());
  log('and reads the two paths its address keeps', /two/.test(await sideText('a')) && /^one\n2\n/.test(await sideText('b') || ''), JSON.stringify([await sideText('a'), await sideText('b')]));
  await page.click('[data-applet="diff"] [data-df-open="a"]');
  await page.waitForSelector('dialog[open] [data-pick="input"]', { timeout: 10000 });
  await page.fill('dialog[open] [data-pick="input"]', '~/diff-b.txt');
  await page.click('dialog[open] [data-pick="ok"]');
  await page.waitForTimeout(500);
  log('Open goes through the site\'s dialog', !(await page.$('dialog[open] [data-pick="input"]')) && /^one\n2\n/.test(await sideText('a') || ''), JSON.stringify(await sideText('a')));

  log('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
