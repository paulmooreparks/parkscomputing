/* Checks for the site's MCP endpoint (Architecture/applet-platform-design.md,
   P3, Mcp/McpSetup.cs): personal access tokens, the tool list a token's
   capabilities allow, the file tools' limits, the page tree, the log and the
   applet tools. It speaks MCP's Streamable HTTP transport over node:http.

     PC_MCP_URL=http://localhost:8102/mcp PC_MCP_TOKEN_ALL=pcmcp_… PC_MCP_TOKEN_READ=pcmcp_… \
       PC_MCP_HISTORY=<the instance's history folder> node Tools/test-mcp.js

   PC_MCP_TOKEN_ALL has files.read, files.write, site.publish, comments.moderate,
   logs.read and artifact.create; PC_MCP_TOKEN_READ only files.read (admin token … on the
   server makes them). PC_MCP_REVOKE, when set, is a command that revokes the
   read-only token, for the last check. Requests connect to PC_MCP_CONNECT
   (127.0.0.1 unless given) and carry the address's own host name, so
   http://parkscomputing.com/mcp reaches the local container, and localhost
   never goes to whatever listens on its IPv6 address. */
const { execSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const URL_ = process.env.PC_MCP_URL || 'http://localhost:8102/mcp';
const CONNECT = process.env.PC_MCP_CONNECT || '127.0.0.1';

function post(headers, body) {
  const u = new URL(URL_);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: CONNECT, port: u.port || 80, path: u.pathname, method: 'POST', headers: Object.assign({ Host: u.host }, headers) }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', d => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
const ALL = process.env.PC_MCP_TOKEN_ALL, READ = process.env.PC_MCP_TOKEN_READ;
const VERSION = '2025-06-18';
/* Each run writes files of its own, ~/mcp-test/note-RUN.md and
   /wwwroot/content/mcp-test-RUN.md, which it leaves for the operator to
   remove: there is no delete tool. */
const RUN = String(Date.now());
const PUBLISH = !process.env.PC_MCP_NO_PUBLISH;

let failures = 0, id = 0;
function log(name, ok, detail) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + String(detail || '').slice(0, 400))); if (!ok) { failures++; } }

/* One JSON-RPC message; the answer comes as JSON or as an event stream.
   The client uses the initialize handshake, as most do today, so each
   token's session id, from initialize's answer, goes with its later
   requests, with the protocol version agreed. */
const sessions = {};
async function rpc(token, method, params, notify) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (token) { headers.Authorization = 'Bearer ' + token; }
  if (method !== 'initialize' && sessions[token]) { headers['Mcp-Session-Id'] = sessions[token]; headers['MCP-Protocol-Version'] = VERSION; }
  const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++id, method, params };
  const r = await post(headers, JSON.stringify(body));
  if (method === 'initialize' && r.headers['mcp-session-id']) { sessions[token] = r.headers['mcp-session-id']; }
  const text = r.text;
  let msg = null;
  if ((r.headers['content-type'] || '').includes('text/event-stream')) {
    const data = text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).filter(Boolean);
    for (const d of data) { try { const m = JSON.parse(d); if (m.id === body.id) { msg = m; } } catch (e) { } }
  } else if (text) {
    try { msg = JSON.parse(text); } catch (e) { }
  }
  return { status: r.status, auth: r.headers['www-authenticate'] || null, msg, text };
}
async function call(token, name, args) {
  const r = await rpc(token, 'tools/call', { name, arguments: args || {} });
  const res = r.msg && r.msg.result;
  const text = res && res.content && res.content.map(c => c.text || '').join('') || (r.msg && r.msg.error && r.msg.error.message) || r.text;
  let json = null; try { json = JSON.parse(text); } catch (e) { }
  return { error: !res || !!res.isError, text, json, structured: res && res.structuredContent };
}
async function init(token) {
  const r = await rpc(token, 'initialize', { protocolVersion: VERSION, capabilities: {}, clientInfo: { name: 'test-mcp', version: '1' } });
  await rpc(token, 'notifications/initialized', {}, true);
  return r;
}

