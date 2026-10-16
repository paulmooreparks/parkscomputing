/* Writes index.json for Sight Reader's sample scores
   (Architecture/sight-reader-design.md): the MusicXML files in the scores
   folder, grouped by the folder each is in. Run it after adding, removing,
   renaming or moving a file there:

     node Tools/scores-index.js [the scores folder]

   The folder is the live site's content/scores by default. A file's title
   is its name without the extension; a file at the top of the folder is in
   no group; folders called licenses, and anything starting with a dot, are
   skipped; the levels come first, easiest first, then other folders by
   name. */
const fs = require('fs'), path = require('path');

const root = path.resolve(process.argv[2] || 'C:/Users/paul/OneDrive/Documents/parkscomputing.com/wwwroot/content/scores');
const LEVELS = ['simple', 'beginner', 'intermediate', 'advanced'];
const EXTENSIONS = ['.mxl', '.musicxml', '.xml'];

const groups = new Map();
(function walk(dir, parts) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) { continue; }
    if (entry.isDirectory()) {
      if (parts.length === 0 && entry.name.toLowerCase() === 'licenses') { continue; }
      walk(path.join(dir, entry.name), parts.concat(entry.name));
    } else if (EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      const group = parts.join(' / ');
      if (!groups.has(group)) { groups.set(group, []); }
      groups.get(group).push({ title: path.basename(entry.name, path.extname(entry.name)), file: parts.concat(entry.name).join('/') });
    }
  }
})(root, []);

const rank = name => {
  if (name === '') { return -1; }
  const i = LEVELS.indexOf(name.split(' / ')[0].toLowerCase());
  return i >= 0 ? i : LEVELS.length;
};
const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
const index = {
  groups: [...groups.keys()].sort((a, b) => rank(a) - rank(b) || byName(a, b)).map(name => ({
    name,
    scores: groups.get(name).sort((a, b) => byName(a.title, b.title))
  }))
};
fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log('Wrote ' + path.join(root, 'index.json') + ': ' + index.groups.map(g => (g.name || '(top)') + ' ' + g.scores.length).join(', '));
