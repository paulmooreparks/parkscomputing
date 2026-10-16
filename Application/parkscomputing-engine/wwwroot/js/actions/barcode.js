/* The Barcode Tool's actions (js/actions/barcode.json), run by the action
   broker (js/applet-actions.js) without the tool's window. generate and
   interpret are GK Companion's barcode commands (vendor/barcode/
   barcode-commands.js there), over the same engine the tool uses,
   js/barcode-engine.js, which loads here beside the module with the
   module's own version. */
(function () {
    'use strict';

    /* The module's own stamp, read while it loads. */
    var stamp = document.currentScript ? new URL(document.currentScript.src).search : '';
    var engine = null;
    function ready(ctx) {
        if (!engine) {
            engine = (window.qrcodegen ? Promise.resolve() : ctx.load('../vendor/qrcodegen-1.8.0.js'))
                .then(function () { return window.pcBarcode ? null : ctx.load('../barcode-engine.js' + stamp); })
                .then(function () { return window.pcBarcode; }, function (err) { engine = null; throw err; });
        }
        return engine;
    }

    function evaluate(B, input) {
        var def = B.symbologies[input.symbology];
        if (!def) { throw new Error('Choose a supported barcode format.'); }
        var options = input.options || {};
        Object.keys(options).forEach(function (key) {
            if ((def.options || []).indexOf(key) < 0) { throw new Error(key + ' is not an option for ' + input.symbology + '.'); }
        });
        return B.encode(input.symbology, input.data, options);
    }

    async function generate(input, ctx) {
        var B = await ready(ctx), result = evaluate(B, input);
        if (!result.ok) { throw new Error(result.error + (result.fix ? ' Suggested correction: ' + result.fix : '')); }
        var symbol = result.symbol, options = Object.assign({}, input.render || {});
        if (Object.prototype.hasOwnProperty.call(options, 'hri')) {
            symbol = Object.assign({}, symbol, { hri: options.hri, hriMap: null, textMode: 'center' });
            delete options.hri;
        }
        options.moduleMM = input.moduleMM === undefined ? 0.33 : input.moduleMM;
        if (input.showText !== undefined) { options.showText = input.showText; }
        if (input.highlights) { options.bands = (options.bands || []).concat(B.roleBands(symbol, input.highlights)); }
        var geometry = B.geometry(symbol, options);
        return {
            output: { symbology: input.symbology, data: symbol.data, widthMM: geometry.width * options.moduleMM, heightMM: geometry.height * options.moduleMM },
            artifacts: [{
                key: 'image', mime: 'image/svg+xml', data: B.toSVG(symbol, options),
                name: (input.symbology + '-' + (symbol.data || 'barcode')).replace(/[^A-Za-z0-9-]+/g, '_').slice(0, 60) + '.svg'
            }]
        };
    }

    async function interpret(input, ctx) {
        var B = await ready(ctx);
        return { output: { matches: B.identify(input.data) } };
    }

    window.pcActions.provide('parks.barcode', { 'generate@1': generate, 'interpret@1': interpret });
})();
