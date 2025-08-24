/* Execute when the page loads in order to set up the board. */
window.addEventListener('load', function () {
  /* Initial location of each filled cell, in 'x,y' coordinates separated by ';' */
  var init = "5,6;6,7;7,5;7,6;7,7;1,2;2,2;3,2;";

  /* Linear array of cells. I don't store cells as a two-dimensional array. It's a little easier to
  work with as a 2D array, at least initially, but it's slower and more difficult to optimize. */
  var board = [];

  var liveTracker = []; /* Tracks the locations in the 'board' array which are live (1). */

  /* Since the cells in the board are stored in a linear array, the 'offsets' map stores the
  offsets into the 'board' array which surround any given cell.

  The layout of the offsets for each cell, by index, is thus:

     0 | 1 | 2
     ---------
     3 |   | 4
     ---------
     5 | 6 | 7

  In other words, index 0 is a row above the current cell, one position to the left. Index 7 is a
  row below, one position to the right.

  For example, if the game board is a 10x10 board, the indices in the 'board' array will from 0 to
  99 and will map to the game board as shown below.

      0 |   1 |   2 |   3 |   4 |   5 |   6 |   7 |   8 |   9
    ----------------------------------------------------------
     10 |  11 |  12 |  13 |  14 |  15 |  16 |  17 |  18 |  19
    ----------------------------------------------------------
     20 |  21 |  22 |  23 |  24 |  25 |  26 |  27 |  28 |  29
    ----------------------------------------------------------
     30 |  31 |  32 |  33 |  34 |  35 |  36 |  37 |  38 |  39
    ----------------------------------------------------------
     40 |  41 |  42 |  43 |  44 |  45 |  46 |  47 |  48 |  49
    ----------------------------------------------------------
     50 |  51 |  52 |  53 |  54 |  55 |  56 |  57 |  58 |  59
    ----------------------------------------------------------
     60 |  61 |  62 |  63 |  64 |  65 |  66 |  67 |  68 |  69
    ----------------------------------------------------------
     70 |  71 |  72 |  73 |  74 |  75 |  76 |  77 |  78 |  79
    ----------------------------------------------------------
     80 |  81 |  82 |  83 |  84 |  85 |  86 |  87 |  88 |  89
    ----------------------------------------------------------
     90 |  91 |  92 |  93 |  94 |  95 |  96 |  97 |  98 |  99

   The 'offsets' map will contain an array of indices that surround each index in the 'board' array.
   In the example board above, offsets[69] = [57, 58, 59, 67, 69, 77, 78, 79]

   */
  var offsets = {};

  /* When we spawn a generation of cells, we don't want to examine every single index in the
  game board, since most of them will not be relevant. The only interesting cells are the ones
  which are near live cells. Any cell surrounded by dead cells will remain dead, so it's not
  worth spending cycles to evaluate those. Since we have the 'liveTracker' array to track live
  cells, and we have the 'offsets' map to track offsets around each cell, we use these to create
  and maintain 'cellList', which is a map of cells which are either live or near other live cells.
  These are the cells to evaluate on each generation. */
  var cellList = {};

  /* The board is clickable while the game is running, so we don't want to risk modifying the
  live 'cellList' map during a generation. Clicks go into 'tempCellList' instead, and this map
  is merged into 'cellList' at the start of each generation. */
  var tempCellList = {};

  var boardSize = 40; /* How many cells across the board. */
  var cellCount = boardSize * boardSize; /* The board is square, so 'boardSize' squared */
  var cellSize = 8; /* Size across, in pixels, of each cell in the board. */
  var speed = 1000 / 60; /* Defaults to 60 frames per second (1000 ms divided by 60) */

  var wrap = true; /* If true, cell effects wrap around the edges of the board */

  /* If 'saveHistory' is true, a history of live cells is updated after each generation, so that
  users may use browse history (back button & forward button) to move forward or backward in time
  over generations. Impacts performance. */
  var saveHistory = false;

  /* Colors sourced from CSS custom properties for light/dark mode support */
  var rootStyles = getComputedStyle(document.documentElement);
  var deadColor = rootStyles.getPropertyValue('--conway-dead').trim() || "white"; /* The color of empty (dead) cells */
  var liveColor = rootStyles.getPropertyValue('--conway-live').trim() || "black"; /* The color of filled (live) cells */
  var gridColor = rootStyles.getPropertyValue('--conway-grid').trim() || "lightgray"; /* The color of the grid lines separating cells */

  /* Lets me choose a color quickly by indexing 'cellColors' with the state of a cell (0 is dead,
  1 is live). Need to update this array if 'deadColor' or 'liveColor' change from the default. */
  var cellColors = [deadColor, liveColor];

  /* Update colors if the preferred color scheme changes (e.g., user toggles OS theme) */
  var mql = window.matchMedia('(prefers-color-scheme: dark)');
  var updateThemeColors = function() {
    rootStyles = getComputedStyle(document.documentElement);
    deadColor = rootStyles.getPropertyValue('--conway-dead').trim() || deadColor;
    liveColor = rootStyles.getPropertyValue('--conway-live').trim() || liveColor;
    gridColor = rootStyles.getPropertyValue('--conway-grid').trim() || gridColor;
    cellColors = [deadColor, liveColor];
    /* Redraw entire board with new palette */
    ctx.strokeStyle = gridColor;
    for (var i = 0; i < board.length; ++i) {
      if (i >= cellCount) break;
      var x = i % boardSize;
      var y = Math.floor(i / boardSize);
      drawCell(x, y, board[i]);
    }
  };
  mql.addEventListener ? mql.addEventListener('change', updateThemeColors) : mql.addListener(updateThemeColors);

  /* The CANVAS element used to display the board */
  var grid = document.getElementById("grid");

  /* Get a two-dimensional drawing context into the canvas. We'll use this to draw the grid and
  the cells. */
  var ctx = grid.getContext("2d");

  var generationCount = 0; /* How many generations have passed */
  var intervalID = null; /* Track the interval returned by 'setInterval' used to draw each generation */
  var startLink = ""; /* Stores link to page, which may have initial settings passed as URL parameters */
  var startGen = 0; /* Store the start time of each generation to track how quickly they are spawned */

  /* Various controls in the HTML document. */
  var startButton = document.getElementById("start");
  var stopButton = document.getElementById("stop");
  var stepButton = document.getElementById("step");
  var ticksInput = document.getElementById("ticks");
  var boardSizeInput = document.getElementById("boardSize");
  var cellSizeInput = document.getElementById("cellSize");
  var wrapCheck = document.getElementById("wrap");
  var saveHistoryCheck = document.getElementById("saveHistory");
  var initialState = document.getElementById("initialState");
  var currentState = document.getElementById("currentState");
  var generationStat = document.getElementById("generationStat");
  var liveStat = document.getElementById("liveStat");
  var generationRate = document.getElementById("generationRate");

  /* Update the link to the current state with the necessary URL parameters EXCEPT the 'init' parameter. */
  var generateLinkWithoutInit = function () {
    /* Note 'saveHistory' and 'wrap', and the ternary logic used. Those parameters are only
    appended if there is a value to be set. If no value, then no parameter. */
    return "?boardSize=" + boardSize + "&cellSize=" + cellSize + "&speed=" + speed +
      (saveHistory ? ("&saveHistory=" + saveHistory) : "") + (!wrap ? ("&wrap=" + wrap) : "");
  };


  /* Update the link to the current state with the necessary URL parameters. */
  var generateLink = function () {
    /* Defer generation of most of the parameters to generateLinkWithoutInit. */
    return generateLinkWithoutInit() + "&init=" + init;
  };

  /* Update the link to current board state. */
  var updateLink = function () {
    currentState.href = generateLink();
  };

  /* Set the value of the URL parameter that indicates the starting state of the board ('init'). */
  var updateInit = function () {
    /* Reset 'init' parameter value to empty. */
    init = "";

    /* The liveTracker array contains the indices into the board array which contain live cells.
    Loop through them and convert them into coordinates in the 'init' parameter. */
    for (i = 0; i < liveTracker.length; ++i) {
      init += (liveTracker[i] % boardSize) /* x */ + "," +
        (Math.floor(liveTracker[i] / boardSize)) /* y */ + ";";
    }

    /* Update the link with the new 'init' parameter value. */
    updateLink();
  };

  /* Take a snapshot of the current state of the board and, if 'saveHistory' is set, push that state
  onto the history stack. */
  var updateHistory = function () {
    updateInit();

    if (saveHistory) {
      window.history.pushState("", "", currentState.href);
    }
  };

  /* Draw a cell on the board at the given coordinates with the given state (0 = dead, 1 = live). */
  var drawCell = function (x, y, state) {
    /* Scale the coordinates by the size (in pixels) of each cell to get the true grid coordinates. */
    x = x * cellSize;
    y = y * cellSize;

    /* Choose fill color based on cell state */
    ctx.fillStyle = cellColors[state];
    /* Fill the cell with the selected color */
    ctx.fillRect(x, y, cellSize, cellSize);
    /* Restore the cell outline */
    ctx.strokeRect(x, y, cellSize, cellSize);
  };

  /* Update a cell on the board at the given coordinates with the given state (0 = dead, 1 = live). */
  var setState = function (x, y, state) {
    /* Convert x,y coordinates into a linear index into the array of cells */
    var offset = y * boardSize + x;
    const index = liveTracker.indexOf(offset);

    if (index > -1) {
      liveTracker.splice(index, 1);
    }

    board[offset] = state;
    drawCell(x, y, state);

    if (state) {
      liveTracker.push(offset);

      /* Add this cell and all surrounding cells to the list of cells to be evaluated during
      the next generation. */
      tempCellList[offset] = 0;
      tempCellList[offsets[offset][0]] = 0;
      tempCellList[offsets[offset][1]] = 0;
      tempCellList[offsets[offset][2]] = 0;
      tempCellList[offsets[offset][3]] = 0;
      tempCellList[offsets[offset][4]] = 0;
      tempCellList[offsets[offset][5]] = 0;
      tempCellList[offsets[offset][6]] = 0;
      tempCellList[offsets[offset][7]] = 0;
    }

    updateHistory();
  };

  /* Respond to a click on the canvas by identifying the cell under the click and flipping its state. */
  var onCanvasClick = function (e) {
    var x = Math.min(Math.floor(e.offsetX / cellSize), boardSize - 1);
    var y = Math.min(Math.floor(e.offsetY / cellSize), boardSize - 1);
    setState(x, y, board[y * boardSize + x] ^ 1); /* XOR the cell state with 1 to flip it. */
  };

  /* Set up the board and the game's data structures from the default starting settings or the URL
  parameters, if provided. */
  var initializeBoard = function () {
    var row = 0;
    var rowAbove = (row + max) % boardSize;
    var rowBelow = (row + 1) % boardSize;
    var col = 0;
    var colLeft = (col + max) % boardSize;
    var colRight = (col + 1) % boardSize;

    board = [];
    offsets = {};

    /* Draw the initial grid */
    grid.width = boardSize * cellSize + 1;
    grid.height = boardSize * cellSize + 1;

    ctx.strokeStyle = gridColor;
    ctx.translate(0.5, 0.5);
    ctx.clearRect(0, 0, grid.width, grid.height);

    for (var x = 0; x < boardSize; ++x) {
      var i = x;
      ctx.beginPath();
      ctx.moveTo(i * cellSize, 0);
      ctx.lineTo(i * cellSize, boardSize * cellSize);
      ctx.moveTo(0, i * cellSize);
      ctx.lineTo(boardSize * cellSize, i * cellSize);
      ctx.stroke();

      for (var y = 0; y < boardSize; ++y) {
        board.push(0);

        /* Calculate the indices for the cells that surround the current cell. */
        var o1 = (rowAbove * boardSize + colLeft);
        var o2 = (rowAbove * boardSize + col);
        var o3 = (rowAbove * boardSize + colRight);
        var o4 = (row * boardSize + colLeft);
        var o5 = (row * boardSize + colRight);
        var o6 = (rowBelow * boardSize + colLeft);
        var o7 = (rowBelow * boardSize + col);
        var o8 = (rowBelow * boardSize + colRight);

        /* Behaviour is a bit different if wrapping is enabled. */
        if (!wrap) {
          if (row == 0) {
            o1 = o2 = o3 = cellCount;
          }

          if ((row + 1) == boardSize) {
            o6 = o7 = o8 = cellCount;
          }

          if (col == 0) {
            o1 = o4 = o6 = cellCount;
          }

          if ((col + 1) == boardSize) {
            o3 = o5 = o8 = cellCount;
          }
        }

        /* Cache the indices in the 'offsets' map, to use later in populating 'cellList' with the
        cells we want to evaluate on the next generation. */
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
    offsets[cellCount] =
      [cellCount, cellCount, cellCount, cellCount, cellCount, cellCount, cellCount, cellCount];

    i = x;
    ctx.beginPath();
    ctx.moveTo(i * cellSize, 0);
    ctx.lineTo(i * cellSize, boardSize * cellSize);
    ctx.moveTo(0, i * cellSize);
    ctx.lineTo(boardSize * cellSize, i * cellSize);
    ctx.stroke();

    /* Draw the live cells on the board and store them in 'liveTracker' */
    liveTracker = [];
    var pairs = init.split(";");

    if (pairs && pairs.length) {
      for (var item in pairs) {
        var pair = pairs[item].split(",");

        if (pair) {
          var x = +pair[0];
          var y = +pair[1];

          if (x >= 0 && x < boardSize && y >= 0 && y < boardSize) {
            var offset = y * boardSize + x;
            board[offset] = 1;
            liveTracker.push(offset);
            drawCell(x, y, 1);
          }
        }
      }
    }

    liveTracker.sort();

    /* Populate the 'cellList' map with the cells that should be evaluated on the next generation. */
    for (var i = 0; i < liveTracker.length; ++i) {
      var offset = liveTracker[i];
      cellList[offset] = 0;
      cellList[offsets[offset][0]] = 0;
      cellList[offsets[offset][1]] = 0;
      cellList[offsets[offset][2]] = 0;
      cellList[offsets[offset][3]] = 0;
      cellList[offsets[offset][4]] = 0;
      cellList[offsets[offset][5]] = 0;
      cellList[offsets[offset][6]] = 0;
      cellList[offsets[offset][7]] = 0;
    }

    updateInit();
  };

  /* Prepare the game for generating new boards based on previous state. */
  var preGen = function () {
    speed = +ticksInput.value;

    temp = boardSize;
    boardSize = +boardSizeInput.value;

    if (!boardSize) {
      boardSize = temp;
      boardSizeInput.value = temp;
    }

    cellCount = boardSize * boardSize

    temp = cellSize;
    cellSize = +cellSizeInput.value;

    if (!cellSize) {
      cellSize = temp;
      cellSizeInput.value = temp;
    }

    initializeBoard();
    startLink = generateLinkWithoutInit() + "&init=";
  };

  /* This array determines the rules of the game. Each index in the array corresponds to a number
  of live cells surrounding the cell being evaluated. At each index is a function that returns if
  the cell should live or die. */
  var cellCountResults = [
    function () { return 0; },          // 0 live cells surrounding the current cell
    function () { return 0; },          // 1 live cells surrounding the current cell
    function (cell) { return cell; },   // 2 live cells surrounding....
    function () { return 1; },          // 3 live cells....
    function () { return 0; },          // 4
    function () { return 0; },          // 5
    function () { return 0; },          // 6
    function () { return 0; },          // 7
    function () { return 0; }           // 8
  ];

  /* Calculate the next generation based on the current state of the board. This is the main
  game function, so it must be the most highly optimized path. */
  var generation = function () {
    startGen = performance.now();
    var newBoard = [];
    var newLiveTracker = [];
    var newCellList = {};
    var newCell = 0;

    init = "";

    /* Copy any interesting cells that happened as a result of a click before this generation. */
    for (var cell in tempCellList) {
      cellList[cell] = 0;
    }

    tempCellList = {};

    /* Walk through the "interesting" cells, which are the cells that are adjacent to only live
    cells. This way, areas of empty cells are never evaluated, since they'd be dead anyway. */
    for (var cell in cellList) {
      const position = +cell;
      var offsetArr = offsets[position];

      /* How many live cells surround the current cell? */
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

      /* Call the appropriate rule function indexed by the number of live cells nearby. */
      newCell = cellCountResults[liveCount](board[position]);

      /* If the current cell OR the new cell is live... */
      if (board[position] || newCell) {
        var x = position % boardSize;
        var y = Math.floor(position / boardSize);

        if (newCell) {
          newLiveTracker.push(position);
          init += x + "," + y + ";"; /* Add cell to init parameter of URL that points to the current state. */
        }

        /* Only redraw the cell if the state changed from the previous generation. */
        if (board[position] != newCell) {
          drawCell(x, y, newCell);
        }

        /* Add this cell and the surrounding cells to the list of cells that should be evaluated in
        the next generation. */
        newCellList[i] = 0;
        newCellList[offsetArr[0]] = 0;
        newCellList[offsetArr[1]] = 0;
        newCellList[offsetArr[2]] = 0;
        newCellList[offsetArr[3]] = 0;
        newCellList[offsetArr[4]] = 0;
        newCellList[offsetArr[5]] = 0;
        newCellList[offsetArr[6]] = 0;
        newCellList[offsetArr[7]] = 0;

        /* Update the board for the new generation. */
        newBoard[position] = newCell;
      }
    }

    /* Store the results of this generation for the next evaluation. */
    board = newBoard;
    liveTracker = newLiveTracker;
    cellList = newCellList;
    board[cellCount] = 0;

    /* Report how many milliseconds this generation took to run. */
    generationRate.innerText = (performance.now() - startGen).toFixed(3);
  };

  var updateStats = function () {
    generationStat.innerText = ++generationCount;
    liveStat.innerText = liveTracker.length;
    currentState.href = startLink + init;

    if (saveHistory) {
      window.history.pushState("", "", currentState.href);
    }
  };

  var run = function () {
    generation();
    updateStats();
    intervalID = setTimeout(run, speed);
  };

  startButton.onclick = function () {
    this.disabled = true;
    stopButton.disabled = false;
    stepButton.disabled = true;
    ticksInput.disabled = true;
    boardSizeInput.disabled = true;
    cellSizeInput.disabled = true;
    wrapCheck.disabled = true;
    saveHistoryCheck.disabled = true;

    preGen();
    run();
  };

  stopButton.onclick = function () {
    clearInterval(intervalID);
    this.disabled = true;
    stepButton.disabled = false;
    startButton.disabled = false;
    ticksInput.disabled = false;
    boardSizeInput.disabled = false;
    cellSizeInput.disabled = false;
    wrapCheck.disabled = false;
    saveHistoryCheck.disabled = (document.origin == "null");
  };

  stepButton.onclick = function () {
    preGen();
    generation();
    updateStats();
  };

  wrapCheck.onchange = function () {
    wrap = wrapCheck.checked;
  };

  saveHistoryCheck.onchange = function () {
    if (document.origin == "null") {
      saveHistory = false;
      saveHistoryCheck.checked = false;
      saveHistoryCheck.disabled = true;
    }
    else {
      saveHistory = saveHistoryCheck.checked;
      updateHistory();

      if (!saveHistory) {
        window.history.replaceState("", "", currentState.href);
      }
    }
  };

  stopButton.disabled = true;
  grid.onclick = onCanvasClick;
  grid.ondblclick = onCanvasClick;

  /* Read the URL parameters and update the defaults used to set up the game. */
  var parseParams = function () {
    var search = /([^&=]+)=?([^&]*)/g;
    var decode = function (s) { return decodeURIComponent(s.replace(/\+/g, " ")); };
    var query = window.location.search.substring(1);
    var match = null;
    var urlParams = {};

    while (match = search.exec(query)) {
      urlParams[decode(match[1])] = decode(match[2]);
    }

    return urlParams;
  };

  var getStateFromParams = function () {
    var urlParams = parseParams();
    boardSize = +(urlParams.boardSize) || boardSize;
    max = boardSize - 1;
    cellSize = +(urlParams.cellSize) || cellSize;
    cellCount = boardSize * boardSize

    if (urlParams.hasOwnProperty("init")) {
      init = urlParams.init;
      init = init.replace(/\s/g, '');
    }

    if (urlParams.hasOwnProperty("speed")) {
      speed = +(urlParams.speed);
    }

    if (urlParams.saveHistory && (urlParams.saveHistory == "1" || urlParams.saveHistory == "true")) {
      saveHistory = true;
    }

    if (urlParams.wrap && (urlParams.wrap == "0" || urlParams.wrap == "false")) {
      wrap = false;
    }
  };

  /* Initialize the page to reflect the starting state. */
    window.onpopstate = function () {
    getStateFromParams();
    initializeBoard();
    ticksInput.value = speed; // How many milliseconds to spawn the last generation
    boardSizeInput.value = boardSize;
    cellSizeInput.value = cellSize;
    wrapCheck.checked = wrap;
    saveHistoryCheck.checked = saveHistory;
    updateLink();
  };

  window.onpopstate();
  initialState.href = generateLink();

  if (document.origin == "null") {
    saveHistory = false;
    saveHistoryCheck.checked = false;
    saveHistoryCheck.disabled = true;
  }
}, false);
