// Imports an mdBook as a book of this site (Architecture/books-design.md).
//
//   node Tools/import-mdbook.mjs <mdbook dir> <content dir> <book slug> <images dir> [repo url]
//
// For example, the Tela reference into the Tela project page's book:
//
//   node Tools/import-mdbook.mjs C:/Users/paul/source/repos/tela/book \
//     C:/Users/paul/OneDrive/Documents/parkscomputing.com/wwwroot/content tela \
//     C:/Users/paul/OneDrive/Documents/parkscomputing.com/wwwroot/images/books/tela \
//     https://github.com/paulmooreparks/tela
//
// The mdBook stays the source of truth; run this again when it changes. It
// replaces content/<slug>/ entirely and leaves content/<slug>.md, the
// book's main page, alone, so that page must already exist.
//
// SUMMARY.md gives the structure. A part heading ("# User Guide") becomes a
// folder with a page of its own listing its chapters; a chapter becomes a
// Markdown file in its part's folder, with its title and its place in
// front matter. A chapter's date is its source's last commit.
//
// What mdBook does and this site doesn't is done here once:
// {{#include path[:start[:end]]}} pulls the named lines in; links between
// chapters become the chapters' addresses on this site, and links to other
// files of the repository go to the repository; images are copied to the
// images folder and their links follow them.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [bookDir, contentDir, slug, imagesDir, repoUrl = ''] = process.argv.slice(2);
if (!bookDir || !contentDir || !slug || !imagesDir) {
  console.error('usage: node Tools/import-mdbook.mjs <mdbook dir> <content dir> <book slug> <images dir> [repo url]');
  process.exit(2);
}
const src = path.join(bookDir, 'src');
// Git names the root with forward slashes; path.resolve gives this system's form.
const repoRoot = path.resolve(execFileSync('git', ['-C', bookDir, 'rev-parse', '--show-toplevel']).toString().trim());
const imagesUrl = '/' + path.relative(path.join(contentDir, '..'), imagesDir).split(path.sep).join('/');
if (!fs.existsSync(path.join(contentDir, slug + '.md'))) {
  console.error(`content/${slug}.md, the book's main page, must exist first`);
  process.exit(1);
}

const kebab = s => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const yaml = s => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

/* === The structure, from SUMMARY.md ===================================== */

const summary = fs.readFileSync(path.join(src, 'SUMMARY.md'), 'utf8').split(/\r?\n/);
const top = [];          // { kind: 'part', title, slug, chapters: [] } or { kind: 'chapter', ... }
let part = null;
for (const line of summary) {
  const h = /^#\s+(.+)$/.exec(line);
  if (h && h[1].trim() !== 'Summary') {
    part = { kind: 'part', title: h[1].trim(), slug: kebab(h[1]), chapters: [] };
    top.push(part);
    continue;
  }
  const c = /^\s*(?:-\s+)?\[([^\]]+)\]\(([^)]+\.md)\)/.exec(line);
  if (!c) { continue; }
  // A numbered appendix title ("A. CLI Reference") keeps its letter.
  const chapter = { kind: 'chapter', title: c[1].trim(), source: c[2].trim() };
  if (part && /^\s*-/.test(line)) { part.chapters.push(chapter); }
  else { part = null; top.push(chapter); }
}

/* Each source file's place in the book, for rewriting links. */
const placeOf = new Map();    // absolute source path -> book path ("user-guide/credentials")
const used = new Set();
function place(chapter, folder) {
  let name = kebab(path.basename(chapter.source, '.md'));
  let p = (folder ? folder + '/' : '') + name;
  for (let n = 2; used.has(p); n++) { p = (folder ? folder + '/' : '') + name + '-' + n; }
  used.add(p);
  chapter.path = p;
  placeOf.set(path.resolve(src, chapter.source), p);
}
for (const item of top) {
  if (item.kind === 'part') { used.add(item.slug); item.chapters.forEach(c => place(c, item.slug)); }
  else { place(item, ''); }
}

