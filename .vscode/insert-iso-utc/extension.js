const vscode = require('vscode');

function activate(context) {
  const disposable = vscode.commands.registerCommand('insertIsoUtc.insert', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }
    const now = new Date();
    const iso = now.toISOString().replace(/\.\d{3}Z$/, 'Z'); // strip ms for brevity
    editor.edit(editBuilder => {
      editor.selections.forEach(sel => {
        editBuilder.insert(sel.active, iso);
      });
    });
  });
  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = { activate, deactivate };
