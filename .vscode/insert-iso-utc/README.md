# Insert ISO UTC Timestamp

VS Code lightweight, in-repo extension (no build) that inserts the current UTC timestamp in ISO 8601 (no milliseconds) at the cursor(s).

Default keybinding: `Ctrl+Alt+T`

Format example: `2025-08-24T13:45:12Z`

## Install (Workspace Local)
Use the built-in "Developer: Load Extension" pointing to this folder, or drag the folder into VS Code's extensions view in development mode.

Alternatively, copy the keybinding/command info into your global `keybindings.json` & `settings.json` as needed.

## Command
`Insert ISO 8601 UTC Timestamp` (ID: `insertIsoUtc.insert`)

## Customizing Keybinding
Edit `package.json` keybinding section or add to your user `keybindings.json`:
```json
{
  "key": "ctrl+alt+t",
  "command": "insertIsoUtc.insert",
  "when": "editorTextFocus"
}
```

## Multiple Cursors
Works for each active cursor / selection insertion point.
