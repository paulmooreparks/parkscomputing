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
    title: document.querySelector('[data-role="title"]').textContent,
    green: document.querySelectorAll('.sr-sheet svg [fill="#2e7d32"], .sr-sheet svg [stroke="#2e7d32"]').length,
    red: document.querySelectorAll('.sr-sheet svg [fill="#b42318"], .sr-sheet svg [stroke="#b42318"]').length
  }));
  const cursorLeft = () => page.evaluate(() => { const c = document.querySelector('.sr-sheet img'); return c ? Math.round(c.getBoundingClientRect().left + window.scrollX) : null; });
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
  const pending = () => page.evaluate(() => { const p = document.querySelector('[data-role="pending"]'); return p.hidden ? '' : p.textContent; });

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

  // 3. Never revealing, set in Options, and kept in the settings.
  await options(() => page.selectOption('[data-opt="revealAfter"]', '0'));
  await type('bbbbbb');
  i = await info();
  log('with the answer set to never, wrong tries only mark errors', i.fb === 'Not that one', i.fb);
  const saved = await page.evaluate(() => window.pcConfig.get('sight-reader').revealAfter);
  log('the setting is kept in ~/.config/sight-reader.json', saved === 0, saved);
  await options(() => page.selectOption('[data-opt="revealAfter"]', '3'));

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
  await options(() => page.uncheck('[data-opt="sound"]'));
  await type('f');
  log('with the sound turned off a right letter plays nothing', (await page.evaluate(() => window.__tones)).length === heard, 'tones ' + heard);
  await options(() => page.check('[data-opt="sound"]'));

  // 6c. Sharps and flats: buttons that wait for the setting, then a key or a
  //     button before the letter.
  await page.setInputFiles('.sr-file', accFile);
  await page.waitForTimeout(800);
  i = await info();
  log('a score with a key signature and accidentals has four steps', i.pos === 'Bar 1 · 1 of 4', i.pos);
  const accState = await page.evaluate(() => ({ sharp: document.querySelector('[data-acc="1"]').disabled, flat: document.querySelector('[data-acc="-1"]').disabled, shown: !!document.querySelector('.sr-accidentals').offsetParent }));
  log('the sharp and flat buttons are there, and wait for the setting', accState.shown && accState.sharp && accState.flat, JSON.stringify(accState));
  await type('=');
  i = await info();
  log('pressing a sharp key with the setting off says what to do', /Name sharps and flats in Options/.test(i.fb), i.fb);
  await type('fbbc');
  i = await info();
  log('with letters only, the letters alone are right (F, B, B, C)', /^Finished: 4 of 4 right first time/.test(i.fb), i.fb);
  await options(() => page.check('[data-opt="accidentals"]'));
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
  await options(() => page.uncheck('[data-opt="accidentals"]'));

  // 6d. Choosing what to read: clefs, following a clef change.
  await page.setInputFiles('.sr-file', pianoFile);
  await page.waitForTimeout(800);
  i = await info();
  log('a piano score with both clefs has two steps', i.pos === 'Bar 1 · 1 of 2', i.pos);
  await page.click('.sr-top [data-sr="options"]');
  const clefs = await page.evaluate(() => [...document.querySelectorAll('[data-clef]')].map(b => b.getAttribute('data-clef') + (b.checked ? '+' : '-')).join());
  log('Options offers the clefs the score uses', clefs === 'Treble+,Bass+', clefs);
  await page.uncheck('[data-clef="Treble"]');
  await page.waitForTimeout(500);
  await page.click('[data-clef="Bass"]');
  const guard = await page.evaluate(() => document.querySelector('[data-clef="Bass"]').checked);
  log('the last clef stays ticked', guard);
  await page.click('[data-sr="close-options"]');
  await page.focus('.pc-sight-reader');
  i = await info();
  log('with only bass chosen the quiz reads just the bass notes: one step', i.pos === 'Bar 1 · 1 of 1', i.pos);
  await type('e');
  log('a treble note is not asked for', (await info()).fb === 'Not that one');
  await type('c');
  log('the bass note ends it', /^Finished: \d of 1/.test((await info()).fb), (await info()).fb);
  await page.click('.sr-top [data-sr="options"]');
  await page.check('[data-clef="Treble"]');
  await page.uncheck('[data-clef="Bass"]');
  await page.click('[data-sr="close-options"]');
  await page.focus('.pc-sight-reader');
  i = await info();
  log('with only treble chosen, the left hand in the treble clef counts: two steps', i.pos === 'Bar 1 · 1 of 2', i.pos);
  await type('eg');
  log('G alone is not the whole bar', /1 more/.test((await info()).fb));
  await type('d');
  log('the treble-clef left hand note is read with the right hand: the piece ends', /^Finished: 2 of 2/.test((await info()).fb), (await info()).fb);

  // 6d2. A real song, where a hand moves between clefs many times.
  await open('/page/sight-reader?score=advanced/Schumann - Fruhlingsnacht.mxl');
  await page.click('.sr-top [data-sr="options"]');
  const songClefs = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-clef]')].map(b => [b.getAttribute('data-clef'), +/(\d+) notes/.exec(b.parentElement.textContent)[1]])));
  /* The counts are what reading the score's XML note by note gives, with each
     staff's clef followed through its changes, rests, grace notes and tied
     continuations left out: 1,219 in the treble clef and 280 in the bass. */
  log('a song lists its clefs with how many notes are in each, following the changes', songClefs.Treble === 1219 && songClefs.Bass === 280, JSON.stringify(songClefs));
  await page.click('[data-sr="close-options"]');

  // 6e. Choosing what to read: parts.
  await page.setInputFiles('.sr-file', partsFile);
  await page.waitForTimeout(800);
  i = await info();
  log('a score with a voice and a piano has one step asking for two notes', i.pos === 'Bar 1 · 1 of 1' && /interval/.test(i.fb), JSON.stringify(i));
  await page.click('.sr-top [data-sr="options"]');
  const parts = await page.evaluate(() => [...document.querySelectorAll('[data-part]')].map(b => b.parentElement.textContent.trim().replace(/\s+/g, ' ')).join());
  log('Options offers the parts, with their note counts', /Voice 1 notes,Piano 1 notes/.test(parts), parts);
  await page.uncheck('[data-part="0"]');
  await page.click('[data-sr="close-options"]');
  await page.focus('.pc-sight-reader');
  await type('d');
  log('with the voice not chosen, its note is not asked for', (await info()).fb === 'Not that one');
  await type('a');
  log('the piano note ends it', /^Finished: \d of 1/.test((await info()).fb), (await info()).fb);

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
  await page.screenshot({ path: path.join(SHOTS, 'sr-window.png') });

  log('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  if (failed) { console.log(failed + ' check(s) failed'); process.exitCode = 1; }
})().catch(e => { console.error(e); process.exit(1); });
