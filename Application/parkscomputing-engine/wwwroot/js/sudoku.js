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

const defaultCell = { value: 0, clue: false, hints: [] };
const boardSize = 9; // For a 9x9 Sudoku board
let boardState = Array(boardSize).fill(null).map(() => Array(boardSize).fill(null).map(() => ({ ...defaultCell })));

let isEditingMode = false;
let isHintMode = false;


document.addEventListener("DOMContentLoaded", function () {
    const params = getUrlParameters();
    const difficultyDropdown = document.getElementById("difficultyDropdown");
    const difficulty = getDifficultyFromUrl(params);
    difficultyDropdown.value = difficulty;

    if (setBoardStateFromUrl(params)) {
        populateBoardFromState();
        checkBoard();
        updateBoardStateInURL();
    }
    else {
        generateNewBoard(difficulty);
    }

    let selectedRow = 0, selectedCol = 0;
    let selectedCell = document.getElementById(`cell-${selectedRow}-${selectedCol}`);

    if (selectedCell !== null) { 
        selectedCell.classList.add('selected');
    }

    // Event listener for the button
    document.getElementById("generateBoardButton").addEventListener("click", function() {
        const selectedDifficulty = difficultyDropdown.value;
        generateNewBoard(selectedDifficulty);
    });

    document.getElementById("solveBoard").addEventListener("click", function() {
        solveBoard();
        populateBoardFromState();
        checkBoard();
        updateBoardStateInURL();
    });

    // Function to generate a new board based on selected difficulty
    function generateNewBoard(difficulty) {
        var solutionCount = 0;

        do {
            clearGameBoard();
            fillBoard();
            removeNumbers(difficulty);
        } while (!checkUnique());

        populateBoardFromState();
        checkBoard();
        updateBoardStateInURL();
    }

    function getShuffledArray() {
        let array = Array.from({ length: boardSize }, (_, i) => i + 1);

        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }

        return array;
    }

    function fillBoard() {
        function backtrack(row, col) {
            if (row === boardSize) {
                return true;  // Entire board has been filled
            }

            if (boardState[row][col].value !== 0) {
                return (col === boardSize - 1) ? backtrack(row + 1, 0) : backtrack(row, col + 1);
            }

            const numbers = getShuffledArray();

            for (const num of numbers) {
                boardState[row][col].clue = false;  // Resetting the clue flag

                if (isValid(boardState, row, col, num)) {
                    boardState[row][col].value = num;
                    boardState[row][col].clue = true;  // Marking the number as a clue

                    if ((col === boardSize - 1) ? backtrack(row + 1, 0) : backtrack(row, col + 1)) {
                        return true;  // Continue if the current number allows for a solution
                    }

                    boardState[row][col].value = 0;
                    boardState[row][col].clue = false;  // Resetting the clue flag
                }
            }

            return false;  // If no number fits in the current cell, backtrack
        }

        return backtrack(0, 0);  // Start backtracking from the first cell
    }

    function checkUnique() {
        let solutionCount = 0;
        const tempBoard = boardState.map(row => row.map(cell => Object.assign({}, cell)));

        function backtrack(row, col) {
            if (row === boardSize) {
                solutionCount++;
                return;
            }

            if (solutionCount > 1) {
                return;
            }

            if (tempBoard[row][col].value === 0) {
                for (let num = 1; num <= boardSize; num++) {
                    if (isValid(tempBoard, row, col, num)) {
                        tempBoard[row][col].value = num;

                        if (col === 8) {
                            backtrack(row + 1, 0);
                        } else {
                            backtrack(row, col + 1);
                        }

                        tempBoard[row][col].value = 0;
                    }
                }
            } else {
                if (col === 8) {
                    backtrack(row + 1, 0);
                } else {
                    backtrack(row, col + 1);
                }
            }
        }

        backtrack(0, 0);

        return solutionCount === 1;
    }

    function solveBoard() {
        function backtrack(row, col) {
            if (row === boardSize) {
                return true;
            }

            if (boardState[row][col].value === 0) {
                for (let num = 1; num <= boardSize; num++) {
                    if (isValid(boardState, row, col, num)) {
                        boardState[row][col].clue = false;
                        boardState[row][col].value = num;

                        if (col === 8) {
                            if (backtrack(row + 1, 0)) {
                                return true;
                            }
                        } else {
                            if (backtrack(row, col + 1)) {
                                return true;
                            }
                        }

                        boardState[row][col].value = 0;
                    }
                }
            } else {
                if (col === 8) {
                    if (backtrack(row + 1, 0)) {
                        return true;
                    }
                } else {
                    if (backtrack(row, col + 1)) {
                        return true;
                    }
                }
            }
            return false;
        }

        backtrack(0, 0);
    }


    function isValid(board, row, col, num) {
        for (let x = 0; x < boardSize; x++) {
            if (board[row][x].value === num) return false;
            if (board[x][col].value === num) return false;
        }

        const startRow = Math.floor(row / 3) * 3;
        const startCol = Math.floor(col / 3) * 3;
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                if (board[i + startRow][j + startCol].value === num) return false;
            }
        }
        return true;
    }

    function removeNumbers(difficulty) {
        let removalCount;

        switch (difficulty) {
            case "easy":
                removalCount = 30;
                break;
            case "medium":
                removalCount = 40;
                break;
            case "hard":
                removalCount = 50;
                break;
            case "veryhard":
                removalCount = 60;
                break;
            default:
                removalCount = 40; // Default to medium
        }

        let unvisitedCells = [];

        for (let i = 0; i < boardSize; i++) {
            for (let j = 0; j < boardSize; j++) {
                unvisitedCells.push([i, j]);
            }
        }

        let removals = 0;

        while (removals < removalCount && unvisitedCells.length > 0) {
            let index = Math.floor(Math.random() * unvisitedCells.length);
            let [row, col] = unvisitedCells.splice(index, 1)[0];

            // Ensure the cell has not been visited and has a number
            if (!boardState[row][col].visited && boardState[row][col].value !== 0) {
                // Preserve the original value
                let originalValue = boardState[row][col].value;

                // Try to remove the number
                boardState[row][col].value = 0;

                if (checkUnique()) {
                    removals++;
                    boardState[row][col].clue = false;
                } else {
                    // Otherwise, revert the removal
                    boardState[row][col].value = originalValue;
                }
            }
        }
    }

    const numberButtons = document.querySelectorAll(".number-button");

    numberButtons.forEach((button) => {
        button.addEventListener("click", function (event) {
            const numberElement = selectedCell.querySelector(".main-number");

            if (isEditingMode || numberElement.getAttribute('data-editable') !== 'false') {
                const digit = parseInt(this.innerText, 10);
                updateNumberCell(digit, selectedCell, isHintMode);
            }
        });
    });

    document.getElementById("toggleEditMode").addEventListener("click", function (event) {
        isEditingMode = !isEditingMode; 
        const resetGame = document.getElementById("resetGame");
        const clearBoard = document.getElementById("clearBoard");

        if (isEditingMode) {
            this.textContent = "Gameplay";
            resetGame.style.display = "none";
            clearBoard.style.display = "inline-block";
        } else {
            this.textContent = "Editor";
            resetGame.style.display = "inline-block";
            clearBoard.style.display = "none";
        }

        populateBoardFromState();
        checkBoard();
    });

    function toggleHint() {
        isHintMode = !isHintMode; 
        const button = document.getElementById("toggleEditHintMode")

        if (isHintMode) {
            button.classList.add('selected');
        } else {
            button.classList.remove('selected');
        }

        selectCell(selectedRow, selectedCol);
    }

    document.getElementById("toggleEditHintMode").addEventListener("click", function (event) {
        toggleHint();
    });

    let helpDisplay = false;

    function toggleHelp() {
        helpDisplay = !helpDisplay;
        const helpText = document.getElementById("helpText");
        const helpButton = document.getElementById("helpButton");

        if (helpDisplay) {
            helpText.style.display = "flex";
            helpButton.classList.add("selected");
        }
        else {
            helpText.style.display = "none";
            helpButton.classList.remove("selected");
        }
    }

    document.getElementById("helpButton").addEventListener("click", function (event) {
        toggleHelp();
    });

    document.getElementById("resetGame").addEventListener("click", function (event) {
        for (let row = 0; row < boardSize; row++) {
            for (let col = 0; col < boardSize; col++) {
                const cellData = boardState[row][col];

                if (cellData.clue === false) {
                    cellData.value = 0;
                    cellData.hints = [];
                }
            }
        }

        populateBoardFromState();
        checkBoard();
        updateBoardStateInURL();
    });

    document.getElementById("clearBoard").addEventListener("click", function (event) {
        clearGameBoard();

        populateBoardFromState();
        checkBoard();
        updateBoardStateInURL();

    });

    function clearGameBoard() {
        for (let row = 0; row < boardSize; row++) {
            for (let col = 0; col < boardSize; col++) {
                const cellData = boardState[row][col];
                cellData.value = 0;
                cellData.clue = false;
                cellData.hints = [];
            }
        }
    }

    function selectCell(row, col) {
        selectedCell.classList.remove('selected'); 
        selectedRow = row;
        selectedCol = col;
        selectedCell = document.getElementById(`cell-${selectedRow}-${selectedCol}`);
        selectedCell.classList.add('selected'); 

        for (var digit = 0; digit < 10; ++digit) {
            const hintElement = document.getElementById(`num-${digit}`);
            if (hintElement !== null) hintElement.classList.remove('selected');
        }

        const cellValue = getDigit(row, col);

        if (isHintMode) {
            if (cellValue === 0) {
                let hintsArray = getHints(selectedRow, selectedCol);
                hintsArray.forEach((digit, index, array) => {
                    const element = document.getElementById(`num-${digit}`);
                    if (element !== null) element.classList.add('selected');
                });
            }
        }
        else {
            if (!isClue(row, col)) {
                const element2 = document.getElementById(`num-${cellValue}`);
                if (element2 !== null) element2.classList.add('selected');
            }
        }
    }

    function clearCell(row, col) {
        const numberElement = selectedCell.querySelector(".main-number");
        const hints = selectedCell.querySelectorAll(".hint");
        updateBoard(row, col, 0); 
        drawNumber(0, numberElement, hints); 
        checkBoard();
        selectCell(row, col);
        updateBoardStateInURL();
    }

    document.getElementById("deleteEntry").addEventListener("click", function (event) {
        const numberElement = selectedCell.querySelector(".main-number");

        if (isEditingMode || numberElement.getAttribute('data-editable') !== 'false') {
            clearCell(selectedRow, selectedCol);
        }
    });

    document.addEventListener('keydown', function (event) {
        console.log(event.code);
        if (event.altKey) return;

        if (event.key === '?') {
            toggleHelp();
            return;
        }

        if (event.key === 'h' || event.key === 'H') {
            toggleHint();
        }

        const isShiftPressed = event.shiftKey;
        const isHintEntry = isShiftPressed || isHintMode;

        selectedCell.classList.remove('selected'); 
        const numberElement = selectedCell.querySelector(".main-number");

        if (isEditingMode || numberElement.getAttribute('data-editable') !== 'false') {
            if (event.code === 'Delete' || event.code === 'Backspace' || (event.code === 'NumpadDecimal') && !event.getModifierState("NumLock")) {
                clearCell(selectedRow, selectedCol);
            }
            else if (event.code.startsWith('Digit')) {
                const digit = parseInt(event.code.replace('Digit', ''), 10); 
                updateNumberCell(digit, selectedCell, isHintEntry);
            }
            else if (event.code.startsWith('Numpad') && event.getModifierState("NumLock")) {
                const digit = parseInt(event.code.replace('Numpad', ''), 10); 

                if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
                    updateNumberCell(digit, selectedCell, isHintEntry);
                }
            }
        }

        /* Yeah, I could probably fix the following code so that the logic isn't duplicated, 
        but that would mean creating four tiny functions. If I ever DO modify the selection 
        logic, I'll make the abstractions then. */

        if (event.code.startsWith('Arrow')) {
            switch (event.code) {
                case 'ArrowUp':
                    selectedRow = (selectedRow - 1 + 9) % 9;
                    break;
                case 'ArrowDown':
                    selectedRow = (selectedRow + 1) % 9;
                    break;
                case 'ArrowLeft':
                    selectedCol = (selectedCol - 1 + 9) % 9;
                    break;
                case 'ArrowRight':
                    selectedCol = (selectedCol + 1) % 9;
                    break;
                default:
                    selectedCell.classList.add('selected'); 
                    return;
            }
        }
        else if (event.code.startsWith('Numpad') && !event.getModifierState("NumLock")) {
            switch (event.code) {
                case 'Numpad8':
                    selectedRow = (selectedRow - 1 + 9) % 9;
                    break;
                case 'Numpad2':
                    selectedRow = (selectedRow + 1) % 9;
                    break;
                case 'Numpad4':
                    selectedCol = (selectedCol - 1 + 9) % 9;
                    break;
                case 'Numpad6':
                    selectedCol = (selectedCol + 1) % 9;
                    break;
            }
        }

        selectCell(selectedRow, selectedCol);
    });

    function updateNumberCell(digit, selectedCell, isHintEntry) {
        const numberElement = selectedCell.querySelector(".main-number");
        const hints = selectedCell.querySelectorAll(".hint");

        numberElement.classList.remove('invalid-number'); 
        numberElement.classList.remove('game-number'); 

        if (isHintEntry) {
            let hintsArray = getHints(selectedRow, selectedCol);
            const hintIndex = hintsArray.indexOf(digit);
            const hintElement = selectedCell.querySelector(`.hint:nth-child(${digit})`);

            if (hintIndex === -1) {
                hintsArray.push(digit); 
                if (hintElement !== null) hintElement.classList.add('active-hint'); 
            } else {
                hintsArray.splice(hintIndex, 1); 
                if (hintElement !== null) hintElement.classList.remove('active-hint'); 
            }

            updateHints(selectedRow, selectedCol, hintsArray);
        } else {
            updateBoard(selectedRow, selectedCol, digit);
            drawNumber(digit, numberElement, hints);
        }

        checkBoard();
        selectCell(selectedRow, selectedCol);

        updateBoardStateInURL();
    }

    window.addEventListener('popstate', function (event) {
        const params = getUrlParameters();
        setBoardStateFromUrl(params);
        populateBoardFromState();
        checkBoard();
        updateBoardStateInURL();
    });

    function isClue(row, col) {
        return boardState[row][col].clue;
    }

    function getDigit(row, col) {
        return boardState[row][col].value;
    }

    function getHints(row, col) {
        return boardState[row][col].hints;
    }

    function updateBoard(row, col, value) {
        boardState[row][col].value = value;
        boardState[row][col].clue = isEditingMode && (value !== 0);
    }

    function updateHints(row, col, hints) {
        boardState[row][col].hints = hints;
    }

    function populateBoardFromState() {
        for (let row = 0; row < boardSize; row++) {
            for (let col = 0; col < boardSize; col++) {
                const cellData = boardState[row][col];
                const hintsArray = cellData.hints;
                const cell = document.getElementById(`cell-${row}-${col}`);

                cell.addEventListener("click", function (event) {
                    selectCell(row, col);
                });

                const numberElement = cell.querySelector(".main-number");
                const hints = cell.querySelectorAll(".hint");

                hints.forEach(function (hint) {
                    hint.classList.remove('active-hint');
                });

                drawNumber(cellData.value || 0, numberElement, hints);

                hintsArray.forEach((digit, index, array) => {
                    const hintElement = cell.querySelector(`.hint:nth-child(${digit})`);
                    if (hintElement !== null) hintElement.classList.add('active-hint');
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
        let isValidBoard = true;
        let isComplete = true;
        const board = document.getElementById("sudoku-board");
        board.classList.remove("winner");

        for (let row = 0; row < boardSize; row++) {
            for (let col = 0; col < boardSize; col++) {
                const digit = getDigit(row, col);
                const cell = document.getElementById(`cell-${row}-${col}`);
                const numberElement = cell.querySelector(".main-number");
                numberElement.className = 'main-number game-number';

                if (isClue(row, col)) {
                    numberElement.className = 'main-number static-number';
                }

                if (!isValidMove(row, col, digit)) {
                    numberElement.classList.add('invalid-number');
                    isValidBoard = false;
                }

                if (digit === 0) {
                    isComplete = false;
                }
            }
        }

        if (isComplete && isValidBoard) {
            board.classList.add("winner");
        }

        return isValidBoard;
    }

    // Sample board parameter:
    // ?board=5C.3C.0P14.0P6.7C.8P6.0P9.0P9.0P-6C.7P.0P4.1C.9C.5C.0P3.0P3.8P78-0P1.9C.8C.3P.4P.0P.5P.6C.0P7-8C.0P.0P.0P9.6C.0P14.0P7.0P2.3C-4C.0P.6P.8C.0P.3C.0P7.0P2.1C-7C.0P.3P.0P9.2C.0P14.8P.0P.6C-0P9.6C.0P9.0P7.0P.0P7.2C.8C.0P-0P.8P3.7P.4C.1C.9C.0P6.0P.5C-0P.0P.0P.0P.8C.0P.0P6.7C.9C

    function updateBoardStateInURL() {
        let urlBoardString = "";
        for (let row = 0; row < boardSize; row++) {
            for (let col = 0; col < boardSize; col++) {
                const cellData = boardState[row][col];
                const clueOrPlayer = cellData.clue ? 'C' : 'P';
                urlBoardString += `${cellData.value}${clueOrPlayer}${cellData.hints.join("")}.`;
            }
            urlBoardString = urlBoardString.slice(0, -1);  // Remove trailing delimiter
            urlBoardString += "-";  // Delimiter between rows
        }

        urlBoardString = urlBoardString.slice(0, -1);  // Remove trailing delimiter

        const newURL = new URL(window.location);
        newURL.searchParams.set("difficulty", difficultyDropdown.value);
        newURL.searchParams.set("board", urlBoardString);

        const linkElement = document.getElementById("shareableLink");
        linkElement.href = newURL.toString();
        window.history.pushState("", "", linkElement.href);
        return linkElement.href;
    }


    function getUrlParameters() {
        return new URLSearchParams(window.location.search);
    }

    function setBoardStateFromUrl(params) {
        const boardStateString = params.get('board');

        if (!boardStateString) {
            return false; 
        }

        const rows = boardStateString.split('-');

        for (let row = 0; row < rows.length; row++) {
            const cols = rows[row].split('.');

            for (let col = 0; col < cols.length; col++) {
                const { value, status, hints } = parseCell(cols[col]);

                boardState[row][col].value = value;
                boardState[row][col].clue = (status === 'C');
                boardState[row][col].hints = hints;
            }
        }

        return true;
    }

    function getDifficultyFromUrl(params) {
        const difficulty = params.get("difficulty");
        if (!difficulty) {
            return "medium";
        }

        return difficulty;
    }

    function parseCell(cellString) {
        const value = parseInt(cellString.charAt(0), 10);
        const status = cellString.charAt(1);
        const hints = cellString.slice(2).split('').map(Number);

        return { value, status, hints };
    }

    function isValidMove(row, col, value) {
        if (value === 0) {
            return true;
        }

        // Check row
        for (let c = 0; c < boardSize; c++) {
            if (c !== col && boardState[row][c].value === value) {
                return false;
            }
        }

        // Check column
        for (let r = 0; r < boardSize; r++) {
            if (r !== row && boardState[r][col].value === value) {
                return false;
            }
        }

        // Check 3x3 box
        const boxRowStart = Math.floor(row / 3) * 3;
        const boxColStart = Math.floor(col / 3) * 3;
        for (let r = boxRowStart; r < boxRowStart + 3; r++) {
            for (let c = boxColStart; c < boxColStart + 3; c++) {
                if (r !== row && c !== col && boardState[r][c].value === value) {
                    return false;
                }
            }
        }

        return true;
    }

    function drawNumber(number, numberElement, hints) {
        numberElement.classList.remove('invalid-number');

        if (number !== 0) {
            numberElement.textContent = number;

            hints.forEach(function (hint) {
                hint.style.visibility = "hidden";
            });
        } else {
            numberElement.textContent = "";

            numberElement.className = 'main-number';
            numberElement.setAttribute('data-editable', 'true');

            hints.forEach(function (hint) {
                hint.style.visibility = "visible";
            });
        }
    }
}); 

