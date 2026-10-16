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
    var SETTINGS = { revealAfter: 3, accidentals: true, sound: true, keyboard: 'piano', labels: 'c', lastScore: null };
    var KEYBOARDS = ['piano', 'letters', 'guitar', 'violin'];
    var REVEAL_CHOICES = [[0, 'Never'], [1, 'After 1 wrong try'], [2, 'After 2 wrong tries'], [3, 'After 3 wrong tries'], [5, 'After 5 wrong tries']];

    var SAMPLES = '/content/scores/';
    var LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    var SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    var LETTER_OF_PC = { 0: 'C', 2: 'D', 4: 'E', 5: 'F', 7: 'G', 9: 'A', 11: 'B' };
    /* The piano on the screen is all 88 keys, A0 to C8, 52 white keys. A
       black key stands to the right of the white key at these places in an
       octave, with the pitch it has. */
    var PIANO_LOW = 21, PIANO_HIGH = 108;
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
    /* The notes of a clef, drawn as a staff: the lines and spaces from the one
       below the bottom ledger line to the one above the top, each named, and
       middle C marked. A position is a step up the staff from the bottom line,
       counting lines and spaces, and the bottom line of each clef is the
       diatonic note (octave times seven, plus C=0 .. B=6) shown here. */
    /* The outlines of the four clefs, as SVG paths in the coordinates of a staff
       whose lines are 10 apart, taken from the glyphs OpenSheetMusicDisplay draws
       (the Bravura music font, SIL Open Font License 1.1, which allows embedding
       its outlines). x is the left edge of the clef and bottom the y of the
       staff's bottom line, so each is moved to where this staff has them. They
       are drawn as shapes, so no font is needed to show a clef. */
    var CLEF_GLYPHS = {
        treble: { x: 54.97, bottom: 103.5, d: ["M69.05 50.33C69.11 50.3,69.17 50.3,69.26 50.3C69.6 50.3,70 50.59,70.58 51.31C72.91 53.99,74.56 58.65,74.56 62.45C74.56 62.74,74.5 62.97,74.5 63.26C74.24 67.78,72.4 71.5,68.74 75.01L67.76 75.96L67.41 76.34L67.41 76.45L67.61 77.31L67.93 78.87L68.25 80.31C68.68 82.27,68.85 83.28,68.85 83.28C68.85 83.28,68.85 83.28,68.85 83.28C68.85 83.28,68.97 83.28,69.11 83.25C69.26 83.25,69.72 83.19,70.21 83.19C70.55 83.19,70.9 83.25,71.07 83.25C75.13 83.77,78.27 86.67,79.16 90.76C79.34 91.43,79.39 92.15,79.39 92.87C79.39 96.75,77.06 100.47,73.17 102.23C72.94 102.37,72.86 102.4,72.86 102.4L72.86 102.43C72.86 102.43,73.03 103.09,73.17 103.84L73.6 106.03L74.01 107.78C74.24 108.91,74.35 109.71,74.35 110.43C74.35 111.07,74.27 111.64,74.12 112.31C73.14 116.31,69.66 118.7,66.03 118.7C64.24 118.7,62.4 118.12,60.79 116.83C59.35 115.62,58.72 114.52,58.72 113.08C58.72 110.55,60.76 108.76,62.89 108.76C63.64 108.76,64.39 108.99,65.11 109.43C66.32 110.26,66.87 111.53,66.87 112.77C66.87 114.67,65.54 116.54,63.27 116.68L63.04 116.68L63.21 116.8C64.16 117.2,65.11 117.4,66.03 117.4C68.36 117.4,70.55 116.22,71.88 114.18C72.63 113.03,73.03 111.67,73.03 110.32C73.03 109.8,72.94 109.28,72.83 108.71C72.83 108.65,72.74 108.19,72.63 107.76C71.99 104.65,71.62 102.83,71.62 102.83C71.62 102.83,71.62 102.83,71.62 102.83C71.56 102.83,71.44 102.83,71.36 102.89C71.07 102.95,70.47 103.09,70.21 103.12C69.57 103.21,68.97 103.23,68.39 103.23C62.75 103.23,57.51 99.43,55.69 93.82C55.23 92.32,54.97 90.82,54.97 89.32C54.97 86.33,55.92 83.39,57.76 80.77C59.78 77.92,61.8 75.47,64.27 72.94L65.14 72.04L64.94 70.98L64.56 69.22L64.07 66.98C63.93 66.14,63.76 65.33,63.73 65.16C63.58 64.21,63.5 63.29,63.5 62.34C63.5 58.71,64.68 55.22,66.89 52.43C67.56 51.57,68.74 50.42,69.05 50.33M70.81 56.03C70.75 56.03,70.67 56.03,70.58 56.03C69.4 56.03,67.87 57.13,66.84 58.74C65.77 60.32,65.22 62.42,65.22 64.58C65.22 65.16,65.25 65.77,65.34 66.37C65.43 66.8,65.45 67.09,65.68 68.13L66.09 69.94C66.2 70.49,66.29 70.92,66.29 70.98L66.29 70.98C66.32 70.98,67.21 70,67.5 69.65C70.38 66.4,72.11 62.97,72.48 59.95C72.51 59.66,72.51 59.43,72.51 59.14C72.51 58.25,72.4 57.38,72.19 56.92C71.96 56.46,71.44 56.09,70.81 56.03M66.46 78.29C66.4 77.89,66.32 77.57,66.32 77.52C66.32 77.52,66.32 77.52,66.29 77.52C66.23 77.52,64.99 78.96,64.13 79.96C62.66 81.75,61.11 83.88,60.47 84.92C59.26 86.96,58.66 89.24,58.66 91.48C58.66 92.95,58.95 94.36,59.46 95.72C61.02 99.72,64.59 102.23,68.48 102.23C68.94 102.23,69.46 102.2,69.95 102.11C70.58 102,71.36 101.77,71.36 101.68L71.36 101.68C71.36 101.68,71.3 101.39,71.21 101.07L70.38 96.96L69.72 93.87L69.28 91.74L68.82 89.67C68.59 88.43,68.51 88.11,68.51 88.11C68.51 88.11,68.51 88.09,68.48 88.09C68.31 88.09,67.38 88.55,66.98 88.83C65.48 89.87,64.71 91.51,64.71 93.13C64.71 94.65,65.45 96.18,66.89 97.07C67.21 97.27,67.33 97.45,67.33 97.65C67.33 97.68,67.33 97.76,67.33 97.79C67.27 98.14,67.07 98.28,66.78 98.28C66.66 98.28,66.52 98.25,66.35 98.17C63.7 97.01,61.91 94.28,61.91 91.28L61.91 91.28C61.91 87.83,64.07 84.83,67.38 83.65L67.56 83.59L67.27 82.15L66.46 78.29M70.78 87.91C70.55 87.88,70.32 87.88,70.15 87.88C70.09 87.88,70 87.88,69.95 87.88L69.8 87.88L69.92 88.4L70.52 91.22L70.9 93.07L71.3 94.88L72.11 98.89L72.42 100.41C72.54 100.82,72.6 101.16,72.63 101.16C72.63 101.16,72.63 101.16,72.63 101.16C72.65 101.16,73.14 100.87,73.46 100.64C74.93 99.61,76.02 97.99,76.43 96.32C76.57 95.78,76.63 95.2,76.63 94.65C76.63 91.31,74.15 88.29,70.78 87.91"] },
        bass: { x: 54.97, bottom: 105.5, d: ["M63.84 65.45C64.07 65.39,64.3 65.39,64.56 65.39C65.57 65.39,66.75 65.51,67.76 65.71C72.48 66.69,75.74 69.88,76.34 74.15C76.4 74.61,76.43 75.04,76.43 75.5C76.43 78.09,75.53 81.43,74.01 84.23C70.38 90.79,63.76 95.52,55.81 97.24C55.66 97.24,55.55 97.27,55.4 97.27C55.12 97.27,54.97 97.1,54.97 96.84C54.97 96.55,55.03 96.47,55.6 96.24C64.71 92.81,70.78 85.41,71.33 77.11C71.36 76.68,71.36 76.19,71.36 75.82C71.36 71.78,70.12 68.79,67.73 67.29C66.69 66.63,65.57 66.31,64.36 66.31C61.68 66.31,58.95 67.84,57.68 70.4C57.62 70.6,57.42 71.04,57.42 71.06C57.42 71.06,57.42 71.06,57.42 71.06C57.42 71.06,57.45 71.04,57.53 71.01C58.17 70.6,58.86 70.4,59.58 70.4C60.59 70.4,61.65 70.83,62.4 71.64C63.09 72.39,63.47 73.4,63.47 74.32C63.47 76.19,62.08 78.09,59.92 78.29C59.78 78.29,59.64 78.32,59.49 78.32C57.1 78.32,55.17 76.13,55.17 73.37C55.17 73.31,55.17 73.22,55.17 73.2C55.29 69.08,59.06 65.71,63.84 65.45M79.16 69.31C79.22 69.28,79.25 69.28,79.34 69.28C79.54 69.28,79.77 69.31,79.83 69.37C80.55 69.57,80.89 70.2,80.89 70.81C80.89 71.32,80.63 71.84,80.11 72.13C79.91 72.27,79.65 72.3,79.39 72.3C78.99 72.3,78.56 72.13,78.27 71.76C78.04 71.47,77.92 71.15,77.92 70.83C77.92 70.11,78.39 69.39,79.16 69.31M79.16 78.73C79.22 78.73,79.25 78.73,79.34 78.73C79.54 78.73,79.77 78.75,79.83 78.81C80.55 79.01,80.89 79.65,80.89 80.25C80.89 80.77,80.63 81.29,80.11 81.55C79.91 81.69,79.65 81.75,79.39 81.75C78.99 81.75,78.56 81.55,78.27 81.2C78.04 80.91,77.92 80.6,77.92 80.25C77.92 79.53,78.39 78.84,79.16 78.73"] },
        alto: { x: 55, bottom: 90.5, d: ["M55 70.5L55 50.25L57.33 50.25L59.72 50.25L59.72 70.5L59.72 90.8L57.33 90.8L55 90.8L55 70.5M61.48 70.5L61.48 50.25L62.08 50.25L62.72 50.25L62.72 59.96L62.72 69.64L62.89 69.46C63.18 69.23,63.7 68.69,64.04 68.22C65.28 66.55,66.29 64.37,66.89 61.8C67.07 61.17,67.12 61.08,67.44 61.08C67.76 61.08,67.87 61.23,67.93 61.69C68.16 64.88,70.24 67.19,72.6 67.19C72.97 67.19,73.37 67.13,73.75 66.99C75.3 66.47,75.85 65.09,75.97 61.4C75.97 60.65,76 59.96,76 59.33C76 55.15,75.48 53.16,74.32 52.21C73.69 51.72,72.74 51.43,71.73 51.43C70.7 51.43,69.69 51.69,68.74 52.15L68.68 52.21L68.74 52.24C69.05 52.3,69.26 52.33,69.49 52.44C70.32 52.87,70.7 53.68,70.7 54.49C70.7 55.41,70.15 56.36,69.14 56.68C68.85 56.79,68.62 56.85,68.39 56.85C67.01 56.85,65.92 55.64,65.92 54.29C65.92 53.91,66 53.57,66.2 53.16C66.78 52.04,68.8 50.89,70.58 50.6C70.98 50.57,71.36 50.51,71.76 50.51C75.56 50.51,79.02 53.28,79.91 57.19C80.08 57.83,80.14 58.52,80.14 59.21C80.14 59.93,80.08 60.68,79.91 61.37C79.16 64.91,76.54 67.59,73.4 68.08C73.14 68.11,72.86 68.11,72.63 68.11C71.62 68.11,70.64 67.79,69.72 67.16C69.66 67.07,69.57 67.04,69.52 67.04C69.52 67.04,69.52 67.04,69.52 67.04C69.52 67.04,69.05 67.82,68.51 68.8L67.44 70.53L68.51 72.26C69.05 73.21,69.52 74.01,69.52 74.01C69.52 74.01,69.52 74.01,69.52 74.01C69.57 74.01,69.66 73.96,69.72 73.87C70.64 73.24,71.62 72.92,72.63 72.92C73.14 72.92,73.63 73.01,74.15 73.12C77.2 74.01,79.48 76.72,80.03 80.23C80.11 80.75,80.14 81.27,80.14 81.79C80.14 84.01,79.39 86.02,77.98 87.64C76.34 89.57,74.01 90.52,71.73 90.52C69.89 90.52,68.08 89.82,66.69 88.53C66.2 87.98,65.97 87.35,65.97 86.71C65.97 85.45,66.89 84.24,68.39 84.24C69.8 84.24,70.7 85.45,70.7 86.6C70.7 87.41,70.32 88.15,69.49 88.59C69.26 88.7,69.05 88.76,68.74 88.79L68.68 88.85L68.74 88.87C69.69 89.36,70.7 89.59,71.73 89.59C72.74 89.59,73.69 89.31,74.32 88.85C75.48 87.87,76 85.88,76 81.76C76 81.07,75.97 80.41,75.97 79.63C75.79 75.48,75.1 74.07,72.94 73.87C72.83 73.84,72.71 73.84,72.6 73.84C70.21 73.84,68.16 76.2,67.93 79.37C67.87 79.8,67.76 79.95,67.44 79.95C67.12 79.95,67.07 79.89,66.89 79.23C66.29 76.69,65.28 74.47,64.04 72.8C63.7 72.37,63.18 71.8,62.89 71.57L62.72 71.39L62.72 81.07L62.72 90.8L62.08 90.8L61.48 90.8L61.48 70.5"] },
        tenor: { x: 55, bottom: 100.5, d: ["M55 70.5L55 50.25L57.33 50.25L59.72 50.25L59.72 70.5L59.72 90.8L57.33 90.8L55 90.8L55 70.5M61.48 70.5L61.48 50.25L62.08 50.25L62.72 50.25L62.72 59.96L62.72 69.64L62.89 69.46C63.18 69.23,63.7 68.69,64.04 68.22C65.28 66.55,66.29 64.37,66.89 61.8C67.07 61.17,67.12 61.08,67.44 61.08C67.76 61.08,67.87 61.23,67.93 61.69C68.16 64.88,70.24 67.19,72.6 67.19C72.97 67.19,73.37 67.13,73.75 66.99C75.3 66.47,75.85 65.09,75.97 61.4C75.97 60.65,76 59.96,76 59.33C76 55.15,75.48 53.16,74.32 52.21C73.69 51.72,72.74 51.43,71.73 51.43C70.7 51.43,69.69 51.69,68.74 52.15L68.68 52.21L68.74 52.24C69.05 52.3,69.26 52.33,69.49 52.44C70.32 52.87,70.7 53.68,70.7 54.49C70.7 55.41,70.15 56.36,69.14 56.68C68.85 56.79,68.62 56.85,68.39 56.85C67.01 56.85,65.92 55.64,65.92 54.29C65.92 53.91,66 53.57,66.2 53.16C66.78 52.04,68.8 50.89,70.58 50.6C70.98 50.57,71.36 50.51,71.76 50.51C75.56 50.51,79.02 53.28,79.91 57.19C80.08 57.83,80.14 58.52,80.14 59.21C80.14 59.93,80.08 60.68,79.91 61.37C79.16 64.91,76.54 67.59,73.4 68.08C73.14 68.11,72.86 68.11,72.63 68.11C71.62 68.11,70.64 67.79,69.72 67.16C69.66 67.07,69.57 67.04,69.52 67.04C69.52 67.04,69.52 67.04,69.52 67.04C69.52 67.04,69.05 67.82,68.51 68.8L67.44 70.53L68.51 72.26C69.05 73.21,69.52 74.01,69.52 74.01C69.52 74.01,69.52 74.01,69.52 74.01C69.57 74.01,69.66 73.96,69.72 73.87C70.64 73.24,71.62 72.92,72.63 72.92C73.14 72.92,73.63 73.01,74.15 73.12C77.2 74.01,79.48 76.72,80.03 80.23C80.11 80.75,80.14 81.27,80.14 81.79C80.14 84.01,79.39 86.02,77.98 87.64C76.34 89.57,74.01 90.52,71.73 90.52C69.89 90.52,68.08 89.82,66.69 88.53C66.2 87.98,65.97 87.35,65.97 86.71C65.97 85.45,66.89 84.24,68.39 84.24C69.8 84.24,70.7 85.45,70.7 86.6C70.7 87.41,70.32 88.15,69.49 88.59C69.26 88.7,69.05 88.76,68.74 88.79L68.68 88.85L68.74 88.87C69.69 89.36,70.7 89.59,71.73 89.59C72.74 89.59,73.69 89.31,74.32 88.85C75.48 87.87,76 85.88,76 81.76C76 81.07,75.97 80.41,75.97 79.63C75.79 75.48,75.1 74.07,72.94 73.87C72.83 73.84,72.71 73.84,72.6 73.84C70.21 73.84,68.16 76.2,67.93 79.37C67.87 79.8,67.76 79.95,67.44 79.95C67.12 79.95,67.07 79.89,66.89 79.23C66.29 76.69,65.28 74.47,64.04 72.8C63.7 72.37,63.18 71.8,62.89 71.57L62.72 71.39L62.72 81.07L62.72 90.8L62.08 90.8L61.48 90.8L61.48 70.5"] }
    };
    var CLEFS = [
        { key: 'treble', name: 'Treble clef', bottom: 4 * 7 + 2, text: 'The G clef. Its curl circles the second line from the bottom, which is G above middle C. Used for violin, flute, trumpet, voice and the right hand of the piano.' },
        { key: 'bass', name: 'Bass clef', bottom: 2 * 7 + 4, text: 'The F clef. Its two dots lie either side of the second line from the top, which is the F below middle C. Used for cello, bassoon, trombone, tuba and the left hand of the piano.' },
        { key: 'alto', name: 'Alto clef', bottom: 3 * 7 + 3, text: 'A C clef. Its middle points at the middle line, which is middle C. Used for the viola.' },
        { key: 'tenor', name: 'Tenor clef', bottom: 3 * 7 + 1, text: 'A C clef. Its middle points at the second line from the top, which is middle C. Used for high passages of the cello, bassoon and trombone.' }
    ];
    function clefsMarkup() {
        var NAMES = 'CDEFGAB', first = -2, last = 10, step = 36, left = 84, right = 28, base = 74, html = '';
        CLEFS.forEach(function (c) {
            var width = left + right + (last - first) * step, svg = '<svg class="sr-staff" viewBox="0 0 ' + width + ' 118" role="img" aria-label="' + c.name + ': the notes from the lowest to the highest">';
            for (var line = 0; line <= 8; line += 2) { svg += '<line x1="6" x2="' + (width - 6) + '" y1="' + (base - line * 5) + '" y2="' + (base - line * 5) + '" class="sr-staff-line"/>'; }
            var g = CLEF_GLYPHS[c.key];
            svg += '<g class="sr-clef-glyph" transform="translate(' + (14 - g.x).toFixed(2) + ' ' + (base - g.bottom).toFixed(2) + ')">' + g.d.map(function (d) { return '<path d="' + d + '"/>'; }).join('') + '</g>';
            for (var p = first; p <= last; p++) {
                var d = c.bottom + p, letter = NAMES.charAt(d % 7), oct = Math.floor(d / 7), x = left + (p - first) * step, y = base - p * 5, mid = d === 4 * 7;
                if ((p < 0 || p > 8) && p % 2 === 0) { svg += '<line x1="' + (x - 12) + '" x2="' + (x + 12) + '" y1="' + y + '" y2="' + y + '" class="sr-staff-line"/>'; }
                svg += '<ellipse cx="' + x + '" cy="' + y + '" rx="7" ry="5" class="sr-staff-note' + (mid ? ' sr-mid' : '') + '"/>';
                svg += '<text x="' + x + '" y="112" text-anchor="middle" class="sr-staff-name' + (mid ? ' sr-mid' : '') + '">' + letter + oct + '</text>';
            }
            html += '<section class="sr-clef"><h4>' + c.name + '</h4><p class="form-help">' + c.text + '</p>' + svg + '</section>';
        });
        return '<p class="form-help">Each staff runs up from the lowest note shown to the highest, lines and spaces in turn. The notes are named with their octave, and middle C (C4) is in green.</p>' + html;
    }

    /* The fingerboards. A string's open pitch is the pitch written on the page,
       which for the guitar is an octave above the sound, so a reader presses
       the position that matches the notation. Strings run from the highest, at
       the top, to the lowest, as in tablature, with the nut at the left. */
    var BOARDS = {
        guitar: { title: 'Guitar', frets: 15, fretted: true, inlays: [3, 5, 7, 9, 12, 15], numbers: [1, 3, 5, 7, 9, 12, 15], wood: ['#5a3a22', '#3d2514'],
            strings: [[76, 1.0], [71, 1.3], [67, 1.7], [62, 2.4], [57, 3.0], [52, 3.6]] },
        violin: { title: 'Violin', frets: 14, fretted: false, inlays: [], numbers: [], wood: ['#2a2623', '#14110f'],
            strings: [[76, 1.0], [69, 1.5], [62, 2.0], [55, 2.6]] }
    };
    var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    function boardRange(kind) {
        var b = BOARDS[kind], opens = b.strings.map(function (x) { return x[0]; });
        return { lo: Math.min.apply(null, opens), hi: Math.max.apply(null, opens) + b.frets };
    }
    /* A viewBox 1000 wide: a column for the open strings, the nut, then a cell
       for each fret. A guitar's cell lies between two frets, a violin's is
       centred on its position, which has only a faint line. Each cell is a
       group holding its pitch in data-midi, a ring that lights, and its name. */
    function fingerboardMarkup(kind) {
        var inst = BOARDS[kind], W = 1000, M = 64, S = kind === 'guitar' ? 30 : 38, top = 22, n = inst.frets, L = W - M - 10;
        var H = top + (inst.strings.length - 1) * S + 40 + (inst.numbers.length ? 18 : 0);
        var x = function (f) { return M + L * (1 - Math.pow(2, -f / 12)) / (1 - Math.pow(2, -n / 12)); };
        var y = function (i) { return top + i * S; };
        var boardTop = y(0) - 14, boardBottom = y(inst.strings.length - 1) + 14, g = '', f, i;
        g += '<defs><linearGradient id="sr-wood-' + kind + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + inst.wood[0] + '"/><stop offset="1" stop-color="' + inst.wood[1] + '"/></linearGradient>' +
            '<linearGradient id="sr-metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0f0f0"/><stop offset="1" stop-color="#9aa0a6"/></linearGradient></defs>';
        g += '<rect x="' + (M - 2) + '" y="' + boardTop + '" width="' + (W - M + 2) + '" height="' + (boardBottom - boardTop) + '" rx="3" fill="url(#sr-wood-' + kind + ')"/>';
        inst.inlays.forEach(function (fr) {
            var cx = (x(fr - 1) + x(fr)) / 2, cy = (boardTop + boardBottom) / 2;
            (fr === 12 ? [cy - S, cy + S] : [cy]).forEach(function (c) { g += '<circle cx="' + cx.toFixed(1) + '" cy="' + c.toFixed(1) + '" r="5" fill="#e8e0cf" opacity="0.8"/>'; });
        });
        for (f = 1; f <= n; f++) {
            g += inst.fretted
                ? '<rect x="' + (x(f) - 1.5).toFixed(1) + '" y="' + boardTop + '" width="3" height="' + (boardBottom - boardTop) + '" fill="url(#sr-metal)"/>'
                : '<line x1="' + x(f).toFixed(1) + '" x2="' + x(f).toFixed(1) + '" y1="' + boardTop + '" y2="' + boardBottom + '" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1"/>';
        }
        g += '<rect x="' + (M - 6) + '" y="' + (boardTop - 2) + '" width="7" height="' + (boardBottom - boardTop + 4) + '" rx="1" fill="#efe9da"/>';
        inst.strings.forEach(function (st, k) { g += '<line x1="6" x2="' + (W - 4) + '" y1="' + y(k) + '" y2="' + y(k) + '" stroke="' + (st[1] > 2 ? '#c9a24f' : '#d8dadd') + '" stroke-width="' + st[1] + '"/>'; });
        inst.strings.forEach(function (st, si) {
            for (f = 0; f <= n; f++) {
                var midi = st[0] + f, pc = midi % 12, black = NOTE_NAMES[pc].length > 1, oct = Math.floor(midi / 12) - 1;
                var left = f === 0 ? 4 : (inst.fretted ? x(f - 1) : (x(f - 1) + x(f)) / 2);
                var right = f === 0 ? M - 8 : (inst.fretted ? x(f) : (x(f) + (f < n ? x(f + 1) : x(f) + 20)) / 2);
                var cx = f === 0 ? M / 2 - 2 : (inst.fretted ? (x(f - 1) + x(f)) / 2 : x(f));
                g += '<g class="sr-cell' + (pc === 0 ? ' sr-c' : '') + (f === 0 ? ' sr-open' : '') + '" data-midi="' + midi + '" data-black="' + (black ? 1 : 0) + '" aria-label="' + NOTE_NAMES[pc] + oct + '">' +
                    '<rect x="' + left.toFixed(1) + '" y="' + (y(si) - S / 2).toFixed(1) + '" width="' + (right - left).toFixed(1) + '" height="' + S + '" fill="transparent"/>' +
                    '<circle cx="' + cx.toFixed(1) + '" cy="' + y(si) + '" r="' + (S * 0.36).toFixed(1) + '" class="sr-dot"/>' +
                    '<text x="' + cx.toFixed(1) + '" y="' + (y(si) + 4) + '" text-anchor="middle" class="sr-lab">' + NOTE_NAMES[pc] + oct + '</text></g>';
            }
        });
        inst.numbers.forEach(function (fr) { g += '<text x="' + ((x(fr - 1) + x(fr)) / 2).toFixed(1) + '" y="' + (boardBottom + 16) + '" text-anchor="middle" class="sr-fret-no">' + fr + '</text>'; });
        return '<svg class="sr-board-svg" viewBox="0 0 ' + W + ' ' + H + '" role="group" aria-label="' + inst.title + ' fingerboard">' + g + '</svg>';
    }

    function pianoMarkup() {
        return '<div class="sr-piano" role="group" aria-label="Piano keyboard"><div class="sr-board">' + pianoKeysMarkup() + '</div></div>';
    }
    function pianoKeysMarkup() {
        var whites = 0, m;
        for (m = PIANO_LOW; m <= PIANO_HIGH; m++) { if (LETTER_OF_PC[m % 12]) { whites++; } }
        var width = 100 / whites, black = width * 0.62, html = '', before = 0;
        for (m = PIANO_LOW; m <= PIANO_HIGH; m++) {
            var pc = m % 12, oct = Math.floor(m / 12) - 1;
            if (LETTER_OF_PC[pc]) {
                html += '<button type="button" class="sr-key sr-white' + (pc === 0 ? ' sr-c' : '') + '" data-midi="' + m + '" tabindex="-1" aria-label="' + LETTER_OF_PC[pc] + oct + '"><span class="sr-key-label">' + LETTER_OF_PC[pc] + oct + '</span></button>';
                before++;
            } else {
                html += '<button type="button" class="sr-key sr-black" data-midi="' + m + '" tabindex="-1" aria-label="' + BLACK_NAMES[pc] + ' ' + oct + '" style="left:' + (before * width - black / 2).toFixed(3) + '%;width:' + black.toFixed(3) + '%"></button>';
            }
        }
        return html;
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
              '<button type="button" class="btn" data-sr="clefs" title="The notes on the lines and spaces of each clef">Help</button>' +
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
              '<div class="sr-fingerboard" data-role="fingerboard" hidden></div>' +
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
                    '<option value="piano">A piano keyboard</option><option value="guitar">A guitar fingerboard</option><option value="violin">A violin fingerboard</option><option value="letters">The letters A to G</option>' +
                  '</select></span>' +
                  '<p class="form-help">On the piano, a note lights in its own octave and stays lit until every note of an interval or chord is in. A key you click has to be the right note in the right octave. Typing a letter picks the octave for you. The black keys name sharps and flats, so they wait for Name sharps and flats. The other choice is the buttons A to G, with ♯ and ♭, where no octave is asked for.</p>' +
                '</div>' +
                '<div class="form-group">' +
                  '<label class="form-label" for="sr-lab-' + uid + '">Key labels</label>' +
                  '<span class="form-select-wrap"><select class="form-select" id="sr-lab-' + uid + '" data-opt="labels">' +
                    '<option value="all">Every key (C4, D4, E4 …)</option><option value="c">Only the C keys (C3, C4, C5 …)</option><option value="none">No labels</option>' +
                  '</select></span>' +
                  '<p class="form-help">The piano keyboard always has the keys A0 to C8, and shows middle C (C4) in the middle when it opens. If the box is too narrow for all of them it scrolls sideways, and you can drag it or use a touch to move it.</p>' +
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
            '<dialog class="dialog sr-dialog sr-clefs-dialog" data-role="clefs" aria-labelledby="sr-clefs-title-' + uid + '">' +
              '<h3 class="dialog-title" id="sr-clefs-title-' + uid + '">The notes of each clef</h3>' +
              '<div class="dialog-body sr-clefs">' + clefsMarkup() + '</div>' +
              '<div class="dialog-actions"><button type="button" class="btn btn-primary" data-sr="close-clefs">Close</button></div>' +
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
            options: q('[data-role="options"]'), scope: q('[data-role="scope"]'), help: q('[data-role="help"]'), clefs: q('[data-role="clefs"]'),
            piano: q('.sr-piano'), board: q('.sr-fingerboard'), letters: q('.sr-letters'), accidentals: q('.sr-accidentals')
        };
        var pianoKeys = [].slice.call(el.piano.querySelectorAll('.sr-key')), pianoAt = {}, blackKeys = [], keyFlash = null;
        var boardKind = null, boardCells = [], altTimer = null;
        pianoKeys.forEach(function (k) { pianoAt[k.getAttribute('data-midi')] = k; if (k.classList.contains('sr-black')) { blackKeys.push(k); } });
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
        function kbdKind() { return KEYBOARDS.indexOf(settings.keyboard) >= 0 ? settings.keyboard : 'piano'; }
        function showKeyboard() {
            var kind = kbdKind(), piano = kind === 'piano', letters = kind === 'letters', board = !piano && !letters;
            el.piano.hidden = !piano;
            el.letters.hidden = !letters;
            el.accidentals.hidden = !letters;
            el.board.hidden = !board;
            if (board && boardKind !== kind) {
                el.board.innerHTML = fingerboardMarkup(kind);
                boardKind = kind;
                boardCells = [].slice.call(el.board.querySelectorAll('.sr-cell'));
            }
            boardCells.forEach(function (c) {
                var off = c.getAttribute('data-black') === '1' && !settings.accidentals;
                c.classList.toggle('sr-off', off);
            });
            el.board.setAttribute('data-labels', settings.labels === 'all' || settings.labels === 'none' ? settings.labels : 'c');
            blackKeys.forEach(function (k) {
                k.disabled = !settings.accidentals;
                if (settings.accidentals) { k.removeAttribute('title'); } else { k.title = 'Turn on Name sharps and flats in Options to use the black keys'; }
            });
            el.piano.setAttribute('data-labels', settings.labels === 'all' || settings.labels === 'none' ? settings.labels : 'c');
            showPiano();
        }

        /* The pitch a note has on the keyboard shown: its own, with sharps and
           flats named, and with them off the white key of its letter, since the
           black keys do not work then and the reader presses the letter. */
        function target(s) { return settings.accidentals ? s.midi : s.nat; }
        function clampMidi(m) { while (m < PIANO_LOW) { m += 12; } while (m > PIANO_HIGH) { m -= 12; } return m; }

        /* The key for a note. */
        function keyFor(midi) { return pianoAt[clampMidi(midi)]; }

        /* The keyboard is all 88 keys. When it is wider than its box it
           scrolls sideways, by the scrollbar, by a touch, or by dragging with
           the pointer. It opens centred on middle C and is moved by the reader. */
        var centered = false;
        function centerOnC4() {
            if (el.piano.hidden || !el.piano.clientWidth) { return; }
            centered = true;
            if (el.piano.scrollWidth <= el.piano.clientWidth) { return; }
            var c = keyFor(60);
            el.piano.scrollLeft = Math.max(0, Math.round(c.offsetLeft + c.offsetWidth / 2 - el.piano.clientWidth / 2));
        }

        /* The notes of the step that are named, or shown by the answer, are lit
           in their own octave and stay lit until the step is done, whether
           they were typed or clicked. */
        function showPiano() {
            var step = score && cur >= 0 && cur < steps.length ? steps[cur] : null;
            pianoKeys.forEach(function (k) { k.classList.remove('sr-named', 'sr-missed'); });
            boardCells.forEach(function (c) { c.classList.remove('sr-named', 'sr-missed'); });
            if (!centered) { centerOnC4(); }
            if (!step) { return; }
            step.notes.forEach(function (s) {
                if (!s.state) { return; }
                var cls = s.state === 'ok' ? 'sr-named' : 'sr-missed';
                /* On a fingerboard a pitch is lit everywhere it lies. */
                if (!el.board.hidden) {
                    boardCells.forEach(function (c) { if (+c.getAttribute('data-midi') === target(s)) { c.classList.add(cls); } });
                } else { keyFor(target(s)).classList.add(cls); }
            });
        }

        /* After a right press on a fingerboard, the other places the same pitch
           lies are ringed for a moment, so the reader sees where else it is. */
        function clearAlt() { clearTimeout(altTimer); boardCells.forEach(function (c) { c.classList.remove('sr-alt'); }); }
        function showAlt(midi, pressed) {
            clearAlt();
            if (el.board.hidden) { return; }
            boardCells.forEach(function (c) { if (+c.getAttribute('data-midi') === midi && c !== pressed) { c.classList.add('sr-alt'); } });
            altTimer = setTimeout(clearAlt, 2400);
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
            var midi = +button.getAttribute('data-midi'), pc = midi % 12;
            var letter = LETTER_OF_PC[pc], notes = steps[cur].notes;
            var sameNote = function (s) { return settings.accidentals ? s.pc === pc : s.key === letter; };
            var hit = notes.filter(function (s) { return target(s) === midi; });
            /* A fingerboard has a range. A note outside it cannot be pressed
               where it is written, so for it any octave will do, the lowest
               first. */
            if (!hit.length && !el.board.hidden) {
                var range = boardRange(boardKind);
                var far = notes.filter(function (s) { return s.state !== 'ok' && (target(s) < range.lo || target(s) > range.hi) && sameNote(s); });
                if (far.length) {
                    var low = Math.min.apply(null, far.map(function (s) { return s.midi; }));
                    hit = far.filter(function (s) { return s.midi === low; });
                }
            }
            clearAlt();
            attempt(hit, button, notes.some(sameNote) ? 'Right note, wrong octave' : '');
            if (hit.length) { showAlt(midi, button); }
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
            el.options.querySelector('[data-opt="labels"]').value = settings.labels === 'all' || settings.labels === 'none' ? settings.labels : 'c';
            el.options.querySelector('[data-opt="keyboard"]').value = kbdKind();
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
            var cell = e.target.closest('.sr-cell');
            if (cell && root.contains(cell)) { if (!cell.classList.contains('sr-off')) { answerPiano(cell); } return; }
            var key = e.target.closest('.sr-key');
            if (key && root.contains(key)) { if (!dragged) { answerPiano(key); } return; }
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
                case 'clefs': if (!el.clefs.open) { el.clefs.showModal(); } break;
                case 'close-clefs': el.clefs.close(); root.focus({ preventScroll: true }); break;
            }
        }

        function onChange(e) {
            var t = e.target;
            if (t.hasAttribute('data-bar') || t.hasAttribute('data-loop')) { onRange(t); return; }
            if (!el.options.contains(t)) { return; }
            if (t.hasAttribute('data-clef') || t.hasAttribute('data-part')) { onScopeChange(t); return; }
            var opt = t.getAttribute('data-opt');
            if (opt === 'keyboard') { saveSetting({ keyboard: KEYBOARDS.indexOf(t.value) >= 0 ? t.value : 'piano' }); showKeyboard(); }
            else if (opt === 'labels') { saveSetting({ labels: t.value === 'all' || t.value === 'none' ? t.value : 'c' }); showKeyboard(); }
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
        /* Dragging the keyboard with the mouse moves it sideways, as a touch
           does by itself; a drag is not a press of the key it started on. */
        var dragFrom = null, dragged = false;
        function dragMove(e) {
            if (!dragFrom) { return; }
            var dx = e.clientX - dragFrom.x;
            if (Math.abs(dx) > 6) { dragged = true; }
            if (dragged) { el.piano.scrollLeft = dragFrom.left - dx; }
        }
        function dragEnd() {
            dragFrom = null;
            document.removeEventListener('pointermove', dragMove);
            document.removeEventListener('pointerup', dragEnd);
            document.removeEventListener('pointercancel', dragEnd);
            setTimeout(function () { dragged = false; }, 60);
        }
        el.piano.addEventListener('pointerdown', function (e) {
            if (e.pointerType !== 'mouse' || e.button !== 0 || el.piano.scrollWidth <= el.piano.clientWidth) { return; }
            dragFrom = { x: e.clientX, left: el.piano.scrollLeft };
            dragged = false;
            document.addEventListener('pointermove', dragMove);
            document.addEventListener('pointerup', dragEnd);
            document.addEventListener('pointercancel', dragEnd);
        });
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
                dragEnd();
                clearTimeout(resizeTimer);
                clearTimeout(flashTimer);
                if (observer) { observer.disconnect(); }
                if (unConfig) { unConfig(); }
                if (snap) { snap.leave(); }
                ['chooser', 'options', 'help', 'clefs'].forEach(function (d) { if (el[d].open) { el[d].close(); } });
                if (osmd) { try { osmd.clear(); } catch (err) { } }
                if (audio) { try { audio.close(); } catch (err) { } }
            },
            ready: boot
        };
    }

    window.pudlApplets.register('sight-reader', { init: init });
})();
