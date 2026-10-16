/* The page's own actions (js/actions/page.json): a notice for the person at
   the page, and a question only they can answer, which the action broker
   (js/applet-actions.js) puts to them as a dialog. */
(function () {
    'use strict';

    window.pcActions.provide('parks.page', {
        'notify@1': async function (input, ctx) {
            await ctx.notify(input.text, input.kind || 'info');
            return { output: { shown: true } };
        },
        'ask@1': function (input) {
            return { output: {}, request: { title: input.title, body: input.body || '', fields: input.fields || [] } };
        }
    });
})();
