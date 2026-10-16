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

/* G major, so the first note is an F sharp by the key; then a B flat, a B
   natural and a C double sharp, each with the accidental printed. */
const ACCIDENTALS = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><work><work-title>Accidentals</work-title></work>
<part-list><score-part id="P1"><part-name>Test</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
<note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>1</duration><type>quarter</type><accidental>flat</accidental></note>
<note><pitch><step>B</step><alter>0</alter><octave>4</octave></pitch><duration>1</duration><type>quarter</type><accidental>natural</accidental></note>
<note><pitch><step>C</step><alter>2</alter><octave>5</octave></pitch><duration>1</duration><type>quarter</type><accidental>double-sharp</accidental></note>
</measure></part></score-partwise>
`;

/* A piano's two staves, whose left hand moves up into the treble clef in the
   second bar: E5 over C3, then G5 over D5. */
const PIANO = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><work><work-title>Piano</work-title></work>
<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1">
<measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
<note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>whole</type><staff>1</staff></note>
<backup><duration>4</duration></backup>
<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><type>whole</type><staff>2</staff></note>
</measure>
<measure number="2"><attributes><clef number="2"><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><type>whole</type><staff>1</staff></note>
<backup><duration>4</duration></backup>
<note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><type>whole</type><staff>2</staff></note>
</measure>
</part></score-partwise>
`;

/* A C in two octaves together. */
const OCTAVES = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><work><work-title>Octaves</work-title></work>
<part-list><score-part id="P1"><part-name>Test</part-name></score-part></part-list>
<part id="P1">
<measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><type>whole</type></note>
<note><chord/><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
</measure>
</part></score-partwise>
`;

/* A chord from C2 to E5, which two octaves of keyboard cannot show. */
const WIDE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><work><work-title>Wide</work-title></work>
<part-list><score-part id="P1"><part-name>Test</part-name></score-part></part-list>
<part id="P1">
<measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>C</step><octave>2</octave></pitch><duration>4</duration><type>whole</type></note>
<note><chord/><pitch><step>G</step><octave>3</octave></pitch><duration>4</duration><type>whole</type></note>
<note><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note>
</measure>
</part></score-partwise>
`;

