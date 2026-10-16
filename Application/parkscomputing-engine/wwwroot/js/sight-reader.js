/* Sight Reader: practise reading a piece of music by naming each note as a
   cursor reaches it (Architecture/sight-reader-design.md). The score is
   drawn by OpenSheetMusicDisplay (BSD-3-Clause), vendored in js/vendor and
   loaded only when the applet opens. A score is MusicXML, plain or
   compressed; the samples are listed in content/scores/index.json, and one
   from the reader's own device opens as well.

   The quiz takes steps through the score. A step is the notes that start
   together at the cursor, so one note, an interval or a chord, and a tied
   note's continuation, a rest and a grace note make no step of their own.
   The reader names a note by its letter, with the keys A to G or the
   buttons under the score, and the cursor moves on once every note of the
   step is named. A wrong letter marks an error and the cursor stays. After
   a number of wrong tries the answer is shown, and any key goes on. With
   Name sharps and flats on, a note's sharp or flat is named too, by a key
   or button pressed before its letter. The reader chooses which clefs and
   parts to read, and a right answer can sound the note. */
(function () {
    'use strict';

    var SELF_SRC = document.currentScript && document.currentScript.src;
    function beside(file) { return SELF_SRC ? SELF_SRC.replace(/sight-reader\.js(\?.*)?$/, file) : '/js/' + file; }
    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = function () { reject(new Error('could not load ' + src)); };
            document.head.appendChild(s);
        });
    }
    var osmdReady = null;
    function loadOsmd() {
        if (window.opensheetmusicdisplay) { return Promise.resolve(window.opensheetmusicdisplay); }
        if (!osmdReady) {
            osmdReady = loadScript(beside('vendor/osmd-2.2.1/osmd.js'))
                .then(function () { return window.opensheetmusicdisplay; })
                .catch(function (err) { osmdReady = null; throw err; });
        }
        return osmdReady;
    }
    var configReady = null;
    function loadConfig() {
        if (window.pcConfig) { return Promise.resolve(window.pcConfig); }
        if (!configReady) {
            configReady = loadScript(window.pcConfigSrc || beside('config.js'))
                .then(function () { return window.pcConfig; })
                .catch(function (err) { configReady = null; throw err; });
        }
        return configReady;
    }

    /* The settings are the applet's own, kept in ~/.config/sight-reader.json
       (js/config.js), so they follow the reader wherever ~ does. */
    var SETTINGS = { revealAfter: 3, accidentals: true, sound: true, keyboard: 'piano', lastScore: null };
    var REVEAL_CHOICES = [[0, 'Never'], [1, 'After 1 wrong try'], [2, 'After 2 wrong tries'], [3, 'After 3 wrong tries'], [5, 'After 5 wrong tries']];

    var SAMPLES = '/content/scores/';
    var LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    var SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    var LETTER_OF_PC = { 0: 'C', 2: 'D', 4: 'E', 5: 'F', 7: 'G', 9: 'A', 11: 'B' };
    /* The piano on the screen is two octaves and the C above them, 15 white keys. A
       black key stands to the right of the white key at these places in an
       octave, with the pitch it has. */
    var PIANO_WHITES = 15, PIANO_SPAN = 24;
    var BLACK_RIGHT_OF = { 0: 1, 1: 3, 3: 6, 4: 8, 5: 10 };
    var WHITE_PC = [0, 2, 4, 5, 7, 9, 11];
    var BLACK_NAMES = { 1: 'C sharp or D flat', 3: 'D sharp or E flat', 6: 'F sharp or G flat', 8: 'G sharp or A flat', 10: 'A sharp or B flat' };
    /* The marks drawn on the score: right in green, a missed note in red,
       on the white page the score is always drawn on. */
    var GREEN = '#2e7d32', RED = '#b42318';
    var MARK = { applyToNoteheads: true, applyToStem: true, applyToFlag: true };

    /* A clef by its sign and line, as OpenSheetMusicDisplay documents them
       (ClefEnum: G 0, F 1, C 2, percussion 3, TAB 4). A clef an octave up or
       down, as a guitar's treble clef is, is the same clef here. */
    var CLEF_NAMES = { '01': 'French violin', '02': 'Treble', '21': 'Soprano', '22': 'Mezzo-soprano', '23': 'Alto', '24': 'Tenor', '25': 'Baritone', '13': 'Baritone', '14': 'Bass', '15': 'Subbass' };
    function clefName(ins) {
        var type = ins.ClefType, line = ins.Line;
        return CLEF_NAMES[type + '' + line] || (type === 0 ? 'G clef' : type === 1 ? 'F clef' : 'C clef') + ' on line ' + line;
    }
    function isClef(ins) { return ins && ins.ClefType !== undefined && ins.Line !== undefined; }

    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    /* A path from a link or the snapshot is taken only if it is a relative path to
       a MusicXML file, with no folder that goes back up. */
    function validRel(rel) {
        return typeof rel === 'string' && /\.(mxl|musicxml|xml)$/i.test(rel) && rel.split('/').every(function (p) { return p && p !== '.' && p !== '..'; });
    }
    function sampleUrl(file) { return SAMPLES + String(file).split('/').map(encodeURIComponent).join('/'); }

    /* A note's accidental as the key it is answered by, "#" or "bb", and as
       the reader sees it. */
    function accKey(alter) { return alter > 0 ? new Array(alter + 1).join('#') : alter < 0 ? new Array(-alter + 1).join('b') : ''; }
    function accShown(alter) { return alter > 0 ? new Array(alter + 1).join('♯') : alter < 0 ? new Array(-alter + 1).join('♭') : ''; }
    function nameOf(key) { return key.charAt(0) + accShown(key.length > 1 ? (key.charAt(1) === '#' ? key.length - 1 : 1 - key.length) : 0); }

    /* A score's bytes as what OpenSheetMusicDisplay loads: compressed
       MusicXML (a zip, which starts with PK) as a binary string, and plain
       MusicXML as text, in whichever encoding its byte order mark says. */
    function contentOf(buffer) {
        var bytes = new Uint8Array(buffer);
        if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
            var out = '';
            for (var i = 0; i < bytes.length; i += 0x8000) { out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); }
            return out;
        }
        if (bytes[0] === 0xff && bytes[1] === 0xfe) { return new TextDecoder('utf-16le').decode(bytes.subarray(2)); }
        if (bytes[0] === 0xfe && bytes[1] === 0xff) { return new TextDecoder('utf-16be').decode(bytes.subarray(2)); }
        var start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
        return new TextDecoder('utf-8').decode(bytes.subarray(start));
    }

    var instances = 0;

    /* The piano's keys: white keys in a row, and the black keys over them, at
       the places a piano has them. Each key says how many semitones it is
       above the left-hand C. The keys are for the pointer; they are out of the
       tab order, and the letters, which are real buttons, are there for anyone
       who navigates by keyboard. */
    function pianoMarkup() {
        var width = 100 / PIANO_WHITES, black = width * 0.62, html = '<div class="sr-piano" role="group" aria-label="Piano keyboard">';
        for (var i = 0; i < PIANO_WHITES; i++) {
            var pc = WHITE_PC[i % 7], semi = Math.floor(i / 7) * 12 + pc;
            html += '<button type="button" class="sr-key sr-white" data-semi="' + semi + '" tabindex="-1" aria-label="' + LETTER_OF_PC[pc] + '"><span class="sr-key-label"></span></button>';
        }
        for (var w = 0; w < PIANO_WHITES - 1; w++) {
            var inOctave = w % 7;
            if (BLACK_RIGHT_OF[inOctave] === undefined) { continue; }
            var bpc = BLACK_RIGHT_OF[inOctave];
            html += '<button type="button" class="sr-key sr-black" data-semi="' + (Math.floor(w / 7) * 12 + bpc) + '" tabindex="-1" aria-label="' + BLACK_NAMES[bpc] + '" style="left:' + ((w + 1) * width - black / 2).toFixed(3) + '%;width:' + black.toFixed(3) + '%"></button>';
        }
        return html + '</div>';
    }

    function init(root, opts) {
        opts = opts || {};
        var uid = ++instances;
        var ownUrl = !!opts.ownsUrl;
        var destroyed = false;
        var OS = null, osmd = null, audio = null;
        var settings = Object.assign({}, SETTINGS), unConfig = null;

        /* The score open: where it came from, its steps, and how far the
           reader has got. A step is { adv, measure, notes, result }, where
           adv is how many times the cursor's iterator moves on from the
           start to reach it, and a note is { note, key, state }. info says
           what the score holds to choose from, its clefs and parts with the
           number of notes in each, and chosen what the reader chose; null
           for all of them. */
        var score = null, info = null, chosen = { clefs: null, parts: null };
        var steps = [], cur = -1, curAdv = 0;
        var tries = 0, revealed = false, finished = false, pendingAlter = 0;
        /* The bars being practised, as bar numbers (null is the start or the
           end of the piece), whether to go round again, and which time round. */
        var barFrom = null, barTo = null, looping = false, pass = 1;
        var tally = { first: 0, retried: 0, missed: 0 };
        var pending = null, loadId = 0, needsDraw = false, resizeTimer = null, flashTimer = null, narrow = false, lastWidth = 0;

        root.classList.add('pc-sight-reader');
        /* In a window the applet fills the window. The bare form of its own
           page (?frame), which the installed app opens on, is the applet and
           nothing else, so it fills the screen. */
        var isApp = opts.fit !== 'fill' && ownUrl && new URLSearchParams(location.search).has('frame');
        if (opts.fit === 'fill') { root.classList.add('pc-sight-reader-fill'); }
        if (isApp) { root.classList.add('pc-sight-reader-app'); }
        if (!root.hasAttribute('tabindex')) { root.tabIndex = 0; }
        root.innerHTML =
            '<div class="sr-top">' +
              '<button type="button" class="btn" data-sr="choose">Scores…</button>' +
              '<button type="button" class="btn" data-sr="options">Options…</button>' +
              '<button type="button" class="btn" data-sr="restart" title="Start the piece again from the beginning">Restart</button>' +
              '<span class="sr-range" role="group" aria-label="Bars to practise">' +
              '<span>Bars</span>' +
              '<input type="number" min="1" step="1" class="form-input sr-bar" data-bar="from" placeholder="first" aria-label="First bar to practise" title="Start at this bar. Leave empty to start at the beginning." />' +
              '<span>to</span>' +
              '<input type="number" min="1" step="1" class="form-input sr-bar" data-bar="to" placeholder="last" aria-label="Last bar to practise" title="Stop after this bar. Leave empty to go to the end." />' +
              '<button type="button" class="btn" data-sr="clear-bars" title="Practise the whole piece again" disabled>Clear</button>' +
              '<label class="check" title="Go back to the first bar when the last one is done"><input type="checkbox" data-loop /> Loop</label>' +
              '</span>' +
              '<span class="sr-title" data-role="title"></span>' +
            '</div>' +
            '<div class="sr-score" data-role="score">' +
              '<div class="sr-sheet" data-role="sheet"></div>' +
              '<div class="sr-empty" data-role="empty">' +
                '<p>Choose a score to practise reading it.</p>' +
                '<button type="button" class="btn btn-primary" data-sr="choose">Choose a score</button>' +
              '</div>' +
            '</div>' +
            '<div class="sr-info">' +
              '<span class="sr-pos" data-role="pos"></span>' +
              '<span class="sr-pending" data-role="pending" hidden></span>' +
              '<span class="badge sr-feedback" data-role="feedback" role="status" aria-live="polite"></span>' +
              '<span class="sr-tally" data-role="tally"></span>' +
            '</div>' +
            '<div class="sr-keys" role="group" aria-label="Note names">' +
              pianoMarkup() +
              '<div class="sr-letters">' +
                LETTERS.map(function (l) { return '<button type="button" class="btn sr-note" data-note="' + l + '" aria-label="' + l + '">' + l + '</button>'; }).join('') +
              '</div>' +
              '<div class="sr-accidentals" role="group" aria-label="Sharp and flat">' +
                '<button type="button" class="btn sr-acc" data-acc="1" aria-label="Sharp" aria-pressed="false" title="Sharp: press before the letter (# or =)">♯</button>' +
                '<button type="button" class="btn sr-acc" data-acc="-1" aria-label="Flat" aria-pressed="false" title="Flat: press before the letter (-)">♭</button>' +
              '</div>' +
            '</div>' +
            '<input type="file" class="sr-file" accept=".mxl,.musicxml,.xml" hidden />' +
            '<dialog class="dialog sr-dialog" data-role="chooser" aria-labelledby="sr-choose-title-' + uid + '">' +
              '<h3 class="dialog-title" id="sr-choose-title-' + uid + '">Choose a score</h3>' +
              '<div class="dialog-body" data-role="chooser-body"></div>' +
              '<div class="dialog-actions">' +
                '<button type="button" class="btn" data-sr="file">From this device…</button>' +
                '<button type="button" class="btn btn-primary" data-sr="close-chooser">Close</button>' +
              '</div>' +
            '</dialog>' +
            '<dialog class="dialog sr-dialog" data-role="options" aria-labelledby="sr-opt-title-' + uid + '">' +
              '<h3 class="dialog-title" id="sr-opt-title-' + uid + '">Options</h3>' +
              '<div class="dialog-body sr-options">' +
                '<div class="form-group">' +
                  '<label class="form-label" for="sr-kbd-' + uid + '">Keyboard</label>' +
                  '<span class="form-select-wrap"><select class="form-select" id="sr-kbd-' + uid + '" data-opt="keyboard">' +
                    '<option value="piano">A piano keyboard</option><option value="letters">The letters A to G</option>' +
                  '</select></span>' +
                  '<p class="form-help">On the piano, a note lights in its own octave and stays lit until every note of an interval or chord is in. A key you click has to be the right note in the right octave. Typing a letter picks the octave for you. The black keys name sharps and flats, so they wait for Name sharps and flats. The other choice is the buttons A to G, with ♯ and ♭, where no octave is asked for.</p>' +
                '</div>' +
                '<div class="form-group">' +
                  '<label class="form-label" for="sr-reveal-' + uid + '">Show the answer</label>' +
                  '<span class="form-select-wrap"><select class="form-select" id="sr-reveal-' + uid + '" data-opt="revealAfter">' +
                    REVEAL_CHOICES.map(function (c) { return '<option value="' + c[0] + '">' + c[1] + '</option>'; }).join('') +
                  '</select></span>' +
                  '<p class="form-help">How many wrong tries it takes before the answer is shown. When it is shown, any key goes on to the next note.</p>' +
                '</div>' +
                '<div class="sr-option">' +
                  '<label class="check"><input type="checkbox" data-opt="accidentals" /> Name sharps and flats</label>' +
                  '<p class="form-help">Off, you name only the letter, so an F in G major is F. On, you name the note as the music has it, so that F is F sharp. Press the sharp key (= or #), the flat key (-), or the ♯ or ♭ button, and then the letter. Changing this starts the piece again.</p>' +
                '</div>' +
                '<div class="sr-option">' +
                  '<label class="check"><input type="checkbox" data-opt="sound" /> Play each note I get right</label>' +
                  '<p class="form-help">Each right letter plays its note, at the pitch it is written at.</p>' +
                '</div>' +
                '<div data-role="scope"></div>' +
              '</div>' +
              '<div class="dialog-actions"><button type="button" class="btn btn-primary" data-sr="close-options">Close</button></div>' +
            '</dialog>' +
            '<dialog class="dialog sr-dialog" data-role="help" aria-labelledby="sr-help-title-' + uid + '">' +
              '<h3 class="dialog-title" id="sr-help-title-' + uid + '">About Sight Reader</h3>' +
              '<div class="dialog-body sr-help">' +
                '<p>Sight Reader helps you learn to read music from a piece you are working on. A cursor sits on the first note. Type its letter, A to G, or press its key on the piano. When you are right the cursor moves to the next note, and for an interval or a chord you name every note in it first. A wrong letter marks an error and the cursor stays where it is. Rests are skipped.</p>' +
                '<p>On the piano a note lights in its own octave, where it stays until every note of an interval or chord is in. A key you click has to be the right note in the right octave, and typing a letter picks the octave for you. Options can show just the buttons A to G instead, which ask for no octave.</p>' +
                '<p>Options sets how many wrong tries it takes before the answer is shown, whether a right note is played, and which clefs and parts of the score to read. Restart, in the Practice menu, starts the piece again.</p>' +
                '<p>With Name sharps and flats on, a note is named with its sharp or flat as well, as the key signature and the bar make it: an F in G major is F sharp. Press the sharp (# or =) or flat (-) key, or its button, before the letter, twice for a double. Escape drops it. A natural is just the letter. Octaves are not asked for yet.</p>' +
                '<p>Scores are MusicXML files, compressed (.mxl) or not. Notation programs such as MuseScore export them, and MuseScore.com offers them as downloads. A piece that exists only as a PDF has to be converted first: MuseScore 4 can import a PDF, and Audiveris is a free program that reads one.</p>' +
              '</div>' +
              '<div class="dialog-actions"><button type="button" class="btn btn-primary" data-sr="close-help">Close</button></div>' +
            '</dialog>';

        var q = function (sel) { return root.querySelector(sel); };
        var el = {
            title: q('[data-role="title"]'), score: q('[data-role="score"]'), sheet: q('[data-role="sheet"]'),
            empty: q('[data-role="empty"]'), pos: q('[data-role="pos"]'), pendingMark: q('[data-role="pending"]'),
            feedback: q('[data-role="feedback"]'), tally: q('[data-role="tally"]'), file: q('.sr-file'),
            chooser: q('[data-role="chooser"]'), chooserBody: q('[data-role="chooser-body"]'),
            options: q('[data-role="options"]'), scope: q('[data-role="scope"]'), help: q('[data-role="help"]'),
            piano: q('.sr-piano'), letters: q('.sr-letters'), accidentals: q('.sr-accidentals')
        };
        var pianoKeys = [].slice.call(el.piano.querySelectorAll('.sr-key')), pianoAt = {}, blackKeys = [];
        pianoKeys.forEach(function (k) { pianoAt[k.getAttribute('data-semi')] = k; if (k.classList.contains('sr-black')) { blackKeys.push(k); } });
        var pianoStart = 60, keyFlash = null;
        var sharpButton = q('[data-acc="1"]'), flatButton = q('[data-acc="-1"]');

        /* === What the reader sees =========================================== */

        /* The line under the score: one message at a time, with its glyph and
           colour from PUDL's badge. tone is positive, danger, warn or none. */
        function say(text, tone) {
            el.feedback.textContent = text || '';
            el.feedback.className = 'badge sr-feedback' + (tone ? ' ' + tone : '');
            el.feedback.hidden = !text;
        }

        /* The title of the piece goes on the line of the page's own heading,
           at the right and in a smaller type, when the applet is on its own
           page and that heading is there. Anywhere else, in a window or in
           the installed app, it stays on the toolbar. */
        var heading = null, pieceTitle = null;
        if (ownUrl && !isApp) {
            var heads = [].slice.call(document.querySelectorAll('h1')).filter(function (h) { return h.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING; });
            heading = heads.length ? heads[heads.length - 1] : null;
        }
        function showTitle() {
            var name = score ? score.name : '';
            if (heading) {
                if (!pieceTitle) {
                    pieceTitle = document.createElement('span');
                    pieceTitle.className = 'sr-piece-title';
                    heading.classList.add('sr-heading');
                    heading.appendChild(pieceTitle);
                }
                pieceTitle.textContent = name;
                el.title.textContent = '';
                return;
            }
            el.title.textContent = name;
        }

        /* The first and last step of the bars being practised. */
        function span() {
            var lo = 0, hi = steps.length - 1, i;
            if (barFrom !== null) {
                lo = steps.length - 1;
                for (i = 0; i < steps.length; i++) { if (steps[i].measure >= barFrom) { lo = i; break; } }
            }
            if (barTo !== null) {
                hi = lo;
                for (i = steps.length - 1; i >= lo; i--) { if (steps[i].measure <= barTo) { hi = i; break; } }
            }
            return { lo: lo, hi: Math.max(lo, hi) };
        }

        function showPos() {
            if (!score || !steps.length || cur < 0) { el.pos.textContent = ''; return; }
            var k = Math.min(cur, steps.length - 1), s = span();
            el.pos.textContent = 'Bar ' + steps[k].measure + ' · ' + (k - s.lo + 1) + ' of ' + (s.hi - s.lo + 1) + (looping && pass > 1 ? ' · round ' + pass : '');
        }

        function showRange() {
            var from = q('[data-bar="from"]'), to = q('[data-bar="to"]');
            from.value = barFrom === null ? '' : String(barFrom);
            to.value = barTo === null ? '' : String(barTo);
            q('[data-loop]').checked = looping;
            q('[data-sr="clear-bars"]').disabled = barFrom === null && barTo === null;
        }

        function showTally() {
            var done = tally.first + tally.retried + tally.missed;
            el.tally.textContent = done ? tally.first + ' right first time' + (tally.retried ? ', ' + tally.retried + ' after a retry' : '') + (tally.missed ? ', ' + tally.missed + ' missed' : '') : '';
        }

        /* A sharp or flat waiting for its letter shows beside the position,
           and its button stays pressed. The buttons are there to be found,
           and only work with Name sharps and flats on. */
        function showPending() {
            el.pendingMark.hidden = !pendingAlter;
            el.pendingMark.textContent = accShown(pendingAlter);
            sharpButton.setAttribute('aria-pressed', String(pendingAlter > 0));
            flatButton.setAttribute('aria-pressed', String(pendingAlter < 0));
            var off = settings.accidentals ? '' : '. Turn on Name sharps and flats in Options';
            sharpButton.disabled = flatButton.disabled = !settings.accidentals;
            sharpButton.title = 'Sharp: press before the letter (# or =)' + off;
            flatButton.title = 'Flat: press before the letter (-)' + off;
        }

        function refresh() {
            el.empty.hidden = !!score;
            showTitle();
            showPos();
            showTally();
            showPending();
            showKeyboard();
            showRestart();
        }

        /* Restart is there once a score is open, and is the button to press at
           the end, when there is nothing else to do. */
        function showRestart() {
            var b = q('[data-sr="restart"]');
            b.disabled = !score || !steps.length;
            b.classList.toggle('btn-primary', finished);
        }

        /* === The piano ========================================================= */

        /* Which keyboard shows, and whether the black keys work. */
        function showKeyboard() {
            var piano = settings.keyboard !== 'letters';
            el.piano.hidden = !piano;
            el.letters.hidden = piano;
            el.accidentals.hidden = piano;
            blackKeys.forEach(function (k) {
                k.disabled = !settings.accidentals;
                if (settings.accidentals) { k.removeAttribute('title'); } else { k.title = 'Turn on Name sharps and flats in Options to use the black keys'; }
            });
            showPiano();
        }

        /* The pitch a note has on the keyboard shown: its own, with sharps and
           flats named, and with them off the white key of its letter, since the
           black keys do not work then and the reader presses the letter. */
        function target(s) { return settings.accidentals ? s.midi : s.nat; }
        function onKeyboard(s, start) { var t = target(s); return t >= start && t <= start + PIANO_SPAN; }

        /* The key for a note, in the two octaves on the screen: a note outside
           them is shown in the nearest octave that is. */
        function keyFor(midi) {
            var m = midi;
            while (m < pianoStart) { m += 12; }
            while (m > pianoStart + PIANO_SPAN) { m -= 12; }
            return pianoAt[m - pianoStart];
        }

        /* The keyboard follows the notes: it moves only when it would then show
           more of the step's notes than it does, to the octave that shows the
           most, so it does not jump about between near notes. The C keys say
           which octave they are in, and the notes of the step that are named, or
           shown by the answer, are lit in their own octave and stay lit until the
           step is done, whether they were typed or clicked. */
        function showPiano() {
            var step = score && cur >= 0 && cur < steps.length ? steps[cur] : null;
            if (step) {
                var shown = function (start) { return step.notes.filter(function (s) { return onKeyboard(s, start); }).length; };
                var best = pianoStart, most = shown(pianoStart);
                step.notes.forEach(function (s) {
                    /* The C at the foot of the note's octave, or the octave below it, so
                       the note can sit in either of the two octaves shown. */
                    [Math.floor(target(s) / 12) * 12, Math.floor(target(s) / 12) * 12 - 12].forEach(function (start) {
                        var n = start >= 0 ? shown(start) : 0;
                        if (n > most) { best = start; most = n; }
                    });
                });
                pianoStart = best;
            }
            pianoKeys.forEach(function (k) {
                k.classList.remove('sr-named', 'sr-missed');
                var semi = +k.getAttribute('data-semi');
                if (semi % 12 === 0) { k.querySelector('.sr-key-label').textContent = 'C' + (Math.floor((pianoStart + semi) / 12) - 1); }
            });
            if (step) {
                step.notes.forEach(function (s) {
                    if (s.state) { keyFor(target(s)).classList.add(s.state === 'ok' ? 'sr-named' : 'sr-missed'); }
                });
            }
        }

        /* A wrong key flashes red, as the cursor does. */
        function flashKey(button) {
            button.classList.add('sr-keywrong');
            clearTimeout(keyFlash);
            keyFlash = setTimeout(function () { button.classList.remove('sr-keywrong'); }, 420);
        }

        /* The cursor flashes red for a wrong letter; the shake is left out
           for a reader who asked for less motion, the colour is not. */
        function flash() {
            var c = osmd && osmd.cursor && osmd.cursor.cursorElement;
            if (!c) { return; }
            c.classList.add('sr-wrong');
            clearTimeout(flashTimer);
            flashTimer = setTimeout(function () { c.classList.remove('sr-wrong'); }, 420);
        }

        /* Keeps the cursor in view by scrolling the score's own box, which
           is the only thing that moves: nothing else on the page scrolls. */
        function keepInView() {
            var c = osmd && osmd.cursor && osmd.cursor.cursorElement;
            if (!c || !c.isConnected) { return; }
            var box = el.score.getBoundingClientRect(), r = c.getBoundingClientRect();
            if (r.height === 0) { return; }
            if (r.top < box.top + 12 || r.bottom > box.bottom - 12) {
                var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                el.score.scrollTo({ top: el.score.scrollTop + (r.top + r.height / 2) - (box.top + box.height / 2), behavior: calm ? 'auto' : 'smooth' });
            }
        }

        /* === Sound ============================================================ */

        /* The note as a short plucked tone, at the pitch it is written at,
           from the octave, letter and accidental of its pitch. A part for a
           transposing instrument sounds at its written pitch here. */
        function midiOf(n) {
            var p = n.Pitch;
            return (p.Octave + OS.Pitch.OctaveXmlDifference + 1) * 12 + SEMITONE[OS.Pitch.getNoteEnumString(p.FundamentalNote)] + p.AccidentalHalfTones;
        }
        function frequencyOf(n) { return 440 * Math.pow(2, (midiOf(n) - 69) / 12); }
        function play(notes) {
            if (!settings.sound || !notes.length) { return; }
            try {
                var Ctx = window.AudioContext || window.webkitAudioContext;
                if (!Ctx) { return; }
                if (!audio) { audio = new Ctx(); }
                if (audio.state === 'suspended') { audio.resume(); }
                var t0 = audio.currentTime, level = 0.22 / Math.sqrt(notes.length);
                notes.forEach(function (s) {
                    var osc = audio.createOscillator(), gain = audio.createGain();
                    osc.type = 'triangle';
                    osc.frequency.value = frequencyOf(s.note);
                    gain.gain.setValueAtTime(0.0001, t0);
                    gain.gain.exponentialRampToValueAtTime(level, t0 + 0.01);
                    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1);
                    osc.connect(gain);
                    gain.connect(audio.destination);
                    osc.start(t0);
                    osc.stop(t0 + 1.15);
                });
            } catch (err) { /* A browser with no sound still quizzes. */ }
        }

        /* === Drawing the score ================================================ */

        function draw() {
            if (!el.score.clientWidth) { needsDraw = true; return false; }
            needsDraw = false;
            narrow = el.score.clientWidth < 600;
            lastWidth = el.score.clientWidth;
            osmd.setOptions({ drawPartNames: !narrow });
            osmd.Zoom = narrow ? 0.8 : 1;
            osmd.render();
            /* A browser that does not keep room for the scrollbar (the box's CSS
               asks it to) shows it only now, the score being tall, and has
               taken its width from a drawing already made: once more, at the
               width that is left. */
            if (el.score.scrollWidth > el.score.clientWidth + 1) { lastWidth = el.score.clientWidth; osmd.render(); }
            osmd.cursor.show();
            curAdv = -1;
            return true;
        }

        /* Whether a note is one the quiz could ask for: pitched, new, not a
           grace note, and not on a tablature staff, which only repeats the
           notes of the staff above it. */
        function readable(n) {
            if (n.isRest() || n.IsGraceNote || !n.Pitch) { return false; }
            if (n.NoteTie && n.NoteTie.StartNote !== n) { return false; }
            return !n.ParentStaff.isTab;
        }
        function keyOf(n) {
            var letter = OS.Pitch.getNoteEnumString(n.Pitch.FundamentalNote);
            return settings.accidentals ? letter + accKey(n.Pitch.AccidentalHalfTones) : letter;
        }

        /* Walks the whole score once, noting each step. The iterator moves
           without drawing, and the cursor goes back to the start after. The
           clef in effect on each staff is followed through the score's clef
           instructions, at the start of each bar and within it, so a hand
           that moves into another clef counts as that clef while it is
           there. The first walk also notes what there is to choose from. */
        function build() {
            var first = !info, instruments = osmd.Sheet.Instruments;
            if (first) { info = { clefs: {}, parts: instruments.map(function (i, n) { return { name: i.Name || 'Part ' + (n + 1), count: 0 }; }) }; }
            steps = [];
            /* A bar's lists of instructions, which hold one entry for each staff
               of the score in order, instrument by instrument: those that open
               the bar, and those that close it, where a clef change at the
               barline is filed with the bar before. A clef met on the way
               stands for its staff until the next. */
            var staves = [].concat.apply([], instruments.map(function (i) { return i.Staves; }));
            var clefAt = [], lastMeasure = null;
            function takeAt(entry, idx) {
                if (!entry) { return; }
                (entry.Instructions || []).forEach(function (ins) { if (isClef(ins)) { clefAt[idx] = clefName(ins); } });
            }
            var cursor = osmd.cursor;
            cursor.reset();
            var it = cursor.Iterator, adv = 0;
            while (!it.EndReached) {
                var measure = it.CurrentMeasure;
                if (measure !== lastMeasure) {
                    if (lastMeasure) { (lastMeasure.LastInstructionsStaffEntries || []).forEach(takeAt); }
                    (measure.FirstInstructionsStaffEntries || []).forEach(takeAt);
                    lastMeasure = measure;
                }
                var found = [];
                cursor.NotesUnderCursor().forEach(function (n) {
                    if (!readable(n)) { return; }
                    var staff = staves.indexOf(n.ParentStaff);
                    if (n.ParentStaffEntry) { takeAt(n.ParentStaffEntry, staff); }
                    var clef = clefAt[staff] || 'Treble', part = instruments.indexOf(n.ParentStaff.ParentInstrument);
                    if (first) { info.clefs[clef] = (info.clefs[clef] || 0) + 1; if (info.parts[part]) { info.parts[part].count++; } }
                    if (chosen.clefs && !chosen.clefs[clef]) { return; }
                    if (chosen.parts && !chosen.parts[part]) { return; }
                    var midi = midiOf(n), oct = n.Pitch.Octave + OS.Pitch.OctaveXmlDifference;
                    found.push({
                        note: n, key: keyOf(n), midi: midi, pc: ((midi % 12) + 12) % 12, oct: oct,
                        nat: (oct + 1) * 12 + SEMITONE[OS.Pitch.getNoteEnumString(n.Pitch.FundamentalNote)], state: ''
                    });
                });
                if (found.length) { steps.push({ adv: adv, measure: measure.MeasureNumber, notes: found, result: '' }); }
                it.moveToNext();
                adv++;
            }
            cursor.reset();
            curAdv = 0;
        }

        /* Puts the cursor on a step. It moves forward by the iterator, and
           from the start when the step is behind it; the cursor is drawn
           once, where it ends. */
        function moveTo(k, show) {
            var target = steps[k].adv, cursor = osmd.cursor;
            if (curAdv < 0 || curAdv > target) { cursor.reset(); curAdv = 0; }
            var it = cursor.Iterator;
            while (curAdv < target) { it.moveToNext(); curAdv++; }
            if (show !== false) { cursor.update(); keepInView(); }
        }

        /* Colours one note. The library colours every notehead of a chord at
           once, so for a chord the noteheads are matched to the notes by height
           on the page, lowest note to lowest head, and only the one head is
           coloured. When the heads cannot be matched to the notes, the whole
           chord takes the colour. */
        function markNote(g, note, color) {
            var ve = note.ParentVoiceEntry, chord = ve ? ve.Notes.filter(function (n) { return n.Pitch && !n.isRest(); }) : [];
            var heads = chord.length > 1 && typeof g.getNoteheadSVGs === 'function' ? g.getNoteheadSVGs() : [];
            var head = null;
            if (heads.length === chord.length && chord.length > 1) {
                var tops = heads.map(function (h) { return { h: h, y: h.getBoundingClientRect().top }; });
                if (tops.some(function (t) { return t.y !== tops[0].y; })) {
                    chord = chord.slice().sort(function (a, b) { return midiOf(a) - midiOf(b); });
                    tops.sort(function (a, b) { return b.y - a.y; });
                    head = tops[chord.indexOf(note)] ? tops[chord.indexOf(note)].h : null;
                }
            }
            if (!head) { g.setColor(color, MARK); return; }
            [].slice.call(head.querySelectorAll('path, text')).forEach(function (p) {
                p.setAttribute(p.getAttribute('fill') === 'none' ? 'stroke' : 'fill', color);
            });
        }

        /* Colours the notes of the step the cursor is on that have a state. */
        function paintHere(k) {
            var graphical = osmd.cursor.GNotesUnderCursor();
            steps[k].notes.forEach(function (s) {
                if (!s.state) { return; }
                graphical.forEach(function (g) { if (g.sourceNote === s.note) { markNote(g, s.note, s.state === 'ok' ? GREEN : RED); } });
            });
        }

        /* Draws the marks again after the score was drawn again, which clears
           them: every step that has been read, up to the one in front. */
        function repaint() {
            for (var k = 0; k <= cur && k < steps.length; k++) {
                if (!steps[k].notes.some(function (s) { return s.state; })) { continue; }
                moveTo(k, false);
                paintHere(k);
            }
            if (cur >= 0 && cur < steps.length) { moveTo(cur); }
        }

        /* === The quiz ======================================================== */

        function distinct(step) {
            var seen = {};
            step.notes.forEach(function (s) { seen[s.key] = true; });
            return Object.keys(seen).sort();
        }

        function begin(k) {
            cur = k;
            tries = 0;
            revealed = false;
            clearPending();
            moveTo(k);
            showPos();
            showPiano();
            var n = distinct(steps[k]).length;
            say(n > 1 ? 'Name every note of the ' + (n === 2 ? 'interval' : 'chord') : '', '');
        }

        function conclude(result) {
            steps[cur].result = result;
            if (result === 'first') { tally.first++; } else if (result === 'retried') { tally.retried++; } else { tally.missed++; }
            showTally();
        }

        function advance() {
            var s = span();
            if (cur + 1 <= s.hi) { begin(cur + 1); keepSnapshot(); return; }
            if (looping) {
                var done = tally.first + tally.retried + tally.missed, right = tally.first;
                pass++;
                tally = { first: 0, retried: 0, missed: 0 };
                steps.forEach(function (st) { st.result = ''; st.notes.forEach(function (n) { n.state = ''; }); });
                if (draw()) { begin(s.lo); }
                refresh();
                say('Round ' + (pass - 1) + ': ' + right + ' of ' + done + ' right first time. Round ' + pass + ' begins.', right === done ? 'positive' : 'warn');
                keepSnapshot();
                return;
            }
            finished = true;
            var total = tally.first + tally.retried + tally.missed;
            say('Finished: ' + tally.first + ' of ' + total + ' right first time' + (tally.missed ? ', ' + tally.missed + ' missed' : ''), tally.missed ? 'warn' : 'positive');
            showRestart();
            keepSnapshot();
        }

        function wrong(why) {
            tries++;
            flash();
            if (settings.revealAfter > 0 && tries >= settings.revealAfter) { reveal(); return; }
            say(why || 'Not that one', 'danger');
        }

        /* Shows the answer: the notes still unnamed turn red and the status
           says what they are. Any key goes on from here. */
        function reveal() {
            var step = steps[cur], open = step.notes.filter(function (s) { return s.state !== 'ok'; }), seen = {};
            var missing = open.filter(function (s) { return seen[s.key] ? false : (seen[s.key] = true); }).map(function (s) { return s.key; }).sort();
            open.forEach(function (s) { s.state = 'missed'; });
            paintHere(cur);
            revealed = true;
            showPiano();
            conclude('missed');
            say('The answer is ' + missing.map(nameOf).join(', ') + '. Press any key to go on.', 'warn');
        }

        function ready() { return !!score && cur >= 0 && !finished && !!steps.length; }

        /* The reader names some notes of the step: hit is the notes of the step
           that what they pressed names, none if it names none. A note already
           named costs nothing; a note not in the step is a wrong try; the
           cursor goes on once every note of the step is named. keyButton is the
           piano key pressed, which flashes if it is wrong. */
        function attempt(hit, keyButton, why) {
            clearPending();
            var step = steps[cur];
            if (!hit.length) { if (keyButton) { flashKey(keyButton); } wrong(why); return; }
            var got = hit.filter(function (s) { return s.state !== 'ok'; });
            if (!got.length) { return; }
            got.forEach(function (s) { s.state = 'ok'; });
            paintHere(cur);
            play(got);
            var left = step.notes.filter(function (s) { return s.state !== 'ok'; }), pitches = {};
            left.forEach(function (s) { pitches[s.key + s.midi] = true; });
            if (left.length) { showPiano(); say('Right. ' + Object.keys(pitches).length + ' more to name', 'positive'); return; }
            conclude(tries ? 'retried' : 'first');
            advance();
        }

        /* A letter, with the sharp or flat waiting for it when sharps and flats
           are named: the note is named as it is spelled. */
        function answer(letter) {
            if (!ready()) { return; }
            if (revealed) { advance(); return; }
            var key = settings.accidentals ? letter + accKey(pendingAlter) : letter;
            /* A letter names one note: of those with that name still unnamed,
               the lowest, along with any note at the same pitch (a singer's
               note doubled by the piano). The same letter again names the next,
               so a B in two octaves takes two presses. A letter that is right
               only for notes already named is not a wrong try. */
            var all = steps[cur].notes.filter(function (s) { return s.key === key; });
            var open = all.filter(function (s) { return s.state !== 'ok'; });
            if (!open.length) { attempt(all); return; }
            var low = Math.min.apply(null, open.map(function (s) { return s.midi; }));
            attempt(open.filter(function (s) { return s.midi === low; }));
        }

        /* A key of the piano is the note and the octave, so it is right only if
           it is the key the note is on. A letter typed has no octave, and the
           note lights in its own. With sharps and flats on, a black key is a
           pitch, so right for either spelling of it, F sharp or G flat; with them
           off, only the white keys work, and name the letter. A note too far from
           the others to be on the keyboard cannot be pressed in its octave, so
           for it any octave will do. A key of the right note in the wrong octave
           says so. */
        function answerPiano(button) {
            if (!ready()) { return; }
            if (revealed) { advance(); return; }
            var semi = +button.getAttribute('data-semi'), midi = pianoStart + semi, pc = semi % 12;
            var letter = LETTER_OF_PC[pc], notes = steps[cur].notes;
            var sameNote = function (s) { return settings.accidentals ? s.pc === pc : s.key === letter; };
            /* A key that is a note of the step on the keyboard names it. Only
               when it is not does it name a note that is off the keyboard, one
               at a time, so that B3 does not also name a B2 below the keys. */
            var hit = notes.filter(function (s) { return onKeyboard(s, pianoStart) && target(s) === midi; });
            if (!hit.length) {
                var far = notes.filter(function (s) { return !onKeyboard(s, pianoStart) && s.state !== 'ok' && sameNote(s); });
                if (far.length) {
                    var low = Math.min.apply(null, far.map(function (s) { return s.midi; }));
                    hit = far.filter(function (s) { return s.midi === low; });
                }
            }
            attempt(hit, button, notes.some(sameNote) ? 'Right note, wrong octave' : '');
        }

        /* A sharp or flat typed or pressed before its letter. Pressing the
           other kind takes one back, so a flat pressed by mistake is undone by
           a sharp. */
        function bump(d) {
            if (!settings.accidentals) { say('Turn on Name sharps and flats in Options to answer with them.', 'warn'); return; }
            pendingAlter = Math.max(-2, Math.min(2, pendingAlter + d));
            showPending();
        }
        function clearPending() { if (pendingAlter) { pendingAlter = 0; showPending(); } }

        function restart() {
            if (!score || !steps.length) { return; }
            finished = false;
            tally = { first: 0, retried: 0, missed: 0 };
            steps.forEach(function (s) { s.result = ''; s.notes.forEach(function (n) { n.state = ''; }); });
            pass = 1;
            if (draw()) { begin(span().lo); }
            refresh();
            keepSnapshot();
        }

        /* A change to the first or last bar, or to the loop: the practice
           starts again at the first bar chosen. A first bar past the last is
           taken to mean the two the other way round. */
        function onRange(box) {
            if (box.hasAttribute('data-loop')) { looping = box.checked; showPos(); keepSnapshot(); return; }
            var which = box.getAttribute('data-bar'), n = parseInt(box.value, 10);
            var value = n > 0 ? n : null;
            if (which === 'from') { barFrom = value; } else { barTo = value; }
            if (barFrom !== null && barTo !== null && barFrom > barTo) { var t = barFrom; barFrom = barTo; barTo = t; }
            showRange();
            restart();
        }

        /* A change to what is read, or to how a note is named, starts the
           piece again from its steps as they are now. */
        function rebuild() {
            if (!score || !osmd) { return; }
            if (needsDraw && !el.score.clientWidth) { return; }
            build();
            if (!steps.length) { cur = -1; say('Nothing in the clefs and parts chosen has notes to read.', 'warn'); refresh(); return; }
            restart();
        }

        /* === Opening a score ==================================================== */

        function fetchIndex() {
            return fetch(SAMPLES + 'index.json', { credentials: 'same-origin', cache: 'no-cache' })
                .then(function (r) { return r.ok ? r.json() : { groups: [] }; })
                .catch(function () { return { groups: [] }; });
        }

        /* src is { name, rel } for a sample, which is its path in the samples
           folder, or { name, file } for a file from the reader's device. A
           restored game brings back how far it had got. */
        function openScore(src, again) {
            if (src.rel && !validRel(src.rel)) { say('That is not a score this applet can open.', 'danger'); return Promise.resolve(); }
            var id = ++loadId;
            say('Opening ' + src.name + '…', '');
            return Promise.all([loadOsmd(), src.file ? src.file.arrayBuffer() : fetch(sampleUrl(src.rel), { credentials: 'same-origin' }).then(function (r) {
                if (!r.ok) { throw new Error(src.name + ' could not be fetched (' + r.status + ')'); }
                return r.arrayBuffer();
            })]).then(function (got) {
                if (destroyed || id !== loadId) { return; }
                OS = got[0];
                if (osmd) { osmd.clear(); }
                el.sheet.innerHTML = '';
                osmd = new OS.OpenSheetMusicDisplay(el.sheet, {
                    backend: 'svg', autoResize: false, followCursor: false, drawTitle: true, drawSubtitle: true,
                    cursorsOptions: [{ type: 0, color: '#2c5282', alpha: 0.35, follow: false }]
                });
                return osmd.load(contentOf(got[1])).then(function () {
                    if (destroyed || id !== loadId) { return; }
                    score = src;
                    info = null;
                    chosen = { clefs: null, parts: null };
                    barFrom = null; barTo = null; pass = 1; showRange();
                    finished = false;
                    tally = { first: 0, retried: 0, missed: 0 };
                    cur = -1;
                    if (!draw()) { pending = again || null; say('', ''); refresh(); return; }
                    build();
                    if (again && again.cs) { chosen.clefs = setOf(again.cs); build(); }
                    if (again && again.ps) { chosen.parts = setOf(again.ps); build(); }
                    if (!steps.length) { say('This score has no notes to read.', 'warn'); refresh(); renderScope(); return; }
                    if (again) { restoreProgress(again); } else { begin(0); }
                    refresh();
                    renderScope();
                    announce();
                    keepSnapshot();
                    if (ownUrl || root.closest('.win.active')) { root.focus({ preventScroll: true }); }
                });
            }).catch(function (err) {
                if (destroyed || id !== loadId) { return; }
                say('Could not open ' + src.name + ': ' + (err && err.message ? err.message : err), 'danger');
            });
        }

        function setOf(list) { var s = {}; (list || []).forEach(function (k) { s[k] = true; }); return s; }

        /* === Choosing a score, and what to read ================================== */

        function openChooser() {
            el.chooserBody.innerHTML = '<p class="sr-muted">Looking for scores…</p>';
            if (!el.chooser.open) { el.chooser.showModal(); }
            fetchIndex().then(function (index) {
                if (destroyed) { return; }
                var groups = (index.groups || []).filter(function (g) { return g.scores && g.scores.length; });
                el.chooserBody.innerHTML = groups.length ? groups.map(function (g) {
                    return '<section class="sr-group">' + (g.name ? '<h4 class="sr-group-name">' + esc(g.name) + '</h4>' : '') +
                        '<ul class="sr-list">' + g.scores.map(function (s) {
                            return '<li><button type="button" class="btn sr-pick" data-sr-open="' + esc(s.file) + '" data-sr-name="' + esc(s.title) + '">' + esc(s.title) + '</button></li>';
                        }).join('') + '</ul></section>';
                }).join('') : '<p class="sr-muted">No sample scores were found. Open a file from this device instead.</p>';
            });
        }

        /* The clefs and parts of the score open, as checkboxes. A score in one
           clef, which is most single-staff music, has no choice to offer, and
           neither has one with a single part. */
        function renderScope() {
            var html = '';
            if (info) {
                var clefs = Object.keys(info.clefs).sort(function (a, b) { return info.clefs[b] - info.clefs[a]; });
                if (clefs.length > 1) {
                    html += '<fieldset class="sr-scope"><legend>Clefs to read</legend><p class="form-help">Only notes in the clefs ticked are asked for. A hand that moves into another clef counts as that clef while it is there. Changing this starts the piece again.</p>' + clefs.map(function (c) {
                        return '<label class="check"><input type="checkbox" data-clef="' + esc(c) + '"' + (!chosen.clefs || chosen.clefs[c] ? ' checked' : '') + ' /> ' + esc(c) + ' <span class="sr-muted">' + info.clefs[c] + ' notes</span></label>';
                    }).join('') + '</fieldset>';
                }
                var parts = info.parts.map(function (p, n) { return { n: n, p: p }; }).filter(function (x) { return x.p.count; });
                if (parts.length > 1) {
                    html += '<fieldset class="sr-scope"><legend>Parts to read</legend><p class="form-help">Only the parts ticked are asked for, so a singer can read the voice alone. Changing this starts the piece again.</p>' + parts.map(function (x) {
                        return '<label class="check"><input type="checkbox" data-part="' + x.n + '"' + (!chosen.parts || chosen.parts[x.n] ? ' checked' : '') + ' /> ' + esc(x.p.name) + ' <span class="sr-muted">' + x.p.count + ' notes</span></label>';
                    }).join('') + '</fieldset>';
                }
            }
            el.scope.innerHTML = html;
        }

        function showOptions() {
            el.options.querySelector('[data-opt="keyboard"]').value = settings.keyboard === 'letters' ? 'letters' : 'piano';
            el.options.querySelector('[data-opt="revealAfter"]').value = String(settings.revealAfter);
            el.options.querySelector('[data-opt="accidentals"]').checked = !!settings.accidentals;
            el.options.querySelector('[data-opt="sound"]').checked = !!settings.sound;
            renderScope();
            if (!el.options.open) { el.options.showModal(); }
        }

        function saveSetting(changes) {
            Object.assign(settings, changes);
            loadConfig().then(function (c) { return c.set('sight-reader', changes); }).catch(function () { });
        }

        /* A change to a checkbox of clefs or parts: at least one of each stays
           ticked, and the piece starts again on what is ticked. */
        function onScopeChange(box) {
            var group = box.hasAttribute('data-clef') ? 'clefs' : 'parts', attr = group === 'clefs' ? 'data-clef' : 'data-part';
            var boxes = [].slice.call(el.scope.querySelectorAll('[' + attr + ']'));
            var ticked = boxes.filter(function (b) { return b.checked; });
            if (!ticked.length) { box.checked = true; return; }
            chosen[group] = ticked.length === boxes.length ? null : setOf(ticked.map(function (b) { return b.getAttribute(attr); }));
            rebuild();
        }

        /* === The address and the snapshot ========================================= */

        /* A sample's path is what a link to the applet carries, so a link opens
           the same score. A file from the reader's device has no address. */
        function stateString() { return score && score.rel ? 'score=' + encodeURIComponent(score.rel).replace(/%2F/g, '/') : ''; }
        function announce() {
            if (ownUrl) {
                var qs = new URLSearchParams(location.search);
                if (score && score.rel) { qs.set('score', score.rel); } else { qs.delete('score'); }
                var s = qs.toString().replace(/%2F/g, '/');
                history.replaceState(history.state, '', location.pathname + (s ? '?' + s : '') + location.hash);
            }
            if (opts.changed) { opts.changed(stateString()); }
            /* The last sample opened is kept, so the installed app, whose launch
               address names no score, opens on it. */
            if (score && score.rel && settings.lastScore !== score.rel) { saveSetting({ lastScore: score.rel }); }
        }
        /* The score a state string or an address asks for, as it was written. */
        function askedFor(s) {
            if (!s) { return null; }
            return new URLSearchParams(String(s).replace(/^\?/, '')).get('score') || null;
        }
        function relFrom(s) { var v = askedFor(s); return validRel(v) ? v : null; }

        /* A reload brings back the step the reader was on, how each earlier
           one went and what they chose to read (js/snapshot.js), for a sample,
           which can be fetched again. */
        var snap = window.pcSnapshot ? window.pcSnapshot.join(root, function () {
            if (!score || !score.rel || !steps.length) { return null; }
            return {
                rel: score.rel, name: score.name, k: cur,
                r: steps.map(function (s) { return s.result ? s.result.charAt(0) : '-'; }).join(''), t: tally,
                cs: chosen.clefs ? Object.keys(chosen.clefs) : null, ps: chosen.parts ? Object.keys(chosen.parts) : null,
                bf: barFrom, bt: barTo, lp: looping, ps2: pass
            };
        }) : null;
        function keepSnapshot() { if (snap) { snap.changed(); } }
        var CODES = { f: 'first', r: 'retried', m: 'missed' };
        function restoreProgress(kept) {
            var codes = String(kept.r || '');
            barFrom = +kept.bf > 0 ? +kept.bf : null;
            barTo = +kept.bt > 0 ? +kept.bt : null;
            looping = !!kept.lp;
            pass = +kept.ps2 > 1 ? +kept.ps2 : 1;
            showRange();
            for (var i = 0; i < steps.length && i < codes.length; i++) {
                var result = CODES[codes.charAt(i)];
                if (!result) { continue; }
                steps[i].result = result;
                steps[i].notes.forEach(function (n) { n.state = result === 'missed' ? 'missed' : 'ok'; });
            }
            if (kept.t && typeof kept.t === 'object') { tally = { first: +kept.t.first || 0, retried: +kept.t.retried || 0, missed: +kept.t.missed || 0 }; }
            var k = Math.max(0, Math.min(+kept.k || 0, steps.length - 1));
            cur = k;
            repaint();
            begin(k);
        }

        /* === Input ============================================================== */

        function onClick(e) {
            var note = e.target.closest('[data-note]');
            if (note && root.contains(note)) { answer(note.getAttribute('data-note')); return; }
            var acc = e.target.closest('[data-acc]');
            if (acc && root.contains(acc)) { bump(+acc.getAttribute('data-acc')); return; }
            var key = e.target.closest('.sr-key');
            if (key && root.contains(key)) { answerPiano(key); return; }
            var open = e.target.closest('[data-sr-open]');
            if (open) { el.chooser.close(); openScore({ name: open.getAttribute('data-sr-name'), rel: open.getAttribute('data-sr-open') }); return; }
            var act = e.target.closest('[data-sr]');
            if (!act) { return; }
            switch (act.getAttribute('data-sr')) {
                case 'choose': openChooser(); break;
                case 'options': showOptions(); break;
                case 'restart': restart(); root.focus({ preventScroll: true }); break;
                case 'clear-bars': barFrom = null; barTo = null; showRange(); restart(); root.focus({ preventScroll: true }); break;
                case 'file': el.file.click(); break;
                case 'close-chooser': el.chooser.close(); break;
                case 'close-options': el.options.close(); root.focus({ preventScroll: true }); break;
                case 'close-help': el.help.close(); break;
            }
        }

        function onChange(e) {
            var t = e.target;
            if (t.hasAttribute('data-bar') || t.hasAttribute('data-loop')) { onRange(t); return; }
            if (!el.options.contains(t)) { return; }
            if (t.hasAttribute('data-clef') || t.hasAttribute('data-part')) { onScopeChange(t); return; }
            var opt = t.getAttribute('data-opt');
            if (opt === 'keyboard') { saveSetting({ keyboard: t.value === 'letters' ? 'letters' : 'piano' }); showKeyboard(); }
            else if (opt === 'revealAfter') { saveSetting({ revealAfter: +t.value }); }
            else if (opt === 'sound') { saveSetting({ sound: t.checked }); }
            else if (opt === 'accidentals') { saveSetting({ accidentals: t.checked }); clearPending(); showPending(); showKeyboard(); rebuild(); }
        }

        function onKeyDown(e) {
            if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) { return; }
            var t = e.target;
            /* Enter in a bar box applies it and returns to the music; Tab just
               moves on, so the first bar and the last are neighbours. */
            if (e.key === 'Enter' && t.hasAttribute && t.hasAttribute('data-bar')) { e.preventDefault(); root.focus({ preventScroll: true }); return; }
            if (t.closest && (t.closest('dialog') || t.closest('input, select, textarea, [contenteditable]'))) { return; }
            if (e.key.length === 1 && /[a-gA-G]/.test(e.key)) { e.preventDefault(); answer(e.key.toUpperCase()); return; }
            if (e.key === '#' || e.key === '=') { e.preventDefault(); bump(1); return; }
            if (e.key === '-') { e.preventDefault(); bump(-1); return; }
            if (e.key === 'Escape' && pendingAlter) { e.preventDefault(); clearPending(); return; }
            /* Enter and Space on a button press that button, which answers; on
               the score itself they go on from a shown answer. */
            if (revealed && (e.key === 'Enter' || e.key === ' ') && !(t.closest && t.closest('button'))) { e.preventDefault(); advance(); }
        }

        function fromDevice(file) {
            if (!file) { return; }
            if (el.chooser.open) { el.chooser.close(); }
            openScore({ name: file.name.replace(/\.[^.]*$/, ''), file: file });
        }

        /* Whether the keyboard moved the focus to the applet: Tab, anywhere on
           the page, until a press in the applet says the pointer has it. */
        function onTab(e) { if (e.key === 'Tab') { root.classList.add('sr-tabbed'); } }
        document.addEventListener('keydown', onTab, true);
        root.addEventListener('pointerdown', function () { root.classList.remove('sr-tabbed'); });

        el.file.addEventListener('change', function () { fromDevice(el.file.files && el.file.files[0]); el.file.value = ''; });
        root.addEventListener('click', onClick);
        root.addEventListener('change', onChange);
        root.addEventListener('keydown', onKeyDown);
        /* A press on the score puts the keyboard in the applet. */
        root.addEventListener('pointerdown', function (e) { if (!e.target.closest('button, dialog, input')) { root.focus({ preventScroll: true }); } });
        root.addEventListener('dragover', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { e.preventDefault(); } });
        root.addEventListener('drop', function (e) {
            if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) { return; }
            e.preventDefault();
            fromDevice(e.dataTransfer.files[0]);
        });

        /* The score is drawn again when its box changes width by more than a
           few pixels, with the part names left out and the page smaller on a
           narrow one, and the marks put back. */
        var observer = null;
        if (window.ResizeObserver) {
            observer = new ResizeObserver(function () {
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(function () {
                    if (destroyed || !osmd || !score) { return; }
                    var w = el.score.clientWidth;
                    if (!w || (!needsDraw && Math.abs(w - lastWidth) < 24)) { return; }
                    if (!draw()) { return; }
                    if (!steps.length) {
                        build();
                        if (steps.length && cur < 0) { if (pending) { restoreProgress(pending); pending = null; } else { begin(0); } }
                        refresh();
                        renderScope();
                        return;
                    }
                    repaint();
                }, 250);
            });
            observer.observe(el.score);
        }

        /* === Menus ============================================================== */

        function menus() {
            var open = !!score;
            return {
                titles: [
                    { label: 'Sight Reader', items: window.pcAppletIdentity(root, [{ label: 'About Sight Reader', run: function () { el.help.showModal(); } }]) },
                    { label: 'Score', items: [
                        { label: 'Choose a score…', run: openChooser },
                        { label: 'Open a file from this device…', run: function () { el.file.click(); } }
                    ] },
                    { label: 'Practice', items: [
                        { label: 'Restart', disabled: !open, run: restart },
                        { label: 'Show the answer', disabled: !open || finished || revealed || cur < 0, run: function () { if (!revealed && !finished && cur >= 0) { reveal(); root.focus({ preventScroll: true }); } } },
                        '-',
                        { label: 'Options…', run: showOptions }
                    ] }
                ]
            };
        }

        /* === Start ============================================================== */

        say('', '');
        refresh();
        var startAsked = askedFor(opts.state) || (ownUrl ? askedFor(location.search) : null);
        var startRel = validRel(startAsked) ? startAsked : null;
        var kept = snap && snap.kept && validRel(snap.kept.rel) ? snap.kept : null;
        var boot = loadConfig().then(function (c) {
            return c.load('sight-reader', SETTINGS).then(function (s) {
                settings = Object.assign({}, SETTINGS, s);
                showPending();
                showKeyboard();
                unConfig = c.onChange('sight-reader', function (next) {
                    var before = settings.accidentals;
                    settings = Object.assign({}, SETTINGS, next);
                    showPending();
                    showKeyboard();
                    if (before !== settings.accidentals) { rebuild(); }
                });
            });
        }).catch(function () { }).then(function () {
            if (destroyed) { return; }
            /* An address that names the score the snapshot kept is a reload,
               and the reader carries on where they were. */
            if (startAsked && !startRel) { say('That is not a score this applet can open.', 'danger'); return; }
            if (startRel) { return openScore({ name: startRel.replace(/^.*\//, '').replace(/\.[^.]*$/, ''), rel: startRel }, kept && kept.rel === startRel ? kept : null); }
            if (kept) { return openScore({ name: kept.name || kept.rel, rel: kept.rel }, kept); }
            if (isApp && validRel(settings.lastScore)) { return openScore({ name: settings.lastScore.replace(/^.*\//, '').replace(/\.[^.]*$/, ''), rel: settings.lastScore }); }
        });

        return {
            state: function () { return stateString() || null; },
            setState: function (s) {
                var rel = relFrom(s);
                if (rel) { openScore({ name: rel.replace(/^.*\//, '').replace(/\.[^.]*$/, ''), rel: rel }); }
            },
            menus: menus,
            destroy: function () {
                destroyed = true;
                if (pieceTitle) { pieceTitle.remove(); heading.classList.remove('sr-heading'); }
                document.removeEventListener('keydown', onTab, true);
                clearTimeout(resizeTimer);
                clearTimeout(flashTimer);
                if (observer) { observer.disconnect(); }
                if (unConfig) { unConfig(); }
                if (snap) { snap.leave(); }
                ['chooser', 'options', 'help'].forEach(function (d) { if (el[d].open) { el[d].close(); } });
                if (osmd) { try { osmd.clear(); } catch (err) { } }
                if (audio) { try { audio.close(); } catch (err) { } }
            },
            ready: boot
        };
    }

    window.pudlApplets.register('sight-reader', { init: init });
})();
