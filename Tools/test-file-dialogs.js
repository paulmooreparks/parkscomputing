/* Browser checks for Open and Save as (pcFileBrowser.pick in js/filebrowser.js),
   as the Editor uses them: New folder, the plain note in a folder that can't
   take the file, the dialog staying open while the editor writes or reads and
   showing there why it couldn't, Escape doing nothing meanwhile, and the size
   the dialog was last given being kept.

     PLAYWRIGHT_MODULE=... CHROMIUM_PATH=... UI_SITE=http://localhost:8102 node Tools/test-file-dialogs.js

   It runs signed out, so ~ is this browser's own. A failing write or read is
   made by wrapping the site file system's own function for one call. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.UI_SITE || 'http://localhost:8102';

let failures = 0;
function log(name, ok, detail) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + (detail || ''))); if (!ok) { failures++; } }

(async () => {
  const browser = await chromium.launch(Object.assign({ args: process.env.HOST_MAP ? ['--host-resolver-rules=' + process.env.HOST_MAP] : [] }, process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}));
  const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/page/editor', { waitUntil: 'networkidle' });
  await page.waitForSelector('.cm-content');
  await page.evaluate(async () => { const F = window.pcSiteFs; await F.load(); await F.write(F.home(), '~/dialog-src.txt', 'from the dialog test\n', false); });

  /* The Editor's commands, run as pressing them would (PUDL 0.68.0's command table). */
  const action = a => page.evaluate(a => { window.pudlCommands.run(a, undefined, document.querySelector('.pc-editor')); }, a);
  const dlg = '.fb-picker[open]';
  const state = () => page.evaluate(() => {
    const d = document.querySelector('.fb-picker[open]');
    if (!d) { return null; }
    const q = s => d.querySelector('[data-pick="' + s + '"]');
    return {
      busy: d.classList.contains('fb-pick-busy'),
      note: q('note').hidden ? '' : q('note').textContent,
      error: q('error').hidden ? '' : q('error').textContent,
      inputOff: q('input').disabled, okOff: q('ok').disabled, ok: q('ok').textContent,
      downloadMain: !!(q('download') && q('download').classList.contains('btn-primary')),
      crumbs: (d.querySelector('[data-fb="crumbs"]') || {}).textContent || '',
      w: d.offsetWidth, h: d.offsetHeight
    };
  });
  const press = s => page.click(dlg + ' [data-pick="' + s + '"]');

  // Save as, with New folder.
  await page.click('.cm-content');
  await page.keyboard.type('saved by the dialog test');
  await action('save-as');
  await page.waitForSelector(dlg);
  let s = await state();
  log('Save as opens in ~, ready to save', s && !s.note && !s.inputOff && !s.okOff, JSON.stringify(s));
  await press('newfolder');
  await page.fill(dlg + ' [data-pick="newname"]', 'dialog-made');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !!window.pcSiteFs.resolve(window.pcSiteFs.home(), '~/dialog-made'), null, { timeout: 10000 }).catch(() => {});
  const made = await page.evaluate(() => { const n = window.pcSiteFs.resolve(window.pcSiteFs.home(), '~/dialog-made'); return !!(n && n.children); });
  const rowHidden = await page.evaluate(() => document.querySelector('.fb-picker[open] [data-pick="newrow"]').hidden);
  log('New folder makes a folder in ~ and puts its row away', made && rowHidden, JSON.stringify({ made, rowHidden }));
  log('the new folder is selected in the list', await page.evaluate(() => /dialog-made/.test((document.querySelector('.fb-picker[open] [aria-selected="true"]') || {}).textContent || '')));
  const again = await page.evaluate(() => { const d = document.querySelector('.fb-picker[open]'); d.querySelector('[data-pick="newfolder"]').click(); d.querySelector('[data-pick="newname"]').value = 'dialog-made'; d.querySelector('[data-pick="make"]').click(); return new Promise(r => setTimeout(() => r(d.querySelector('[data-pick="error"]').textContent), 300)); });
  log('a folder that already exists is said so in the dialog', /already exists/.test(again), again);
  await press('nomake');

  // A folder that can't take the file.
  await page.evaluate(() => { const d = document.querySelector('.fb-picker[open]'); d.querySelector('[data-pick="input"]').value = ''; });
  await press('up');
  await page.waitForTimeout(300);
  s = await state();
  log('a read-only folder says so plainly, not as an error', /read-only/.test(s.note) && !s.error, JSON.stringify(s));
  log('there, the name and Save are off and Download is the main button', s.inputOff && s.okOff && s.downloadMain, JSON.stringify(s));
  log('New folder is off in a read-only folder', await page.evaluate(() => document.querySelector('.fb-picker[open] [data-pick="newfolder"]').disabled));
  await press('home');
  await page.waitForTimeout(300);
  s = await state();
  log('back in ~, the note goes and Save comes back', !s.note && !s.inputOff && !s.okOff && !s.downloadMain, JSON.stringify(s));

  // A write that fails keeps the dialog open and says why there.
  await page.fill(dlg + ' [data-pick="input"]', 'dialog-saved.txt');
  await page.evaluate(() => { const F = window.pcSiteFs, real = F.write; F.write = function () { F.write = real; return Promise.resolve({ error: 'the disk is full' }); }; });
  await press('ok');
  await page.waitForTimeout(400);
  s = await state();
  log('a failed save keeps the dialog open with the reason in it', s && /Not saved: the disk is full/.test(s.error) && !s.busy, JSON.stringify(s));

  // While it writes, the dialog is busy and Escape does nothing.
  await page.evaluate(() => { const F = window.pcSiteFs, real = F.write; F.write = function () { const a = arguments; F.write = real; return new Promise(r => { window.__release = () => r(real.apply(F, a)); }); }; });
  await press('ok');
  await page.waitForTimeout(200);
  s = await state();
  log('while it saves, the dialog is busy', s && s.busy && /Saving/.test(s.ok), JSON.stringify(s));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  log('Escape does not close it while busy', !!(await state()));
  await page.evaluate(() => window.__release());
  await page.waitForSelector(dlg, { state: 'detached', timeout: 10000 }).catch(() => {});
  const saved = await page.evaluate(() => { const n = window.pcSiteFs.resolve(window.pcSiteFs.home(), '~/dialog-saved.txt'); return n ? window.pcSiteFs.readHome(n) : null; });
  log('once written, the dialog closes and the file is there', !(await state()) && /saved by the dialog test/.test(saved || ''), String(saved));
  log('the tab is the saved file', await page.evaluate(() => (document.querySelector('[data-role="where"]') || {}).textContent === '~/dialog-saved.txt'));

  // Open: a read that fails stays open; a good one closes.
  await action('open');
  await page.waitForSelector(dlg);
  const opened = await page.evaluate(() => { const d = document.querySelector('.fb-picker[open]'); d.style.width = '640px'; d.style.height = '520px'; return d.offsetWidth; });
  await page.waitForTimeout(200);
  await page.fill(dlg + ' [data-pick="input"]', '~/dialog-src.txt');
  await page.evaluate(() => { const F = window.pcSiteFs, real = F.read; F.read = function () { F.read = real; return Promise.reject(new Error('the network went away')); }; });
  await press('ok');
  await page.waitForTimeout(400);
  s = await state();
  log('a failed open keeps the dialog open with the reason in it', s && /network went away/i.test(s.error), JSON.stringify(s));
  await press('ok');
  await page.waitForSelector(dlg, { state: 'detached', timeout: 10000 }).catch(() => {});
  log('a good open closes the dialog and opens the file', !(await state()) && await page.evaluate(() => (document.querySelector('[data-role="where"]') || {}).textContent === '~/dialog-src.txt'));

  // The size it was given is the size it opens at next time.
  await action('open');
  await page.waitForSelector(dlg);
  s = await state();
  log('the dialog opens at the size it was last given', Math.abs(s.w - opened) <= 2 && Math.abs(s.h - 520) <= 2, JSON.stringify({ w: s.w, h: s.h, opened }));
  await page.keyboard.press('Escape');
  await page.waitForSelector(dlg, { state: 'detached', timeout: 5000 }).catch(() => {});
  log('Escape closes it when nothing is happening', !(await state()));

  // Tidy ~.
  await page.evaluate(async () => {
    const F = window.pcSiteFs;
    for (const p of ['~/dialog-made', '~/dialog-src.txt', '~/dialog-saved.txt']) { const n = F.resolve(F.home(), p); if (n) { await F.remove(n, true); } }
    try { localStorage.removeItem('pc-picker-size'); } catch (e) { }
  });

  log('no page errors', errors.length === 0, errors.join(' | '));
  console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
