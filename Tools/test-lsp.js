/* Drives the site's language server (Lsp/SiteLanguageServer.cs) as an
   editor would, over stdin and stdout, against a real web root:

     node Tools/test-lsp.js <command…>

   such as
     node Tools/test-lsp.js docker run -i --rm -v C:/…/wwwroot:/site:ro parkscomputing-local:dev lsp --root /site

   It opens a document with a good shortcode, an unknown one and a figure
   without alt, then asks for completion, a parameter completion and a
   hover, and checks the diagnostics and the answers. */
const { spawn } = require('child_process');

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) { console.error('usage: test-lsp.js <command…>'); process.exit(2); }
const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'], env: Object.assign({}, process.env, { MSYS_NO_PATHCONV: '1' }) });

let failures = 0;
function log(name, ok, detail) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + String(detail || '').slice(0, 400))); if (!ok) { failures++; } }

let buffer = Buffer.alloc(0);
const waiting = new Map(), notes = [];
child.stdout.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const head = buffer.indexOf('\r\n\r\n');
    if (head < 0) { return; }
    const len = +/Content-Length: (\d+)/i.exec(buffer.slice(0, head).toString())[1];
    if (buffer.length < head + 4 + len) { return; }
    const msg = JSON.parse(buffer.slice(head + 4, head + 4 + len).toString('utf8'));
    buffer = buffer.slice(head + 4 + len);
    if (msg.id != null && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
    else if (msg.method) { notes.push(msg); }
  }
});
let next = 1;
function send(obj) { const body = Buffer.from(JSON.stringify(Object.assign({ jsonrpc: '2.0' }, obj))); child.stdin.write('Content-Length: ' + body.length + '\r\n\r\n'); child.stdin.write(body); }
function request(method, params) { const id = next++; return new Promise((resolve, reject) => { waiting.set(id, resolve); send({ id, method, params }); setTimeout(() => reject(new Error(method + ' timed out')), 60000); }); }
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const uri = 'file:///site/content/lsp-check.md';
  const text = '---\ntitle: LSP check\n---\n\nA key: {{kbd:Ctrl+S}}.\n\nAn {{nonesuch}} here.\n\n{{figure:/images/pelican-bicycle.png}}\n\n{{tip:A tip}}\nInside.\n{{/tip}}\n';
  const init = await request('initialize', { processId: null, rootUri: null, capabilities: {} });
  log('initialize offers completion, hover and full document sync', init.result.capabilities.hoverProvider === true && init.result.capabilities.completionProvider && init.result.capabilities.textDocumentSync.change === 1, JSON.stringify(init.result));
  send({ method: 'initialized', params: {} });
  send({ method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'markdown', version: 1, text } } });
  for (let i = 0; i < 100 && !notes.some(n => n.method === 'textDocument/publishDiagnostics'); i++) { await wait(100); }
  const diags = (notes.find(n => n.method === 'textDocument/publishDiagnostics') || { params: { diagnostics: [] } }).params.diagnostics;
  const unknown = diags.find(d => /nonesuch/.test(d.message)), figure = diags.find(d => /alt/.test(d.message));
  log('the renderer\'s problems come back as two diagnostics', diags.length === 2, JSON.stringify(diags));
  log('the unknown shortcode is marked where it is', unknown && unknown.range.start.line === 6 && unknown.range.start.character === 3, JSON.stringify(unknown));
  log('the figure without alt says so, on its line', figure && figure.range.start.line === 8, JSON.stringify(figure));
  const names = await request('textDocument/completion', { textDocument: { uri }, position: { line: 4, character: 9 } });
  log('after {{ the shortcodes are offered', names.result.some(i => i.label === 'kbd') && names.result.some(i => i.label === 'figure'), JSON.stringify(names.result.map(i => i.label)));
  send({ method: 'textDocument/didChange', params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: text.replace('{{figure:/images/pelican-bicycle.png}}', '{{figure:/images/pelican-bicycle.png al') }] } });
  await wait(300);
  const params = await request('textDocument/completion', { textDocument: { uri }, position: { line: 8, character: 39 } });
  log('inside a call its parameters are offered', ['alt', 'width', 'caption'].every(n => params.result.some(i => i.label === n)), JSON.stringify(params.result.map(i => i.label)));
  const hover = await request('textDocument/hover', { textDocument: { uri }, position: { line: 4, character: 10 } });
  log('the pointer over a shortcode says what it is', hover.result && /Keys/i.test(hover.result.contents.value), JSON.stringify(hover.result));
  const down = await request('shutdown', null);
  log('shutdown is answered', 'result' in down);
  send({ method: 'exit' });
  child.on('exit', code => {
    log('exit after shutdown leaves with 0', code === 0, code);
    console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
    process.exit(failures ? 1 : 0);
  });
})().catch(e => { console.error(e); child.kill(); process.exit(1); });
