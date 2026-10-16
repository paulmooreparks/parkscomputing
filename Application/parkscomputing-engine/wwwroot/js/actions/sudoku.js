/* Sudoku's actions (js/actions/sudoku.json), run by the action broker
   (js/applet-actions.js) without Sudoku's window. The search is the
   applet's (js/sudoku.js, solution()), stopping at a second solution,
   with the emptiest-choice cell tried first, which keeps a hard puzzle
   from taking seconds. */
(function () {
    'use strict';

    function solve(input) {
        var grid = input.puzzle.split('').map(function (c) { return c === '.' ? 0 : +c; });
        var rows = new Array(9).fill(0), cols = new Array(9).fill(0), boxes = new Array(9).fill(0);
        function box(i) { return Math.floor(Math.floor(i / 9) / 3) * 3 + Math.floor(i % 9 / 3); }
        /* Clues that already repeat a number have no solution. */
        for (var i = 0; i < 81; i++) {
            var n = grid[i];
            if (!n) { continue; }
            var bit = 1 << n, r = Math.floor(i / 9), c = i % 9, b = box(i);
            if ((rows[r] | cols[c] | boxes[b]) & bit) { return { output: { solutions: 'none', solution: null } }; }
            rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
        }
        var found = null, count = 0;
        function search() {
            if (count > 1) { return; }
            var best = -1, bestFree = 0, bestCount = 10;
            for (var j = 0; j < 81; j++) {
                if (grid[j]) { continue; }
                var free = ~(rows[Math.floor(j / 9)] | cols[j % 9] | boxes[box(j)]) & 0x3fe, k = 0;
                for (var f = free; f; f &= f - 1) { k++; }
                if (k < bestCount) { best = j; bestFree = free; bestCount = k; if (!k) { return; } }
            }
            if (best < 0) {
                count++;
                if (count === 1) { found = grid.join(''); }
                return;
            }
            var br = Math.floor(best / 9), bc = best % 9, bb = box(best);
            for (var d = 1; d <= 9 && count <= 1; d++) {
                var m = 1 << d;
                if (!(bestFree & m)) { continue; }
                grid[best] = d; rows[br] |= m; cols[bc] |= m; boxes[bb] |= m;
                search();
                grid[best] = 0; rows[br] &= ~m; cols[bc] &= ~m; boxes[bb] &= ~m;
            }
        }
        search();
        return { output: { solutions: count === 0 ? 'none' : count === 1 ? 'one' : 'many', solution: count === 1 ? found : null } };
    }

    window.pcActions.provide('parks.sudoku', { 'solve@1': solve });
})();
