# Barcode tool design

The barcode tool replaces the 2015 DIV-based generator with a PUDL applet that draws to a canvas. It generates the linear symbologies found in retail stores, validates data as it is typed, and highlights check digits and structure. Its distinctive feature is the layout: a description of what the characters in a barcode mean, which lets the tool compose a barcode from named fields, explain one, and read a scanned value back into its fields.

## Scope

The first two phases cover the linear symbologies a store actually meets:

- EAN-13, EAN-8, UPC-A and UPC-E for products.
- GS1-128, with Application Identifier validation, for logistics labels and embedded-data codes.
- ITF-14 and general Interleaved 2 of 5 for cases and for numeric codes printed by the store.
- Code 128 and Code 39 for internal labels.
- Codabar (NW-7) for membership cards, coupons and older in-store codes.

QR Code and GS1 DataBar come in a third phase. QR needs Reed-Solomon error correction, and a vetted MIT-licensed library vendored into the pinned assets is safer than a hand-written one.

## Public and private layouts

The site's repository is public and everything it deploys is published, so the tool ships only generic, standards-based demonstration layouts. Customer layouts, GK's barcode rule set and anything else under confidentiality are imported from a JSON file into the reader's own browser, where they live in local storage and never reach the server. A URL can name a private layout by its id, and a browser without that layout says so and shows the raw data instead.

## Architecture

The tool is an applet in the site registry, following Conway and the flash cards. `/page/barcodes` is the tool alone, and the `barcode-generator` article embeds it. There are three layers.

The engine (`js/barcode-engine.js`) is plain JavaScript with no DOM beyond a canvas context. Its encoders turn data into a list of bar and space runs, together with a map from every input character to the run range that carries it. That map is what makes highlighting possible. The same module holds the check-digit algorithms, the GS1 Application Identifier table and the layout model, and it is loadable on its own so the flash cards can generate codes too.

The renderer draws a symbol to a canvas at the device pixel ratio with whole device pixels per module, so bars stay crisp. It exports the same geometry as SVG, sized in millimetres for print, and as PNG. Highlights are colored bands beneath the bars and tints on the printed digits, and they never color the bars themselves, because a scanner reads red as white.

The applet (`js/barcode-tool.js`) is the PUDL interface: a toolbar, sunken inputs validated on every keystroke, a flat preview in a white well, and raised controls. Its whole state serializes to the query string, so any barcode it makes is a link.

## Opening and saving files

Every file the tool reads or writes goes through the site's shared Open and Save as dialog, `pcFileBrowser.pick` in `js/filebrowser.js`, which the Editor uses too (`files-editor-design.md`). The Layout menu's **Open layouts**, **Save this layout as** and **Save all layouts as**, and the **Save SVG** and **Save PNG** buttons, all start in the reader's home directory. The dialog keeps the reader's computer one click away beside its buttons: **From your computer** when opening (or a file dropped on the dialog), and **Download instead** when saving. The tool loads the site filesystem and the browser only the first time one of these is used.

The home directory on the public site lives in the browser's local storage and holds text only. SVG and JSON are saved there; a PNG cannot be, so in a folder that cannot hold it the dialog turns Save off, says why, and makes Download instead its main button. Where the site keeps files on its server, a PNG is saved there byte for byte.

On the public site, saving to `~` keeps a layout in the reader's browser, so the rule under "Public and private layouts" still holds. Signed in as an admin on the edit origin, `~` is the admin's home directory on the server, which is private but not in the browser. The dialog there can also write to `/wwwroot`, as the terminal and the Editor can, and keeping private layouts out of published folders is the admin's own care, whichever tool writes them.

The linked layouts file (File System Access, in Edge and Chrome) is a separate feature and stays in the Layout menu: it keeps the library in step with a file on the reader's disk, where opening and saving are one-off copies.

## The layout format

A layout file is JSON. Positions are never written in it, because fields are sequential and each field's length determines where the next begins. The tool shows positions 1-based. Rule lists that number positions from 0 or from 1 must be converted by whoever writes the file, and the converter should check its work against a known sample, since an off-by-one in a price field is the kind of error this tool exists to catch.

```json
{
  "format": "pc-barcode-layouts",
  "version": 1,
  "layouts": [
    {
      "id": "demo-price-embedded",
      "name": "Price-embedded item",
      "symbology": "ean13",
      "description": "An in-store code carrying an item number and a price.",
      "options": {},
      "hri": "data",
      "explain": "Item {item}, price {price}.",
      "fields": [
        { "id": "prefix", "name": "Prefix", "type": "fixed", "values": ["21"], "color": "blue" },
        { "id": "item", "name": "Item", "type": "number", "length": 5, "color": "gray" },
        { "id": "price", "name": "Price", "type": "decimal", "length": 5, "decimals": 2, "prefix": "$", "color": "green" }
      ]
    }
  ]
}
```

