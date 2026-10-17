/* Compares how two running sites render the same articles: each article's
   body (.post-body) as the server sends it, with scripts off, so only the
   server's rendering is compared. For a change to the renderer
   (Pages/Services/SiteMarkdown.cs) or to an article's source, such as a
   cleanup that replaces hand-written HTML with shortcodes, which must leave
   what a reader sees as it was (Architecture/wysiwyg-editor-design.md).

     PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… node Tools/compare-article-render.js <slugs file> <site A> <site B> [out folder]

   Each line of the slugs file is a page's slug, such as about or
   tela/appendices. A site is its origin; parkscomputing.com is reached on
   this machine through HOST_MAP, as the other tests do. Each article that
   differs is reported, with the first place it differs; with an out folder,
   both bodies are written there for a closer look. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const path = require('path');

const [slugsFile, siteA, siteB, out] = process.argv.slice(2);
if (!slugsFile || !siteA || !siteB) { console.error('usage: compare-article-render.js <slugs file> <site A> <site B> [out folder]'); process.exit(2); }
const slugs = fs.readFileSync(slugsFile, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);

(async () => {
  const browser = await chromium.launch(Object.assign({ args: process.env.HOST_MAP ? ['--host-resolver-rules=' + process.env.HOST_MAP] : [] }, process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}));
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  async function body(site, slug) {
    const r = await page.goto(site + '/page/' + slug.split('/').map(encodeURIComponent).join('/'), { waitUntil: 'domcontentloaded' });
    if (!r || r.status() !== 200) { return { status: r ? r.status() : 0, html: null }; }
    const html = await page.$eval('.post-body', e => e.innerHTML).catch(() => null);
    return { status: 200, html };
  }
  let same = 0, differ = 0, missing = 0;
  for (const slug of slugs) {
    const a = await body(siteA, slug), b = await body(siteB, slug);
    if (a.html === null || b.html === null) {
      missing++;
      console.log('SKIP  ' + slug + '  (' + siteA + ' ' + a.status + (a.html === null && a.status === 200 ? ' no body' : '') + ', ' + siteB + ' ' + b.status + (b.html === null && b.status === 200 ? ' no body' : '') + ')');
      continue;
    }
    if (a.html === b.html) { same++; continue; }
    differ++;
    let i = 0;
    while (i < a.html.length && a.html[i] === b.html[i]) { i++; }
    console.log('DIFF  ' + slug + '  at ' + i + ':\n   A: ' + JSON.stringify(a.html.slice(Math.max(0, i - 60), i + 120)) + '\n   B: ' + JSON.stringify(b.html.slice(Math.max(0, i - 60), i + 120)));
    if (out) {
      fs.mkdirSync(out, { recursive: true });
      const name = slug.replace(/\//g, '__');
      fs.writeFileSync(path.join(out, name + '.a.html'), a.html);
      fs.writeFileSync(path.join(out, name + '.b.html'), b.html);
    }
  }
  console.log(same + ' the same, ' + differ + ' different, ' + missing + ' not compared');
  await browser.close();
  process.exit(differ ? 1 : 0);
})();
