// Checks for the site's text comparison (wwwroot/js/textdiff.js), which the
// diff viewer and the file history share. The live web root is not in this
// repository, so the script is given it:
//
//   node Tools/test-textdiff.js <path to wwwroot>
//
// It loads the file into Node with a stand-in window, prints each check, and
// exits non-zero if any fails.
const path = require('node:path');
const root = process.argv[2];
if (!root) { console.error('usage: node Tools/test-textdiff.js <path to wwwroot>'); process.exit(2); }
global.window = {};
require(path.resolve(root, 'js', 'textdiff.js'));
const D = window.pcTextDiff;
let fail = 0;
function check(name, got, want) {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g !== w) { fail++; console.log('FAIL', name, '\n  got ', g, '\n  want', w); } else { console.log('ok  ', name); }
}
const ops = r => r.rows.map(x => x.op + (x.a || '_') + ',' + (x.b || '_')).join(' ');

check('split', [D.split('a\nb\n'), D.split('a\r\nb'), D.split(''), D.split('\n')], [['a', 'b'], ['a', 'b'], [], ['']]);
check('same', D.lines('a\nb\nc', 'a\nb\nc').same, true);
check('insert', ops(D.lines('a\nc', 'a\nb\nc')), '=1,1 +_,2 =2,3');
check('delete', ops(D.lines('a\nb\nc', 'a\nc')), '=1,1 -2,_ =3,2');
check('replace', ops(D.lines('a\nb\nc', 'a\nX\nc')), '=1,1 -2,_ +_,2 =3,3');
check('empty to text', ops(D.lines('', 'x\ny')), '+_,1 +_,2');
check('text to empty', ops(D.lines('x\ny', '')), '-1,_ -2,_');
check('counts', (r => [r.added, r.removed])(D.lines('a\nb\nc\nd', 'a\nB\nc\nd\ne')), [2, 1]);
check('ignore spaces', D.lines('a  b\n\tc', 'a b\nc', { ignoreWhitespace: true }).same, true);
check('spaces matter', D.lines('a  b', 'a b').same, false);
const w = D.lines('the quick brown fox', 'the slow brown fox').rows;
check('words', w.map(r => (r.words || []).filter(x => x.changed).map(x => x.text)), [['quick'], ['slow']]);

// The example in Myers' paper: ABCABBA to CBABAC takes five edits.
const m = D.lines('A\nB\nC\nA\nB\nB\nA', 'C\nB\nA\nB\nA\nC');
check('myers example', m.added + m.removed, 5);

// Every line of each text appears once, in order, and the rows rebuild the second text.
const big = Array.from({ length: 300 }, (_, i) => 'line ' + i);
const big2 = big.filter((_, i) => i % 7 !== 0).map((l, i) => i % 11 === 0 ? l + ' changed' : l);
const r = D.lines(big.join('\n'), big2.join('\n'));
check('first text in order', r.rows.filter(x => x.a).map(x => x.a).every((v, i) => v === i + 1), true);
check('second text in order', r.rows.filter(x => x.b).map(x => x.b).every((v, i) => v === i + 1), true);
check('rows rebuild the second text', r.rows.filter(x => x.op !== '-').map(x => x.text).join('\n'), big2.join('\n'));

// Texts with nothing in common past the limit are shown whole, and say so.
const many = p => Array.from({ length: 5000 }, (_, i) => p + i).join('\n');
check('gives up past the limit', D.lines(many('a'), many('b')).gaveUp, true);

console.log(fail ? fail + ' failed' : 'all passed');
process.exit(fail ? 1 : 0);
