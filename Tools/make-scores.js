/* Builds Sight Reader's sample scores from OpenScore's CC0 corpora, as
   converted to MusicXML by https://codeberg.org/HerrBenedikt/MusicXML
   (Architecture/sight-reader-design.md). It needs the fflate package
   (NODE_PATH may point to a folder holding it).

     node Tools/make-scores.js candidates <work folder>
         Downloads the catalog and the short Lieder and string quartet
         movements from it, cuts each down to one instrument, measures how
         hard each is to read, and writes <work folder>/candidates.json.
     node Tools/make-scores.js build <work folder> <picks.json> <scores folder>
         Writes the chosen cut scores into the scores folder, in a folder for
         each level, and CREDITS rows to <work folder>/credits.md.

   A Lieder score is cut to its piano part, so the voice staff is gone. A
   string quartet movement is cut to the violin, the viola and the cello,
   one score each. Everything is released under CC0 1.0 by OpenScore, which
   asks for credit, and the credits file gives it. */
const fs = require('fs'), path = require('path'), https = require('https');
const { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate');

const RAW = 'https://codeberg.org/HerrBenedikt/MusicXML/raw/branch/main/';

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'parkscomputing-make-scores' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { return resolve(get(res.headers.location)); }
      if (res.statusCode === 429) { res.resume(); return reject(Object.assign(new Error(url + ' 429'), { retry: true })); }
      if (res.statusCode !== 200) { return reject(new Error(url + ' ' + res.statusCode)); }
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function cached(work, rel) {
  const file = path.join(work, 'cache', rel.replace(/[\\/]/g, '__'));
  if (!fs.existsSync(file) && process.env.OFFLINE) { throw new Error('not cached: ' + rel); }
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (let tries = 0; ; tries++) {
      try { fs.writeFileSync(file, await get(RAW + rel)); break; }
      catch (e) { if (!e.retry || tries > 8) { throw e; } await sleep(4000 * (tries + 1)); }
    }
    await sleep(+process.env.DELAY || 250);
  }
  return fs.readFileSync(file);
}

/* The score's XML out of a compressed MusicXML file. */
function xmlOf(buf) {
  const z = unzipSync(new Uint8Array(buf));
  const name = Object.keys(z).find(n => !n.startsWith('META-INF') && /\.(xml|musicxml)$/i.test(n));
  return strFromU8(z[name]);
}
function mxlOf(xml, name) {
  const container = '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="' + name + '"/></rootfiles></container>';
  return Buffer.from(zipSync({ 'META-INF/container.xml': strToU8(container), [name]: strToU8(xml) }, { level: 9 }));
}

