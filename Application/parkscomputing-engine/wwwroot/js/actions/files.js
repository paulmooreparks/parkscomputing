/* Files' actions (js/actions/files.json), run by the action broker
   (js/applet-actions.js) through the file services it gives an action that
   declares files.read or files.write. browse is Files' verb, which the
   broker carries out itself. */
(function () {
    'use strict';

    window.pcActions.provide('parks.files', {
        'list@1': async function (input, ctx) {
            var at = await ctx.files.stat(input.path);
            if (!at) { throw new Error(input.path + ': no such file or directory'); }
            return { output: { path: at.path, entries: await ctx.files.list(input.path) } };
        },
        'read@1': async function (input, ctx) {
            var at = await ctx.files.stat(input.path);
            if (!at) { throw new Error(input.path + ': no such file or directory'); }
            return { output: { path: at.path, text: String(await ctx.files.read(input.path)) } };
        },
        'write@1': async function (input, ctx) {
            var e = await ctx.files.write(input.path, input.text, !!input.append);
            var out = { path: e.path };
            if (e.size != null) { out.size = e.size; }
            return { output: out };
        }
    });
})();
