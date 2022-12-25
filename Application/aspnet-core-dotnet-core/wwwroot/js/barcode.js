﻿/* This method formats a string using a supplied format string and a
variable number of parameters. It is based on the ECMA CLR (common-
language runtime) class System.String's static method Format. */

/* This function becomes a static method of the String object. */
String.format = function (formatString) {
    if (arguments.length < 2) {
        return formatString;
    }

    /* Each JavaScript function has an implicit object named arguments that is
    an array of the parameters passed to the function each time it is called.
    The following line makes a reference to the arguments object so that it can
    be used by the lambda function passed to the replace method, since it will
    be available in the lambda's lexical scope. */
    var replArray = arguments;

    /* Perform a regular-expression replacement of format placeholders. The
    second parameter is a lambda function that is called on each regex match and
    returns the appropriate replacement value. For example, {0} should be replaced
    by element 1 in the replArray array, {1} by element 2, and so on. */
    return formatString.replace(
        /\{(\d+)\}/g,
        function (match, i) {
            /* The '+' prefix operator converts a string to a numeric value. */
            return replArray[+i + 1];
        }
    );
}


/* I found the information I needed to write this script in an article
on CodeProject (http://www.codeproject.com/csharp/EAN_13_Barcodes.asp) that
showed how to create a barcode in C#. The check-digit calculation is lifted
pretty much as-is from that article; the rest of the code is original. */

function createAttribute(name, value) {
    var attr = document.createAttribute(name);
    attr.nodeValue = value;
    return attr;
}

var getHostname = function (href) {
    var l = document.createElement("a");
    l.href = href;
    return l.hostname;
};

function BarCodeUI(nodeID) {
    var self = this;

    var codeDisplay = document.getElementById("codeDisplay").firstChild;
    var descDisplay = document.getElementById("descDisplay").firstChild;
    var credit = document.getElementById("credit");

    var urlParams;

    (window.onpopstate = function () {
        var match,
            pl = /\+/g,  // Regex for replacing addition symbol with a space
            search = /([^&=]+)=?([^&]*)/g,
            decode = function (s) { return decodeURIComponent(s.replace(pl, " ")); },
            query = window.location.search.substring(1);

        urlParams = {};
        while (match = search.exec(query))
            urlParams[decode(match[1])] = decode(match[2]);
    })();

    /* IDs of the HTML elements used to display the encoded digits. */
    var digits =
        [
            "",
            String.format("{0}_digit01", nodeID),
            String.format("{0}_digit02", nodeID),
            String.format("{0}_digit03", nodeID),
            String.format("{0}_digit04", nodeID),
            String.format("{0}_digit05", nodeID),
            String.format("{0}_digit06", nodeID),
            String.format("{0}_digit07", nodeID),
            String.format("{0}_digit08", nodeID),
            String.format("{0}_digit09", nodeID),
            String.format("{0}_digit10", nodeID),
            String.format("{0}_digit11", nodeID),
            String.format("{0}_digit12", nodeID)
        ];

    var _getParam = function (param) {
        if (urlParams && urlParams.hasOwnProperty(param)) {
            return urlParams[param];
        }
        return "";
    };

    var _setDigit = function (pos, pattern) {
        var digitNode = document.getElementById(digits[pos]);
        var bits = digitNode.getElementsByTagName("div");

        for (var j = 0; j < bits.length; ++j) {
            bits[j].setAttributeNode(
                createAttribute(
                    "class",
                    pattern[j] ? "bitOn" : "bitOff"
                )
            );
        }
    };


    var _displayLabels = function (code, desc) {
        codeDisplay.nodeValue = code;
        descDisplay.nodeValue = desc;

        if (getHostname(document.referrer) == "www.parkscomputing.com") {
            credit.style.visibility = "hidden";
        }
    };


    var _getCode = function () {
        var code = _getParam("code");

        if (!code || !code.length) {
            code = "000000000000"
        }

        return code;
    };


    var _getDesc = function () {
        var desc = _getParam("desc");

        if (!desc || !desc.length) {
            desc = ""
        }

        return desc;
    };

    var publicInterface = {
        getParam: _getParam,
        getCode: _getCode,
        getDesc: _getDesc,
        displayLabels: _displayLabels,
        setDigit: _setDigit
    };

    return publicInterface;
};

