/* Text comparison, shared by the diff viewer (js/diff.js) and the file
   history (Architecture/applet-roadmap.md). Lines are compared with Myers'
   O(ND) algorithm ("An O(ND) Difference Algorithm and Its Variations",
   1986), after the lines the two texts share at the start and the end are
   set aside, and a changed line paired with the line that replaced it is
   compared again word by word.

     pcTextDiff.lines(a, b, { ignoreWhitespace }) -> {
         rows: [{ op: '=' | '-' | '+', a: line number or null,
                  b: line number or null, text, words? }],
         added, removed, same: true when nothing differs,
         gaveUp: true when the texts differ too much to align }
     pcTextDiff.split(text) -> the lines of a text

   Line numbers count from 1. A row's words, on a removed or added line
   that has a partner, are [{ text, changed }], the pieces of that line in
   order. Two texts that differ in more than LIMIT places are not aligned
   line by line: every line of the first is removed and every line of the
   second added, and gaveUp says so. */
(function () {
    'use strict';
    if (window.pcTextDiff) { return; }

    /* The alignment keeps one frontier per edit, so its memory grows with
       the square of the edits; past this many it gives up. */
    var LIMIT = 2000;

    function split(text) {
        text = String(text == null ? '' : text);
        if (text === '') { return []; }
        var lines = text.split(/\r\n|\r|\n/);
        /* A final line ending ends the last line; it does not start one. */
        if (lines.length > 1 && lines[lines.length - 1] === '') { lines.pop(); }
        return lines;
    }

    /* The shortest edit script from a to b, compared by key, as a list of
       '=', '-' and '+'; or null when it would take more than limit edits. */
    function myers(a, b, limit) {
        var n = a.length, m = b.length, max = n + m, off = max + 1;
        var v = new Int32Array(2 * max + 3), trace = [];
        v[off + 1] = 0;
        for (var d = 0; d <= max; d++) {
            if (d > limit) { return null; }
            trace.push(v.slice(off - d - 1, off + d + 2));
            for (var k = -d; k <= d; k += 2) {
                var x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
                var y = x - k;
                while (x < n && y < m && a[x] === b[y]) { x++; y++; }
                v[off + k] = x;
                if (x >= n && y >= m) { return backtrack(trace, n, m); }
            }
        }
        return backtrack(trace, n, m);
    }

    /* Walks the saved frontiers back from the end, one edit at a time. */
    function backtrack(trace, n, m) {
        var ops = [], x = n, y = m;
        for (var d = trace.length - 1; d >= 0; d--) {
            var vd = trace[d], base = d + 1, k = x - y;
            var at = function (kk) { return vd[base + kk]; };
            var prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
            var prevX = d === 0 ? 0 : at(prevK), prevY = prevX - prevK;
            while (x > prevX && y > prevY) { ops.push('='); x--; y--; }
            if (d > 0) { ops.push(x === prevX ? '+' : '-'); x = prevX; y = prevY; }
        }
        while (x > 0 && y > 0) { ops.push('='); x--; y--; }
        return ops.reverse();
    }

    function keyOf(line, ignoreWhitespace) { return ignoreWhitespace ? line.replace(/\s+/g, ' ').trim() : line; }

    /* A line in words, spaces and marks, so a changed line shows which of
       them changed. */
    function tokens(line) { return line.match(/\w+|\s+|[^\w\s]/g) || []; }

    function words(oldLine, newLine) {
        var a = tokens(oldLine), b = tokens(newLine), ops = myers(a, b, 400);
        if (!ops) { return null; }
        var outA = [], outB = [], i = 0, j = 0;
        function push(list, text, changed) {
            var last = list[list.length - 1];
            if (last && last.changed === changed) { last.text += text; } else { list.push({ text: text, changed: changed }); }
        }
        ops.forEach(function (op) {
            if (op === '=') { push(outA, a[i++], false); push(outB, b[j++], false); }
            else if (op === '-') { push(outA, a[i++], true); }
            else { push(outB, b[j++], true); }
        });
        return [outA, outB];
    }

    function lines(textA, textB, opts) {
        opts = opts || {};
        var a = split(textA), b = split(textB), ws = !!opts.ignoreWhitespace;
        var ka = a.map(function (l) { return keyOf(l, ws); }), kb = b.map(function (l) { return keyOf(l, ws); });

        var head = 0;
        while (head < a.length && head < b.length && ka[head] === kb[head]) { head++; }
        var tail = 0;
        while (tail < a.length - head && tail < b.length - head && ka[a.length - 1 - tail] === kb[b.length - 1 - tail]) { tail++; }

        var midA = ka.slice(head, a.length - tail), midB = kb.slice(head, b.length - tail);
        var ops = myers(midA, midB, LIMIT), gaveUp = false;
        if (!ops) {
            gaveUp = true;
            ops = midA.map(function () { return '-'; }).concat(midB.map(function () { return '+'; }));
        }

        var rows = [], i = 0, j = 0, added = 0, removed = 0;
        for (var h = 0; h < head; h++) { rows.push({ op: '=', a: i + 1, b: j + 1, text: b[j] }); i++; j++; }
        ops.forEach(function (op) {
            if (op === '=') { rows.push({ op: '=', a: i + 1, b: j + 1, text: b[j] }); i++; j++; }
            else if (op === '-') { rows.push({ op: '-', a: i + 1, b: null, text: a[i] }); i++; removed++; }
            else { rows.push({ op: '+', a: null, b: j + 1, text: b[j] }); j++; added++; }
        });
        for (var t = 0; t < tail; t++) { rows.push({ op: '=', a: i + 1, b: j + 1, text: b[j] }); i++; j++; }

        /* In each run of removed lines followed by added ones, the first of
           each are partners, the second of each, and so on; partners are
           compared word by word. */
        for (var r = 0; r < rows.length;) {
            if (rows[r].op !== '-') { r++; continue; }
            var del = r;
            while (r < rows.length && rows[r].op === '-') { r++; }
            var add = r;
            while (r < rows.length && rows[r].op === '+') { r++; }
            for (var p = 0; p < Math.min(add - del, r - add); p++) {
                var w = words(rows[del + p].text, rows[add + p].text);
                if (w) { rows[del + p].words = w[0]; rows[add + p].words = w[1]; }
            }
        }

        return { rows: rows, added: added, removed: removed, same: added === 0 && removed === 0, gaveUp: gaveUp };
    }

    window.pcTextDiff = { lines: lines, split: split };
})();
