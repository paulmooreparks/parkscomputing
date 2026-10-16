/* Writes Architecture/mockups/sight-reader-fingerboards.html: mockups of the
   guitar and violin fingerboards Sight Reader could answer on (see "For later:
   fingerboards" in Architecture/sight-reader-design.md). The drawing code is
   the code the applet would use, so the mockup shows what would be built.

     node Tools/mockup-fingerboards.js */
const fs = require('fs'), path = require('path');

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const INSTRUMENTS = {
  guitar: {
    title: 'Guitar', frets: 15,
    strings: [{ name: 'E', open: 76, w: 1.0 }, { name: 'B', open: 71, w: 1.3 }, { name: 'G', open: 67, w: 1.7 }, { name: 'D', open: 62, w: 2.4 }, { name: 'A', open: 57, w: 3.0 }, { name: 'E', open: 52, w: 3.6 }],
    inlays: [3, 5, 7, 9, 12, 15], numbers: [1, 3, 5, 7, 9, 12, 15], board: ['#5a3a22', '#3d2514'], fretted: true
  },
  violin: {
    title: 'Violin', frets: 14,
    strings: [{ name: 'E', open: 76, w: 1.0 }, { name: 'A', open: 69, w: 1.5 }, { name: 'D', open: 62, w: 2.0 }, { name: 'G', open: 55, w: 2.6 }],
    inlays: [], numbers: [], board: ['#2a2623', '#14110f'], fretted: false
  }
};

/* The drawing: a viewBox 1000 wide, the open strings in a column at the left,
   the nut, then a cell for each fret (a finger between two frets on a guitar,
   a finger at a position on a violin). Each cell is a group with the pitch
   written on it, so the applet can find the cells that make a note. */
function fingerboard(kind, opts) {
  const inst = INSTRUMENTS[kind], accidentals = opts.accidentals, labels = opts.labels, named = opts.named || [], missed = opts.missed || [];
  const W = 1000, M = 64, S = kind === 'guitar' ? 30 : 38, top = 22, n = inst.frets, L = W - M - 10;
  const H = top + (inst.strings.length - 1) * S + 40 + (inst.numbers.length ? 18 : 0);
  const x = f => M + L * (1 - Math.pow(2, -f / 12)) / (1 - Math.pow(2, -n / 12));
  const y = i => top + i * S;
  const boardTop = y(0) - 14, boardBottom = y(inst.strings.length - 1) + 14;
  let g = '<defs><linearGradient id="wood-' + kind + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + inst.board[0] + '"/><stop offset="1" stop-color="' + inst.board[1] + '"/></linearGradient>' +
    '<linearGradient id="metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0f0f0"/><stop offset="1" stop-color="#9aa0a6"/></linearGradient></defs>';
  g += '<rect x="' + (M - 2) + '" y="' + boardTop + '" width="' + (W - M + 2) + '" height="' + (boardBottom - boardTop) + '" rx="3" fill="url(#wood-' + kind + ')"/>';
  inst.inlays.forEach(f => {
    const cx = (x(f - 1) + x(f)) / 2, cy = (boardTop + boardBottom) / 2;
    const dots = f === 12 ? [cy - S, cy + S] : [cy];
    dots.forEach(c => { g += '<circle cx="' + cx.toFixed(1) + '" cy="' + c.toFixed(1) + '" r="5" fill="#e8e0cf" opacity="0.8"/>'; });
  });
  if (inst.fretted) { for (let f = 1; f <= n; f++) { g += '<rect x="' + (x(f) - 1.5).toFixed(1) + '" y="' + boardTop + '" width="3" height="' + (boardBottom - boardTop) + '" fill="url(#metal)"/>'; } }
  else { for (let f = 1; f <= n; f++) { g += '<line x1="' + x(f).toFixed(1) + '" x2="' + x(f).toFixed(1) + '" y1="' + boardTop + '" y2="' + boardBottom + '" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1"/>'; } }
  g += '<rect x="' + (M - 6) + '" y="' + (boardTop - 2) + '" width="7" height="' + (boardBottom - boardTop + 4) + '" rx="1" fill="#efe9da"/>';
  inst.strings.forEach((s, i) => { g += '<line x1="6" x2="' + (W - 4) + '" y1="' + y(i) + '" y2="' + y(i) + '" stroke="' + (s.w > 2 ? '#c9a24f' : '#d8dadd') + '" stroke-width="' + s.w + '"/>'; });
  inst.strings.forEach((s, si) => {
    for (let f = 0; f <= n; f++) {
      const midi = s.open + f, pc = midi % 12, black = NAMES[pc].length > 1, oct = Math.floor(midi / 12) - 1;
      const left = f === 0 ? 4 : (kind === 'guitar' ? x(f - 1) : (x(f - 1) + x(f)) / 2), right = f === 0 ? M - 8 : (kind === 'guitar' ? x(f) : (x(f) + (f < n ? x(f + 1) : x(f) + 20)) / 2);
      const cx = f === 0 ? M / 2 - 2 : (kind === 'guitar' ? (x(f - 1) + x(f)) / 2 : x(f));
      const state = named.includes(si + ':' + f) ? ' sr-named' : missed.includes(si + ':' + f) ? ' sr-missed' : '';
      const off = black && !accidentals ? ' sr-off' : '';
      const showLabel = labels === 'all' || (labels === 'c' && (pc === 0 || f === 0));
      g += '<g class="sr-cell' + state + off + '" data-midi="' + midi + '" data-s="' + si + '" data-f="' + f + '"><rect x="' + left.toFixed(1) + '" y="' + (y(si) - S / 2).toFixed(1) + '" width="' + (right - left).toFixed(1) + '" height="' + S + '" fill="transparent"/>' +
        '<circle cx="' + cx.toFixed(1) + '" cy="' + y(si) + '" r="' + (S * 0.36).toFixed(1) + '" class="dot"/>' +
        (showLabel ? '<text x="' + cx.toFixed(1) + '" y="' + (y(si) + 4) + '" text-anchor="middle" class="lab">' + NAMES[pc] + (f === 0 || labels === 'all' ? oct : '') + '</text>' : '') + '</g>';
    }
  });
  inst.numbers.forEach(f => { g += '<text x="' + ((x(f - 1) + x(f)) / 2).toFixed(1) + '" y="' + (boardBottom + 16) + '" text-anchor="middle" class="num">' + f + '</text>'; });
  return '<svg class="sr-fingerboard-svg" viewBox="0 0 ' + W + ' ' + H + '" role="group" aria-label="' + inst.title + ' fingerboard">' + g + '</svg>';
}

