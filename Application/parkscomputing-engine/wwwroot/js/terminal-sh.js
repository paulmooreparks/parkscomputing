/* Copyright 2026 Paul Parks. SPDX-License-Identifier: Apache-2.0
   A POSIX shell for the terminal (Architecture/applet-platform-design.md,
   P1, from GK Companion's Terminal): an interpreter module, which the
   terminal runs a script with when its name ends in .sh or its first line
   is a #! line for sh or bash, and which gives the terminal its sh command
   in place of the one that runs a file of terminal commands. It is listed
   in window.pcTerminalCommands (js/applets.js); leaving it out leaves the
   terminal's own sh.

   The shell is mvdan.cc/sh's interpreter, built for WebAssembly (in GK
   Companion, tools/shwasm) and run in a worker of its own
   (terminal-sh-worker.js), so a script that never ends cannot hold up the
   page, and Ctrl+C ends the worker. A command that is not the shell's own,
   and every file the script opens, is a request the terminal's host
   answers. The shell is about 6.5 MB, fetched the first time a shell
   script runs and kept by the browser after that. */
(function () {
    'use strict';
    var base = new URL('.', document.currentScript.src);
    var WASM = new URL('vendor/gosh-f1115436/sh.wasm', base).href;
    function message(err) { return String(err && err.message || err).replace(/^Error: /, ''); }
    function envObject(pairs) {
        var out = {};
        (pairs || []).forEach(function (pair) { if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(pair[0])) { out[pair[0]] = String(pair[1]); } });
        return out;
    }

    var sh = {
        id: 'sh',
        name: 'POSIX shell',
        command: 'sh',
        inline: '-c',
        inlineName: true,
        summary: 'run a shell script, or a line of shell',
        help: 'sh <file> [arguments...]\nsh -c <commands> [arguments...]\n\nRuns a POSIX shell script, as sh and bash do: variables, quoting, if, for, while, case, functions, pipelines, redirection, $( ) and $(( )), with the common Bash additions. cd, export, read, test and the other shell builtins are its own; any other command is a terminal command, an applet or a script, found in the directories of PATH, which is ~/bin and then /site/bin unless you change it. A script also runs by its name from a directory in PATH, as a file ending in .sh or whose first line is #!/bin/sh or #!/bin/bash. A script runs on its own, so cd and export in it change nothing at the prompt; "source <file>" runs one in the terminal itself, and ~/.profile is sourced that way when a terminal starts. Ctrl+C stops it. The first shell script loads the shell, about 6.5 MB, which the browser then keeps. The shell is mvdan.cc/sh (BSD-3-Clause), built with Go (BSD-3-Clause).',
        /* A .profile is a shell script too, as on Unix. */
        matches: function (path, text) { return /\.sh$/i.test(path) || /(^|\/)\.profile$/.test(path) || /^#![^\n]*\b(sh|bash)[ \t]*(\r?\n|$)/.test(String(text)); },
        /* Resolves to the script's status, the variables it exported and the
           directory it ended in, which "source" takes into the terminal. */
        run: function (source, ctx) {
            return new Promise(function (finish) {
                var worker, ended = false, poll;
                function end(result) { if (ended) { return; } ended = true; clearInterval(poll); if (worker) { worker.terminate(); } finish(result); }
                try { worker = new Worker(new URL('terminal-sh-worker.js', base)); } catch (err) { ctx.error(ctx.name + ': the shell could not start: ' + message(err)); finish(1); return; }
                poll = setInterval(function () { if (ctx.interrupted()) { end(130); } }, 100);
                worker.onerror = function (e) { ctx.error(ctx.name + ': the shell could not start' + (e && e.message ? ': ' + e.message : '')); end(1); };
                worker.onmessage = async function (e) {
                    var m = e.data;
                    if (ended) { return; }
                    if (m.type === 'out') { ctx.write(m.text); return; }
                    if (m.type === 'err') { ctx.error(m.text); return; }
                    if (m.type === 'done') { end({ status: m.status, env: m.env || null, cwd: m.cwd || null }); return; }
                    if (m.type !== 'call') { return; }
                    var reply;
                    try { reply = { type: 'reply', id: m.id, ok: true, value: await ctx.request(m.op, m.args || []) }; }
                    catch (err) { reply = { type: 'reply', id: m.id, ok: false, value: message(err) }; }
                    if (!ended) { worker.postMessage(reply); }
                };
                worker.postMessage({ type: 'run', source: source, name: ctx.name, args: ctx.args, stdin: ctx.stdin, cwd: ctx.cwd || ctx.dir, env: envObject(ctx.env), wasm: WASM });
            });
        }
    };
    if (window.pcTerminal && window.pcTerminal.registerInterpreter) { window.pcTerminal.registerInterpreter(sh); }
    else { (window.pcTerminalInterpreters = window.pcTerminalInterpreters || []).push(sh); }
})();