/* A voice on D and a piano on A, sounding together. */
const PARTS = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><work><work-title>Parts</work-title></work>
<part-list><score-part id="P1"><part-name>Voice</part-name></score-part><score-part id="P2"><part-name>Piano</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part>
<part id="P2"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>A</step><octave>3</octave></pitch><duration>4</duration><type>whole</type></note></measure></part>
</score-partwise>
`;

(async () => {
  const fixture = path.join(os.tmpdir(), 'sight-reader-fixture.musicxml');
  const accFile = path.join(os.tmpdir(), 'sight-reader-accidentals.musicxml');
  const pianoFile = path.join(os.tmpdir(), 'sight-reader-piano.musicxml');
  const partsFile = path.join(os.tmpdir(), 'sight-reader-parts.musicxml');
  fs.writeFileSync(fixture, FIXTURE);
  fs.writeFileSync(accFile, ACCIDENTALS);
  fs.writeFileSync(pianoFile, PIANO);
  fs.writeFileSync(partsFile, PARTS);
  const octFile = path.join(os.tmpdir(), 'sight-reader-octaves.musicxml');
  fs.writeFileSync(octFile, OCTAVES);
  const wideFile = path.join(os.tmpdir(), 'sight-reader-wide.musicxml');
  fs.writeFileSync(wideFile, WIDE);
  /* Scrollbars are left showing, as a reader's browser has them: a headless browser hides them by default, and a scrollbar that takes room from a box is what a layout has to allow for. */
  const browser = await chromium.launch(Object.assign({ ignoreDefaultArgs: ['--hide-scrollbars'], args: process.env.HOST_MAP ? ['--host-resolver-rules=' + process.env.HOST_MAP] : [] }, process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}));
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  let page = null;
  /* A new tab starts with nothing remembered: the applet keeps its last score
     for the tab in session storage (js/snapshot.js), and writes it as the page
     unloads, so clearing it from the page cannot be relied on. */
  const newTab = async context => {
    if (page) { await page.close(); }
    page = await (context || ctx).newPage();
    /* Every tone the page starts, by frequency, so a check can hear what was
       played without a sound device. */
    await page.addInitScript(() => {
      window.__tones = [];
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) { return; }
      const create = C.prototype.createOscillator;
      C.prototype.createOscillator = function () {
        const o = create.call(this), start = o.start.bind(o);
        o.start = function (t) { window.__tones.push(Math.round(o.frequency.value * 100) / 100); return start(t); };
        return o;
      };
    });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/plausible|Failed to load resource/.test(m.text())) { errors.push('console: ' + m.text()); } });
  };
  await newTab();
  const info = () => page.evaluate(() => ({
    pos: document.querySelector('[data-role="pos"]').textContent,
    fb: document.querySelector('[data-role="feedback"]').textContent,
    tally: document.querySelector('[data-role="tally"]').textContent,
    title: (document.querySelector('.sr-piece-title') || document.querySelector('[data-role="title"]')).textContent,
    green: document.querySelectorAll('.sr-sheet svg [fill="#2e7d32"], .sr-sheet svg [stroke="#2e7d32"]').length,
    red: document.querySelectorAll('.sr-sheet svg [fill="#b42318"], .sr-sheet svg [stroke="#b42318"]').length
  }));
  const cursorLeft = () => page.evaluate(() => { const c = document.querySelector('.sr-sheet img'); return c ? Math.round(c.getBoundingClientRect().left + window.scrollX) : null; });
  /* A real song from Tools/test-scores, opened from a file as a reader's own score is. */
  const openSong = async name => { await page.goto(BASE + '/page/sight-reader', { waitUntil: 'networkidle' }); await page.setInputFiles('.sr-file', path.join(__dirname, 'test-scores', name)); await page.waitForSelector('.sr-sheet svg', { timeout: 30000 }); await page.waitForTimeout(500); };
  const open = async url => { await page.goto(BASE + url, { waitUntil: 'networkidle' }); await page.waitForSelector('.sr-sheet svg', { timeout: 30000 }); await page.waitForTimeout(500); };
  const type = async s => { for (const ch of s) { await page.keyboard.press(ch); } };
  /* A command in the applet's own menus, which sit in the menu bar. */
  const menu = async (title, item) => {
    await page.locator('.menubar-title', { hasText: new RegExp('^' + title + '$') }).first().click();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
    await page.waitForTimeout(300);
  };
  /* The Options dialog: opens it, runs what is asked of it, and closes it. */
  const options = async fn => {
    await page.click('.sr-top [data-sr="options"]');
    await page.waitForSelector('.sr-options', { state: 'visible' });
    await fn();
    await page.click('[data-sr="close-options"]');
    await page.waitForTimeout(400);
    await page.focus('.pc-sight-reader');
  };
  /* The controls of Options and Read: a segmented control's choice, a switch, a clef toggle, a part box. */
  const pick = async (opt, val) => { const sel = '[data-opt="' + opt + '"]'; if ((await page.locator(sel).first().evaluate(e => e.tagName)) === 'SELECT') { return page.selectOption(sel, val); } return page.click(sel + '[data-value="' + val + '"]'); };
  const setSwitch = async (opt, on) => { const sel = '[data-opt="' + opt + '"]'; if (((await page.getAttribute(sel, 'aria-checked')) === 'true') !== on) { await page.click(sel); } };
  const setClef = async (name, on) => { const sel = '[data-clef="' + name + '"]'; if (((await page.getAttribute(sel, 'aria-pressed')) === 'true') !== on) { await page.click(sel); } };
  const setPart = async (n, on) => { const sel = '[data-part="' + n + '"]'; if ((await page.isChecked(sel)) !== on) { await page.click(sel); } };
  const pending = () => page.evaluate(() => { const p = document.querySelector('[data-role="pending"]'); return p.hidden ? '' : p.textContent; });

  // 1. A single-line tune from the samples.
  await open('/page/sight-reader?score=simple/Ode to Joy.musicxml');
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

  // 1b. The focus ring: not after the applet took the keyboard itself, as on
  //     a refresh, and there once the reader has tabbed into it.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.sr-sheet svg', { timeout: 30000 });
  await page.waitForTimeout(500);
  const ring = () => page.evaluate(() => { const r = document.querySelector('.pc-sight-reader'); return { focused: document.activeElement === r, outline: getComputedStyle(r).outlineStyle }; });
  let rg = await ring();
  log('after a refresh the applet has the keyboard and shows no ring', rg.focused && rg.outline === 'none', JSON.stringify(rg));
  await page.focus('[data-sr="choose"]');
  await page.keyboard.press('Shift+Tab');
  rg = await ring();
  log('tabbing into it shows the ring', rg.focused && rg.outline !== 'none', JSON.stringify(rg));
  await page.click('.sr-score');
  rg = await ring();
  log('and a click in it takes the ring away', rg.focused && rg.outline === 'none', JSON.stringify(rg));

  // 2. Reveal after three wrong tries, and any key goes on.
  await type('bbb');
  i = await info();
  log('after three wrong tries the answer is shown', /^The answer is [A-G]/.test(i.fb) && i.red > 0, i.fb);
  const posBefore = i.pos;
  await page.keyboard.press('Space');
  i = await info();
  log('any key goes on, and the step counts as missed', i.pos !== posBefore && /1 missed/.test(i.tally), i.pos + ' / ' + i.tally);

  // 2b. Options: two cards of segmented controls and switches.
  await page.click('.sr-top [data-sr="options"]');
  const opt2 = await page.evaluate(() => ({ cards: document.querySelectorAll('.sr-options .card').length, segs: document.querySelectorAll('.sr-options .seg').length, switches: document.querySelectorAll('.sr-options .switch').length, helps: document.querySelectorAll('.sr-options .form-help').length, selects: document.querySelectorAll('.sr-options select').length, counts: /\d+ notes/.test(document.querySelector('.sr-options').textContent) }));
  log('Options is two cards: the instrument as a select, the rest segmented controls and switches, with no paragraphs or counts', opt2.cards === 2 && opt2.segs === 2 && opt2.switches === 2 && opt2.helps === 0 && opt2.selects === 1 && !opt2.counts, JSON.stringify(opt2));
  log('Name sharps and flats is on by default', (await page.getAttribute('[data-opt="accidentals"]', 'aria-checked')) === 'true');
  await setSwitch('accidentals', false);
  await page.waitForTimeout(400);
  const hover = await page.evaluate(() => document.querySelector('[data-acc="1"]').title);
  log('with the setting off the sharp button says how to turn it on', /Turn on Name sharps and flats in Options/.test(hover), hover);
  await pick('revealAfter', '5');
  log('a segment shows which choice is made', (await page.getAttribute('[data-opt="revealAfter"][data-value="5"]', 'aria-pressed')) === 'true' && (await page.getAttribute('[data-opt="revealAfter"][data-value="3"]', 'aria-pressed')) === 'false');
  await pick('revealAfter', '3');
  await page.click('[data-sr="close-options"]');
  await page.focus('.pc-sight-reader');

  // 2c. Help: how to use it, in tabs, with the clefs as one.
  await page.click('.sr-top [data-sr="help"]');
  await page.waitForSelector('.sr-help', { state: 'visible' });
  const tabsAt = () => page.evaluate(() => [...document.querySelectorAll('.sr-help [role="tab"]')].map(t => t.textContent + (t.getAttribute('aria-selected') === 'true' ? '*' : '')).join());
  log('Help opens on Getting started, with Answering and Clefs beside it', (await tabsAt()) === 'Getting started*,Answering,Clefs', await tabsAt());
  log('Getting started has numbered steps that name the buttons', await page.evaluate(() => document.querySelectorAll('.sr-help .sr-panel:not([hidden]) .sr-steps li').length) === 5);
  await page.click('.sr-help [data-tab="answer"]');
  log('the Answering tab is shown alone', (await tabsAt()) === 'Getting started,Answering*,Clefs' && /fingerboards/i.test(await page.textContent('.sr-help .sr-panel:not([hidden])')));
  await page.keyboard.press('ArrowRight');
  log('the arrow keys move between tabs', (await tabsAt()) === 'Getting started,Answering,Clefs*', await tabsAt());
  const clefHelp = await page.evaluate(() => ({
    staves: document.querySelectorAll('.sr-help .sr-staff').length,
    notes: [...document.querySelectorAll('.sr-help .sr-staff')].map(v => v.querySelectorAll('.sr-staff-note').length).join(),
    middle: [...document.querySelectorAll('.sr-help .sr-staff-name.sr-mid')].map(t => t.textContent).join(),
    names: [...document.querySelectorAll('.sr-help .sr-clef h4')].map(h => h.textContent).join(),
    first: [...document.querySelectorAll('.sr-help .sr-staff')].map(v => v.querySelector('.sr-staff-name').textContent).join()
  }));
  log('the Clefs tab shows four clefs, each a staff of thirteen notes', clefHelp.staves === 4 && clefHelp.notes === '13,13,13,13' && /Treble.*Bass.*Alto.*Tenor/.test(clefHelp.names), JSON.stringify(clefHelp));
  log('middle C is marked on each staff, and the lowest notes are right', clefHelp.middle === 'C4,C4,C4,C4' && clefHelp.first.startsWith('C4,'), clefHelp.first);
  await page.screenshot({ path: path.join(SHOTS, 'sr-clefs.png') });
  await page.click('[data-sr="close-help"]');
  await page.focus('.pc-sight-reader');

  // 3. Never revealing, set in Options, and kept in the settings.
  await options(() => pick('revealAfter', '0'));
  await type('bbbbbb');
  i = await info();
  log('with the answer set to never, wrong tries only mark errors', i.fb === 'Not that one', i.fb);
  const saved = await page.evaluate(() => window.pcConfig.get('sight-reader').revealAfter);
  log('the setting is kept in ~/.config/sight-reader.json', saved === 0, saved);
  await options(() => pick('revealAfter', '3'));

  // 4. The buttons do what the keys do. (The piano is the default keyboard,
  //    so the checks that use the letter buttons ask for them, and the choice
  //    is kept for the rest of this browser's checks.)
  await options(() => pick('keyboard', 'letters'));
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
  log('and the Restart button waits for a score', await page.isDisabled('[data-sr="restart"]'));
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
  const tones = await page.evaluate(() => window.__tones);
  log('each right letter plays its note at its pitch (C4, E4, G4)', JSON.stringify(tones) === JSON.stringify([261.63, 329.63, 392]), JSON.stringify(tones));
  await type('d');
  await type('f');
  i = await info();
  log('then the next note, and the tied note is read once', i.pos === 'Bar 2 · 4 of 4', i.pos);
  await type('c');
  i = await info();
  log('finishing says how it went', /^Finished: 4 of 4 right first time/.test(i.fb), i.fb);
  await type('c');
  log('a key after the end changes nothing', (await info()).fb === i.fb);
  const restartState = await page.evaluate(() => { const b = document.querySelector('[data-sr="restart"]'); return { disabled: b.disabled, primary: b.classList.contains('btn-primary') }; });
  log('at the end the Restart button is the highlighted one', !restartState.disabled && restartState.primary, JSON.stringify(restartState));
  await page.click('[data-sr="restart"]');
  i = await info();
  log('pressing it starts again from the top, with nothing marked', i.pos === 'Bar 1 · 1 of 4' && i.green === 0 && i.tally === '', JSON.stringify(i));
  log('and it is no longer highlighted', await page.evaluate(() => !document.querySelector('[data-sr="restart"]').classList.contains('btn-primary')));
  await type('ceg');
  log('the keyboard works straight away, with no click first', (await info()).pos === 'Bar 1 · 2 of 4', (await info()).pos);

  // 6. Restart, from the Practice menu, clears the marks and the tally.
  await menu('Practice', 'Restart');
  i = await info();
  log('Restart starts from the top with nothing marked', i.pos === 'Bar 1 · 1 of 4' && i.green === 0 && i.tally === '' && i.fb === 'Name every note of the chord', JSON.stringify(i));
  await page.focus('.pc-sight-reader');
  await type('ceg');
  log('and the quiz works again after it', (await info()).pos === 'Bar 1 · 2 of 4');
  await menu('Practice', 'Show the answer');
  i = await info();
  log('Show the answer, from the menu, shows it and marks the step missed', /^The answer is D/.test(i.fb) && /1 missed/.test(i.tally), i.fb + ' / ' + i.tally);

  // 6b. Sound can be turned off.
  await page.keyboard.press('Space');
  const heard = (await page.evaluate(() => window.__tones)).length;
  await options(() => setSwitch('sound', false));
  await type('f');
  log('with the sound turned off a right letter plays nothing', (await page.evaluate(() => window.__tones)).length === heard, 'tones ' + heard);
  await options(() => setSwitch('sound', true));

  // 6c. Sharps and flats: buttons that wait for the setting, then a key or a
  //     button before the letter.
  await page.setInputFiles('.sr-file', accFile);
  await page.waitForTimeout(800);
  i = await info();
  log('a score with a key signature and accidentals has four steps', i.pos === 'Bar 1 · 1 of 4', i.pos);
  await options(() => setSwitch('accidentals', false));
  const accState = await page.evaluate(() => ({ sharp: document.querySelector('[data-acc="1"]').disabled, flat: document.querySelector('[data-acc="-1"]').disabled, shown: !!document.querySelector('.sr-accidentals').offsetParent }));
  log('the sharp and flat buttons are there, and wait for the setting', accState.shown && accState.sharp && accState.flat, JSON.stringify(accState));
  await type('=');
  i = await info();
  log('pressing a sharp key with the setting off says what to do', /Name sharps and flats in Options/.test(i.fb), i.fb);
  await type('fbbc');
  i = await info();
  log('with letters only, the letters alone are right (F, B, B, C)', /^Finished: 4 of 4 right first time/.test(i.fb), i.fb);
  await options(() => setSwitch('accidentals', true));
  i = await info();
  log('turning Name sharps and flats on starts the piece again', i.pos === 'Bar 1 · 1 of 4' && i.tally === '', JSON.stringify(i));
  const accOn = await page.evaluate(() => !document.querySelector('[data-acc="1"]').disabled && !document.querySelector('[data-acc="-1"]').disabled);
  log('and the buttons work', accOn);
  await type('f');
  log('the letter alone is no longer right for an F sharp', (await info()).fb === 'Not that one');
  await type('=');
  log('a sharp key waits for its letter, and shows it', (await pending()) === '♯' && (await page.getAttribute('[data-acc="1"]', 'aria-pressed')) === 'true', await pending());
  await page.keyboard.press('Escape');
  log('Escape drops it', (await pending()) === '');
  await type('=f');
  i = await info();
  log('= then F is F sharp, right by the key signature', i.pos === 'Bar 1 · 2 of 4' && (await pending()) === '', i.pos);
  await type('-b');
  log('- then B is B flat', (await info()).pos === 'Bar 1 · 3 of 4');
  await type('b');
  log('B alone is a natural', (await info()).pos === 'Bar 1 · 4 of 4');
  await type('==c');
  i = await info();
  log('two sharps then C is a double sharp, and the piece ends', /^Finished: 3 of 4 right first time/.test(i.fb), i.fb);
  await menu('Practice', 'Restart');
  await page.focus('.pc-sight-reader');
  await page.click('[data-acc="1"]');
  log('the sharp button waits for its letter too', (await pending()) === '♯');
  await page.click('[data-note="F"]');
  log('and a click on a letter after it names the sharp', (await info()).pos === 'Bar 1 · 2 of 4');
  await type('-f');
  i = await info();
  log('a right letter with the wrong accidental is a wrong try', i.fb === 'Not that one' && i.pos === 'Bar 1 · 2 of 4', i.fb);
  await page.focus('.pc-sight-reader');
  const shownAnswer = await (async () => { await type('bb'); return (await info()).fb; })();
  log('the answer shows its accidental', /^The answer is B♭/.test(shownAnswer), shownAnswer);
  await options(() => setSwitch('accidentals', false));

  // 6d. Choosing what to read: clefs, following a clef change.
  await page.setInputFiles('.sr-file', pianoFile);
  await page.waitForTimeout(800);
  i = await info();
  log('a piano score with both clefs has two steps', i.pos === 'Bar 1 · 1 of 2', i.pos);
  await page.click('.sr-top [data-sr="read"]');
  await page.waitForSelector('.sr-read', { state: 'visible' });
  const clefs = await page.evaluate(() => [...document.querySelectorAll('[data-clef]')].map(b => b.getAttribute('data-clef') + (b.getAttribute('aria-pressed') === 'true' ? '+' : '-')).join());
  log('Read offers the clefs the score uses', clefs === 'Treble+,Bass+', clefs);
  await setClef('Treble', false);
  await page.waitForTimeout(500);
  await page.click('[data-clef="Bass"]');
  const guard = await page.evaluate(() => document.querySelector('[data-clef="Bass"]').getAttribute('aria-pressed') === 'true');
  log('the last clef stays on', guard);
  await page.click('[data-sr="close-read"]');
  await page.focus('.pc-sight-reader');
  i = await info();
  log('with only bass chosen the quiz reads just the bass notes: one step', i.pos === 'Bar 1 · 1 of 1', i.pos);
  await type('e');
  log('a treble note is not asked for', (await info()).fb === 'Not that one');
  await type('c');
  log('the bass note ends it', /^Finished: \d of 1/.test((await info()).fb), (await info()).fb);
  await page.click('.sr-top [data-sr="read"]');
  await page.waitForSelector('.sr-read', { state: 'visible' });
  await setClef('Treble', true);
  await setClef('Bass', false);
  await page.click('[data-sr="close-read"]');
  await page.focus('.pc-sight-reader');
  i = await info();
  log('with only treble chosen, the left hand in the treble clef counts: two steps', i.pos === 'Bar 1 · 1 of 2', i.pos);
  await type('eg');
  log('G alone is not the whole bar', /1 more/.test((await info()).fb));
  await type('d');
  log('the treble-clef left hand note is read with the right hand: the piece ends', /^Finished: 2 of 2/.test((await info()).fb), (await info()).fb);

  // 6d2. A real song, where a hand moves between clefs many times.
  await openSong('Schumann - Fruhlingsnacht.mxl');
  await page.click('.sr-top [data-sr="read"]');
  await page.waitForSelector('.sr-read', { state: 'visible' });
  const songClefs = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-clef]')].map(b => [b.getAttribute('data-clef'), +b.getAttribute('data-notes')])));
  /* The counts are what reading the score's XML note by note gives, with each
     staff's clef followed through its changes, rests, grace notes and tied
     continuations left out: 1,219 in the treble clef and 280 in the bass. */
  log('a song lists its clefs with how many notes are in each, following the changes', songClefs.Treble === 1219 && songClefs.Bass === 280, JSON.stringify(songClefs));
  await page.click('[data-sr="close-read"]');

  // 6e. Choosing what to read: parts.
  await page.setInputFiles('.sr-file', partsFile);
  await page.waitForTimeout(800);
  i = await info();
  log('a score with a voice and a piano has one step asking for two notes', i.pos === 'Bar 1 · 1 of 1' && /interval/.test(i.fb), JSON.stringify(i));
  await page.click('.sr-top [data-sr="read"]');
  await page.waitForSelector('.sr-read', { state: 'visible' });
  const parts = await page.evaluate(() => [...document.querySelectorAll('[data-part]')].map(b => b.parentElement.textContent.trim().replace(/\s+/g, ' ') + ' ' + b.getAttribute('data-notes')).join());
  log('Read offers the parts', /Voice 1,Piano 1/.test(parts), parts);
  await setPart(0, false);
  await page.click('[data-sr="close-read"]');
  await page.focus('.pc-sight-reader');
  await type('d');
  log('with the voice not chosen, its note is not asked for', (await info()).fb === 'Not that one');
  await type('a');
  log('the piano note ends it', /^Finished: \d of 1/.test((await info()).fb), (await info()).fb);

  // 6f. Read: the button, the line under the toolbar, Only and All, and the filter.
  await page.setInputFiles('.sr-file', partsFile);
  await page.waitForTimeout(800);
  const readState = () => page.evaluate(() => ({ disabled: document.querySelector('.sr-top [data-sr="read"]').disabled, title: document.querySelector('.sr-top [data-sr="read"]').title, line: document.querySelector('[data-role="reading"]').hidden ? '' : document.querySelector('[data-role="reading-text"]').textContent }));
  let rs = await readState();
  log('Read is there for a score with more than one part, and says nothing while all of it is read', !rs.disabled && rs.line === '', JSON.stringify(rs));
  await page.click('.sr-top [data-sr="read"]');
  await page.waitForSelector('.sr-read', { state: 'visible' });
  log('the parts list has no filter box when it is short', (await page.locator('[data-part-filter]').count()) === 0);
  await page.click('[data-only="1"]');
  rs = await readState();
  log('Only reads one part alone, and the line and the button say so', /^Reading 1 of 2 parts\.$/.test(rs.line) && /now 1 of 2 parts/.test(rs.title), JSON.stringify(rs));
  log('the dialog says so too', /reading 1 of 2 parts/.test(await page.textContent('[data-role="read-summary"]')));
  await page.click('[data-sr="parts-all"]');
  rs = await readState();
  log('All reads every part again, and the line goes', rs.line === '', JSON.stringify(rs));
  await page.click('[data-sr="close-read"]');
  await page.focus('.pc-sight-reader');
  await page.goto(BASE + '/page/sight-reader?score=simple/Ode to Joy.musicxml', { waitUntil: 'networkidle' });
  await page.waitForSelector('.sr-sheet svg', { timeout: 30000 });
  rs = await readState();
  log('a tune with one clef and one part has nothing to choose, and Read is off', rs.disabled, JSON.stringify(rs));
  const names = ['Flute', 'Oboe', 'Clarinet', 'Bassoon', 'Horn', 'Trumpet', 'Violin', 'Viola', 'Cello', 'Bass'];
  const many = path.join(os.tmpdir(), 'sight-reader-many.musicxml');
  fs.writeFileSync(many, '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>Many</work-title></work><part-list>' +
    names.map((n, k) => '<score-part id="P' + k + '"><part-name>' + n + '</part-name></score-part>').join('') + '</part-list>' +
    names.map((n, k) => '<part id="P' + k + '"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part>').join('') + '</score-partwise>');
  await page.setInputFiles('.sr-file', many);
  await page.waitForTimeout(900);
  await page.click('.sr-top [data-sr="read"]');
  await page.waitForSelector('.sr-read', { state: 'visible' });
  log('with more than eight parts a filter box appears', (await page.locator('[data-part-filter]').count()) === 1);
  await page.fill('[data-part-filter]', 'violin');
  const shown = await page.evaluate(() => [...document.querySelectorAll('.sr-part-row')].filter(r => !r.hidden).map(r => r.getAttribute('data-name')).join());
  log('the filter keeps the parts that match', shown === 'violin', shown);
  await page.click('[data-sr="close-read"]');
  await page.focus('.pc-sight-reader');

  // 6g. Play: the piece plays from the cursor, lighting its notes, and stops.
  await page.goto(BASE + '/page/sight-reader?score=simple/Ode to Joy.musicxml', { waitUntil: 'networkidle' });
  await page.waitForSelector('.sr-sheet svg', { timeout: 30000 });
  await page.waitForTimeout(500);
  await options(() => pick('keyboard', 'piano'));
  await page.selectOption('[data-play-speed]', '1.5');
  const startPos = (await info()).pos;
  const tonesBefore = (await page.evaluate(() => window.__tones)).length;
  await page.click('.sr-top [data-sr="play"]');
  await page.waitForTimeout(1600);
  const playingNow = await page.evaluate(() => ({ playOff: document.querySelector('[data-sr="play"]').disabled, stopOn: !document.querySelector('[data-sr="stop"]').disabled, lit: document.querySelectorAll('.sr-piano .sr-playing').length, tones: window.__tones.length }));
  log('Play sounds the notes in turn and lights them in blue, and only Stop can be pressed', playingNow.playOff && playingNow.stopOn && playingNow.lit >= 1 && playingNow.tones - tonesBefore >= 3, JSON.stringify(playingNow));
  await page.click('.sr-top [data-sr="stop"]');
  await page.waitForTimeout(300);
  const stopped = await page.evaluate(() => ({ playOn: !document.querySelector('[data-sr="play"]').disabled, stopOff: document.querySelector('[data-sr="stop"]').disabled, lit: document.querySelectorAll('.sr-playing').length }));
  i = await info();
  log('Stop clears the lights and leaves the quiz where it was', stopped.playOn && stopped.stopOff && stopped.lit === 0 && i.pos === startPos && i.tally === '', JSON.stringify(stopped) + ' ' + i.pos);
  await page.click('.sr-top [data-sr="play"]');
  await page.waitForTimeout(600);
  await page.focus('.pc-sight-reader');
  await type('e');
  i = await info();
  log('a key pressed while it plays stops it, and is not taken as an answer', !(await page.isDisabled('[data-sr="play"]')) && i.pos === startPos, i.pos);
  await options(() => pick('keyboard', 'guitar'));
  await page.click('.sr-top [data-sr="play"]');
  await page.waitForTimeout(500);
  const sizes = await page.evaluate(() => ['play', 'stop', 'options'].map(n => Math.round(document.querySelector('.sr-top [data-sr="' + n + '"]').getBoundingClientRect().height)));
  log('Play and Stop are the height of the other toolbar buttons', sizes[0] === sizes[2] && sizes[1] === sizes[2], JSON.stringify(sizes));
  log('on a fingerboard every place the note lies is lit', (await page.evaluate(() => document.querySelectorAll('.sr-fingerboard .sr-playing').length)) >= 2);
  await page.click('.sr-top [data-sr="stop"]');
  await options(() => pick('keyboard', 'letters'));
  await page.selectOption('[data-play-speed]', '1');

  // 6h. A score chosen while the page is still starting stands.
  await newTab();
  await page.route('**/js/config.js*', async route => { await new Promise(r => setTimeout(r, 2500)); await route.continue(); });
  await page.goto(BASE + '/page/sight-reader?score=simple/Ode to Joy.musicxml', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.sr-file', { state: 'attached', timeout: 30000 });
  const early = await page.evaluate(() => document.querySelector('[data-role="feedback"]').textContent);
  log('while the page starts it says which score it is opening', /^Opening Ode to Joy/.test(early), early);
  await page.setInputFiles('.sr-file', fixture);
  await page.waitForTimeout(5000);
  i = await info();
  log('a score chosen during the start is not replaced by the one in the address', i.title === 'sight-reader-fixture', i.title);
  await page.unroute('**/js/config.js*');

  // 7. A reload mid-piece brings the sample back where it was.
  await open('/page/sight-reader?score=simple/Frere Jacques.musicxml');
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
  const levels = ['simple', 'beginner', 'intermediate', 'advanced'], at = groups.map(g => levels.indexOf(g));
  log('the chooser lists the samples by level, easiest first', groups.length > 0 && at.every((n, k) => n >= 0 && (k === 0 || n > at[k - 1])), groups.join());
  await page.click('.sr-pick[data-sr-name="Twinkle Twinkle Little Star"]');
  await page.waitForSelector('.sr-sheet svg', { timeout: 30000 });
  await page.waitForTimeout(500);
  i = await info();
  log('choosing one opens it, and the address carries it', i.title === 'Twinkle Twinkle Little Star' && /score=simple\/Twinkle/.test(decodeURIComponent(page.url())), page.url());

  // 9. A real song with a voice and a two-staff piano part.
  await openSong('Schubert - Morgengruss.mxl');
  i = await info();
  log('a song with voice and piano opens and has steps to read', /^Bar \d+ · 1 of \d{3}$/.test(i.pos), i.pos);

  // 10. A link cannot reach outside the samples.
  await newTab();
  await page.goto(BASE + '/page/sight-reader?score=../../index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  log('a score path that climbs out of the folder is refused, and says so', (await page.isVisible('.sr-empty')) && /not a score/.test((await info()).fb), (await info()).fb);

  // 11. Resizing draws the score again and keeps the marks and the place.
  await open('/page/sight-reader?score=simple/Ode to Joy.musicxml');
  await type('eefgg');
  const wide = await info();
  await page.setViewportSize({ width: 800, height: 900 });
  await page.waitForTimeout(1200);
  i = await info();
  log('after a resize the marks and the place are back', i.pos === wide.pos && i.green > 0, wide.pos + ' green ' + wide.green + ' -> ' + i.pos + ' green ' + i.green);
  await type('f');
  log('and the quiz carries on', (await info()).pos !== wide.pos);

  // 11b. A tall score's vertical scrollbar takes room from the box, and the
  //      drawing must not then be too wide for it: no horizontal scrollbar,
  //      at any width, however the box got its size.
  const sideways = () => page.evaluate(() => { const b = document.querySelector('.sr-score'); return { scroll: b.scrollWidth, client: b.clientWidth, vertical: b.scrollHeight > b.clientHeight }; });
  for (const width of [1000, 1300, 1700]) {
    await page.setViewportSize({ width, height: 900 });
    await openSong('Brahms - Am Sonntag Morgen.mxl');
    await page.waitForTimeout(600);
    const sw = await sideways();
    log('no horizontal scrollbar at ' + width + 'px, with the vertical one showing', sw.vertical && sw.scroll <= sw.client + 1, JSON.stringify(sw));
  }
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForTimeout(1200);
  let sw2 = await sideways();
  log('nor after the page is made narrower', sw2.scroll <= sw2.client + 1, JSON.stringify(sw2));
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1200);
  sw2 = await sideways();
  log('nor after it is made wider again', sw2.scroll <= sw2.client + 1, JSON.stringify(sw2));

  // 12. Phone width.
  await page.setViewportSize({ width: 390, height: 844 });
  await openSong('Schubert - Morgengruss.mxl');
  const phone = await page.evaluate(() => {
    const keys = document.querySelector('.sr-keys').getBoundingClientRect(), acc = document.querySelector('.sr-accidentals').getBoundingClientRect();
    return { page: document.documentElement.scrollWidth, screen: document.documentElement.clientWidth, keysRight: Math.round(keys.right), accRight: Math.round(acc.right), accBelowLetters: acc.top >= document.querySelector('.sr-letters').getBoundingClientRect().bottom - 1,
      noteWidth: Math.round(document.querySelector('.sr-note').getBoundingClientRect().width), partNames: /Singstimme/.test(document.querySelector('.sr-sheet').textContent) };
  });
  log('at phone width nothing scrolls sideways and the buttons fit', phone.page <= phone.screen + 1 && phone.keysRight <= phone.screen && phone.accRight <= phone.screen && phone.accBelowLetters, JSON.stringify(phone));
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
  await page.setInputFiles('.win[data-win="sight-reader"] .sr-file', path.join(__dirname, 'test-scores', 'Brahms - Am Sonntag Morgen.mxl'));
  await page.waitForTimeout(1500);
  const inWin = await page.evaluate(() => { const b = document.querySelector('.win[data-win="sight-reader"] .sr-score'); return { scroll: b.scrollWidth, client: b.clientWidth }; });
  log('and a window shows no horizontal scrollbar either', inWin.scroll <= inWin.client + 1, JSON.stringify(inWin));
  await page.screenshot({ path: path.join(SHOTS, 'sr-window.png') });

  // 13b. The piano keyboard.
  await newTab();
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.goto(BASE + '/page/sight-reader', { waitUntil: 'networkidle' });
  await options(async () => { await pick('keyboard', 'piano'); await setSwitch('accidentals', false); });
  await page.setInputFiles('.sr-file', fixture);
  await page.waitForSelector('.sr-sheet svg', { timeout: 30000 });
  await page.waitForTimeout(600);
  const key = semi => '.sr-key[data-midi="' + (60 + semi) + '"]';
  const midiKey = m => '.sr-key[data-midi="' + m + '"]';
  const visible = m => page.evaluate(sel => { const k = document.querySelector(sel).getBoundingClientRect(), p = document.querySelector('.sr-piano').getBoundingClientRect(); return k.left >= p.left - 1 && k.right <= p.right + 1; }, midiKey(m));
  const lit = () => page.evaluate(() => [...document.querySelectorAll('.sr-named')].map(k => +k.getAttribute('data-midi') - 60).sort((a, b) => a - b));
  const missedKeys = () => page.evaluate(() => document.querySelectorAll('.sr-missed').length);
  const label = () => page.evaluate(() => document.querySelector('.sr-key[data-midi="60"] .sr-key-label').textContent);
  const board = await page.evaluate(() => ({ white: document.querySelectorAll('.sr-white').length, black: document.querySelectorAll('.sr-black').length, piano: !!document.querySelector('.sr-piano').offsetParent, letters: !!document.querySelector('.sr-letters').offsetParent, blackOff: [...document.querySelectorAll('.sr-black')].every(k => k.disabled) }));
  log('the piano is the keyboard: all 88 keys, 52 white and 36 black, with no letter buttons', board.white === 52 && board.black === 36 && board.piano && !board.letters, JSON.stringify(board));
  log('the black keys wait for Name sharps and flats', board.blackOff);
  log('the C keys name their octaves, and the music is in view', (await label()) === 'C4' && await visible(60), await label());
  await page.click(key(12));
  i = await info();
  log('a key of the right note in the wrong octave is a wrong try, and says so', i.fb === 'Right note, wrong octave' && i.pos === 'Bar 1 · 1 of 4', i.fb);
  log('the wrong key flashes', await page.evaluate(() => document.querySelector('.sr-key[data-midi="72"]').classList.contains('sr-keywrong')));
  await page.click(key(2));
  log('a key of another note is a wrong try too', (await info()).fb === 'Not that one');
  await page.click(key(0));
  log('the right key lights, in its octave', JSON.stringify(await lit()) === '[0]' && /2 more/.test((await info()).fb), JSON.stringify(await lit()));
  await page.click(key(4));
  log('and stays lit while the rest of the chord goes in', JSON.stringify(await lit()) === '[0,4]', JSON.stringify(await lit()));
  await page.click(key(7));
  i = await info();
  log('the last note ends the chord, the keys clear, and the cursor goes on', i.pos === 'Bar 1 · 2 of 4' && (await lit()).length === 0, i.pos + ' ' + JSON.stringify(await lit()));
  log('each key plays the note, at its pitch', JSON.stringify(await page.evaluate(() => window.__tones)) === JSON.stringify([261.63, 329.63, 392]), JSON.stringify(await page.evaluate(() => window.__tones)));
  await menu('Practice', 'Restart');
  await page.focus('.pc-sight-reader');
  await type('c');
  log('a typed letter has no octave, and lights the note in its own', JSON.stringify(await lit()) === '[0]', JSON.stringify(await lit()));
  await type('g');
  log('typed notes stay lit with the clicked ones', JSON.stringify(await lit()) === '[0,7]', JSON.stringify(await lit()));
  await page.click(key(4));
  log('and a clicked note completes what was typed', (await info()).pos === 'Bar 1 · 2 of 4');
  await type('bbb');
  i = await info();
  log('after three wrong tries the answer is lit on the keys in red', /^The answer is/.test(i.fb) && (await missedKeys()) >= 1, i.fb + ' / red keys ' + (await missedKeys()));

  // The piano with sharps and flats named: black keys, and enharmonic spellings.
  await page.setInputFiles('.sr-file', accFile);
  await page.waitForTimeout(800);
  await page.click('.sr-top [data-sr="options"]');
  await setSwitch('accidentals', true);
  await page.click('[data-sr="close-options"]');
  await page.focus('.pc-sight-reader');
  log('with sharps and flats on, the black keys work', await page.evaluate(() => [...document.querySelectorAll('.sr-black')].every(k => !k.disabled)));
  await page.click(key(5));
  log('F is not F sharp: the white key is a wrong try', (await info()).pos === 'Bar 1 · 1 of 4');
  await page.click(key(18));
  log('the F sharp key in the wrong octave is a wrong try', (await info()).fb === 'Right note, wrong octave');
  await page.click(key(6));
  log('the F sharp key is right', (await info()).pos === 'Bar 1 · 2 of 4');
  await page.click(key(10));
  log('the one black key is B flat as well as A sharp, so it is right for the B flat', (await info()).pos === 'Bar 1 · 3 of 4');
  await page.click(key(11));
  await page.click(key(2 + 12));
  i = await info();
  log('and the D key is right for a C double sharp, which is the same pitch', /^Finished/.test(i.fb), i.fb);
  await page.click('.sr-top [data-sr="options"]');
  await setSwitch('accidentals', false);
  await page.click('[data-sr="close-options"]');
  await page.focus('.pc-sight-reader');
  await page.click(key(17));
  log('with them off, the white F in the wrong octave is a wrong try', (await info()).fb === 'Right note, wrong octave');
  await page.click(key(5));
  log('F, in the right octave, is right for an F sharp', (await info()).pos === 'Bar 1 · 2 of 4');

  // The keyboard follows the register of the notes.
  await page.setInputFiles('.sr-file', pianoFile);
  await page.waitForTimeout(800);
  await page.click('.sr-top [data-sr="read"]');
  await page.waitForSelector('.sr-read', { state: 'visible' });
  await page.click('[data-clef="Treble"]');
  await page.waitForTimeout(400);
  await page.click('[data-sr="close-read"]');
  i = await info();
  log('with only the bass clef chosen the keyboard is centred on the bass register: C3 in view', (await visible(48)) && i.pos === 'Bar 1 · 1 of 1', i.pos);
  await page.click('.sr-top [data-sr="read"]');
  await page.waitForSelector('.sr-read', { state: 'visible' });
  await setClef('Treble', true);
  await setClef('Bass', false);
  await page.click('[data-sr="close-read"]');
  await page.waitForTimeout(400);
  log('and with only the treble clef it moves to the treble: E5 in view', await visible(76));
  await page.click('.sr-top [data-sr="read"]');
  await page.waitForSelector('.sr-read', { state: 'visible' });
  await setClef('Bass', true);
  await page.click('[data-sr="close-read"]');
  await page.waitForTimeout(400);
  // E5 and C3 together are more than two octaves apart, and both are on the one keyboard.
  await page.click(midiKey(76));
  await page.click(midiKey(48));
  i = await info();
  log('notes more than two octaves apart are both on the keyboard', i.pos === 'Bar 2 · 2 of 2', i.pos);

  // A phone.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + '/page/sight-reader?score=simple/Ode to Joy.musicxml', { waitUntil: 'networkidle' });
  await page.waitForSelector('.sr-sheet svg', { timeout: 30000 });
  await page.waitForTimeout(600);
  const small = await page.evaluate(() => { const p = document.querySelector('.sr-piano').getBoundingClientRect(); return { scrolls: document.querySelector('.sr-piano').scrollWidth > document.querySelector('.sr-piano').clientWidth, right: Math.round(p.right), left: Math.round(p.left), height: Math.round(document.querySelector('.sr-board').getBoundingClientRect().height), screen: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }; });
  log('at phone width the keyboard scrolls inside the screen and is tall enough to press', small.scrolls && small.left >= 0 && small.right <= small.screen && small.page <= small.screen + 1 && small.height >= 90, JSON.stringify(small));
  await page.screenshot({ path: path.join(SHOTS, 'sr-piano-phone.png') });

  // The letters, as an option.
  await page.setViewportSize({ width: 1300, height: 900 });
  await options(() => pick('keyboard', 'letters'));
  const swapped = await page.evaluate(() => ({ piano: !!document.querySelector('.sr-piano').offsetParent, letters: !!document.querySelector('.sr-letters').offsetParent, acc: !!document.querySelector('.sr-accidentals').offsetParent }));
  log('the letters can be shown instead, with the sharp and flat buttons', !swapped.piano && swapped.letters && swapped.acc, JSON.stringify(swapped));
  await options(() => pick('keyboard', 'piano'));

  // Key labels, and the keyboard opening on middle C.
  await page.setViewportSize({ width: 1300, height: 900 });
  const labelShown = mid => page.isVisible(midiKey(mid) + ' .sr-key-label');
  await options(() => pick('labels', 'c'));
  log('labels on the C keys only: C4 is labelled, D4 is not', (await labelShown(60)) && !(await labelShown(62)));
  await options(() => pick('labels', 'all'));
  log('labels on every key: D4 is labelled too', (await labelShown(62)) && (await page.textContent(midiKey(62) + ' .sr-key-label')) === 'D4');
  await options(() => pick('labels', 'none'));
  log('no labels: C4 is not labelled', !(await labelShown(60)));
  await options(() => pick('labels', 'c'));
  await page.setViewportSize({ width: 700, height: 900 });
  await page.goto(BASE + '/page/sight-reader?score=simple/Ode to Joy.musicxml', { waitUntil: 'networkidle' });
  await page.waitForSelector('.sr-sheet svg', { timeout: 30000 });
  await page.waitForTimeout(600);
  const narrowKeys = await page.evaluate(() => { const p = document.querySelector('.sr-piano'), c = document.querySelector('.sr-key[data-midi="60"]').getBoundingClientRect(), r = p.getBoundingClientRect(); return { scrolls: p.scrollWidth > p.clientWidth, middle: Math.abs((c.left + c.right) / 2 - (r.left + r.right) / 2) < 12 }; });
  log('where the keyboard does not fit it scrolls, opening on middle C', narrowKeys.scrolls && narrowKeys.middle, JSON.stringify(narrowKeys));
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.goto(BASE + '/page/sight-reader?score=simple/Ode to Joy.musicxml', { waitUntil: 'networkidle' });
  await page.waitForSelector('.sr-sheet svg', { timeout: 30000 });
  log('where it fits it does not scroll', await page.evaluate(() => { const p = document.querySelector('.sr-piano'); return p.scrollWidth <= p.clientWidth + 1; }));

  // 13c. An octave doubled in a chord: a piano key names only the note it is on.
  await newTab();
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.goto(BASE + '/page/sight-reader', { waitUntil: 'networkidle' });
  await page.setInputFiles('.sr-file', octFile);
  await page.waitForSelector('.sr-sheet svg', { timeout: 30000 });
  await page.waitForTimeout(600);
  const greenNotes = () => page.evaluate(() => [...document.querySelectorAll(".sr-sheet svg g.vf-notehead")].filter(g => g.querySelector("[fill=\"#2e7d32\"], [stroke=\"#2e7d32\"]")).length);
  const lowC = "";
  await page.click(midiKey(48));
  i = await info();
  const green1 = await greenNotes();
  log('with C in two octaves, one key names only one of them', /1 more/.test(i.fb) && green1 === 1, i.fb + " noteheads " + green1);
  await page.click(midiKey(60));
  i = await info();
  log('and the other octave is named by its own key', /^Finished/.test(i.fb) && (await greenNotes()) === 2, i.fb + " noteheads " + (await greenNotes()));

  await menu('Practice', 'Restart');
  await page.focus('.pc-sight-reader');
  await type('c');
  i = await info();
  log('a typed letter names one note: the lower of two Cs, and the rest wait', /1 more/.test(i.fb) && (await greenNotes()) === 1, i.fb + ' noteheads ' + (await greenNotes()));
  await type('c');
  i = await info();
  log('the same letter again names the other octave', /^Finished/.test(i.fb) && (await greenNotes()) === 2, i.fb);

  // 13c2. A chord wider than two octaves: the keyboard grows, and every note can be pressed.
  await page.setInputFiles('.sr-file', wideFile);
  await page.waitForTimeout(800);
  const wideKeys = await page.evaluate(() => ({ white: document.querySelectorAll('.sr-white').length, first: document.querySelector('.sr-key-label').textContent }));
  log('a chord from C2 to E5 is on the same keyboard of 88 keys', wideKeys.white === 52, JSON.stringify(wideKeys));
  await page.click(midiKey(36));
  await page.click(midiKey(55));
  await page.click(midiKey(76));
  i = await info();
  log('and the low C, the G and the high E are each pressed in their own octave', /^Finished: 1 of 1/.test(i.fb), i.fb);

  // 13c3. Fingerboards: the guitar and the violin.
  await newTab();
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.goto(BASE + '/page/sight-reader', { waitUntil: 'networkidle' });
  await options(() => pick('keyboard', 'guitar'));
  await page.setInputFiles('.sr-file', fixture);
  await page.waitForSelector('.sr-sheet svg', { timeout: 30000 });
  await page.waitForTimeout(600);
  const cell = (m, k) => page.locator('.sr-fingerboard .sr-cell[data-midi="' + m + '"]').nth(k || 0);
  const litCells = () => page.evaluate(() => [...document.querySelectorAll('.sr-fingerboard .sr-named')].map(c => +c.getAttribute('data-midi')));
  const rings = () => page.evaluate(() => document.querySelectorAll('.sr-fingerboard .sr-alt').length);
  const gb = await page.evaluate(() => ({ board: !!document.querySelector('.sr-fingerboard').offsetParent, piano: !!document.querySelector('.sr-piano').offsetParent, letters: !!document.querySelector('.sr-letters').offsetParent, cells: document.querySelectorAll('.sr-fingerboard .sr-cell').length, strings: document.querySelectorAll('.sr-fingerboard line[stroke-width]').length }));
  log('the guitar fingerboard shows in place of the piano: 6 strings of 16 positions', gb.board && !gb.piano && !gb.letters && gb.cells === 96, JSON.stringify(gb));
  const allC4 = await page.locator('.sr-fingerboard .sr-cell[data-midi="60"]').count();
  log('a pitch lies on more than one string', allC4 >= 2, 'C4 on ' + allC4);
  await cell(72).click();
  log('a position of the right note in the wrong octave says so', (await info()).fb === 'Right note, wrong octave');
  await cell(60, 0).click();
  i = await info();
  const lit1 = await litCells();
  log('a right position is named, and the pitch is lit wherever it lies on the neck', /2 more/.test(i.fb) && lit1.length === allC4 && lit1.every(m => m === 60), i.fb + ' lit ' + lit1.length + ' of ' + allC4);
  log('the other places the pitch lies are ringed after a right press', (await rings()) === allC4 - 1, 'rings ' + (await rings()));
  log('and the place pressed stays lit, as the others show', (await page.evaluate(() => document.querySelectorAll('.sr-fingerboard .sr-hit').length)) === 1);
  await page.waitForTimeout(2800);
  log('and the rings and the lit place go after a moment', (await rings()) === 0 && (await page.evaluate(() => document.querySelectorAll('.sr-fingerboard .sr-hit').length)) === 0);
  await cell(64, 0).click();
  await cell(67, 0).click();
  i = await info();
  log('the last note of the chord ends it, the neck clears, and the cursor goes on', i.pos === 'Bar 1 · 2 of 4' && (await litCells()).length === 0, i.pos);
  await options(() => setSwitch('accidentals', false));
  const offCells = await page.evaluate(() => [...document.querySelectorAll('.sr-fingerboard .sr-cell')].filter(c => c.getAttribute('data-black') === '1').every(c => c.classList.contains('sr-off')));
  log('with sharps and flats not named, the black-key positions are off', offCells);
  const gbPosBefore = (await info()).pos;
  await page.locator('.sr-fingerboard .sr-cell[data-black="1"]').first().click({ force: true });
  log('and pressing one does nothing', (await info()).pos === gbPosBefore);
  await options(() => setSwitch('accidentals', true));
  await options(() => pick('keyboard', 'violin'));
  const vn = await page.evaluate(() => ({ board: !!document.querySelector('.sr-fingerboard').offsetParent, cells: document.querySelectorAll('.sr-fingerboard .sr-cell').length }));
  log('the violin fingerboard has 4 strings of 15 positions', vn.board && vn.cells === 60, JSON.stringify(vn));
  const shapes = { bass: [4, 16, 40], ukulele: [4, 13, 60], mandolin: [4, 16, 55], viola: [4, 15, 48], cello: [4, 15, 36], doublebass: [4, 15, 40] };
  for (const [kind, [strings, positions, lowest]] of Object.entries(shapes)) {
    await options(() => pick('keyboard', kind));
    const b = await page.evaluate(() => ({ cells: document.querySelectorAll('.sr-fingerboard .sr-cell').length, low: Math.min(...[...document.querySelectorAll('.sr-fingerboard .sr-cell')].map(c => +c.getAttribute('data-midi'))) }));
    log('the ' + kind + ' fingerboard has ' + strings + ' strings of ' + positions + ' positions, the lowest open string at ' + lowest, b.cells === strings * positions && b.low === lowest, JSON.stringify(b));
  }
  await page.setInputFiles('.sr-file', wideFile);
  await page.waitForTimeout(800);
  await options(() => pick('keyboard', 'guitar'));
  await cell(55, 0).click();
  await cell(76, 0).click();
  i = await info();
  log('a note below the neck (C2) is named by a C in any octave once the others are in', /1 more/.test(i.fb), i.fb);
  await cell(60, 0).click();
  log('and the chord then ends', /^Finished/.test((await info()).fb), (await info()).fb);
  await options(() => pick('keyboard', 'piano'));

  // 13d. Bars to practise: start part-way in, and go round again.
  await newTab();
  await page.setViewportSize({ width: 1300, height: 900 });
  await open('/page/sight-reader?score=simple/Ode to Joy.musicxml');
  await options(() => pick('keyboard', 'letters'));
  await page.fill('[data-bar="from"]', '2');
  await page.fill('[data-bar="to"]', '3');
  await page.press('[data-bar="to"]', 'Enter');
  await page.waitForTimeout(600);
  i = await info();
  log('a first and last bar start the practice at the first bar, counting only those', i.pos === 'Bar 2 · 1 of 8', i.pos);
  await page.focus('[data-bar="from"]');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('2');
  await page.keyboard.press('Tab');
  log('Tab from the first bar goes to the last bar', await page.evaluate(() => document.activeElement.getAttribute('data-bar')) === 'to');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('3');
  await page.keyboard.press('Tab');
  log('and on to Clear, then Loop', await page.evaluate(() => document.activeElement.getAttribute('data-sr')) === 'clear-bars' && (await page.keyboard.press('Tab'), await page.evaluate(() => document.activeElement.hasAttribute('data-loop'))));
  await page.focus('.pc-sight-reader');
  await type('gfedccd');
  await type('e');
  i = await info();
  log('after the last bar the practice ends', /^Finished: 8 of 8/.test(i.fb) && i.pos.startsWith('Bar 3'), i.fb + ' / ' + i.pos);
  await page.check('[data-loop]');
  await menu('Practice', 'Restart');
  await page.focus('.pc-sight-reader');
  await type('gfedccde');
  await page.waitForTimeout(600);
  i = await info();
  log('with Loop on it goes back to the first bar and starts another round', i.pos === 'Bar 2 · 1 of 8 · round 2' && /Round 1: 8 of 8/.test(i.fb), i.pos + ' / ' + i.fb);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.sr-sheet svg', { timeout: 30000 });
  await page.waitForTimeout(600);
  const back = await page.evaluate(() => ({ from: document.querySelector('[data-bar="from"]').value, to: document.querySelector('[data-bar="to"]').value, loop: document.querySelector('[data-loop]').checked }));
  log('the bars and the loop come back after a reload', back.from === '2' && back.to === '3' && back.loop, JSON.stringify(back));
  log('Clear is there to use while bars are set', !(await page.isDisabled('[data-sr="clear-bars"]')));
  await page.click('[data-sr="clear-bars"]');
  await page.waitForTimeout(500);
  const emptied = await page.evaluate(() => document.querySelector('[data-bar="from"]').value + document.querySelector('[data-bar="to"]').value);
  log('Clear empties both bars and is then disabled', emptied === '' && await page.isDisabled('[data-sr="clear-bars"]'), emptied);
  log('clearing practises the whole piece again', (await info()).pos.startsWith('Bar 1 · 1 of 62'), (await info()).pos);

  // 14. Installable: a manifest of its own, which the browser accepts, and
  //     the bare form it launches on.
  await newTab();
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto(BASE + '/page/sight-reader', { waitUntil: 'networkidle' });
  const links = await page.evaluate(() => [...document.querySelectorAll('link[rel="manifest"]')].map(l => l.getAttribute('href')));
  log('the page links its own manifest first', links[0] === '/sight-reader.webmanifest', links.join());
  const manifest = await page.evaluate(() => fetch('/sight-reader.webmanifest').then(r => r.json()));
  log('the manifest names the app and opens it on the bare form', manifest.name === 'Sight Reader' && manifest.start_url === '/page/sight-reader?frame' && manifest.display === 'standalone' && manifest.scope === '/page/sight-reader', JSON.stringify(manifest).slice(0, 160));
  const icons = await page.evaluate(m => Promise.all(m.icons.map(i => fetch(i.src).then(r => r.status))), manifest);
  log('its icons are there', icons.length >= 2 && icons.every(s => s === 200), icons.join());
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Page.enable');
  const installable = await cdp.send('Page.getInstallabilityErrors');
  /* The test browser is a private window, which a browser will not install
     from and says so; that is the one objection allowed. */
  const obstacles = installable.installabilityErrors.filter(e => e.errorId !== 'in-incognito');
  log('the browser finds nothing in the way of installing it', obstacles.length === 0, JSON.stringify(installable.installabilityErrors));
  const parsed = await cdp.send('Page.getAppManifest');
  log('and reads the manifest without complaint', !(parsed.errors || []).length && /sight-reader\.webmanifest/.test(parsed.url), JSON.stringify(parsed.errors || []));
  // Launched bare with nothing opened yet, in a browser that has never run it: no score, then choose one.
  const fresh = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  await newTab(fresh);
  await page.goto(BASE + '/page/sight-reader?frame', { waitUntil: 'networkidle' });
  const bare = await page.evaluate(() => ({ app: !!document.querySelector('.pc-sight-reader-app'), headerHidden: !document.querySelector('.post-header') || getComputedStyle(document.querySelector('.post-header')).display === 'none', pageScroll: document.documentElement.scrollHeight - window.innerHeight }));
  log('the bare form fills the screen with nothing else, and the page does not scroll', bare.app && bare.headerHidden && bare.pageScroll <= 1, JSON.stringify(bare));
  await page.click('.sr-empty [data-sr="choose"]');
  await page.waitForSelector('.sr-pick');
  await page.click('.sr-pick[data-sr-name="Ode to Joy"]');
  await page.waitForSelector('.sr-sheet svg', { timeout: 30000 });
  await page.waitForTimeout(800);
  const fits = await page.evaluate(() => { const k = document.querySelector('.sr-keys').getBoundingClientRect(); return { keysBottom: Math.round(k.bottom), vh: window.innerHeight }; });
  log('the keys are on the screen without scrolling', fits.keysBottom <= fits.vh, JSON.stringify(fits));
  await newTab(fresh);
  await page.goto(BASE + '/page/sight-reader?frame', { waitUntil: 'networkidle' });
  await page.waitForSelector('.sr-sheet svg', { timeout: 30000 });
  i = await info();
  log('launched again with no score named, it opens the last one', i.title === 'Ode to Joy' && i.pos === 'Bar 1 · 1 of 62', JSON.stringify(i));
  await newTab(fresh);
  await page.goto(BASE + '/page/sight-reader', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  log('but the ordinary page still starts empty', await page.isVisible('.sr-empty'));

  log('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  if (failed) { console.log(failed + ' check(s) failed'); process.exitCode = 1; }
})().catch(e => { console.error(e); process.exit(1); });