/* A file the book takes in by {{#include}} links to the chapter that holds it. */
const includePattern = /\{\{#include\s+([^}\s:]+)(?::(\d*))?(?::(\d*))?\s*\}\}/g;
for (const [abs, p] of placeOf) {
  const text = fs.readFileSync(abs, 'utf8');
  for (const m of text.matchAll(includePattern)) {
    const inc = path.resolve(path.dirname(abs), m[1]);
    if (!placeOf.has(inc)) { placeOf.set(inc, p); }
  }
}

/* === Each chapter's text ================================================= */

function expandIncludes(text, file) {
  return text.replace(includePattern, (_, rel, start, end) => {
    const inc = path.resolve(path.dirname(file), rel);
    let lines = fs.readFileSync(inc, 'utf8').split(/\r?\n/);
    const s = start ? Math.max(1, +start) : 1, e = end ? +end : lines.length;
    lines = lines.slice(s - 1, e);
    // Links in the included text are relative to the included file.
    return rewrite(lines.join('\n'), inc);
  });
}

const copiedImages = new Set();
const missing = new Set();
function rewrite(text, file) {
  const dir = path.dirname(file);
  // Fenced code is left as it is.
  return text.split(/(```[\s\S]*?```)/g).map((chunk, i) => i % 2 ? chunk : chunk.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (all, bang, label, target, title) => {
    if (/^(https?:|mailto:|#|\/)/.test(target)) { return all; }
    const [p, hash = ''] = target.split('#');
    const abs = path.resolve(dir, decodeURIComponent(p));
    const anchor = hash ? '#' + hash : '';
    if (bang) {
      if (!fs.existsSync(abs)) { return all; }
      const name = path.basename(abs);
      if (!copiedImages.has(abs)) { fs.mkdirSync(imagesDir, { recursive: true }); fs.copyFileSync(abs, path.join(imagesDir, name)); copiedImages.add(abs); }
      return `${bang}[${label}](${imagesUrl}/${name}${title})`;
    }
    if (placeOf.has(abs)) { return `[${label}](/page/${slug}/${placeOf.get(abs)}${anchor}${title})`; }
    if (repoUrl && abs.startsWith(repoRoot) && fs.existsSync(abs)) {
      const rel = path.relative(repoRoot, abs).split(path.sep).join('/');
      return `[${label}](${repoUrl}/${fs.statSync(abs).isDirectory() ? 'tree' : 'blob'}/main/${rel}${anchor}${title})`;
    }
    // A link to nothing that exists keeps its words and loses the link.
    if (!fs.existsSync(abs)) { missing.add(path.relative(repoRoot, abs)); return label; }
    return all;
  })).join('');
}

function lastCommit(file) {
  try { return execFileSync('git', ['-C', repoRoot, 'log', '-1', '--format=%cI', '--', file]).toString().trim(); }
  catch { return ''; }
}

function frontMatter(title, order, date) {
  return ['---', `title: ${yaml(title)}`, `order: ${order}`, ...(date ? [`date: ${date.slice(0, 19)}`, `lastModified: ${date.slice(0, 19)}`] : []), '---', ''].join('\n');
}

/* === Writing ============================================================ */

const out = path.join(contentDir, slug);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
let written = 0;

function writeChapter(chapter, order) {
  const file = path.resolve(src, chapter.source);
  let text = fs.readFileSync(file, 'utf8');
  text = rewrite(expandIncludes(text, file), file);
  // The latest of the chapter's own file and anything it takes in.
  const dates = [lastCommit(file), ...[...fs.readFileSync(file, 'utf8').matchAll(includePattern)].map(m => lastCommit(path.resolve(path.dirname(file), m[1])))].filter(Boolean).sort();
  const target = path.join(out, chapter.path.split('/').join(path.sep) + '.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, frontMatter(chapter.title, order, dates.at(-1)) + '\n' + text.replace(/\s+$/, '') + '\n');
  written++;
}

top.forEach((item, i) => {
  const order = i + 1;
  if (item.kind === 'chapter') { writeChapter(item, order); return; }
  item.chapters.forEach((c, j) => writeChapter(c, j + 1));
  const list = item.chapters.map(c => `- [${c.title}](/page/${slug}/${c.path})`).join('\n');
  fs.writeFileSync(path.join(out, item.slug + '.md'), frontMatter(item.title, order, '') + `\n# ${item.title}\n\n${list}\n`);
  written++;
});

console.log(`${written} pages into content/${slug}/, ${copiedImages.size} images into ${imagesUrl}/`);
if (missing.size) { console.log('Links to files that do not exist, kept as plain words: ' + [...missing].join(', ')); }
