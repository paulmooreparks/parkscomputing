// The parts of CodeMirror 6 the site's editor uses, bundled into one file
// that defines the global CM. Built with:
//   esbuild entry.js --bundle --format=iife --global-name=CM --minify --legal-comments=eof
export { EditorState, Compartment, StateEffect, StateField, Transaction } from '@codemirror/state';
export {
    EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
    drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars,
    placeholder, Decoration, ViewPlugin, MatchDecorator, WidgetType, hoverTooltip
} from '@codemirror/view';
export { defaultKeymap, history, historyField, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
export {
    searchKeymap, highlightSelectionMatches, openSearchPanel, search,
    searchPanelOpen, getSearchQuery, setSearchQuery, SearchQuery,
    closeSearchPanel, findNext, findPrevious, replaceNext, replaceAll
} from '@codemirror/search';
export {
    bracketMatching, indentOnInput, syntaxHighlighting, HighlightStyle, StreamLanguage,
    foldGutter, foldKeymap, indentUnit
} from '@codemirror/language';
export { linter, lintGutter, lintKeymap, forceLinting } from '@codemirror/lint';
export { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap, startCompletion, acceptCompletion } from '@codemirror/autocomplete';
export { markdown } from '@codemirror/lang-markdown';
export { json, jsonParseLinter } from '@codemirror/lang-json';
export { shell } from '@codemirror/legacy-modes/mode/shell';
export { tags } from '@lezer/highlight';
