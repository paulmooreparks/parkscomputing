/*
MIT License

Copyright (c) 2023 Paul Parks

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

/* Sudoku as a PUDL applet: init(root, opts) builds the whole game inside
   root, scopes every lookup and listener to it, and returns an instance
   with destroy(). It runs in four habitats: a PUDL window, the classic
   article page, the bare ?frame page, and stand-alone as a web app; the
   habitat only changes how the game sizes itself. Stand-alone (with
   opts.ownsUrl) it keeps the game in the page URL, with the browser's
   back and forward as undo and redo; inside a PUDL window it leaves the
   URL to the windows and the share button carries the game's own page
   URL instead.

   Everything visible is drawn by one render() from the game state, so a
   control can never drift out of step with the board. */
(function () {
    'use strict';

    var BOARD_SIZE = 9;

    /* Chrome glyphs are inline SVG strokes in currentColor, per PUDL
       0.16.0: nothing here can render as a colour emoji, and every glyph
       follows the theme. */
    var GLYPHS = {
        pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3l4 4L8 20l-5 1 1-5z"/></svg>',
        erase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
        help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 9a3 3 0 1 1 4.6 2.5c-1 .7-1.6 1.3-1.6 2.5"/><circle cx="12" cy="18" r="0.5" fill="currentColor"/></svg>',
        share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v11M8 6l4-3 4 3"/><path d="M5 12v8h14v-8"/></svg>',
        undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 5 4 9l4 4"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
        redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 5 4 4-4 4"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/></svg>'
    };

    function buildMarkup(root) {
        var rows = '';
        for (var row = 0; row < BOARD_SIZE; row++) {
            var rowCells = '';
            for (var col = 0; col < BOARD_SIZE; col++) {
                var classes = 'cell';
                if (col === 0) { classes += ' cell-left'; }
                if (row === 0) { classes += ' cell-top'; }
                if (col % 3 === 2) { classes += ' cell-right'; }
                if (row % 3 === 2) { classes += ' cell-bottom'; }
                var hints = '';
                for (var digit = 1; digit <= 9; digit++) { hints += '<div class="hint">' + digit + '</div>'; }
                rowCells += '<div class="' + classes + '" role="gridcell" aria-selected="false" data-cell="' + row + '-' + col + '">' +
                            '<div class="hints" aria-hidden="true">' + hints + '</div><div class="main-number"></div></div>';
            }
            rows += '<div class="board-row" role="row">' + rowCells + '</div>';
        }

        var numbers = '';
        for (var n = 1; n <= 9; n++) {
            numbers += '<button type="button" class="btn number-button" data-num="' + n + '" aria-label="Enter ' + n + '">' + n + '</button>';
        }

        root.innerHTML =
            '<div class="sudoku-toolbar">' +
              '<div class="seg sudoku-mode" role="group" aria-label="Mode">' +
                '<button type="button" data-mode="play" aria-pressed="true">Play</button>' +
                '<button type="button" data-mode="edit" aria-pressed="false">Edit</button>' +
              '</div>' +
              '<select class="form-select" data-role="difficulty" aria-label="Difficulty">' +
                '<option value="easy">Easy</option><option value="medium">Medium</option>' +
                '<option value="hard">Hard</option><option value="veryhard">Very Hard</option>' +
              '</select>' +
              '<button type="button" class="btn btn-primary" data-action="new">New</button>' +
              '<button type="button" class="btn" data-action="reset">Restart</button>' +
              '<button type="button" class="btn" data-action="clear" disabled>Clear</button>' +
              '<button type="button" class="btn" data-action="solve">Solve</button>' +
            '</div>' +
            '<div class="sudoku-play">' +
              '<div class="board-box">' +
                '<div class="sudoku-board" data-role="board" role="grid" aria-label="Sudoku board">' + rows + '</div>' +
              '</div>' +
              '<div class="sudoku-pad">' +
                '<div class="pad-digits">' + numbers + '</div>' +
                '<div class="pad-actions">' +
                  '<button type="button" class="btn" data-action="undo" title="Undo" aria-label="Undo" disabled>' + GLYPHS.undo + '</button>' +
                  '<button type="button" class="btn" data-action="redo" title="Redo" aria-label="Redo" disabled>' + GLYPHS.redo + '</button>' +
                  '<button type="button" class="btn" data-action="hintmode" aria-pressed="false" title="Pencil marks" aria-label="Pencil marks">' + GLYPHS.pencil + '</button>' +
                  '<button type="button" class="btn" data-action="delete" title="Clear cell" aria-label="Clear cell">' + GLYPHS.erase + '</button>' +
                  '<button type="button" class="btn" data-action="help" title="Help" aria-label="Help">' + GLYPHS.help + '</button>' +
                  '<button type="button" class="btn" data-action="share" title="Copy shareable link" aria-label="Copy shareable link">' + GLYPHS.share + '</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<a class="sudoku-share-link" data-role="share-link" href="#" hidden>Link to this board</a>' +
            '<dialog class="dialog sudoku-help">' +
              '<h3 class="dialog-title">How to play</h3>' +
              '<div class="dialog-body">' +
                '<ul>' +
                  '<li>Click a cell, or move with the arrow keys, then type a number or press one of the number buttons.</li>' +
                  '<li>For pencil marks, press the pencil button (or the <b>H</b> key) to latch pencil entry, or hold <b>Shift</b> while typing a number.</li>' +
                  '<li>Clear a cell with the erase button, <b>Delete</b> or <b>Backspace</b>.</li>' +
                  '<li><b>Restart</b> clears your entries and keeps the clues; <b>New</b> deals a fresh board at the chosen difficulty.</li>' +
                  '<li>Switch to <b>Edit</b> to compose a board of your own; your numbers become its clues.</li>' +
                  '<li>The undo and redo buttons step through your moves, <b>Ctrl+Z</b> and <b>Ctrl+Y</b> included; New, Restart, Clear and Solve are undoable steps like any other.</li>' +
                  '<li>The share button copies a link that reproduces the whole board, clues, entries and pencil marks alike.</li>' +
                  '<li>This help answers to the <b>?</b> key.</li>' +
                '</ul>' +
                '<p class="sudoku-fine" data-role="undo-note">The game lives in the page address, so your browser&#8217;s Back and Forward are undo and redo.</p>' +
                '<p class="sudoku-fine">Sudoku by Paul Parks. Licensed under the <a href="https://mit-license.org/" target="_blank" rel="noopener">MIT License</a>; source on <a href="https://github.com/parkscomputing/sudoku" target="_blank" rel="noopener">GitHub</a>.</p>' +
              '</div>' +
              '<div class="dialog-actions">' +
                '<button type="button" class="btn btn-primary" data-action="help-close">Close</button>' +
              '</div>' +
            '</dialog>';
    }

    function init(root, opts) {
        opts = opts || {};
        var ownUrl = !!opts.ownsUrl;
        var pageUrl = opts.pageUrl || location.pathname;

        buildMarkup(root);
        root.classList.add('pc-sudoku');

        /* The host says how to size (opts.fit, PUDL 0.20.0): fill the box a
           window gives, or flow with the page. The bare ?frame form of the
           game's own page is the app: it fills the viewport itself. */
        var fill = opts.fit === 'fill';
        var isApp = !fill && ownUrl && new URLSearchParams(location.search).has('frame');
        root.classList.add(fill ? 'pc-sudoku-fit' : isApp ? 'pc-sudoku-app' : 'pc-sudoku-flow');

        if (!root.hasAttribute('tabindex')) { root.tabIndex = 0; }

        var q = function (sel) { return root.querySelector(sel); };

        var boardEl = q('[data-role="board"]');
        var difficultyDropdown = q('[data-role="difficulty"]');
        var shareLink = q('[data-role="share-link"]');
        var helpDialog = q('.sudoku-help');

        var cells = [];
        for (var r = 0; r < BOARD_SIZE; r++) {
            cells.push([]);
            for (var c = 0; c < BOARD_SIZE; c++) {
                cells[r].push(q('[data-cell="' + r + '-' + c + '"]'));
            }
        }
        var numButtons = {};
        root.querySelectorAll('[data-num]').forEach(function (b) { numButtons[parseInt(b.getAttribute('data-num'), 10)] = b; });

        var boardState = Array(BOARD_SIZE).fill(null).map(function () {
            return Array(BOARD_SIZE).fill(null).map(function () { return { value: 0, clue: false, hints: [] }; });
        });

        var isEditingMode = false;
        var isHintMode = false;
        var selectedRow = 0, selectedCol = 0;

        /* The undo history: a bounded stack of board snapshots (the same
           serialization the share URL uses) and a cursor into it. In the
           URL-owning habitats the browser's Back and Forward still walk
           the same states through history; the buttons work everywhere. */
        var UNDO_MAX = 200;
        var undoStack = [];
        var undoIndex = -1;

        /* Without its own URL there is no history-based undo, so the help
           text should not promise one. */
        if (!ownUrl) { q('[data-role="undo-note"]').hidden = true; }

        /* === Board logic ================================================== */

        function getShuffledArray() {
            var array = Array.from({ length: BOARD_SIZE }, function (_, i) { return i + 1; });
            for (var i = array.length - 1; i > 0; i--) {
                var j = Math.floor(Math.random() * (i + 1));
                var t = array[i]; array[i] = array[j]; array[j] = t;
            }
            return array;
        }

        function isValid(board, row, col, num) {
            for (var x = 0; x < BOARD_SIZE; x++) {
                if (board[row][x].value === num) { return false; }
                if (board[x][col].value === num) { return false; }
            }
            var startRow = Math.floor(row / 3) * 3;
            var startCol = Math.floor(col / 3) * 3;
            for (var i = 0; i < 3; i++) {
                for (var j = 0; j < 3; j++) {
                    if (board[i + startRow][j + startCol].value === num) { return false; }
                }
            }
            return true;
        }

        function fillBoard() {
            function backtrack(row, col) {
                if (row === BOARD_SIZE) { return true; }
                if (boardState[row][col].value !== 0) {
                    return (col === BOARD_SIZE - 1) ? backtrack(row + 1, 0) : backtrack(row, col + 1);
                }
                var numbers = getShuffledArray();
                for (var k = 0; k < numbers.length; k++) {
                    var num = numbers[k];
                    boardState[row][col].clue = false;
                    if (isValid(boardState, row, col, num)) {
                        boardState[row][col].value = num;
                        boardState[row][col].clue = true;
                        if ((col === BOARD_SIZE - 1) ? backtrack(row + 1, 0) : backtrack(row, col + 1)) { return true; }
                        boardState[row][col].value = 0;
                        boardState[row][col].clue = false;
                    }
                }
                return false;
            }
            return backtrack(0, 0);
        }

        function checkUnique() {
            var solutionCount = 0;
            var tempBoard = boardState.map(function (row) { return row.map(function (cell) { return Object.assign({}, cell); }); });

            function backtrack(row, col) {
                if (row === BOARD_SIZE) { solutionCount++; return; }
                if (solutionCount > 1) { return; }
                if (tempBoard[row][col].value === 0) {
                    for (var num = 1; num <= BOARD_SIZE; num++) {
                        if (isValid(tempBoard, row, col, num)) {
                            tempBoard[row][col].value = num;
                            if (col === 8) { backtrack(row + 1, 0); } else { backtrack(row, col + 1); }
                            tempBoard[row][col].value = 0;
                        }
                    }
                } else {
                    if (col === 8) { backtrack(row + 1, 0); } else { backtrack(row, col + 1); }
                }
            }

            backtrack(0, 0);
            return solutionCount === 1;
        }

        function solveBoard() {
            function backtrack(row, col) {
                if (row === BOARD_SIZE) { return true; }
                if (boardState[row][col].value === 0) {
                    for (var num = 1; num <= BOARD_SIZE; num++) {
                        if (isValid(boardState, row, col, num)) {
                            boardState[row][col].clue = false;
                            boardState[row][col].value = num;
                            if (col === 8) { if (backtrack(row + 1, 0)) { return true; } }
                            else if (backtrack(row, col + 1)) { return true; }
                            boardState[row][col].value = 0;
                        }
                    }
                } else {
                    if (col === 8) { if (backtrack(row + 1, 0)) { return true; } }
                    else if (backtrack(row, col + 1)) { return true; }
                }
                return false;
            }
            backtrack(0, 0);
        }

        function removeNumbers(difficulty) {
            var removalCount;
            switch (difficulty) {
                case 'easy': removalCount = 30; break;
                case 'medium': removalCount = 40; break;
                case 'hard': removalCount = 50; break;
                case 'veryhard': removalCount = 60; break;
                default: removalCount = 40;
            }

            var unvisitedCells = [];
            for (var i = 0; i < BOARD_SIZE; i++) {
                for (var j = 0; j < BOARD_SIZE; j++) { unvisitedCells.push([i, j]); }
            }

            var removals = 0;
            while (removals < removalCount && unvisitedCells.length > 0) {
                var index = Math.floor(Math.random() * unvisitedCells.length);
                var rc = unvisitedCells.splice(index, 1)[0];
                var row = rc[0], col = rc[1];
                if (boardState[row][col].value !== 0) {
                    var originalValue = boardState[row][col].value;
                    boardState[row][col].value = 0;
                    if (checkUnique()) {
                        removals++;
                        boardState[row][col].clue = false;
                    } else {
                        boardState[row][col].value = originalValue;
                    }
                }
            }
        }

        function clearGameBoard() {
            for (var row = 0; row < BOARD_SIZE; row++) {
                for (var col = 0; col < BOARD_SIZE; col++) {
                    var cellData = boardState[row][col];
                    cellData.value = 0;
                    cellData.clue = false;
                    cellData.hints = [];
                }
            }
        }

        function isClue(row, col) { return boardState[row][col].clue; }
        function getDigit(row, col) { return boardState[row][col].value; }
        function getHints(row, col) { return boardState[row][col].hints; }

        function updateBoard(row, col, value) {
            boardState[row][col].value = value;
            boardState[row][col].clue = isEditingMode && (value !== 0);
        }

        function isValidMove(row, col, value) {
            if (value === 0) { return true; }
            for (var c2 = 0; c2 < BOARD_SIZE; c2++) {
                if (c2 !== col && boardState[row][c2].value === value) { return false; }
            }
            for (var r2 = 0; r2 < BOARD_SIZE; r2++) {
                if (r2 !== row && boardState[r2][col].value === value) { return false; }
            }
            var boxRowStart = Math.floor(row / 3) * 3;
            var boxColStart = Math.floor(col / 3) * 3;
            for (var r3 = boxRowStart; r3 < boxRowStart + 3; r3++) {
                for (var c3 = boxColStart; c3 < boxColStart + 3; c3++) {
                    if (r3 !== row && c3 !== col && boardState[r3][c3].value === value) { return false; }
                }
            }
            return true;
        }

        function canEdit(row, col) { return isEditingMode || !isClue(row, col); }

        /* === Rendering ====================================================
           One pass draws everything from the state: the cells, the number
           pad, the toolbar. Nothing else touches classes, so nothing can
           fall out of step with the board. */

        function cellLabel(row, col) {
            var cellData = boardState[row][col];
            var what = cellData.value
                ? (cellData.clue ? 'clue ' : '') + cellData.value
                : (cellData.hints.length ? 'pencil marks ' + cellData.hints.join(', ') : 'empty');
            return 'Row ' + (row + 1) + ', column ' + (col + 1) + ', ' + what;
        }

        function render() {
            var isComplete = true;
            var isValidBoard = true;

            for (var row = 0; row < BOARD_SIZE; row++) {
                for (var col = 0; col < BOARD_SIZE; col++) {
                    var cellData = boardState[row][col];
                    var cell = cells[row][col];
                    var numberElement = cell.querySelector('.main-number');
                    var hintEls = cell.querySelectorAll('.hint');

                    var invalid = !isValidMove(row, col, cellData.value);
                    if (invalid) { isValidBoard = false; }
                    if (cellData.value === 0) { isComplete = false; }

                    numberElement.textContent = cellData.value || '';
                    numberElement.className = 'main-number'
                        + (cellData.clue ? ' static-number' : ' game-number')
                        + (invalid ? ' invalid-number' : '');

                    for (var d = 1; d <= 9; d++) {
                        var hintEl = hintEls[d - 1];
                        var on = cellData.value === 0 && cellData.hints.indexOf(d) !== -1;
                        hintEl.classList.toggle('active-hint', on);
                    }

                    var selected = row === selectedRow && col === selectedCol;
                    cell.classList.toggle('selected', selected);
                    cell.setAttribute('aria-selected', String(selected));
                    cell.setAttribute('aria-label', cellLabel(row, col));
                }
            }

            boardEl.classList.toggle('winner', isComplete && isValidBoard);

            /* The number pad reflects the selected cell: its value, or its
               pencil marks in pencil mode. Derived fresh every time, so it
               cannot lose its anchor to the board. */
            var selValue = getDigit(selectedRow, selectedCol);
            var selHints = getHints(selectedRow, selectedCol);
            for (var digit = 1; digit <= 9; digit++) {
                var lit = isHintMode
                    ? (selValue === 0 && selHints.indexOf(digit) !== -1)
                    : (canEdit(selectedRow, selectedCol) && selValue === digit);
                numButtons[digit].classList.toggle('selected', lit);
            }

            q('[data-mode="play"]').setAttribute('aria-pressed', String(!isEditingMode));
            q('[data-mode="edit"]').setAttribute('aria-pressed', String(isEditingMode));
            q('[data-action="reset"]').disabled = isEditingMode;
            q('[data-action="clear"]').disabled = !isEditingMode;
            q('[data-action="hintmode"]').setAttribute('aria-pressed', String(isHintMode));
            q('[data-action="undo"]').disabled = undoIndex <= 0;
            q('[data-action="redo"]').disabled = undoIndex >= undoStack.length - 1;
        }

        function selectCell(row, col) {
            selectedRow = row;
            selectedCol = col;
            render();
        }

        /* === Game state in the URL, or in the share link ================== */

        function boardStateString() {
            var urlBoardString = '';
            for (var row = 0; row < BOARD_SIZE; row++) {
                for (var col = 0; col < BOARD_SIZE; col++) {
                    var cellData = boardState[row][col];
                    urlBoardString += String(cellData.value) + (cellData.clue ? 'C' : 'P') + cellData.hints.join('') + '.';
                }
                urlBoardString = urlBoardString.slice(0, -1) + '-';
            }
            return urlBoardString.slice(0, -1);
        }

        function updateShareState() {
            var target = ownUrl ? new URL(window.location) : new URL(pageUrl, window.location.origin);
            target.searchParams.set('difficulty', difficultyDropdown.value);
            target.searchParams.set('board', boardStateString());

            shareLink.href = target.toString();
            if (ownUrl) {
                window.history.pushState('', '', shareLink.href);
            }
            /* The 0.20.0/0.21.0 handshake: the host hears every change and
               keeps the continuity wherever it likes; in a window that is
               desktop.js, which keeps it in pc-sudoku. The applet no
               longer knows where its state lives. */
            if (opts.changed) { opts.changed(continuityState()); }
            return shareLink.href;
        }

        /* The applet's state string: the whole game including its undo
           history, so a host's continuity round-trips it all. setState
           also accepts the portable forms a link can carry. */
        function continuityState() {
            return JSON.stringify({ d: difficultyDropdown.value, i: undoIndex, s: undoStack });
        }

        function applyCompactState(s) {
            var sep = typeof s === 'string' ? s.indexOf('|') : -1;
            if (sep <= 0) { return false; }
            difficultyDropdown.value = s.slice(0, sep);
            applyBoardString(s.slice(sep + 1));
            var snapshot = boardStateString();
            if (undoStack[undoIndex] !== snapshot) {
                undoStack.length = undoIndex + 1;
                undoStack.push(snapshot);
                if (undoStack.length > UNDO_MAX) { undoStack.shift(); }
                undoIndex = undoStack.length - 1;
            }
            render();
            return true;
        }

        /* Every state change lands here: the snapshot joins the undo
           history (dropping any redo tail), then the world redraws. */
        function commit() {
            var snapshot = boardStateString();
            if (undoStack[undoIndex] !== snapshot) {
                undoStack.length = undoIndex + 1;
                undoStack.push(snapshot);
                if (undoStack.length > UNDO_MAX) { undoStack.shift(); }
                undoIndex = undoStack.length - 1;
            }
            render();
            updateShareState();
        }

        function applyUndoCursor() {
            applyBoardString(undoStack[undoIndex]);
            render();
            updateShareState();
        }

        function undo() { if (undoIndex > 0) { undoIndex--; applyUndoCursor(); } }
        function redo() { if (undoIndex < undoStack.length - 1) { undoIndex++; applyUndoCursor(); } }

        function parseCell(cellString) {
            return {
                value: parseInt(cellString.charAt(0), 10),
                status: cellString.charAt(1),
                hints: cellString.slice(2).split('').map(Number)
            };
        }

        function applyBoardString(boardStateStr) {
            var rows = boardStateStr.split('-');
            for (var row = 0; row < rows.length; row++) {
                var cols = rows[row].split('.');
                for (var col = 0; col < cols.length; col++) {
                    var parsed = parseCell(cols[col]);
                    boardState[row][col].value = parsed.value;
                    boardState[row][col].clue = (parsed.status === 'C');
                    boardState[row][col].hints = parsed.hints;
                }
            }
        }

        function setBoardStateFromParams(params) {
            var boardStateStr = params.get('board');
            if (!boardStateStr) { return false; }
            applyBoardString(boardStateStr);
            return true;
        }

        /* === Actions ====================================================== */

        function generateNewBoard(difficulty) {
            do {
                clearGameBoard();
                fillBoard();
                removeNumbers(difficulty);
            } while (!checkUnique());

            commit();
        }

        /* A legal placement settles the digit for its row, column and box,
           so their pencil marks of that digit are erased. It happens inside
           the same undo step, so one undo brings the marks back. */
        function eraseNeighborNotes(digit, row, col) {
            function drop(r, c) {
                var hints = boardState[r][c].hints;
                var at = hints.indexOf(digit);
                if (at !== -1) { hints.splice(at, 1); }
            }
            for (var x = 0; x < BOARD_SIZE; x++) { drop(row, x); drop(x, col); }
            var boxRow = Math.floor(row / 3) * 3;
            var boxCol = Math.floor(col / 3) * 3;
            for (var r = boxRow; r < boxRow + 3; r++) {
                for (var c = boxCol; c < boxCol + 3; c++) { drop(r, c); }
            }
        }

        function enterNumber(digit, isHintEntry) {
            if (!canEdit(selectedRow, selectedCol)) { return; }

            if (isHintEntry) {
                var hintsArray = getHints(selectedRow, selectedCol);
                var hintIndex = hintsArray.indexOf(digit);
                if (hintIndex === -1) { hintsArray.push(digit); } else { hintsArray.splice(hintIndex, 1); }
            } else {
                updateBoard(selectedRow, selectedCol, digit);
                if (digit !== 0 && isValidMove(selectedRow, selectedCol, digit)) {
                    eraseNeighborNotes(digit, selectedRow, selectedCol);
                }
            }
            commit();
        }

        function clearCell() {
            if (!canEdit(selectedRow, selectedCol)) { return; }
            updateBoard(selectedRow, selectedCol, 0);
            commit();
        }

        function toggleHint() {
            isHintMode = !isHintMode;
            render();
        }

        function toggleHelp() {
            if (helpDialog.open) { helpDialog.close(); } else { helpDialog.showModal(); }
        }

        /* === Wiring ======================================================= */

        boardEl.addEventListener('click', function (e) {
            var cell = e.target.closest('[data-cell]');
            if (!cell) { return; }
            var rc = cell.getAttribute('data-cell').split('-');
            selectCell(parseInt(rc[0], 10), parseInt(rc[1], 10));
            root.focus({ preventScroll: true });
        });

        Object.keys(numButtons).forEach(function (digit) {
            numButtons[digit].addEventListener('click', function () {
                enterNumber(parseInt(digit, 10), isHintMode);
            });
        });

        q('.sudoku-mode').addEventListener('click', function (e) {
            var btn = e.target.closest('[data-mode]');
            if (!btn) { return; }
            isEditingMode = btn.getAttribute('data-mode') === 'edit';
            render();
        });

        q('[data-action="new"]').addEventListener('click', function () {
            generateNewBoard(difficultyDropdown.value);
        });

        q('[data-action="solve"]').addEventListener('click', function () {
            solveBoard();
            commit();
        });

        q('[data-action="reset"]').addEventListener('click', function () {
            for (var row = 0; row < BOARD_SIZE; row++) {
                for (var col = 0; col < BOARD_SIZE; col++) {
                    var cellData = boardState[row][col];
                    if (cellData.clue === false) {
                        cellData.value = 0;
                        cellData.hints = [];
                    }
                }
            }
            commit();
        });

        q('[data-action="clear"]').addEventListener('click', function () {
            clearGameBoard();
            commit();
        });

        /* The button may disable itself mid-click, which would drop focus
           to the body and take the keyboard with it; the game keeps it. */
        q('[data-action="undo"]').addEventListener('click', function () { undo(); root.focus({ preventScroll: true }); });
        q('[data-action="redo"]').addEventListener('click', function () { redo(); root.focus({ preventScroll: true }); });

        q('[data-action="hintmode"]').addEventListener('click', toggleHint);
        q('[data-action="help"]').addEventListener('click', toggleHelp);
        q('[data-action="help-close"]').addEventListener('click', function () { helpDialog.close(); });
        q('[data-action="delete"]').addEventListener('click', clearCell);

        q('[data-action="share"]').addEventListener('click', function () {
            var shareBtn = this;
            try {
                var url = updateShareState();
                navigator.clipboard.writeText(url).then(function () {
                    var originalTitle = shareBtn.title;
                    shareBtn.title = 'Copied to clipboard';
                    shareBtn.setAttribute('aria-label', 'Copied to clipboard');
                    setTimeout(function () { shareBtn.title = originalTitle; shareBtn.setAttribute('aria-label', originalTitle); }, 1800);
                }, function () {
                    shareLink.hidden = false;
                });
            } catch (err) {
                shareLink.hidden = false;
            }
        });

        function onKeyDown(event) {
            if ((event.ctrlKey || event.metaKey) && !event.altKey) {
                var chord = event.key.toLowerCase();
                if (chord === 'z' && !event.shiftKey) { undo(); event.preventDefault(); }
                else if (chord === 'y' || (chord === 'z' && event.shiftKey)) { redo(); event.preventDefault(); }
                return;
            }
            if (event.altKey || event.ctrlKey || event.metaKey) { return; }
            if (event.target.closest('select, input, textarea')) { return; }

            if (event.key === '?') { toggleHelp(); event.preventDefault(); return; }
            if (event.key === 'h' || event.key === 'H') { toggleHint(); }

            var isHintEntry = event.shiftKey || isHintMode;

            if (event.code === 'Delete' || event.code === 'Backspace' ||
                (event.code === 'NumpadDecimal' && !event.getModifierState('NumLock'))) {
                clearCell();
                event.preventDefault();
            }
            else if (event.code.indexOf('Digit') === 0) {
                var digit = parseInt(event.code.replace('Digit', ''), 10);
                if (digit >= 1 && digit <= 9) { enterNumber(digit, isHintEntry); event.preventDefault(); }
            }
            else if (event.code.indexOf('Numpad') === 0 && event.getModifierState('NumLock')) {
                var npDigit = parseInt(event.code.replace('Numpad', ''), 10);
                if (Number.isInteger(npDigit) && npDigit >= 1 && npDigit <= 9) {
                    enterNumber(npDigit, isHintEntry);
                    event.preventDefault();
                }
            }

            var moved = true;
            switch (event.code) {
                case 'ArrowUp': selectedRow = (selectedRow - 1 + 9) % 9; break;
                case 'ArrowDown': selectedRow = (selectedRow + 1) % 9; break;
                case 'ArrowLeft': selectedCol = (selectedCol - 1 + 9) % 9; break;
                case 'ArrowRight': selectedCol = (selectedCol + 1) % 9; break;
                default:
                    moved = false;
                    if (event.code.indexOf('Numpad') === 0 && !event.getModifierState('NumLock')) {
                        moved = true;
                        switch (event.code) {
                            case 'Numpad8': selectedRow = (selectedRow - 1 + 9) % 9; break;
                            case 'Numpad2': selectedRow = (selectedRow + 1) % 9; break;
                            case 'Numpad4': selectedCol = (selectedCol - 1 + 9) % 9; break;
                            case 'Numpad6': selectedCol = (selectedCol + 1) % 9; break;
                            default: moved = false;
                        }
                    }
            }

            if (moved) { event.preventDefault(); }
            render();
        }

        root.addEventListener('keydown', onKeyDown);

        var onPopState = null;
        if (ownUrl) {
            /* Back and Forward already put the right URL in place, so this
               only reads it; writing history here would truncate the
               forward entries and break redo. The restored state joins the
               undo stack so the buttons stay usable after a Back. */
            onPopState = function () {
                if (!setBoardStateFromParams(new URLSearchParams(window.location.search))) { return; }
                var snapshot = boardStateString();
                if (undoStack[undoIndex] !== snapshot) {
                    undoStack.length = undoIndex + 1;
                    undoStack.push(snapshot);
                    if (undoStack.length > UNDO_MAX) { undoStack.shift(); }
                    undoIndex = undoStack.length - 1;
                }
                render();
                shareLink.href = window.location.href;
            };
            window.addEventListener('popstate', onPopState);
        }

        /* === Start ======================================================== */

        var params = ownUrl ? new URLSearchParams(window.location.search) : new URLSearchParams('');
        var restoredStack = null;
        var restoredIndex = -1;
        /* The state the host kept (opts.state, 0.21.0) supplies the game
           unless the address itself names one: the full continuity JSON
           with its undo history, or the older "difficulty|board" form. */
        if (!params.get('board') && typeof opts.state === 'string' && opts.state) {
            if (opts.state.charAt(0) === '{') {
                try {
                    var kept = JSON.parse(opts.state);
                    if (kept && Array.isArray(kept.s) && kept.s.length > 0) {
                        restoredStack = kept.s;
                        restoredIndex = Math.min(Math.max(kept.i | 0, 0), kept.s.length - 1);
                        params.set('difficulty', kept.d || 'medium');
                        params.set('board', kept.s[restoredIndex]);
                    }
                } catch (err) { }
            } else if (opts.state.indexOf('|') > 0) {
                params.set('difficulty', opts.state.slice(0, opts.state.indexOf('|')));
                params.set('board', opts.state.slice(opts.state.indexOf('|') + 1));
            }
        }
        difficultyDropdown.value = params.get('difficulty') || 'medium';

        if (setBoardStateFromParams(params)) {
            undoStack = restoredStack || [boardStateString()];
            undoIndex = restoredIndex >= 0 ? restoredIndex : undoStack.length - 1;
            render();
            updateShareState();
        } else {
            generateNewBoard(difficultyDropdown.value);
        }

        /* Take the keyboard only where that steals nothing: stand-alone the
           game is the page, and in a window only when that window is the
           active one; focusing an inactive window would raise it over
           whatever the reader put on top. */
        if (ownUrl || root.closest('.win.active')) { root.focus({ preventScroll: true }); }

        /* setState accepts every form the game travels in: the continuity
           JSON a host kept, the "difficulty|board" pair, or a preset
           link's query string. */
        function applyAnyState(s) {
            if (typeof s !== 'string' || !s) { return; }
            if (s.charAt(0) === '{') {
                try {
                    var kept = JSON.parse(s);
                    if (kept && Array.isArray(kept.s) && kept.s.length > 0) {
                        undoStack = kept.s;
                        undoIndex = Math.min(Math.max(kept.i | 0, 0), kept.s.length - 1);
                        difficultyDropdown.value = kept.d || 'medium';
                        applyBoardString(undoStack[undoIndex]);
                        render();
                        if (opts.changed) { opts.changed(continuityState()); }
                    }
                } catch (err) { }
                return;
            }
            if (s.indexOf('=') >= 0) {
                var q = new URLSearchParams(s);
                if (!q.get('board')) { return; }
                s = (q.get('difficulty') || difficultyDropdown.value) + '|' + q.get('board');
            }
            if (applyCompactState(s) && opts.changed) { opts.changed(continuityState()); }
        }

        return {
            state: continuityState,
            setState: applyAnyState,
            destroy: function () {
                if (helpDialog.open) { helpDialog.close(); }
                if (onPopState) { window.removeEventListener('popstate', onPopState); }
                root.removeEventListener('keydown', onKeyDown);
            }
        };
    }

    window.pudlApplets.register('sudoku', { init: init });
})();
