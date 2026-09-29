// The parts of CodeMirror 6 the site's editor uses, bundled into one file
// that defines the global CM. Built with:
//   esbuild entry.js --bundle --format=iife --global-name=CM --minify --legal-comments=eof
export { EditorState, Compartment, StateEffect, StateField } from '@codemirror/state';
export {
    EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
    drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars,
    placeholder
} from '@codemirror/view';
export { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
export { searchKeymap, highlightSelectionMatches, openSearchPanel, search } from '@codemirror/search';
export {
    bracketMatching, indentOnInput, syntaxHighlighting, HighlightStyle, StreamLanguage,
    foldGutter, foldKeymap, indentUnit
} from '@codemirror/language';
export { linter, lintGutter, lintKeymap, forceLinting } from '@codemirror/lint';
export { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
export { markdown } from '@codemirror/lang-markdown';
export { json, jsonParseLinter } from '@codemirror/lang-json';
export { shell } from '@codemirror/legacy-modes/mode/shell';
export { tags } from '@lezer/highlight';
