// Copyright 2026 Paul Parks. SPDX-License-Identifier: Apache-2.0
// Starts the site engine's language server (Lsp/SiteLanguageServer.cs) for
// Markdown files: the command in parkscomputingSite.server, which by
// default runs the engine's image with the open folder as its web root.
// Everything the server knows, the shortcodes, their parameters and the
// renderer's problems, is the engine's; this only connects VS Code to it.
const vscode = require('vscode');
const { LanguageClient } = require('vscode-languageclient/node');

let client = null;

function activate(context) {
    const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    const setting = vscode.workspace.getConfiguration('parkscomputingSite').get('server') || [];
    const words = setting.map(w => w.replace(/\$\{workspaceFolder\}/g, folder ? folder.uri.fsPath : process.cwd()));
    if (!words.length) { return; }
    client = new LanguageClient('parkscomputingSite', 'Parks Computing site',
        { command: words[0], args: words.slice(1) },
        { documentSelector: [{ scheme: 'file', language: 'markdown' }] });
    client.start();
    context.subscriptions.push({ dispose: () => client && client.stop() });
}

function deactivate() { return client ? client.stop() : undefined; }

module.exports = { activate, deactivate };
