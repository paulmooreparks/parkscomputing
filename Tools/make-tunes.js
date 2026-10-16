/* Writes Sight Reader's simplest sample scores (Architecture/sight-reader-design.md):
   a few more single-line public domain tunes, and the same tunes in the bass,
   alto and tenor clefs, so that a reader meets each clef on music they know.

     node Tools/make-tunes.js <scores folder>

   The scores folder is the live site's content/scores. The first four tunes
   (Twinkle, Twinkle; Ode to Joy; Frère Jacques; Au clair de la lune) must
   already be in its simple folder; the clef versions are made from them by
   changing the clef and moving the notes an octave where the clef calls for
   it. The new tunes are written out here. */
const fs = require('fs'), path = require('path');

const root = path.resolve(process.argv[2] || 'C:/Users/paul/OneDrive/Documents/parkscomputing.com/wwwroot/content/scores');
const simple = path.join(root, 'simple');
fs.mkdirSync(simple, { recursive: true });

/* A tune is a time signature and a list of "note:units", where a unit is an
   eighth note (so a quarter is 2, a dotted quarter 3, a half 4, a whole 8).
   Every tune here is in C major. */
const TYPES = { 1: ['eighth', 0], 2: ['quarter', 0], 3: ['quarter', 1], 4: ['half', 0], 6: ['half', 1], 8: ['whole', 0] };
const TUNES = [
  { name: 'Mary Had a Little Lamb', composer: 'Traditional', beats: 4, type: 4,
    notes: 'E4:2 D4:2 C4:2 D4:2 E4:2 E4:2 E4:4 D4:2 D4:2 D4:4 E4:2 G4:2 G4:4 E4:2 D4:2 C4:2 D4:2 E4:2 E4:2 E4:2 E4:2 D4:2 D4:2 E4:2 D4:2 C4:8' },
  { name: 'Hot Cross Buns', composer: 'Traditional English', beats: 4, type: 4,
    notes: 'E4:2 D4:2 C4:4 E4:2 D4:2 C4:4 C4:1 C4:1 C4:1 C4:1 D4:1 D4:1 D4:1 D4:1 E4:2 D4:2 C4:4' },
  { name: 'London Bridge', composer: 'Traditional English', beats: 4, type: 4,
    notes: 'G4:3 A4:1 G4:2 F4:2 E4:2 F4:2 G4:4 D4:2 E4:2 F4:4 E4:2 F4:2 G4:4 G4:3 A4:1 G4:2 F4:2 E4:2 F4:2 G4:4 D4:4 G4:4 E4:4 C4:4' },
  { name: 'Jingle Bells (chorus)', composer: 'James Lord Pierpont', beats: 4, type: 4,
    notes: 'E4:2 E4:2 E4:4 E4:2 E4:2 E4:4 E4:2 G4:2 C4:3 D4:1 E4:8 F4:2 F4:2 F4:3 F4:1 F4:2 E4:2 E4:2 E4:1 E4:1 E4:2 D4:2 D4:2 E4:2 D4:4 G4:4' },
  { name: 'Row, Row, Row Your Boat', composer: 'Traditional', beats: 6, type: 8,
    notes: 'C4:3 C4:3 C4:3 D4:1 E4:2 E4:3 D4:1 E4:2 F4:3 G4:3 C5:1 C5:1 C5:1 G4:1 G4:1 G4:1 E4:1 E4:1 E4:1 C4:1 C4:1 C4:1 G4:2 F4:1 E4:2 D4:1 C4:6' }
];

const CLEFS = { treble: ['G', 2], bass: ['F', 4], alto: ['C', 3], tenor: ['C', 4] };

function tuneXml(t) {
  const barLength = t.type === 8 ? t.beats : t.beats * 2;
  let out = '', unitsInBar = 0, bar = 1;
  for (const token of t.notes.split(/\s+/)) {
    const [pitch, units] = token.split(':'), u = +units, [type, dots] = TYPES[u];
    if (unitsInBar === 0) { out += '    <measure number="' + bar + '">\n' + (bar === 1 ? attributes(t) : ''); }
    out += '      <note><pitch><step>' + pitch[0] + '</step><octave>' + pitch.slice(1) + '</octave></pitch><duration>' + u + '</duration><type>' + type + '</type>' + (dots ? '<dot/>' : '') + '</note>\n';
    unitsInBar += u;
    if (unitsInBar === barLength) { out += '    </measure>\n'; unitsInBar = 0; bar++; }
    else if (unitsInBar > barLength) { throw new Error(t.name + ': bar ' + bar + ' is too long'); }
  }
  if (unitsInBar !== 0) { throw new Error(t.name + ': the last bar is short by ' + (barLength - unitsInBar)); }
  return header(t.name, t.composer) + out + '  </part>\n</score-partwise>\n';
}
function attributes(t) {
  return '      <attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>' + t.beats + '</beats><beat-type>' + t.type + '</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>\n';
}
function header(title, composer) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n<score-partwise version="4.0">\n' +
    '  <work><work-title>' + title + '</work-title></work>\n  <identification>\n    <creator type="composer">' + composer + '</creator>\n' +
    '    <rights>Typeset for parkscomputing.com, 2026. The tune is in the public domain.</rights>\n  </identification>\n' +
    '  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>\n  <part id="P1">\n';
}

/* The same tune in another clef: the clef is replaced, and the notes move
   down an octave for the bass and the tenor clefs, which sit lower. */
function inClef(xml, clef, title) {
  const [sign, line] = CLEFS[clef], shift = clef === 'bass' || clef === 'tenor' ? -1 : 0;
  return xml
    .replace(/<clef><sign>\w<\/sign><line>\d<\/line><\/clef>/, '<clef><sign>' + sign + '</sign><line>' + line + '</line></clef>')
    .replace(/<octave>(\d)<\/octave>/g, (m, o) => '<octave>' + (+o + shift) + '</octave>')
    .replace(/<work-title>[^<]*<\/work-title>/, '<work-title>' + title + '</work-title>');
}

for (const t of TUNES) { fs.writeFileSync(path.join(simple, t.name + '.musicxml'), tuneXml(t)); console.log('wrote', t.name); }
const BASES = ['Ode to Joy', 'Twinkle Twinkle Little Star', 'Frere Jacques', 'Mary Had a Little Lamb'];
for (const base of BASES) {
  const xml = fs.readFileSync(path.join(simple, base + '.musicxml'), 'utf8'), title = (/<work-title>([^<]*)</.exec(xml) || [])[1] || base;
  for (const clef of ['bass', 'alto', 'tenor']) {
    const name = base + ' (' + clef + ' clef)';
    fs.writeFileSync(path.join(simple, name + '.musicxml'), inClef(xml, clef, title + ' (' + clef + ' clef)'));
    console.log('wrote', name);
  }
}
