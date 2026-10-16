/* Browser checks for the actions applets publish (Architecture/applet-platform-design.md,
   P2): the broker (js/applet-actions.js) and its manifests (js/actions), from
   the Terminal's applets command, from Lua and the shell, and from the page.

     PLAYWRIGHT_MODULE=... CHROMIUM_PATH=... UI_SITE=http://localhost:8102 node Tools/test-applet-actions.js

   It runs signed out, so ~ is this browser's own. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.UI_SITE || 'http://localhost:8102';

let failures = 0;
function log(name, ok, detail) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + String(detail || '').slice(0, 400))); if (!ok) { failures++; } }

(async () => {
  const browser = await chromium.launch(Object.assign({ args: process.env.HOST_MAP ? ['--host-resolver-rules=' + process.env.HOST_MAP] : [] }, process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}));
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/page/terminal', { waitUntil: 'networkidle' });
  await page.waitForSelector('.xterm-helper-textarea', { timeout: 30000 });
  await page.waitForTimeout(800);

  const screen = () => page.evaluate(() => [...document.querySelectorAll('.xterm-rows > div')].map(r => r.textContent.replace(/ /g, ' ').trimEnd()).join('\n'));
  /* Types a line on a cleared screen and gives what it printed, once the
     prompt is back and the screen has stopped changing. */
  async function run(line, wait) {
    await page.focus('.xterm-helper-textarea');
    await page.keyboard.press('Control+L');
    await page.waitForTimeout(150);
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
    const deadline = Date.now() + (wait || 20000);
    let rows = [], at = -1, prev = '';
    while (Date.now() < deadline) {
      await page.waitForTimeout(200);
      rows = (await screen()).split('\n').filter(r => r.trim());
      at = commandEnd(rows, line);
      const last = rows[rows.length - 1] || '';
      if (at >= 0 && rows.length - 1 > at && /[$#]$/.test(last.trim())) {
        const now = rows.join('\n');
        if (now === prev) { break; }
        prev = now;
      }
    }
    return at < 0 ? '' : rows.slice(at + 1, rows.length - 1).join('\n');
  }
  /* The last row of the typed line, which wraps when it is long: rows from
     the one it starts on are added until they hold all of it. */
  function commandEnd(rows, line) {
    const bare = s => s.replace(/\s/g, '');
    const start = rows.map(r => bare(r).includes(bare(line.slice(0, 20)))).lastIndexOf(true);
    if (start < 0) { return -1; }
    let joined = '', k = start;
    for (; k < rows.length; k++) { joined += bare(rows[k]); if (joined.includes(bare(line))) { return k; } }
    return -1;
  }
  /* The terminal wraps long lines, so JSON is read back without them. */
  const json = text => { try { return JSON.parse(text.replace(/\n/g, '')); } catch (e) { return null; } };

  // The catalog.
  let out = await run('applets');
  log('applets lists the eight providers', ['parks.page', 'parks.sudoku', 'parks.barcode', 'parks.terminal', 'parks.files', 'parks.editor', 'parks.dice', 'parks.sight-reader'].every(id => out.includes(id)) && !/applets: /.test(out), out);
  out = await run('applets actions parks.files');
  log('applets actions lists one provider\'s actions', /parks\.files\/list@1/.test(out) && /parks\.files\/browse@1/.test(out) && !/dice/.test(out), out);
  out = await run('applets describe parks.dice/roll@1 | grep replay');
  log('describe gives the action as JSON', /"replay": "pure"/.test(out), out);

  // Running actions.
  let v = json(await run('applets run parks.dice/roll@1 dice=3 sides=6'));
  log('run rolls three dice', v && v.values.length === 3 && v.values.every(x => x >= 1 && x <= 6) && v.total === v.values.reduce((a, b) => a + b, 0), JSON.stringify(v));
  out = await run('applets run parks.dice/roll@1 dice=0');
  log('input the schema refuses is an error that says where', /invalid input to parks\.dice\/roll@1 at dice/.test(out), out);
  out = await run('applets run parks.dice/roll@9');
  log('an action that does not exist is an error', /there is no action parks\.dice\/roll@9/.test(out), out);
  v = json(await run('applets run parks.sudoku/solve@1 puzzle=530070000600195000098000060800060003400803001700020006060000280000419005000080079'));
  log('sudoku solves a puzzle with one solution', v && v.solutions === 'one' && v.solution === '534678912672195348198342567859761423426853791713924856961537284287419635345286179', JSON.stringify(v));
  v = json(await run('applets run parks.sudoku/solve@1 puzzle=' + '0'.repeat(81)));
  log('an empty grid has many solutions', v && v.solutions === 'many' && v.solution === null, JSON.stringify(v));

  // A barcode, its artifact, and text input that keeps its zeros.
  v = json(await run('applets run parks.barcode/generate@1 symbology=ean13 data=400638133393', 30000));
  log('a barcode is generated, its image an artifact in the output', v && v.data === '4006381333931' && v.image && v.image.mime === 'image/svg+xml' && v.image.size > 100, JSON.stringify(v));
  if (v && v.image) {
    await run('applets artifact ' + v.image.id + ' ~/ean.svg');
    out = await run('grep "<svg" ~/ean.svg | wc -l');
    log('the artifact saves to a file', out.trim() === '1', out);
  }
  v = json(await run('applets run parks.barcode/interpret@1 data=0012345678905'));
  log('interpret keeps the leading zeros of text input', v && Array.isArray(v.matches) && v.matches.length > 0, JSON.stringify(v));

  // Files.
  await run('applets run parks.files/write@1 path=~/act.txt text=written-by-an-action');
  out = await run('cat ~/act.txt | wc -c');
  log('files write puts text in ~', out.trim() === '20', out);
  v = json(await run('applets run parks.files/read@1 path=~/act.txt'));
  log('files read gives it back', v && v.text === 'written-by-an-action' && v.path === '~/act.txt', JSON.stringify(v));
  out = await run('applets run parks.files/write@1 path=/site/x.txt text=no');
  log('files write outside ~ fails', /applets: parks\.files\/write@1 failed/.test(out), out);
  v = json(await run('applets run parks.files/list@1 path=/site/bin'));
  log('files list gives a folder\'s entries', v && v.entries.length > 0 && v.entries.every(e => e.path.indexOf('/site/bin/') === 0), JSON.stringify(v).slice(0, 200));

  // Lua and the shell.
  out = await run('lua -e "local a = require \'applets\'; local r = a.invoke(\'parks.dice/roll@1\', {dice = 4}); print(#r.values)"', 30000);
  log('Lua invokes an action and reads its output', out.trim() === '4', out);
  out = await run('lua -e "local a = require \'applets\'; print(#a.list() >= 8)"', 30000);
  log('Lua lists the providers', out.trim() === 'true', out);
  out = await run("sh -c 'applets run parks.dice/roll@1 dice=1 | grep total | wc -l'", 60000);
  log('a shell script runs the applets command', out.trim() === '1', out);
  out = await run('applets history');
  log('history lists this page\'s invocations', /done\s+parks\.dice\/roll@1/.test(out), out);

  // From the page: grants, replay, validation of output, and questions.
  const r = await page.evaluate(async () => {
    const A = window.pcActions, res = {};
    try { await A.invoke('parks.files/write@1', { path: '~/g.txt', text: 'x' }, { grant: ['files.read'] }); res.grant = 'ran'; } catch (e) { res.grant = e.message; }
    const a = await A.invoke('parks.files/write@1', { path: '~/once.txt', text: 'a', append: true }, { id: 'once-1' });
    const b = await A.invoke('parks.files/write@1', { path: '~/once.txt', text: 'a', append: true }, { id: 'once-1' });
    const F = window.pcSiteFs;
    res.once = { same: a.id === b.id, text: F.readHome(F.resolve(F.home(), '~/once.txt')) };
    try { await A.invoke('parks.files/write@1', { path: '~/once.txt', text: 'b' }, { id: 'once-1' }); res.reuse = 'ran'; } catch (e) { res.reuse = e.message; }
    /* A handler whose output its schema refuses fails. */
    A.provide('parks.dice', { 'roll@1': function () { return { output: { values: [0], total: 0 } }; } });
    const bad = await A.invoke('parks.dice/roll@1', {});
    res.bad = bad.status + ': ' + bad.error;
    return res;
  });
  log('a caller without a capability cannot run the action', /needs files\.write, which this caller was not granted/.test(r.grant), r.grant);
  log('the same id runs a once action one time', r.once.same && r.once.text === 'a', JSON.stringify(r.once));
  log('an id reused for a different call is refused', /was a different call/.test(r.reuse), r.reuse);
  log('output the schema refuses fails the invocation', /^failed: invalid output from parks\.dice\/roll@1/.test(r.bad), r.bad);

  const asked = page.evaluate(() => window.pcActions.run('parks.page/ask@1', { title: 'Pick one', body: 'For the test.', fields: [{ name: 'colour', type: 'choice', choices: ['red', 'green'], required: true }, { name: 'sure', type: 'boolean' }] }));
  await page.waitForSelector('dialog.pc-ask[open]');
  await page.selectOption('dialog.pc-ask select', 'green');
  await page.check('dialog.pc-ask input[type="checkbox"]');
  await page.click('dialog.pc-ask button[type="submit"]');
  const answer = await asked;
  log('a question is answered by the person in a dialog', answer && answer.response && answer.response.colour === 'green' && answer.response.sure === true, JSON.stringify(answer));
  const declined = page.evaluate(() => window.pcActions.invoke('parks.page/ask@1', { title: 'Again?' }).then(v => window.pcActions.wait(v.id)));
  await page.waitForSelector('dialog.pc-ask[open]');
  await page.click('dialog.pc-ask [data-ask="cancel"]');
  const d = await declined;
  log('a question declined cancels the invocation', d.status === 'cancelled', JSON.stringify(d));
  const shown = await page.evaluate(() => window.pcActions.run('parks.page/notify@1', { text: 'From an action', kind: 'positive' }));
  log('a notice shows on the page', shown.shown === true && await page.isVisible('.toast:has-text("From an action")'), JSON.stringify(shown));

  // A window action, from the classic view: a new tab, never this one.
  const popup = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
  out = await run('applets run parks.editor/open@1 path=~/act.txt');
  const tab = await popup;
  log('a window action in the classic view opens a new tab', !!tab && /\/page\/editor\?file=~\/act\.txt/.test(tab.url()) && /"view": "tab"/.test(out), (tab && tab.url()) + ' ' + out);
  if (tab) { await tab.close(); }
  log('the terminal is still on its page', /\/page\/terminal/.test(page.url()), page.url());

  // Window actions in the window view go through PUDL's requests.
  await page.goto(BASE + '/?open=terminal', { waitUntil: 'networkidle' });
  await page.waitForSelector('.win[data-win="terminal"] .xterm-helper-textarea', { timeout: 30000 });
  await page.waitForTimeout(1500);
  out = await run('applets run parks.sight-reader/open@1 \'{"path": "simple/Frere Jacques.musicxml"}\'');
  await page.waitForSelector('.win[data-win="sight-reader"]', { timeout: 15000 }).catch(() => {});
  log('a window action opens Sight Reader on a score in a window', /"view": "window"/.test(out) && await page.isVisible('.win[data-win="sight-reader"]'), out);
  /* A line that wraps in a narrow window is redrawn in place as it is
     typed, not once more on a new row for every key. */
  const copies = (await screen()).split('\n').filter(r => r.includes('applets run parks.si')).length;
  log('a typed line that wraps is drawn once', copies === 1, copies + ' copies');
  const titled = await page.waitForFunction(() => /Frere Jacques/.test((document.querySelector('.win[data-win="sight-reader"]') || {}).textContent || ''), null, { timeout: 20000 }).then(() => true, () => false);
  log('Sight Reader opened the score it was asked for', titled);
  out = await run('applets run parks.editor/open@1 path=~/act.txt');
  await page.waitForSelector('.win[data-win="editor"] .cm-content', { timeout: 15000 }).catch(() => {});
  log('the Editor opens a file in a window', /"view": "window"/.test(out) && /written-by-an-action/.test(await page.evaluate(() => (document.querySelector('.win[data-win="editor"] .cm-content') || {}).textContent || '')), out);

  // Tidy ~.
  await page.evaluate(async () => {
    const F = window.pcSiteFs;
    for (const p of ['~/ean.svg', '~/act.txt', '~/once.txt']) { const n = F.resolve(F.home(), p); if (n) { await F.remove(n, false); } }
  });

  log('no page errors', errors.length === 0, errors.join(' | '));
  console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