A layout has an `id` (letters, digits and hyphens, unique across the reader's library), a `name`, a `symbology` from the list below, and its `fields`. It may add a `description`, an `explain` template, `options` for the symbology, and `hri`, which sets the human-readable line. The value `data` prints the encoded data, `none` prints nothing, and any other string is a template.

The symbologies are `ean13`, `ean8`, `upca`, `upce`, `gs1-128`, `code128`, `itf`, `itf14`, `code39` and `codabar`. For the EAN and UPC family and for ITF-14 the fields cover the data before the symbology's own check digit, which the tool adds.

Each field has an `id`, a `name`, a `type`, and optionally a `color` (blue, gray, orange, green, purple, teal, red or gold), a `description`, and for GS1-128 an `ai`, which starts a new element string. A field without an `ai` continues the element before it.

| Type | Meaning | Keys |
| --- | --- | --- |
| `fixed` | One of a set of literal values. The first is the default. | `values` |
| `number` | Digits, zero-padded on the left to `length` unless `pad` is `none`. | `length`, `pad` |
| `text` | Characters the symbology allows, of exact `length` or at most `maxLength`. | `length` or `maxLength` |
| `date` | A calendar date in a format built from `dd`, `mm`, `yy` and `yyyy`. | `format` |
| `decimal` | Digits with implied decimals, entered as `127.60` or as raw digits. | `length`, `decimals`, `prefix`, `suffix` |
| `enum` | A code from a table of meanings. | `values` (an object of code to meaning) |
| `check` | A computed check digit over earlier fields. | `algorithm`, `over` (field ids, default all earlier fields) |

The check algorithms are `gs1-mod10`, `luhn`, `mod11` (weights 2 to 7 from the right, a result of 10 written as 0), `7dr` (the remainder of the number divided by 7), `7dsr` (7 less that remainder), and `gs1-price4` and `gs1-price5` (the price check digits of GS1 General Specifications 7.9.3 and 7.9.4). The public definitions of 7DSR say only "subtract the remainder from the modulus", so a remainder of 0 gives 7; if a real scheme turns out to write 0 there, that is a separate algorithm, not a change to this one. A price check covers exactly four or five digits, and the layout is refused otherwise.

Check digits are computed after every other field, so `over` may name a field that comes later. The GS1 price check digit stands in front of the price it guards, which is why. A check may cover another check digit only when that one comes first.

The `explain` template substitutes `{field}` with the field's formatted value, `{field:raw}` with its digits, and `{field:meaning}` with an enumeration's meaning.

## Interpretation

Read in reverse, a layout splits a scanned value into its fields. The tool tries every layout whose symbology family and length fit, requires its fixed fields to match, verifies its check digits and dates, and lists the matches with any problems. Without a matching layout it still identifies what it can: a valid EAN-13 and its GS1 prefix country, a UPC-A, a GTIN-14, or a GS1 element string with each AI named and its dates and weights formatted.

## Phases

1. The engine with every linear symbology above, the canvas and SVG renderers, highlighting, export, and URL state.
2. Layouts: the field editor, the check algorithms, explanations, interpretation, the demonstration layouts, the imported library and a JSON editor for authoring.
3. QR Code and GS1 DataBar, and live-generated cards for the barcode quiz.

The first two phases ship together, since the layout model shapes the engine's character map.

Phases 1 and 2 shipped on 2026-09-29. Of phase 3, the barcode quiz's generated cards shipped the same day. The flash cards load the engine beside themselves and deal one freshly generated card per symbology the engine draws (two of each in the generated-only deck), and a reveal shows the data and colors the structure and check characters.

QR Code shipped the same day as symbology `qr`, with the option `ecc` (L, M, Q or H, default M). The module matrix comes from Project Nayuki's QR Code generator v1.8.0 (MIT), compiled from its TypeScript source and vendored unmodified at `js/vendor/qrcodegen-1.8.0.js`. The tool and the flash cards load it before the engine, and the engine reports QR as unavailable if it is missing. Error correction is never boosted beyond the chosen level, so the level shown is the level encoded. A QR symbol is a matrix: the engine's symbol carries `matrix`, `size` and `modules` instead of bar runs, the renderers draw it with a four-module quiet zone, and the structure highlight frames the three finder patterns on light modules only. Every level round-trips through ZXing for numeric, alphanumeric, Unicode and 600-byte text.

GS1 DataBar remains, and it is the last item of phase 3.
