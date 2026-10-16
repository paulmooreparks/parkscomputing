/* Dice's actions (js/actions/dice.json), run by the action broker
   (js/applet-actions.js) without Dice's window. */
(function () {
    'use strict';

    /* A fair value from 1 to sides: random words at or above the largest
       multiple of sides are drawn again, so no face is favoured. */
    function face(sides) {
        var limit = Math.floor(0x100000000 / sides) * sides, word = new Uint32Array(1);
        do { crypto.getRandomValues(word); } while (word[0] >= limit);
        return 1 + word[0] % sides;
    }

    function roll(input) {
        var dice = input.dice || 2, sides = input.sides || 6, values = [];
        for (var i = 0; i < dice; i++) { values.push(face(sides)); }
        return { output: { values: values, total: values.reduce(function (a, b) { return a + b; }, 0) } };
    }

    window.pcActions.provide('parks.dice', { 'roll@1': roll });
})();