(async () => {
  if (!ALL || !READ) { console.error('PC_MCP_TOKEN_ALL and PC_MCP_TOKEN_READ are needed.'); process.exit(2); }

  // Who may call.
  let r = await rpc(null, 'initialize', { protocolVersion: VERSION, capabilities: {}, clientInfo: { name: 't', version: '1' } });
  log('no token is refused with a bearer challenge', r.status === 401 && /^Bearer/.test(r.auth || ''), r.status + ' ' + r.auth);
  r = await rpc('pcmcp_not-a-real-token', 'initialize', { protocolVersion: VERSION, capabilities: {}, clientInfo: { name: 't', version: '1' } });
  log('a made-up token is refused as invalid', r.status === 401 && /invalid_token/.test(r.auth || ''), r.status + ' ' + r.auth);

  r = await init(ALL);
  log('a token initializes, and the server says what it is', r.status === 200 && r.msg && r.msg.result && r.msg.result.serverInfo.name === 'parkscomputing' && /\/wwwroot/.test(r.msg.result.instructions || ''), r.text.slice(0, 300));
  await init(READ);
  const stolen = await post({ 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer ' + READ, 'Mcp-Session-Id': sessions[ALL], 'MCP-Protocol-Version': VERSION },
    JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'server_log', arguments: {} } }));
  const stolenText = stolen.text;
  log('one token can\'t use another token\'s session', stolen.status >= 400 || /"isError":true|"error"/.test(stolenText), stolen.status + ' ' + stolenText.slice(0, 200));

  // What each token is offered.
  const names = async token => { const l = await rpc(token, 'tools/list', {}); return (l.msg && l.msg.result && l.msg.result.tools || []).map(t => t.name).sort(); };
  const all = await names(ALL), read = await names(READ);
  const SITE = ['site_files_list', 'site_file_read', 'site_file_write', 'site_pages', 'comments_queue', 'comment_decide', 'server_log'];
  const APPLET = ['applet_discover', 'applet_invoke', 'applet_status', 'applet_cancel', 'applet_artifact'];
  log('every tool is listed to a token with every capability', SITE.concat(APPLET).every(n => all.includes(n)), all.join(','));
  log('a read-only token is offered only reading and the applet tools',
    ['site_files_list', 'site_file_read', 'site_pages'].concat(APPLET).every(n => read.includes(n)) && !read.includes('site_file_write') && !read.includes('comments_queue') && !read.includes('server_log'), read.join(','));
  let c = await call(READ, 'site_file_write', { path: '~/nope.txt', text: 'x' });
  log('a read-only token cannot write', c.error, c.text);

  // The page tree and a page's source.
  c = await call(ALL, 'site_pages');
  const pages = []; (function walk(list) { (list || []).forEach(p => { pages.push(p); walk(p.pages); }); })(c.json && c.json.sections);
  const withSource = pages.find(p => p.source && /^\/wwwroot\/content\//.test(p.source));
  log('site_pages gives sections and pages with their source files', !c.error && pages.length > 5 && !!withSource, c.text.slice(0, 200));
  if (withSource) {
    c = await call(ALL, 'site_file_read', { path: withSource.source });
    log('a page\'s source reads back as text', !c.error && c.json && c.json.text.length > 0 && c.json.path === withSource.source, c.text.slice(0, 200));
  }
  c = await call(ALL, 'site_files_list', { path: '/wwwroot' });
  log('site_files_list lists /wwwroot', !c.error && c.json && c.json.entries.some(e => e.name === 'content' && e.kind === 'folder'), c.text.slice(0, 200));

  // Writing, and its limits.
  c = await call(ALL, 'site_file_write', { path: '~/mcp-test/note-' + RUN + '.md', text: '# From MCP\n', makeFolders: true });
  log('a file is written in ~, making its folder', !c.error && c.json && c.json.created === true && c.json.live === false, c.text);
  c = await call(ALL, 'site_file_read', { path: '~/mcp-test/note-' + RUN + '.md' });
  log('and reads back', !c.error && c.json && c.json.text === '# From MCP\n', c.text);
  /* On the live site the test's token has no site.publish (PC_MCP_NO_PUBLISH),
     so nothing it does ever reaches the public site. */
  c = await call(ALL, 'site_file_write', { path: '/wwwroot/content/mcp-test-' + RUN + '.md', text: 'Published by the MCP test.\n' });
  if (PUBLISH) { log('site.publish writes in /wwwroot, live', !c.error && c.json && c.json.live === true, c.text); }
  else { log('without site.publish, /wwwroot can\'t be written', c.error && /was not given site\.publish/.test(c.text), c.text); }
  c = await call(ALL, 'site_file_write', { path: '/wwwroot/js/mcp-test.js', text: '1' });
  log('js/ can\'t be written over MCP', c.error && (PUBLISH ? /js\/, css\/ or pudl\//.test(c.text) : /site\.publish/.test(c.text)), c.text);
  c = await call(ALL, 'site_file_write', { path: '/etc/mcp-test', text: '1' });
  log('/etc can\'t be written over MCP', c.error && /\/etc can't be written/.test(c.text), c.text);
  c = await call(ALL, 'site_file_read', { path: '~/../../etc/passwd' });
  log('a path that leaves its root is refused', c.error, c.text);
  c = await call(ALL, 'site_file_read', { path: '/app/appsettings.json' });
  log('a path outside the three roots is refused', c.error && /isn't a path here/.test(c.text), c.text);

  // The log, the queue and the applets.
  c = await call(ALL, 'server_log', { level: 'information', sinceMinutes: 10 });
  log('server_log shows each MCP call with the token\'s name', !c.error && c.json && c.json.entries.some(e => /MCP site_pages by token all-tools: done/.test(e.message)), c.text.slice(0, 300));
  c = await call(ALL, 'comments_queue');
  log('comments_queue gives the waiting comments', !c.error && c.json && Array.isArray(c.json.pending) && Array.isArray(c.json.reports), c.text.slice(0, 200));
  c = await call(READ, 'applet_discover');
  const providers = c.json && c.json.providers || [];
  log('applet_discover lists the applets\' actions in GK\'s shape', providers.some(p => p.id === 'parks.dice') && !/"module"|"handles"/.test(c.text), c.text.slice(0, 200));
  const actionOf = ref => providers.flatMap(p => p.actions).find(a => a.ref === ref) || {};
  log('applet_discover says which actions run over MCP', actionOf('parks.dice/roll@1').runsOverMcp === true && actionOf('parks.editor/open@1').runsOverMcp === false, JSON.stringify([actionOf('parks.dice/roll@1').runsOverMcp, actionOf('parks.editor/open@1').runsOverMcp]));

  // Pure actions run on the server (Mcp/AppletRunner.cs), from the page's own modules.
  c = await call(READ, 'applet_invoke', { action: 'parks.dice/roll@1', input: { dice: 3, sides: 6 } });
  const roll = c.json;
  log('dice roll on the server', !c.error && roll && roll.status === 'done' && roll.output.values.length === 3 && roll.output.values.every(v => v >= 1 && v <= 6) && roll.output.total === roll.output.values.reduce((a, b) => a + b, 0), c.text.slice(0, 300));
  c = await call(READ, 'applet_invoke', { action: 'parks.dice/roll@1', input: { dice: 0 } });
  log('input the schema refuses is refused, saying where', c.error && /invalid input to parks\.dice\/roll@1 at dice/.test(c.text), c.text);
  c = await call(READ, 'applet_invoke', { action: 'parks.sudoku/solve@1', input: { puzzle: '530070000600195000098000060800060003400803001700020006060000280000419005000080079' } });
  log('a sudoku is solved on the server', !c.error && c.json && c.json.output.solutions === 'one' && c.json.output.solution === '534678912672195348198342567859761423426853791713924856961537284287419635345286179', c.text.slice(0, 300));
  // An installed applet package's actions (Pages/Services/AppletCatalog.cs), with
  // the example package at wwwroot/applets/hello.
  log('applet_discover lists an installed package\'s actions', providers.some(p => p.id === 'example.hello'), providers.map(p => p.id).join());
  c = await call(READ, 'applet_invoke', { action: 'example.hello/greet@1', input: { name: 'Ada' } });
  log('and runs one on the server, from the package\'s own module', !c.error && c.json && c.json.output.greeting === 'Hello, Ada.', c.text.slice(0, 300));
  c = await call(READ, 'applet_invoke', { action: 'parks.barcode/generate@1', input: { symbology: 'ean13', data: '400638133393' } });
  log('an action needing artifact.create is refused to a token without it', c.error && /needs artifact\.create, which this token was not given/.test(c.text), c.text);
  c = await call(ALL, 'applet_invoke', { action: 'parks.barcode/generate@1', input: { symbology: 'ean13', data: '400638133393' } });
  const code = c.json;
  log('a barcode is drawn on the server, its output checked against a schema with a $ref', !c.error && code && code.status === 'done' && code.output.data === '4006381333931' && /^[0-9a-f]{64}$/.test(code.output.image.sha256 || ''), c.text.slice(0, 300));
  if (code && code.output) {
    c = await call(ALL, 'applet_artifact', { id: code.output.image.id });
    log('applet_artifact gives the barcode\'s SVG', !c.error && c.json && /^<svg/.test(c.json.text) && c.json.mime === 'image/svg+xml', c.text.slice(0, 200));
    c = await call(READ, 'applet_artifact', { id: code.output.image.id });
    log('another token can\'t fetch it', c.error && /no artifact/.test(c.text), c.text);
  }
  c = await call(READ, 'applet_status', { id: roll && roll.id });
  log('applet_status gives the token\'s own record', !c.error && c.json && c.json.id === roll.id && c.json.status === 'done', c.text.slice(0, 200));
  c = await call(ALL, 'applet_status', { id: roll && roll.id });
  log('and not another token\'s', c.error && /no invocation/.test(c.text), c.text);
  const once = 'test-' + RUN;
  const first = (await call(READ, 'applet_invoke', { action: 'parks.dice/roll@1', input: { dice: 5 }, id: once })).json;
  const again = (await call(READ, 'applet_invoke', { action: 'parks.dice/roll@1', input: { dice: 5 }, id: once })).json;
  log('the same id gives the first record instead of running again', first && again && JSON.stringify(first.output) === JSON.stringify(again.output) && first.id === once, JSON.stringify([first && first.output, again && again.output]));
  c = await call(READ, 'applet_invoke', { action: 'parks.dice/roll@1', input: { dice: 4 }, id: once });
  log('an id reused for a different call is refused', c.error && /was a different call/.test(c.text), c.text);
  c = await call(READ, 'applet_invoke', { action: 'parks.editor/open@1', input: { path: '~/x.md' } });
  log('an action that needs the desktop says so', c.error && /needs your open desktop/.test(c.text), c.text);
  c = await call(READ, 'applet_invoke', { action: 'parks.dice/roll@9' });
  log('applet_invoke refuses an action that doesn\'t exist', c.error && /There is no action/.test(c.text), c.text);

  // The audit log names the token, and a revoked token stops working.
  if (process.env.PC_MCP_HISTORY && PUBLISH) {
    const audit = fs.readFileSync(path.join(process.env.PC_MCP_HISTORY, 'audit.log'), 'utf8');
    log('the audit log records the writes with the token\'s name', audit.split('\n').some(l => l.includes('"who":"mcp-test@example.com (token all-tools)"') && l.includes('"op":"create","root":"wwwroot","path":"content/mcp-test-' + RUN + '.md"')), audit.split('\n').slice(-4).join(' | '));
  }
  if (process.env.PC_MCP_REVOKE) {
    execSync(process.env.PC_MCP_REVOKE, { stdio: 'ignore' });
    r = await rpc(READ, 'tools/list', {});
    log('a revoked token is refused', r.status === 401, r.status);
  }

  console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
  process.exit(failures ? 1 : 0);
})();
