/* Conway's Game of Life as a PUDL applet (0.20.0): init(root, opts)
   builds the whole game inside root, scopes every lookup and listener to
   it, and returns an instance with state(), setState() and destroy(). The
   engine (the linear board, the offsets map, the interesting-cell list)
   is the 2015 original, unchanged in approach; what moved is the chrome:
   the controls are PUDL components, the colours come from PUDL's tokens
   and follow the theme live, and the URL work now follows the applet
   contract, so the game only touches the address on its own page.

   The state string is the game's historic URL grammar, so links shared
   over the years keep working:
     boardSize=40&cellSize=8&speed=16.7[&saveHistory=true][&wrap=false]&init=x,y;x,y;...

   A page may offer preset links: an anchor carrying
   data-applet-preset="conway" whose href holds that grammar as its query.
   The host hands the query to a running instance as pc:applet-preset on
   the mount; without script, or with no instance running, the href
   navigates and the boot path reads the same grammar. */
(function () {
    'use strict';

    /* In a window the settings start folded away, because a window's
       height belongs to the board; on a page they are open. */
    function buildMarkup(root, fill) {
        root.innerHTML =
            '<div class="conway-buttons">' +
              '<button type="button" class="btn btn-primary" data-action="start">Start</button>' +
              '<button type="button" class="btn" data-action="stop" disabled>Stop</button>' +
              '<button type="button" class="btn" data-action="step">Step</button>' +
              '<button type="button" class="btn" data-action="reset" title="Put back the board this started with">Reset</button>' +
              '<button type="button" class="btn" data-action="share" aria-haspopup="dialog">Share…</button>' +
              '<button type="button" class="btn" data-action="help" aria-haspopup="dialog">Help</button>' +
            '</div>' +
            '<dialog class="dialog conway-help" data-role="help-dialog" aria-label="How to use the Game of Life">' +
              '<h3 class="dialog-title">How to use the Game of Life</h3>' +
              '<div class="dialog-body">' +
                '<p>Each generation, every cell looks at its eight neighbours. A live cell with two or three live neighbours ' +
                  'survives, a dead cell with exactly three comes to life, and every other cell is dead in the next generation.</p>' +
                '<h4>Running the game</h4>' +
                '<p><strong>Start</strong> runs one generation after another until you press <strong>Stop</strong>. ' +
                  '<strong>Step</strong> advances a single generation, so you can watch how the cells interact. ' +
                  '<strong>Reset</strong> puts back the board you started with, and <strong>Share</strong> gives you a link ' +
                  'to the board exactly as it is.</p>' +
                '<h4>Setting up the board</h4>' +
                '<p>Click any cell to bring it to life, and click a live cell to clear it. This works while the game is ' +
                  'running too: a cell you click joins the very next generation, so you can drop a new pattern into a running ' +
                  'world and see what it does. To start from nothing, set the cells you want before pressing Start.</p>' +
                '<h4>Settings</h4>' +
                '<p>The settings take effect the next time you press Start or Step, and they are locked while the game ' +
                  'runs, so press Stop to change them.</p>' +
                '<ul>' +
                  '<li><strong>Milliseconds delay</strong> is the pause between generations. Zero runs as fast as your ' +
                    'computer allows.</li>' +
                  '<li><strong>Cells across and down</strong> sets the size of the square board. Changing it starts a new ' +
                    'board, keeping the live cells that still fit.</li>' +
                  '<li><strong>Pixels across each cell</strong> sets how large each cell is drawn. In a window the board is ' +
                    'scaled to fit, so this matters most on the article page.</li>' +
                  '<li><strong>Wrap around edges</strong> joins the left edge to the right and the top to the bottom, so ' +
                    'patterns leaving one side come back on the other. Turned off, the edges are walls.</li>' +
                  '<li><strong>Save history</strong> records each generation in the browser\'s history, so Back and Forward ' +
                    'step through time. It slows long runs, and it is available only on the article page, which owns ' +
                    'its address.</li>' +
                '</ul>' +
              '</div>' +
              '<div class="dialog-actions">' +
                '<button type="button" class="btn btn-primary" data-action="help-close">Close</button>' +
              '</div>' +
            '</dialog>' +
            '<dialog class="dialog conway-share" data-role="share-dialog" aria-label="Share this board">' +
              '<h3 class="dialog-title">Share this board</h3>' +
              '<div class="dialog-body">' +
                '<p class="conway-share-help">This address reproduces the board as it is now: its cells, size, speed and wrapping.</p>' +
                '<input class="form-input conway-share-url" data-role="share-url" readonly aria-label="Address of this board" />' +
              '</div>' +
              '<div class="dialog-actions">' +
                '<button type="button" class="btn" data-action="share-open">Open this board</button>' +
                '<button type="button" class="btn" data-action="share-close">Close</button>' +
                '<button type="button" class="btn btn-primary" data-action="share-copy">Copy link</button>' +
              '</div>' +
            '</dialog>' +
            '<div class="conway-stats num">' +
              '<div>Generation: <span data-role="generation"></span></div>' +
              '<div>Live cells: <span data-role="live"></span></div>' +
              '<div>Generation time (ms): <span data-role="rate"></span></div>' +
            '</div>' +
            '<div class="conway-stage"><canvas data-role="grid" width="321" height="321"></canvas></div>' +
            '<details class="conway-more"' + (fill ? '' : ' open') + '><summary>Settings</summary>' +
            '<div class="conway-settings">' +
              '<label class="check"><input class="form-input num" data-role="ticks" type="text" inputmode="decimal" /> milliseconds delay between generations.</label>' +
              '<label class="check"><input class="form-input num" data-role="boardSize" type="text" inputmode="numeric" /> cells across and down.</label>' +
              '<label class="check"><input class="form-input num" data-role="cellSize" type="text" inputmode="numeric" /> pixels across each cell.</label>' +
              '<label class="check"><input data-role="wrap" type="checkbox" /> Wrap around edges.</label>' +
              '<label class="check"><input data-role="saveHistory" type="checkbox" /> Save history (turn off to improve performance; best with single-stepping).</label>' +
              '<p class="conway-hint">Click "Stop" to edit the settings, "Start" to activate them. Click cells on the board to toggle them.</p>' +
            '</div></details>';
    }

    function init(root, opts) {
        opts = opts || {};
        var ownUrl = !!opts.ownsUrl;

        buildMarkup(root, opts.fit === 'fill');
        root.classList.add('pc-conway');
        if (opts.fit === 'fill') { root.classList.add('pc-conway-fill'); }

        var q = function (sel) { return root.querySelector(sel); };
        var el = {
            grid: q('[data-role="grid"]'),
            start: q('[data-action="start"]'),
            stop: q('[data-action="stop"]'),
            step: q('[data-action="step"]'),
            ticks: q('[data-role="ticks"]'),
            boardSize: q('[data-role="boardSize"]'),
            cellSize: q('[data-role="cellSize"]'),
            wrap: q('[data-role="wrap"]'),
            saveHistory: q('[data-role="saveHistory"]'),
            reset: q('[data-action="reset"]'),
            share: q('[data-action="share"]'),
            shareDialog: q('[data-role="share-dialog"]'),
            shareUrl: q('[data-role="share-url"]'),
            shareOpen: q('[data-action="share-open"]'),
            shareCopy: q('[data-action="share-copy"]'),
            generation: q('[data-role="generation"]'),
            live: q('[data-role="live"]'),
            rate: q('[data-role="rate"]')
        };

        /* === Game state ================================================== */

        var init0 = "5,6;6,7;7,5;7,6;7,7;1,2;2,2;3,2;";
        var board = [];
        var liveTracker = [];
        var offsets = {};
        var cellList = {};
        var tempCellList = {};
        var boardSize = 40;
        var max = boardSize - 1;
        var cellCount = boardSize * boardSize;
        var cellSize = 8;
        var speed = 1000 / 60;
        var wrap = true;
        var saveHistory = false;
        var generationCount = 0;
        var intervalID = null;
        var startLink = "";
        var startGen = 0;

        /* === Colours: PUDL's tokens, followed live ======================= */

        var deadColor, liveColor, gridColor, cellColors;
        function readColors() {
            var styles = getComputedStyle(root);
            deadColor = styles.getPropertyValue('--conway-dead').trim() || 'white';
            liveColor = styles.getPropertyValue('--conway-live').trim() || 'black';
            gridColor = styles.getPropertyValue('--conway-grid').trim() || 'lightgray';
            cellColors = [deadColor, liveColor];
        }
        readColors();

        var ctx = el.grid.getContext('2d');

        function repaint() {
            readColors();
            ctx.strokeStyle = gridColor;
            for (var i = 0; i < board.length && i < cellCount; ++i) {
                drawCell(i % boardSize, Math.floor(i / boardSize), board[i] || 0);
            }
        }
        var mql = window.matchMedia('(prefers-color-scheme: dark)');
        var onScheme = function () { repaint(); };
        if (mql.addEventListener) { mql.addEventListener('change', onScheme); } else { mql.addListener(onScheme); }
        document.addEventListener('pudl:theme-change', onScheme);

        /* === Serialization: the historic URL grammar ===================== */

        function stateWithoutInit() {
            return 'boardSize=' + boardSize + '&cellSize=' + cellSize + '&speed=' + speed +
                (saveHistory ? '&saveHistory=' + saveHistory : '') + (!wrap ? '&wrap=' + wrap : '');
        }
        function stateString() { return stateWithoutInit() + '&init=' + init0; }

        function parseQuery(query) {
            var search = /([^&=]+)=?([^&]*)/g;
            var decode = function (s) { return decodeURIComponent(s.replace(/\+/g, ' ')); };
            var match = null;
            var urlParams = {};
            while ((match = search.exec(query))) { urlParams[decode(match[1])] = decode(match[2]); }
            return urlParams;
        }

        function applyState(query) {
            var p = parseQuery((query || '').replace(/^[?]/, ''));
            boardSize = +p.boardSize || boardSize;
            max = boardSize - 1;
            cellSize = +p.cellSize || cellSize;
            cellCount = boardSize * boardSize;
            if (Object.prototype.hasOwnProperty.call(p, 'init')) { init0 = p.init.replace(/\s/g, ''); }
            if (Object.prototype.hasOwnProperty.call(p, 'speed')) { speed = +p.speed; }
            /* A state names the whole board, so a setting it leaves out
               takes its default. */
            saveHistory = p.saveHistory === '1' || p.saveHistory === 'true';
            wrap = !(p.wrap === '0' || p.wrap === 'false');
        }

        var currentHref = '';   /* the address of the board as it is now */
        function updateLink() { currentHref = shareBase() + '?' + stateString(); }
        function shareBase() { return ownUrl ? location.pathname : (opts.pageUrl || location.pathname); }

        function updateInit() {
            init0 = '';
            for (var i = 0; i < liveTracker.length; ++i) {
                init0 += (liveTracker[i] % boardSize) + ',' + Math.floor(liveTracker[i] / boardSize) + ';';
            }
            updateLink();
        }

        /* History entries belong only to the applet's own page. */
        function updateHistory() {
            updateInit();
            if (saveHistory && ownUrl) { window.history.pushState('', '', currentHref); }
            announce();
        }

        function announce() { if (opts.changed) { opts.changed(stateString()); } }

        /* === Drawing ===================================================== */

        function drawCell(x, y, state) {
            x = x * cellSize;
            y = y * cellSize;
            ctx.fillStyle = cellColors[state];
            ctx.fillRect(x, y, cellSize, cellSize);
            ctx.strokeRect(x, y, cellSize, cellSize);
        }

        function setCell(x, y, state) {
            var offset = y * boardSize + x;
            var index = liveTracker.indexOf(offset);
            if (index > -1) { liveTracker.splice(index, 1); }
            board[offset] = state;
            drawCell(x, y, state);
            if (state) {
                liveTracker.push(offset);
                tempCellList[offset] = 0;
                for (var k = 0; k < 8; ++k) { tempCellList[offsets[offset][k]] = 0; }
            }
            updateHistory();
        }

        /* The canvas may be scaled by the stylesheet to fit its box, so a
           click's CSS pixels are mapped back to canvas pixels. */
        function onCanvasClick(e) {
            var scale = el.grid.width / el.grid.clientWidth;
            var x = Math.min(Math.floor(e.offsetX * scale / cellSize), boardSize - 1);
            var y = Math.min(Math.floor(e.offsetY * scale / cellSize), boardSize - 1);
            setCell(x, y, (board[y * boardSize + x] || 0) ^ 1);
        }

        /* === Board setup (the 2015 engine) =============================== */

        function initializeBoard() {
            var row = 0;
            var rowAbove = (row + max) % boardSize;
            var rowBelow = (row + 1) % boardSize;
            var col = 0;
            var colLeft = (col + max) % boardSize;
            var colRight = (col + 1) % boardSize;

            board = [];
            offsets = {};
            cellList = {};

            el.grid.width = boardSize * cellSize + 1;
            el.grid.height = boardSize * cellSize + 1;

            readColors();
            ctx.strokeStyle = gridColor;
            ctx.translate(0.5, 0.5);
            ctx.clearRect(0, 0, el.grid.width, el.grid.height);

            var x, y, i;
            for (x = 0; x < boardSize; ++x) {
                i = x;
                ctx.beginPath();
                ctx.moveTo(i * cellSize, 0);
                ctx.lineTo(i * cellSize, boardSize * cellSize);
                ctx.moveTo(0, i * cellSize);
                ctx.lineTo(boardSize * cellSize, i * cellSize);
                ctx.stroke();

                for (y = 0; y < boardSize; ++y) {
                    board.push(0);

                    var o1 = (rowAbove * boardSize + colLeft);
                    var o2 = (rowAbove * boardSize + col);
                    var o3 = (rowAbove * boardSize + colRight);
                    var o4 = (row * boardSize + colLeft);
                    var o5 = (row * boardSize + colRight);
                    var o6 = (rowBelow * boardSize + colLeft);
                    var o7 = (rowBelow * boardSize + col);
                    var o8 = (rowBelow * boardSize + colRight);

                    if (!wrap) {
                        if (row === 0) { o1 = o2 = o3 = cellCount; }
                        if ((row + 1) === boardSize) { o6 = o7 = o8 = cellCount; }
                        if (col === 0) { o1 = o4 = o6 = cellCount; }
                        if ((col + 1) === boardSize) { o3 = o5 = o8 = cellCount; }
                    }

                    offsets[row * boardSize + col] = [o1, o2, o3, o4, o5, o6, o7, o8];

                    col = (col + 1) % boardSize;
                    colLeft = (colLeft + 1) % boardSize;
                    colRight = (colRight + 1) % boardSize;
                }

                row = (row + 1) % boardSize;
                rowAbove = (rowAbove + 1) % boardSize;
                rowBelow = (rowBelow + 1) % boardSize;
            }

            board.push(0);
            offsets[cellCount] = [cellCount, cellCount, cellCount, cellCount, cellCount, cellCount, cellCount, cellCount];

            i = x;
            ctx.beginPath();
            ctx.moveTo(i * cellSize, 0);
            ctx.lineTo(i * cellSize, boardSize * cellSize);
            ctx.moveTo(0, i * cellSize);
            ctx.lineTo(boardSize * cellSize, i * cellSize);
            ctx.stroke();

            liveTracker = [];
            var pairs = init0.split(';');
            for (var item = 0; item < pairs.length; ++item) {
                var pair = pairs[item].split(',');
                var px = +pair[0];
                var py = +pair[1];
                if (px >= 0 && px < boardSize && py >= 0 && py < boardSize) {
                    var offset = py * boardSize + px;
                    board[offset] = 1;
                    liveTracker.push(offset);
                    drawCell(px, py, 1);
                }
            }

            liveTracker.sort();

            for (i = 0; i < liveTracker.length; ++i) {
                var live = liveTracker[i];
                cellList[live] = 0;
                for (var k = 0; k < 8; ++k) { cellList[offsets[live][k]] = 0; }
            }

            updateInit();
        }

        function preGen() {
            speed = +el.ticks.value;
            var temp = boardSize;
            boardSize = +el.boardSize.value;
            if (!boardSize) { boardSize = temp; el.boardSize.value = temp; }
            max = boardSize - 1;
            cellCount = boardSize * boardSize;

            temp = cellSize;
            cellSize = +el.cellSize.value;
            if (!cellSize) { cellSize = temp; el.cellSize.value = temp; }

            initializeBoard();
            startLink = stateWithoutInit() + '&init=';
        }

        var cellCountResults = [
            function () { return 0; },
            function () { return 0; },
            function (cell) { return cell; },
            function () { return 1; },
            function () { return 0; },
            function () { return 0; },
            function () { return 0; },
            function () { return 0; },
            function () { return 0; }
        ];

        function generation() {
            startGen = performance.now();
            var newBoard = [];
            var newLiveTracker = [];
            var newCellList = {};
            var newCell = 0;

            init0 = '';

            for (var pending in tempCellList) { cellList[pending] = 0; }
            tempCellList = {};

            for (var cell in cellList) {
                var position = +cell;
                var offsetArr = offsets[position];

                var liveCount = (
                    (board[offsetArr[0]] || 0) +
                    (board[offsetArr[1]] || 0) +
                    (board[offsetArr[2]] || 0) +
                    (board[offsetArr[3]] || 0) +
                    (board[offsetArr[4]] || 0) +
                    (board[offsetArr[5]] || 0) +
                    (board[offsetArr[6]] || 0) +
                    (board[offsetArr[7]] || 0)
                );

                newCell = cellCountResults[liveCount](board[position]);

                if (board[position] || newCell) {
                    var x = position % boardSize;
                    var y = Math.floor(position / boardSize);

                    if (newCell) {
                        newLiveTracker.push(position);
                        init0 += x + ',' + y + ';';
                    }

                    if (board[position] !== newCell) { drawCell(x, y, newCell); }

                    newCellList[position] = 0;
                    for (var k = 0; k < 8; ++k) { newCellList[offsetArr[k]] = 0; }

                    newBoard[position] = newCell;
                }
            }

            board = newBoard;
            liveTracker = newLiveTracker;
            cellList = newCellList;
            board[cellCount] = 0;

            el.rate.textContent = (performance.now() - startGen).toFixed(3);
        }

        function updateStats() {
            el.generation.textContent = ++generationCount;
            el.live.textContent = liveTracker.length;
            currentHref = shareBase() + '?' + startLink + init0;
            if (saveHistory && ownUrl) { window.history.pushState('', '', currentHref); }
        }

        function run() {
            generation();
            updateStats();
            intervalID = setTimeout(run, speed);
        }

        function setControlsRunning(running) {
            el.start.disabled = running;
            el.stop.disabled = !running;
            el.step.disabled = running;
            el.ticks.disabled = running;
            el.boardSize.disabled = running;
            el.cellSize.disabled = running;
            el.wrap.disabled = running;
            el.saveHistory.disabled = running || !ownUrl;
        }

        /* === Wiring ====================================================== */

        el.start.addEventListener('click', function () { setControlsRunning(true); preGen(); run(); });
        el.stop.addEventListener('click', function () {
            clearTimeout(intervalID);
            setControlsRunning(false);
            updateInit();
            announce();
        });
        el.step.addEventListener('click', function () { preGen(); generation(); updateStats(); updateInit(); announce(); });
        el.wrap.addEventListener('change', function () { wrap = el.wrap.checked; });
        el.saveHistory.addEventListener('change', function () {
            saveHistory = el.saveHistory.checked;
            updateHistory();
            if (!saveHistory && ownUrl) { window.history.replaceState('', '', currentHref); }
        });
        el.grid.addEventListener('click', onCanvasClick);
        el.grid.addEventListener('dblclick', onCanvasClick);

        /* Reset puts back the board this instance started with, in place. */
        el.reset.addEventListener('click', function () {
            clearTimeout(intervalID);
            setControlsRunning(false);
            applyAndDraw(initialState);
            if (ownUrl) { window.history.replaceState('', '', currentHref); }
        });

        /* Share shows the board's address, to copy or to open. Opening goes
           to the Conway article with this board: as a window when this
           game is in a window, as a page otherwise. On the article page
           itself there is nowhere else to go, so the choice is hidden. */
        function boardAddress() { return new URL(shareBase() + '?' + stateString(), location.origin).href; }
        el.share.addEventListener('click', function () {
            el.shareUrl.value = boardAddress();
            el.shareOpen.hidden = ownUrl;
            el.shareCopy.textContent = 'Copy link';
            el.shareDialog.showModal();
            el.shareUrl.select();
        });
        el.shareCopy.addEventListener('click', function () {
            var url = el.shareUrl.value;
            (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
                .then(function () { el.shareCopy.textContent = 'Copied'; },
                      function () { el.shareUrl.select(); el.shareCopy.textContent = 'Press Ctrl+C to copy'; });
        });
        root.querySelector('[data-action="share-close"]').addEventListener('click', function () { el.shareDialog.close(); });

        var helpDialog = q('[data-role="help-dialog"]');
        q('[data-action="help"]').addEventListener('click', function () { helpDialog.showModal(); });
        q('[data-action="help-close"]').addEventListener('click', function () { helpDialog.close(); });
        helpDialog.addEventListener('click', function (e) { if (e.target === helpDialog) { helpDialog.close(); } });
        el.shareDialog.addEventListener('click', function (e) { if (e.target === el.shareDialog) { el.shareDialog.close(); } });
        el.shareOpen.addEventListener('click', function () {
            var url = el.shareUrl.value;
            el.shareDialog.close();
            var key = (opts.pageUrl || '').split('/').filter(Boolean).pop();
            if (opts.host === 'window' && window.pudlWindows && key) {
                /* The site host hands this state to the new window's
                   instance as it boots (js/site.js). */
                window.pcAppletHandoff = window.pcAppletHandoff || {};
                window.pcAppletHandoff.conway = stateString();
                if ((window.pudlWindows.state().open || []).indexOf(key) >= 0) { window.pudlWindows.close(key); }
                window.pudlWindows.open(key);
            } else {
                location.assign(url);
            }
        });

        function syncSettings() {
            el.ticks.value = speed;
            el.boardSize.value = boardSize;
            el.cellSize.value = cellSize;
            el.wrap.checked = wrap;
            el.saveHistory.checked = saveHistory;
            el.saveHistory.disabled = !ownUrl;
            updateLink();
        }

        function applyAndDraw(query) {
            applyState(query);
            initializeBoard();
            syncSettings();
            el.generation.textContent = generationCount = 0;
            el.live.textContent = liveTracker.length;
            announce();
        }

        var onPopState = null;
        if (ownUrl) {
            onPopState = function () {
                applyState(window.location.search);
                initializeBoard();
                syncSettings();
            };
            window.addEventListener('popstate', onPopState);
        }

        /* === Start =======================================================
           Order of authority: the state the host kept, else the page's own
           address, whose grammar every historic shared link uses. */
        if (typeof opts.state === 'string' && opts.state) {
            applyState(opts.state);
        } else {
            applyState(window.location.search);
        }
        initializeBoard();
        syncSettings();
        var initialState = stateString();
        el.generation.textContent = '0';
        el.live.textContent = liveTracker.length;

        return {
            state: stateString,
            setState: function (s) { clearTimeout(intervalID); setControlsRunning(false); applyAndDraw(s); },
            destroy: function () {
                clearTimeout(intervalID);
                if (mql.removeEventListener) { mql.removeEventListener('change', onScheme); } else { mql.removeListener(onScheme); }
                document.removeEventListener('pudl:theme-change', onScheme);
                if (onPopState) { window.removeEventListener('popstate', onPopState); }
            }
        };
    }

    window.pudlApplets.register('conway', { init: init });
})();
