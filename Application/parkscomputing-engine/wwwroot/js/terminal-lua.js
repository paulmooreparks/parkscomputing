/* Copyright 2026 Paul Parks. SPDX-License-Identifier: Apache-2.0
   Lua 5.4 for the terminal (Architecture/applet-platform-design.md, P1,
   from GK Companion's Terminal): an interpreter module, which the terminal
   runs a script with when its name ends in .lua or its first line is a #!
   line that ends in lua, and which gives the terminal its lua command. It
   is listed in window.pcTerminalCommands (js/applets.js); leaving it out
   leaves Lua out and changes nothing else.

   A script runs in a worker of its own (terminal-lua-worker.js), so that a
   script that never ends cannot hold up the page, and Ctrl+C ends the
   worker. Everything the script reaches outside itself is a request the
   worker sends and the terminal's host answers. Lua is wasmoon 1.16.0, the
   reference Lua 5.4 compiled to WebAssembly (vendor/wasmoon-1.16.0). */
(function () {
    'use strict';
    var base = new URL('.', document.currentScript.src);
    var WASM = new URL('vendor/wasmoon-1.16.0/glue.wasm', base).href;
    function message(err) { return String(err && err.message || err).replace(/^Error: /, ''); }

    var lua = {
        id: 'lua',
        name: 'Lua 5.4',
        command: 'lua',
        summary: 'run a Lua script, or a line of Lua',
        help: 'lua <file> [arguments...]\nlua -e <code> [arguments...]\n\nRuns Lua 5.4. print, io.write, io.read and io.lines use the terminal\'s output and input, so a Lua script takes part in a pipeline like any command; io.open, os.remove and os.rename use your files; io.popen and os.execute run a terminal command; os.getenv reads its variables, and arg holds the script\'s name and arguments. require finds a module in the script\'s directory, in ~/lib/lua, in /site/lib/lua, and among the ones that come with the terminal, json and cli; require "fs" lists and inspects directories. A script also runs by its name from a directory in PATH, ~/bin and then /site/bin, as a file ending in .lua or whose first line is #!/bin/lua. Ctrl+C stops it. A file function cannot be used inside a coroutine the script makes itself. Lua is wasmoon (MIT), the reference Lua 5.4 (MIT, Lua.org, PUC-Rio) compiled to WebAssembly.',
        matches: function (path, text) { return /\.lua$/i.test(path) || /^#![^\n]*\blua[ \t]*(\r?\n|$)/.test(String(text)); },
        run: function (source, ctx) {
            return new Promise(function (finish) {
                var worker, ended = false, poll;
                function end(status) { if (ended) { return; } ended = true; clearInterval(poll); if (worker) { worker.terminate(); } finish(status); }
                try { worker = new Worker(new URL('terminal-lua-worker.js', base)); } catch (err) { ctx.error(ctx.name + ': Lua could not start: ' + message(err)); finish(1); return; }
                poll = setInterval(function () { if (ctx.interrupted()) { end(130); } }, 100);
                worker.onerror = function (e) { ctx.error(ctx.name + ': Lua could not start' + (e && e.message ? ': ' + e.message : '')); end(1); };
                worker.onmessage = async function (e) {
                    var m = e.data;
                    if (ended) { return; }
                    if (m.type === 'out') { ctx.write(m.text); return; }
                    if (m.type === 'err') { ctx.error(m.text); return; }
                    if (m.type === 'done') { end(m.status); return; }
                    if (m.type !== 'call') { return; }
                    var reply;
                    try { reply = { type: 'reply', id: m.id, ok: true, value: await ctx.request(m.op, m.args || []) }; }
                    catch (err) { reply = { type: 'reply', id: m.id, ok: false, value: message(err) }; }
                    if (!ended) { worker.postMessage(reply); }
                };
                worker.postMessage({ type: 'run', source: source, name: ctx.name, args: ctx.args, stdin: ctx.stdin, wasm: WASM });
            });
        }
    };
    if (window.pcTerminal && window.pcTerminal.registerInterpreter) { window.pcTerminal.registerInterpreter(lua); }
    else { (window.pcTerminalInterpreters = window.pcTerminalInterpreters || []).push(lua); }
})();