/* Define the application object. */
var EAN13Generator = function () {
    /* Bit patterns for digits. Each digit takes up seven lines in a
    barcode. A zero corresponds to a blank line, and a one corresponds to
    a filled line. */

    /* Odd-parity left-hand digits. */
    var odd =
        [
            [0, 0, 0, 1, 1, 0, 1], // 0
            [0, 0, 1, 1, 0, 0, 1], // 1
            [0, 0, 1, 0, 0, 1, 1], // 2
            [0, 1, 1, 1, 1, 0, 1], // 3
            [0, 1, 0, 0, 0, 1, 1], // 4
            [0, 1, 1, 0, 0, 0, 1], // 5
            [0, 1, 0, 1, 1, 1, 1], // 6
            [0, 1, 1, 1, 0, 1, 1], // 7
            [0, 1, 1, 0, 1, 1, 1], // 8
            [0, 0, 0, 1, 0, 1, 1]  // 9
        ];

    /* Even-parity left-hand digits. */
    var even =
        [
            [0, 1, 0, 0, 1, 1, 1], // 0
            [0, 1, 1, 0, 0, 1, 1], // 1
            [0, 0, 1, 1, 0, 1, 1], // 2
            [0, 1, 0, 0, 0, 0, 1], // 3
            [0, 0, 1, 1, 1, 0, 1], // 4
            [0, 1, 1, 1, 0, 0, 1], // 5
            [0, 0, 0, 0, 1, 0, 1], // 6
            [0, 0, 1, 0, 0, 0, 1], // 7
            [0, 0, 0, 1, 0, 0, 1], // 8
            [0, 0, 1, 0, 1, 1, 1]  // 9
        ];

    /* Right-hand digits. */
    var right =
        [
            [1, 1, 1, 0, 0, 1, 0], // 0
            [1, 1, 0, 0, 1, 1, 0], // 1
            [1, 1, 0, 1, 1, 0, 0], // 2
            [1, 0, 0, 0, 0, 1, 0], // 3
            [1, 0, 1, 1, 1, 0, 0], // 4
            [1, 0, 0, 1, 1, 1, 0], // 5
            [1, 0, 1, 0, 0, 0, 0], // 6
            [1, 0, 0, 0, 1, 0, 0], // 7
            [1, 0, 0, 1, 0, 0, 0], // 8
            [1, 1, 1, 0, 1, 0, 0]  // 9
        ];

    /* Digit parity is determined by the first digit of the code. This
    array corresponds to the possible values of the code and uses the
    parity tables described above. */
    var parity =
        [
            [odd, odd, odd, odd, odd, odd], // 0
            [odd, odd, even, odd, even, even], // 1
            [odd, odd, even, even, odd, even], // 2
            [odd, odd, even, even, even, odd], // 3
            [odd, even, odd, odd, even, even], // 4
            [odd, even, even, odd, odd, even], // 5
            [odd, even, even, even, odd, odd], // 6
            [odd, even, odd, even, odd, even], // 7
            [odd, even, odd, even, even, odd], // 8
            [odd, even, even, odd, even, odd]  // 9
        ];

    /* Public method that executes the script application. */
    var _generate = function (ui) {
        var retVal = 0;
        var code = ui.getCode();

        if (code.length < 12) {
            code = "000000000000".substr(0, 12 - code.length) + code;
        }

        if (code.length > 12) {
            code = code.substring(0, 12);
        }
        else if (code.length == 11) {
            code = "0" + code;
        }

        code = code + _calculateChecksumDigit(code);

        var parityDigit = parseInt(code.charAt(0));
        var parityTable = parity[parityDigit];

        for (var i = 1; i < code.length; ++i) {
            var num = +code.charAt(i);
            var pattern = null; // parityTable[0][0];

            if (i < 7) {
                pattern = parityTable[i - 1][num];
            }
            else {
                pattern = right[num];
            }

            ui.setDigit(i, pattern);
        }

        ui.displayLabels(code, ui.getDesc());

        return retVal;
    };

    /* As mentioned above, this was borrowed from
    http://www.codeproject.com/csharp/EAN_13_Barcodes.asp */
    var _calculateChecksumDigit = function (code) {
        var sum = 0;
        var digit = 0;

        /* Calculate the checksum digit here. */
        for (var i = code.length; i >= 1; --i) {
            digit = parseInt(code.substring(i - 1, i));

            /* This appears to be backwards but the EAN-13 checksum must be calculated
            this way to be compatible with UPC-A. */
            if (i % 2 == 0) {   /* odd */
                sum += digit * 3;
            }
            else {   /* even */
                sum += digit * 1;
            }
        }

        var checkSum = (10 - (sum % 10)) % 10;
        return checkSum;
    };

    var publicInterface = {
        generate: _generate,
        calculateChecksumDigit: _calculateChecksumDigit
    };

    return publicInterface;
}();

var barcodeObjects = null;

function window_onload() {
    EAN13Generator.generate(BarCodeUI("EAN-13"));
}

window.onload = window_onload;
