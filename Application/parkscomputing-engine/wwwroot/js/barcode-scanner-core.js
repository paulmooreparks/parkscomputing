/* Scanner interpretation stays independent of camera and DOM APIs. */
(function (global) {
    'use strict';
    var formats = { EAN13: 'ean13', EAN8: 'ean8', UPCA: 'upca', UPCE: 'upce',
        Code128: 'code128', Code39: 'code39', Code39Std: 'code39', Code39Ext: 'code39',
        ITF: 'itf', ITF14: 'itf14', Codabar: 'codabar', QRCode: 'qr', QRCodeModel2: 'qr' };

    function visible(text) {
        return String(text).replace(/[\x00-\x1f\x7f]/g, function (c) {
            return ({ 9: '<TAB>', 10: '<LF>', 13: '<CR>', 29: '<GS>' })[c.charCodeAt(0)] ||
                '<0x' + c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase() + '>';
        });
    }

    function gs1Input(raw, B) {
        var pos = 0, parts = [];
        while (pos < raw.length) {
            if (raw[pos] === '\x1d') { throw new Error('Unexpected GS separator at character ' + (pos + 1) + '.'); }
            var ai, info;
            for (var n = 2; n <= 4; n++) {
                ai = raw.slice(pos, pos + n); info = B.gs1.aiInfo(ai);
                if (info) { break; }
            }
            if (!info) { throw new Error('Unknown GS1 Application Identifier at character ' + (pos + 1) + '.'); }
            pos += ai.length;
            var end = info.fixed ? pos + info.len : raw.indexOf('\x1d', pos);
            if (end < 0) { end = raw.length; }
            var value = raw.slice(pos, end);
            if (end > raw.length || value.indexOf('\x1d') >= 0 || /[()]/.test(value)) {
                throw new Error('AI (' + ai + ') cannot be represented by the layout reader. Check its length and separators.');
            }
            parts.push('(' + ai + ')' + value);
            pos = end;
            if (raw[pos] === '\x1d') { pos++; }
        }
        var result = parts.join(''), parsed = B.gs1.parse(result);
        if (!parsed.ok) { throw new Error(parsed.error); }
        return result;
    }

    function inspect(capture, layouts, selected, B) {
        var raw = String(capture.text || ''), text = raw, format = capture.format || '',
            aim = capture.symbologyIdentifier || '', issues = [], matches = [];
        if (capture.source === 'text' && /^\][A-Za-z][0-9]/.test(text)) {
            aim = text.slice(0, 3); text = text.slice(3);
        }
        var sym = formats[format] || format;
        if (aim === ']C1') { sym = 'gs1-128'; }
        else if (!sym && aim === ']C0') { sym = 'code128'; }
        if (!sym && capture.source === 'text' && /^\([0-9]{2,4}\)/.test(text)) { sym = 'gs1-128'; }
        var gs1 = sym === 'gs1-128' || capture.contentType === 'GS1';
        try {
            if (!raw) { throw new Error('Enter or scan a barcode.'); }
            if (capture.isValid === false) { throw new Error(capture.error || 'The decoder reported an invalid symbol.'); }
            if (gs1) {
                if (capture.source === 'text' && text[0] === '(') {
                    var parsed = B.gs1.parse(text); if (!parsed.ok) { throw new Error(parsed.error); }
                } else { text = gs1Input(text, B); }
            } else if (/\s/.test(text) && (!sym || /^(ean13|ean8|upca|upce|itf|itf14|codabar)$/.test(sym))) {
                throw new Error('Whitespace is present in the captured value. It has not been removed.');
            }
            var candidates = layouts.filter(function (L) { return !selected || L.id === selected; });
            if (selected && !candidates.length) { throw new Error('The selected layout is not in this browser. Import it or choose another layout.'); }
            candidates.forEach(function (L) {
                var input = text, equivalent = false;
                // GS1 permits UPC-A to be reported with an implied leading zero.
                // Keep the capture intact and adapt only the layout-reader input.
                if (sym === 'ean13' && L.symbology === 'upca' && /^0[0-9]{12}$/.test(text)) {
                    input = text.slice(1); equivalent = true;
                } else if (sym === 'upca' && L.symbology === 'ean13' && /^[0-9]{12}$/.test(text)) {
                    input = '0' + text; equivalent = true;
                }
                if (sym && L.symbology !== sym && !equivalent && !(sym === 'itf' && L.symbology === 'itf14')) { return; }
                var match = B.layouts.interpret(L, input, { preserveWhitespace: true });
                if (match && equivalent) { match.normalization = 'UPC-A and its EAN-13 representation differ by an implied leading zero. The raw scan above is unchanged.'; }
                if (match) { matches.push(match); }
            });
            if (!matches.length) { issues.push(selected ? 'The selected layout does not match this format, length or fixed fields.' : 'No available layout matches this value.'); }
        } catch (e) { issues.push(e.message); }
        return { raw: raw, input: text, symbology: sym, aim: aim, matches: matches, issues: issues };
    }
    global.pcBarcodeScanner = { visible: visible, inspect: inspect, gs1Input: gs1Input };
})(typeof window !== 'undefined' ? window : globalThis);