module.exports = { fingerboard, INSTRUMENTS };

if (require.main === module) {
  const css = [
    ':root { color-scheme: dark; --bg:#14171b; --text:#e6e8eb; --muted:#9aa3ad; }',
    'body { background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, sans-serif; margin: 0; padding: 24px; }',
    'h1 { font-size: 1.3rem; margin: 0 0 4px; } h2 { font-size: 1rem; margin: 28px 0 4px; } p { color: var(--muted); margin: 0 0 10px; max-width: 70ch; }',
    '.frame { max-width: 1000px; } svg { width: 100%; height: auto; display: block; }',
    '.sr-cell .dot { fill: transparent; } .sr-cell:hover .dot { fill: rgba(255,255,255,0.22); }',
    '.sr-cell.sr-named .dot { fill: #2e7d32; stroke: #1b5e20; stroke-width: 2; } .sr-cell.sr-missed .dot { fill: #b42318; stroke: #7a1710; stroke-width: 2; }',
    '.sr-cell .lab { font: 700 11px system-ui; fill: #fff; paint-order: stroke; stroke: rgba(0,0,0,0.75); stroke-width: 3px; pointer-events: none; }',
    '.sr-cell.sr-off { opacity: 0.45; } .sr-cell.sr-off .lab { opacity: 0.6; }',
    '.num { font: 600 11px system-ui; fill: var(--muted); }'
  ].join('\n');
  const sections = [
    ['Guitar, labels on the C notes and open strings (the default)', 'The low E string is at the bottom, the high E at the top, the nut at the left, as in tablature. The column left of the nut is the open string. Green is a note named; here a G has been named, and it is lit everywhere it lies on the neck: the open third string and frets 5, 10 and 15 of the three strings below.', 'guitar', { accidentals: true, labels: 'c', named: ['2:0', '3:5', '4:10', '5:15'] }],
    ['Guitar, every note labelled, sharps and flats not named', 'With Name sharps and flats off the black-key positions are dimmed and cannot be pressed, as the piano keeps its black keys off. One wrong press shows red.', 'guitar', { accidentals: false, labels: 'all', missed: ['1:5'] }],
    ['Violin, labels on the C notes and open strings', 'The violin has no frets, so there are only faint lines at each semitone and the finger dot sits on the line. Four strings, G at the bottom to E at the top, the nut at the left.', 'violin', { accidentals: true, labels: 'c', named: ['1:3', '3:5'] }],
    ['Violin, every note labelled', 'The same board with each position named, to show how it reads at the full width of the page.', 'violin', { accidentals: true, labels: 'all' }]
  ];
  let html = '<!doctype html><meta charset="utf-8"><title>Sight Reader fingerboards: mockups</title><style>' + css + '</style><div class="frame"><h1>Sight Reader fingerboards: mockups</h1><p>Drawn with the drawing code the applet would use. The names are the written pitches, so a guitar string that sounds an octave lower is named at the pitch on the page.</p>';
  for (const [t, d, k, o] of sections) { html += '<h2>' + t + '</h2><p>' + d + '</p>' + fingerboard(k, o); }
  html += '<p>Open strings (fret 0) sit in the column left of the nut and can be pressed like any other position. A click on any position that has the right pitch is right, as a click on the right piano key is right.</p></div>';
  const out = path.join(__dirname, '..', 'Architecture', 'mockups', 'sight-reader-fingerboards.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log('wrote', out);
}