/* The parts of a score: each score-part element and its part element. */
function partsOf(xml) {
  const list = [...xml.matchAll(/<score-part id="([^"]*)"[^>]*>([\s\S]*?)<\/score-part>/g)];
  return list.map(m => {
    const id = m[1], name = (/<part-name[^>]*>([^<]*)</.exec(m[2]) || [])[1] || '';
    const body = new RegExp('<part id="' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>[\\s\\S]*?</part>').exec(xml);
    return { id, name: name.trim(), score: m[0], body: body ? body[0] : '' };
  });
}

/* The same score with only the parts asked for. */
function keepParts(xml, keep) {
  const all = partsOf(xml), keepIds = new Set(keep.map(p => p.id));
  let out = xml;
  for (const p of all) { if (!keepIds.has(p.id)) { out = out.replace(p.score, '').replace(p.body, ''); } }
  out = out.replace(/<part-group\b[^>]*\/>|<part-group\b[\s\S]*?<\/part-group>/g, '');
  return out;
}

const hasLyrics = p => /<lyric[ >]/.test(p.body);
const isPiano = p => /piano|klavier|clavier|pianoforte|^pf\b/i.test(p.name) && !hasLyrics(p);

function measure(xml) {
  const measures = (xml.match(/<measure /g) || []).length || 1;
  const notes = (xml.match(/<note[ >](?:(?!<\/note>)[\s\S])*?<pitch>/g) || []).length;
  const accidentals = (xml.match(/<accidental>/g) || []).length;
  const fifths = Math.abs(+((/<fifths>(-?\d+)</.exec(xml) || [])[1] || 0));
  const clefs = new Set([...xml.matchAll(/<clef[^>]*>\s*<sign>(\w)<\/sign>\s*<line>(\d)/g)].map(m => m[1] + m[2]));
  const midi = [...xml.matchAll(/<pitch>\s*<step>([A-G])<\/step>(?:\s*<alter>[^<]*<\/alter>)?\s*<octave>(\d+)<\/octave>/g)].map(m => +m[2] * 7 + 'CDEFGAB'.indexOf(m[1]));
  const range = midi.length ? Math.max(...midi) - Math.min(...midi) : 0;
  const chords = (xml.match(/<chord\/>/g) || []).length;
  const density = notes / measures;
  const score = density * (1 + 0.5 * accidentals / Math.max(notes, 1) * 10) + 2 * fifths + range / 4;
  return { measures, notes, chordRatio: +(chords / Math.max(notes, 1)).toFixed(2), accPerBar: +(accidentals / measures).toFixed(2), accidentals, fifths, clefs: [...clefs].join(','), range, density: +density.toFixed(2), difficulty: +score.toFixed(1) };
}

const titleOf = xml => ((/<movement-title>([^<]*)</.exec(xml) || [])[1] || (/<work-title>([^<]*)</.exec(xml) || [])[1] || '').trim();

async function candidates(work) {
  fs.mkdirSync(work, { recursive: true });
  const catalog = JSON.parse((await cached(work, 'catalog.json')).toString('utf8'));
  const out = [];
  const every = catalog.items.filter(i => i.id.startsWith('openscore-lieder') && i.bytes >= 6000 && i.bytes <= 40000).sort((a, b) => a.id < b.id ? -1 : 1);
  const lieder = process.env.ONLY === 'quartet' ? [] : process.env.OFFLINE ? every : every.filter((_, k) => k % 6 === 0);
  const quartets = catalog.items.filter(i => i.id.startsWith('openscore-string-quartets') && i.bytes <= 100000);
  let done = 0;
  async function one(item, kind) {
    try {
      const xml = xmlOf(await cached(work, item.file));
      const all = partsOf(xml);
      if (kind === 'lieder') {
        const piano = all.filter(isPiano), voices = all.filter(hasLyrics);
        if (piano.length !== 1 || !voices.length) { return; }
        const cut = keepParts(xml, piano);
        out.push({ id: item.id, file: item.file, kind, part: piano[0].name, title: item.title, composer: item.composer, collection: item.collection, ...measure(cut) });
      } else {
        const want = [['Violin I', /violin\s*(i\b|1)|^violin$/i], ['Viola', /viola/i], ['Cello', /cello|violoncello/i]];
        for (const [label, re] of want) {
          const p = all.find(x => re.test(x.name));
          if (!p) { continue; }
          const cut = keepParts(xml, [p]);
          out.push({ id: item.id, file: item.file, kind, part: label, partName: p.name, title: item.title, movement: titleOf(xml), composer: item.composer, collection: item.collection, ...measure(cut) });
        }
      }
    } catch (e) { console.error('skipped', item.id, e.message); }
    if (++done % 25 === 0) { console.log(done + ' done'); }
  }
  const queue = [...lieder.map(i => [i, 'lieder']), ...quartets.map(i => [i, 'quartet'])];
  await Promise.all(Array.from({ length: process.env.ONLY ? 1 : 2 }, async () => { while (queue.length) { const [i, k] = queue.shift(); await one(i, k); } }));
  fs.writeFileSync(path.join(work, 'candidates.json'), JSON.stringify(out, null, 1));
  console.log(out.length + ' candidates written');
}

const clean = s => s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
const surname = c => clean(c.split(',')[0]);

async function build(work, picksFile, scores) {
  const picks = JSON.parse(fs.readFileSync(picksFile, 'utf8'));
  const catalog = JSON.parse((await cached(work, 'catalog.json')).toString('utf8'));
  const rows = [];
  for (const pick of picks) {
    const item = catalog.items.find(i => i.id === pick.id);
    const xml = xmlOf(await cached(work, item.file)), all = partsOf(xml);
    const part = pick.kind === 'lieder' ? all.filter(isPiano)[0] : all.find(x => x.name === pick.partName);
    let cut = keepParts(xml, [part]);
    const name = clean(pick.name);
    const dir = path.join(scores, pick.level);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name + '.mxl'), mxlOf(cut, name + '.musicxml'));
    const repo = pick.kind === 'lieder' ? 'https://github.com/OpenScore/Lieder' : 'https://github.com/OpenScore/StringQuartets';
    rows.push('| ' + pick.level + '/' + name + '.mxl | ' + (pick.title || item.title) + ' | ' + item.composer + ' | ' + (item.collection || '') + ' | ' + repo + ' (' + item.id.split(':')[1] + ') | ' + (pick.kind === 'lieder' ? 'the piano part of the song' : 'the ' + pick.part + ' part') + ' |');
    console.log('wrote', pick.level + '/' + name);
  }
  fs.writeFileSync(path.join(work, 'credits.md'), rows.join('\n') + '\n');
}

(async () => {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'candidates') { await candidates(args[0]); }
  else if (cmd === 'build') { await build(args[0], args[1], args[2]); }
  else { console.log('usage: node Tools/make-scores.js candidates <work> | build <work> <picks.json> <scores folder>'); }
})();
