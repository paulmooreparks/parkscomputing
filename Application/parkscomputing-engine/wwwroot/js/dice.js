/* Dice: rolls up to three dice. Its commands are its menu in PUDL's menu
   bar, which it gives through menus(): its own name, Roll and Set, and
   Show the total under the site's View while it is in front. The Roll
   button and the R key roll as well. */
(function () {
    'use strict';

    var FACES = ['\u2680', '\u2681', '\u2682', '\u2683', '\u2684', '\u2685'];

    function init(root) {
        var count = 2, showTotal = true, hold = false, values = [1, 1, 1], history = [];
        root.classList.add('pc-dice');
        root.tabIndex = -1;
        root.innerHTML =
            '<div class="dice-tray" role="img"></div>' +
            '<p class="dice-total"></p>' +
            '<button type="button" class="btn btn-primary dice-roll">Roll</button>' +
            '<p class="dice-history"></p>' +
            '<p class="dice-status" role="status" aria-live="polite"></p>' +
            '<dialog class="dialog dice-about" aria-labelledby="dice-about-title">' +
            '<h3 class="dialog-title" id="dice-about-title">About Dice</h3>' +
            '<div class="dialog-body"><p>Dice rolls up to three dice. Press Roll, or R, to roll them, and Shift+R to roll ten times. ' +
            'The Set menu chooses how many dice there are and can hold the first one, and Show the total is under View.</p></div>' +
            '<div class="dialog-actions"><button type="button" class="btn btn-primary" data-dice="about-close">Close</button></div>' +
            '</dialog>';
        var tray = root.querySelector('.dice-tray'), total = root.querySelector('.dice-total');
        var hist = root.querySelector('.dice-history'), status = root.querySelector('.dice-status');
        var about = root.querySelector('.dice-about');

        function draw() {
            var shown = values.slice(0, count);
            tray.innerHTML = shown.map(function (v) { return '<span class="dice-die" aria-hidden="true">' + FACES[v - 1] + '</span>'; }).join('');
            tray.setAttribute('aria-label', 'Dice showing ' + shown.join(', '));
            total.hidden = !showTotal;
            total.textContent = 'Total ' + shown.reduce(function (a, b) { return a + b; }, 0);
            hist.textContent = history.length ? 'Earlier: ' + history.slice(-10).join(', ') : '';
        }

        function roll(times) {
            for (var t = 0; t < times; t++) {
                for (var i = 0; i < 3; i++) { if (!(hold && i === 0)) { values[i] = 1 + Math.floor(Math.random() * 6); } }
                history.push(values.slice(0, count).reduce(function (a, b) { return a + b; }, 0));
            }
            draw();
            status.textContent = times === 1 ? 'Rolled.' : 'Rolled ' + times + ' times.';
        }

        root.querySelector('.dice-roll').addEventListener('click', function () { roll(1); });
        root.querySelector('[data-dice="about-close"]').addEventListener('click', function () { about.close(); });
        /* A press on the tray puts focus in the applet, so its shortcuts work. */
        root.addEventListener('pointerdown', function (e) { if (!e.target.closest('button, dialog')) { root.focus(); } });

        function menus() {
            var counts = [[1, 'One die'], [2, 'Two dice'], [3, 'Three dice']];
            return {
                titles: [
                    { label: 'Dice', items: window.pcAppletIdentity(root, [{ label: 'About Dice', run: function () { about.showModal(); } }]) },
                    {
                        label: 'Roll', items: [
                            { label: 'Roll', shortcut: 'R', run: function () { roll(1); } },
                            { label: 'Roll ten times', shortcut: 'Shift+R', run: function () { roll(10); } },
                            '-',
                            { label: 'Clear the history', disabled: !history.length, run: function () { history = []; draw(); status.textContent = 'Cleared the history.'; } }
                        ]
                    },
                    {
                        label: 'Set', items: counts.map(function (c) {
                            return { label: c[1], radio: 'count', checked: count === c[0], run: function () { count = c[0]; draw(); } };
                        }).concat(['-',
                            { label: 'Hold the first die', checked: hold, run: function () { hold = !hold; status.textContent = hold ? 'The first die is held.' : 'The first die rolls again.'; } }
                        ])
                    }
                ],
                into: {
                    view: [{ label: 'Show the total', checked: showTotal, run: function () { showTotal = !showTotal; draw(); } }]
                }
            };
        }

        draw();

        return {
            menus: menus,
            destroy: function () { if (about.open) { about.close(); } }
        };
    }

    window.pudlApplets.register('dice', { init: init });
})();
