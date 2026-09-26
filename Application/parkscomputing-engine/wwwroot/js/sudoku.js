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
   with destroy(). Stand-alone (opts.ownsUrl) it keeps the game in the
   page URL, with the browser's back and forward as undo and redo,
   exactly as before; inside a PUDL window it leaves the URL to the
   windows and the share button carries the game's own page URL instead. */
(function () {
    'use strict';

    var BOARD_SIZE = 9;

    function buildMarkup(root) {
        var cells = '';
        for (var row = 0; row < BOARD_SIZE; row++) {
            for (var col = 0; col < BOARD_SIZE; col++) {
                var classes = 'cell';
                if (col === 0) { classes += ' cell-left'; }
                if (row === 0) { classes += ' cell-top'; }
                if (col % 3 === 2) { classes += ' cell-right'; }
                if (row % 3 === 2) { classes += ' cell-bottom'; }
                var hints = '';
                for (var digit = 1; digit <= 9; digit++) { hints += '<div class="hint">' + digit + '</div>'; }
                cells += '<div class="' + classes + '" data-cell="' + row + '-' + col + '">' +
                         '<div class="hints">' + hints + '</div><div class="main-number"></div></div>';
            }
        }

        var numbers = '';
        for (var n = 1; n <= 9; n++) {
            numbers += '<button type="button" class="btn number-button" data-num="' + n + '">' + n + '</button>';
        }

        root.innerHTML =
            '<div class="sudoku-top">' +
              '<h1>Sudoku</h1>' +
              '<div class="mode-controls">' +
                '<select class="form-select" data-role="difficulty" aria-label="Select difficulty">' +
                  '<option value="easy">Easy</option><option value="medium">Medium</option>' +
                  '<option value="hard">Hard</option><option value="veryhard">Very Hard</option>' +
                '</select>' +
                '<button type="button" class="btn btn-primary" data-action="new">New</button>' +
                '<button type="button" class="btn" data-action="reset">Restart</button>' +
                '<button type="button" class="btn btn-danger" data-action="clear" hidden>Clear</button>' +
                '<button type="button" class="btn" data-action="edit">Editor</button>' +
                '<button type="button" class="btn" data-action="solve">Solve</button>' +
                '<a data-role="share-link" href="#" hidden>Link to Current Board</a>' +
              '</div>' +
            '</div>' +
            '<div class="sudoku-stage">' +
              '<div class="sudoku-board" data-role="board">' + cells +
                '<div class="help-text" data-role="help">' +
                  '<p><a href="https://en.wikipedia.org/wiki/Sudoku" target="_blank" rel="noopener">Sudoku</a> by Paul Parks</p>' +
                  '<ul>' +
                    '<li>Touch any cell or use the arrow keys to select a cell.</li>' +
                    '<li>To enter a number, touch one of the number buttons or type a number.</li>' +
                    '<li>To enter a hint, touch the ✏ button or hold the SHIFT key while typing a number.</li>' +
                    '<li>To clear a cell, touch the ❌ button or press the DELETE key or BACKSPACE key.</li>' +
                    '<li>To restart the game, touch the "Restart" button.</li>' +
                    '<li>To generate a new game, select a difficulty from the drop-down, then touch the "New" button.</li>' +
                    '<li>To create a game of your own, touch the "Editor" button.</li>' +
                    '<li>To remove this help text, touch the ❓ button or press the ? key.</li>' +
                  '</ul>' +
                  '<p data-role="undo-note">Game state is saved in the browser history. Use your browser’s back and forward functions to undo and redo entries.</p>' +
                  '<p>To share your game with someone, use the ↗ button. All of the clues, hints, and number entries will be preserved.</p>' +
                  '<p>Licensed under <a href="https://mit-license.org/" target="_blank" rel="noopener">MIT License</a>. Source available on <a href="https://github.com/parkscomputing/sudoku" target="_blank" rel="noopener">GitHub</a>.</p>' +
                '</div>' +
              '</div>' +
              '<div class="number-controls">' + numbers + '</div>' +
              '<div class="number-controls controls-centered">' +
                '<button type="button" class="btn" data-action="hintmode" aria-pressed="false" title="Hint entry">✏</button>' +
                '<button type="button" class="btn" data-action="delete" title="Clear cell">❌</button>' +
                '<button type="button" class="btn" data-action="help" aria-pressed="false" title="Help">❓</button>' +
                '<button type="button" class="btn" data-action="share" title="Copy shareable URL" aria-label="Copy shareable URL">↗</button>' +
              '</div>' +
            '</div>';
    }

    function init(root, opts) {
        opts = opts || {};
        var ownUrl = !!opts.ownsUrl;
        var pageUrl = opts.pageUrl || location.pathname;

        buildMarkup(root);
        root.classList.add('pc-sudoku');
        if (!root.hasAttribute('tabindex')) { root.tabIndex = 0; }

        var q = function (sel) { return root.querySelector(sel); };

        var boardEl = q('[data-role="board"]');
        var difficultyDropdown = q('[data-role="difficulty"]');
        var helpText = q('[data-role="help"]');
        var shareLink = q('[data-role="share-link"]');

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
        var helpDisplay = false;
        var selectedRow = 0, selectedCol = 0;
        var selectedCell = cells[0][0];

        /* Without its own URL there is no history-based undo, so the help
           text should not promise one. */
        if (!ownUrl) { q('[data-role="undo-note"]').hidden = true; }

        /* === Board logic (unchanged from the page-scoped original) ======= */

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

        function updateHints(row, col, hints) { boardState[row][col].hints = hints; }

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

        /* === Rendering ==================================================== */

        function drawNumber(number, numberElement, hints) {
            numberElement.classList.remove('invalid-number');
            if (number !== 0) {
                numberElement.textContent = number;
                hints.forEach(function (hint) { hint.style.visibility = 'hidden'; });
            } else {
                numberElement.textContent = '';
                numberElement.className = 'main-number';
                numberElement.setAttribute('data-editable', 'true');
                hints.forEach(function (hint) { hint.style.visibility = 'visible'; });
            }
        }

        function populateBoardFromState() {
            for (var row = 0; row < BOARD_SIZE; row++) {
                for (var col = 0; col < BOARD_SIZE; col++) {
                    var cellData = boardState[row][col];
                    var cell = cells[row][col];
                    var numberElement = cell.querySelector('.main-number');
                    var hints = cell.querySelectorAll('.hint');

                    hints.forEach(function (hint) { hint.classList.remove('active-hint'); });
                    drawNumber(cellData.value || 0, numberElement, hints);

                    cellData.hints.forEach(function (digit) {
                        var hintElement = cell.querySelector('.hint:nth-child(' + digit + ')');
                        if (hintElement !== null) { hintElement.classList.add('active-hint'); }
                    });

                    if (cellData.clue) {
                        numberElement.className = 'main-number static-number';
                        numberElement.setAttribute('data-editable', 'false');
                    } else {
                        numberElement.className = 'main-number game-number';
                        numberElement.setAttribute('data-editable', 'true');
                    }
                }
            }
        }

        function checkBoard() {
            var isValidBoard = true;
            var isComplete = true;
            boardEl.classList.remove('winner');

            for (var row = 0; row < BOARD_SIZE; row++) {
                for (var col = 0; col < BOARD_SIZE; col++) {
                    var digit = getDigit(row, col);
                    var numberElement = cells[row][col].querySelector('.main-number');
                    numberElement.className = 'main-number game-number';
                    if (isClue(row, col)) { numberElement.className = 'main-number static-number'; }
                    if (!isValidMove(row, col, digit)) {
                        numberElement.classList.add('invalid-number');
                        isValidBoard = false;
                    }
                    if (digit === 0) { isComplete = false; }
                }
            }

            if (isComplete && isValidBoard) { boardEl.classList.add('winner'); }
            return isValidBoard;
        }

        function selectCell(row, col) {
            selectedCell.classList.remove('selected');
            selectedRow = row;
            selectedCol = col;
            selectedCell = cells[row][col];
            selectedCell.classList.add('selected');

            for (var digit = 1; digit <= 9; digit++) {
                if (numButtons[digit]) { numButtons[digit].classList.remove('selected'); }
            }

            var cellValue = getDigit(row, col);
            if (isHintMode) {
                if (cellValue === 0) {
                    getHints(row, col).forEach(function (digit) {
                        if (numButtons[digit]) { numButtons[digit].classList.add('selected'); }
                    });
                }
            } else if (!isClue(row, col)) {
                if (numButtons[cellValue]) { numButtons[cellValue].classList.add('selected'); }
            }
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
            if (ownUrl) { window.history.pushState('', '', shareLink.href); }
            return shareLink.href;
        }

        function parseCell(cellString) {
            return {
                value: parseInt(cellString.charAt(0), 10),
                status: cellString.charAt(1),
                hints: cellString.slice(2).split('').map(Number)
            };
        }

        function setBoardStateFromParams(params) {
            var boardStateStr = params.get('board');
            if (!boardStateStr) { return false; }

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
            return true;
        }

        /* === Actions ====================================================== */

        function generateNewBoard(difficulty) {
            do {
                clearGameBoard();
                fillBoard();
                removeNumbers(difficulty);
            } while (!checkUnique());

            populateBoardFromState();
            checkBoard();
            updateShareState();
        }

        function updateNumberCell(digit, cell, isHintEntry) {
            var numberElement = cell.querySelector('.main-number');
            var hints = cell.querySelectorAll('.hint');

            numberElement.classList.remove('invalid-number');
            numberElement.classList.remove('game-number');

            if (isHintEntry) {
                var hintsArray = getHints(selectedRow, selectedCol);
                var hintIndex = hintsArray.indexOf(digit);
                var hintElement = cell.querySelector('.hint:nth-child(' + digit + ')');

                if (hintIndex === -1) {
                    hintsArray.push(digit);
                    if (hintElement !== null) { hintElement.classList.add('active-hint'); }
                } else {
                    hintsArray.splice(hintIndex, 1);
                    if (hintElement !== null) { hintElement.classList.remove('active-hint'); }
                }
                updateHints(selectedRow, selectedCol, hintsArray);
            } else {
                updateBoard(selectedRow, selectedCol, digit);
                drawNumber(digit, numberElement, hints);
            }

            checkBoard();
            selectCell(selectedRow, selectedCol);
            updateShareState();
        }

        function clearCell(row, col) {
            var numberElement = selectedCell.querySelector('.main-number');
            var hints = selectedCell.querySelectorAll('.hint');
            updateBoard(row, col, 0);
            drawNumber(0, numberElement, hints);
            checkBoard();
            selectCell(row, col);
            updateShareState();
        }

        function toggleHint() {
            isHintMode = !isHintMode;
            q('[data-action="hintmode"]').setAttribute('aria-pressed', String(isHintMode));
            selectCell(selectedRow, selectedCol);
        }

        function toggleHelp() {
            helpDisplay = !helpDisplay;
            helpText.classList.toggle('open', helpDisplay);
            q('[data-action="help"]').setAttribute('aria-pressed', String(helpDisplay));
        }

        /* === Wiring ======================================================= */

        for (var br = 0; br < BOARD_SIZE; br++) {
            for (var bc = 0; bc < BOARD_SIZE; bc++) {
                (function (row, col) {
                    cells[row][col].addEventListener('click', function () {
                        selectCell(row, col);
                        root.focus({ preventScroll: true });
                    });
                })(br, bc);
            }
        }

        Object.keys(numButtons).forEach(function (digit) {
            numButtons[digit].addEventListener('click', function () {
                var numberElement = selectedCell.querySelector('.main-number');
                if (isEditingMode || numberElement.getAttribute('data-editable') !== 'false') {
                    updateNumberCell(parseInt(digit, 10), selectedCell, isHintMode);
                }
            });
        });

        q('[data-action="new"]').addEventListener('click', function () {
            generateNewBoard(difficultyDropdown.value);
        });

        q('[data-action="solve"]').addEventListener('click', function () {
            solveBoard();
            populateBoardFromState();
            checkBoard();
            updateShareState();
        });

        q('[data-action="edit"]').addEventListener('click', function () {
            isEditingMode = !isEditingMode;
            this.textContent = isEditingMode ? 'Gameplay' : 'Editor';
            q('[data-action="reset"]').hidden = isEditingMode;
            q('[data-action="clear"]').hidden = !isEditingMode;
            populateBoardFromState();
            checkBoard();
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
            populateBoardFromState();
            checkBoard();
            updateShareState();
        });

        q('[data-action="clear"]').addEventListener('click', function () {
            clearGameBoard();
            populateBoardFromState();
            checkBoard();
            updateShareState();
        });

        q('[data-action="hintmode"]').addEventListener('click', toggleHint);
        q('[data-action="help"]').addEventListener('click', toggleHelp);

        q('[data-action="delete"]').addEventListener('click', function () {
            var numberElement = selectedCell.querySelector('.main-number');
            if (isEditingMode || numberElement.getAttribute('data-editable') !== 'false') {
                clearCell(selectedRow, selectedCol);
            }
        });

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
            if (event.altKey || event.ctrlKey || event.metaKey) { return; }
            if (event.target.closest('select, input, textarea')) { return; }

            if (event.key === '?') { toggleHelp(); event.preventDefault(); return; }
            if (event.key === 'h' || event.key === 'H') { toggleHint(); }

            var isHintEntry = event.shiftKey || isHintMode;
            var numberElement = selectedCell.querySelector('.main-number');

            if (isEditingMode || numberElement.getAttribute('data-editable') !== 'false') {
                if (event.code === 'Delete' || event.code === 'Backspace' ||
                    (event.code === 'NumpadDecimal' && !event.getModifierState('NumLock'))) {
                    clearCell(selectedRow, selectedCol);
                    event.preventDefault();
                }
                else if (event.code.indexOf('Digit') === 0) {
                    var digit = parseInt(event.code.replace('Digit', ''), 10);
                    if (digit >= 1 && digit <= 9) { updateNumberCell(digit, selectedCell, isHintEntry); event.preventDefault(); }
                }
                else if (event.code.indexOf('Numpad') === 0 && event.getModifierState('NumLock')) {
                    var npDigit = parseInt(event.code.replace('Numpad', ''), 10);
                    if (Number.isInteger(npDigit) && npDigit >= 1 && npDigit <= 9) {
                        updateNumberCell(npDigit, selectedCell, isHintEntry);
                        event.preventDefault();
                    }
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
            selectCell(selectedRow, selectedCol);
        }

        root.addEventListener('keydown', onKeyDown);

        var onPopState = null;
        if (ownUrl) {
            onPopState = function () {
                setBoardStateFromParams(new URLSearchParams(window.location.search));
                populateBoardFromState();
                checkBoard();
                updateShareState();
            };
            window.addEventListener('popstate', onPopState);
        }

        /* === Start ======================================================== */

        var params = ownUrl ? new URLSearchParams(window.location.search) : new URLSearchParams('');
        difficultyDropdown.value = params.get('difficulty') || 'medium';

        if (setBoardStateFromParams(params)) {
            populateBoardFromState();
            checkBoard();
            updateShareState();
        } else {
            generateNewBoard(difficultyDropdown.value);
        }

        selectCell(0, 0);
        root.focus({ preventScroll: true });

        return {
            destroy: function () {
                if (onPopState) { window.removeEventListener('popstate', onPopState); }
                root.removeEventListener('keydown', onKeyDown);
            }
        };
    }

    window.pudlApplets.register('sudoku', { init: init });
})();
