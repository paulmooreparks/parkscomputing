/* Browser checks for Sight Reader (js/sight-reader.js,
   Architecture/sight-reader-design.md), against a site signed out, so that ~
   is the browser's:

     UI_SITE=http://localhost:8102 node Tools/test-sight-reader.js

   PLAYWRIGHT_MODULE names Playwright where it is not installed beside the
   script, CHROMIUM_PATH a browser, and SHOTS a folder for screenshots. The
   sample scores must be in the site's content/scores, with their index. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const BASE = process.env.UI_SITE || 'http://localhost:8102';
const SHOTS = process.env.SHOTS || os.tmpdir();
let failed = 0;
const log = (n, ok, x) => { if (!ok) { failed++; } console.log((ok ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + String(x).slice(0, 240) : '')); };

/* A score with the cases the quiz has to get right: a chord of three
   notes, a rest, a grace note, a tie, and plain notes. Its steps are
   C+E+G, D, F, then C, whose tied continuation in the next bar is no step. */
const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><work><work-title>Test score</work-title></work>
<part-list><score-part id="P1"><part-name>Test</part-name></score-part></part-list>
<part id="P1">
<measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
<note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
<note><rest/><duration>1</duration><type>quarter</type></note>
<note><grace/><pitch><step>E</step><octave>4</octave></pitch><type>eighth</type></note>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
<note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
</measure>
<measure number="2">
<note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><tie type="start"/><type>half</type><notations><tied type="start"/></notations></note>
<note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><tie type="stop"/><type>half</type><notations><tied type="stop"/></notations></note>
</measure>
</part></score-partwise>
`;

(async () => {
  const fixture = path.join(os.tmpdir(), 'sight-reader-fixture.musicxml');
  fs.writeFileSync(fixture, FIXTURE);
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  let page = null;
  /* A new tab starts with nothing remembered: the applet keeps its last score
     for the tab in session storage (js/snapshot.js), and writes it as the page
     unloads, so clearing it from the page cannot be relied on. */
  const newTab = async () => {
    if (page) { await page.close(); }
    page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/plausible|Failed to load resource/.test(m.text())) { errors.push('console: ' + m.text()); } });
  };
  await newTab();
  const info = () => page.evaluate(() => ({
    pos: document.querySelector('[data-role="pos"]').textContent,
    fb: document.querySelector('[data-role="feedback"]').textContent,
    tally: document.querySelector('[data-role="tally"]').textContent,
    title: document.querySelector('[data-role="title"]').textContent,
    green: document.querySelectorAll('.sr-sheet svg [fill="#2e7d32"], .sr-sheet svg [stroke="#2e7d32"]').length,
    red: document.querySelectorAll('.sr-sheet svg [fill="#b42318"], .sr-sheet svg [stroke="#b42318"]').length
  }));
  const cursorLeft = () => page.evaluate(() => { const c = document.querySelector('.sr-sheet img'); return c ? Math.round(c.getBoundingClientRect().left + window.scrollX) : null; });
  const open = async url => { await page.goto(BASE + url, { waitUntil: 'networkidle' }); await page.waitForSelector('.sr-sheet svg', { timeout: 30000 }); await page.waitForTimeout(500); };
  const type = async s => { for (const ch of s) { await page.keyboard.press(ch); } };
  /* A command in the applet's own menus, which sit in the menu bar. */
  const menu = async (title, item, radio) => {
    await page.locator('.menubar-title', { hasText: new RegExp('^' + title + '$') }).first().click();
    await page.getByRole(radio ? 'menuitemradio' : 'menuitem', { name: item, exact: true }).click();
    await page.waitForTimeout(300);
  };

  // 1. A single-line tune from the samples.
  await open('/page/sight-reader?score=beginner/Ode to Joy.musicxml');
  let i = await info();
  log('a sample opens from the address, titled and at its first step', i.title === 'Ode to Joy' && i.pos === 'Bar 1 · 1 of 62', JSON.stringify(i));
  const x0 = await cursorLeft();
  await type('e');
  i = await info();
  log('a right letter moves the cursor on and marks the note', i.pos === 'Bar 1 · 2 of 62' && i.green > 0 && (await cursorLeft()) > x0, 'green ' + i.green);
  await type('b');
  i = await info();
  log('a wrong letter marks an error and the cursor stays', i.fb === 'Not that one' && i.pos === 'Bar 1 · 2 of 62', JSON.stringify(i));
  const flashing = await page.evaluate(() => document.querySelector('.sr-sheet img').classList.contains('sr-wrong'));
  log('the cursor flashes', flashing);
  await type('e');
  i = await info();
  log('then the right letter goes on, counted as a retry', i.pos === 'Bar 1 · 3 of 62' && /1 right first time, 1 after a retry/.test(i.tally), i.tally);
  await page.screenshot({ path: path.join(SHOTS, 'sr-ode-start.png') });

  // 2. Reveal after three wrong tries, and any key goes on.
  await type('bbb');
  i = await info();
  log('after three wrong tries the answer is shown', /^The answer is [A-G]/.test(i.fb) && i.red > 0, i.fb);
  const posBefore = i.pos;
  await page.keyboard.press('Space');
  i = await info();
  log('any key goes on, and the step counts as missed', i.pos !== posBefore && /1 missed/.test(i.tally), i.pos + ' / ' + i.tally);

  // 3. Never revealing, set in the Practice menu, and kept in the settings.
  await menu('Practice', 'Never show the answer', true);
  await page.focus('.pc-sight-reader');
  await type('bbbbbb');
  i = await info();
  log('with the answer set to never, wrong tries only mark errors', i.fb === 'Not that one', i.fb);
  await page.waitForTimeout(500);
  const saved = await page.evaluate(() => window.pcConfig.get('sight-reader').revealAfter);
  log('the setting is kept in ~/.config/sight-reader.json', saved === 0, saved);
  await menu('Practice', 'After 3 wrong tries', true);
  await page.focus('.pc-sight-reader');

  // 4. The buttons do what the keys do.
  const before = (await info()).pos;
  const letters = await page.evaluate(() => [...document.querySelectorAll('[data-note]')].map(b => b.getAttribute('data-note')).join(''));
  log('there are buttons A to G', letters === 'ABCDEFG', letters);
  let moved = false;
  for (const l of 'ABCDEFG') {
    await page.click('[data-note="' + l + '"]');
    const now = await info();
    if (now.pos !== before && !/answer/.test(now.fb)) { moved = true; break; }
  }
  log('clicking the right button goes on', moved);

  // 5. A file from the device: chord, rest, grace note, tie.
  await newTab();
  await page.goto(BASE + '/page/sight-reader', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  log('with no score, the page offers to choose one', await page.isVisible('.sr-empty'));
  await page.setInputFiles('.sr-file', fixture);
  await page.waitForSelector('.sr-sheet svg', { timeout: 30000 });
  await page.waitForTimeout(500);
  i = await info();
  log('a file from the device opens', i.title === 'sight-reader-fixture', JSON.stringify(i));
  log('rests, grace notes and a tie leave four steps', i.pos === 'Bar 1 · 1 of 4', i.pos);
  await type('c');
  i = await info();
  log('a chord needs every note: one named, two to go', /2 more/.test(i.fb) && i.pos === 'Bar 1 · 1 of 4', JSON.stringify(i));
  await type('c');
  i = await info();
  log('naming a note twice costs nothing', i.pos === 'Bar 1 · 1 of 4' && !/Not that/.test(i.fb), i.fb);
  await type('e');
  await type('g');
  i = await info();
  log('with the last note named the cursor goes on, past the rest and the grace note', i.pos === 'Bar 1 · 2 of 4', i.pos);
  await type('d');
  await type('f');
  i = await info();
  log('then the next note, and the tied note is read once', i.pos === 'Bar 2 · 4 of 4', i.pos);
  await type('c');
  i = await info();
  log('finishing says how it went', /^Finished: 4 of 4 right first time/.test(i.fb), i.fb);
  await type('c');
  log('a key after the end changes nothing', (await info()).fb === i.fb);

  // 6. Restart, from the Practice menu, clears the marks and the tally.
  await menu('Practice', 'Restart');
  i = await info();
  log('Restart starts from the top with nothing marked', i.pos === 'Bar 1 · 1 of 4' && i.green === 0 && i.tally === '' && i.fb === '', JSON.stringify(i));
  await page.focus('.pc-sight-reader');
  await type('ceg');
  log('and the quiz works again after it', (await info()).pos === 'Bar 1 · 2 of 4');
  await menu('Practice', 'Show the answer');
  i = await info();
  log('Show the answer, from the menu, shows it and marks the step missed', /^The answer is D/.test(i.fb) && /1 missed/.test(i.tally), i.fb + ' / ' + i.tally);

  // 7. A reload mid-piece brings the sample back where it was.
  await open('/page/sight-reader?score=beginner/Frere Jacques.musicxml');
  await type('cdec');
  const mid = await info();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.sr-sheet svg', { timeout: 30000 });
  await page.waitForTimeout(600);
  i = await info();
  log('a reload brings back the step, the tally and the marks', i.pos === mid.pos && i.tally === mid.tally && i.green > 0, mid.pos + ' ' + mid.tally + ' -> ' + i.pos + ' ' + i.tally + ' green ' + i.green);

  // 8. The sample chooser, from the Scores button.
  await open('/page/sight-reader');
  await page.click('.sr-top [data-sr="choose"]');
  await page.waitForSelector('.sr-pick');
  const groups = await page.evaluate(() => [...document.querySelectorAll('.sr-group-name')].map(h => h.textContent));
  log('the chooser lists the samples by level, easiest first', groups.join() === 'beginner,intermediate,advanced', groups.join());
  await page.click('.sr-pick[data-sr-name="Twinkle Twinkle Little Star"]');
  await page.waitForSelector('.sr-sheet svg', { timeout: 30000 });
  await page.waitForTimeout(500);
  i = await info();
  log('choosing one opens it, and the address carries it', i.title === 'Twinkle Twinkle Little Star' && /score=beginner\/Twinkle/.test(decodeURIComponent(page.url())), page.url());

  // 9. A real song with a voice and a two-staff piano part.
  await open('/page/sight-reader?score=beginner/Schubert - Morgengruss.mxl');
  i = await info();
  log('a song with voice and piano opens and has steps to read', /^Bar \d+ · 1 of \d{3}$/.test(i.pos), i.pos);

  // 10. A link cannot reach outside the samples.
  await newTab();
  await page.goto(BASE + '/page/sight-reader?score=../../index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  log('a score path that climbs out of the folder is refused, and says so', (await page.isVisible('.sr-empty')) && /not a score/.test((await info()).fb), (await info()).fb);

  // 11. Resizing draws the score again and keeps the marks and the place.
  await open('/page/sight-reader?score=beginner/Ode to Joy.musicxml');
  await type('eefgg');
  const wide = await info();
  await page.setViewportSize({ width: 800, height: 900 });
  await page.waitForTimeout(1200);
  i = await info();
  log('after a resize the marks and the place are back', i.pos === wide.pos && i.green > 0, wide.pos + ' green ' + wide.green + ' -> ' + i.pos + ' green ' + i.green);
  await type('f');
  log('and the quiz carries on', (await info()).pos !== wide.pos);

  // 12. Phone width.
  await page.setViewportSize({ width: 390, height: 844 });
  await open('/page/sight-reader?score=beginner/Schubert - Morgengruss.mxl');
  const phone = await page.evaluate(() => {
    const keys = document.querySelector('.sr-keys').getBoundingClientRect();
    return { page: document.documentElement.scrollWidth, screen: document.documentElement.clientWidth, keysRight: Math.round(keys.right),
      noteWidth: Math.round(document.querySelector('.sr-note').getBoundingClientRect().width), partNames: /Singstimme/.test(document.querySelector('.sr-sheet').textContent) };
  });
  log('at phone width nothing scrolls sideways and the buttons fit', phone.page <= phone.screen + 1 && phone.keysRight <= phone.screen, JSON.stringify(phone));
  log('the part names are left out and the note buttons are big enough to press', !phone.partNames && phone.noteWidth >= 36, 'button ' + phone.noteWidth + 'px');
  await page.screenshot({ path: path.join(SHOTS, 'sr-phone.png') });

  // 13. In a window of the windowed desktop.
  await newTab();
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(BASE + '/?open=sight-reader', { waitUntil: 'networkidle' });
  await page.waitForSelector('.win[data-win="sight-reader"] .sr-empty', { timeout: 30000 });
  await page.click('.win[data-win="sight-reader"] .sr-empty [data-sr="choose"]');
  await page.waitForSelector('.sr-pick');
  await page.click('.sr-pick[data-sr-name="Ode to Joy"]');
  await page.waitForSelector('.win[data-win="sight-reader"] .sr-sheet svg', { timeout: 30000 });
  await page.waitForTimeout(600);
  await page.click('.win[data-win="sight-reader"] .sr-score');
  await type('e');
  const win = await page.evaluate(() => {
    const w = document.querySelector('.win[data-win="sight-reader"]'), b = w.querySelector('.win-body').getBoundingClientRect(), k = w.querySelector('.sr-keys').getBoundingClientRect();
    return { pos: w.querySelector('[data-role="pos"]').textContent, keysInside: k.bottom <= b.bottom + 1 };
  });
  log('in a window it fills the window, and the keys work there', win.pos === 'Bar 1 · 2 of 62' && win.keysInside, JSON.stringify(win));
  await page.screenshot({ path: path.join(SHOTS, 'sr-window.png') });

  log('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  if (failed) { console.log(failed + ' check(s) failed'); process.exitCode = 1; }
})().catch(e => { console.error(e); process.exit(1); });
