# Product lookup with Open Food Facts.

I asked an agent to brainstorm some applet ideas for parkscomputing.com. This was one of them.

## Pitch: "Scan anything in your kitchen and compare it on one screen."

Scan or type a barcode, using the Barcode Tool's reader or the scanner inspector from the retail list, and get the product's ingredients, nutrition, Nutri-Score and allergens. Put two or three products side by side.
It ties straight into your retail tools and your barcode work, which no generic app can.
API: Open Food Facts' open API, which needs no key but asks callers to identify themselves. I'd confirm how that applies to calls made from a browser.

## My take

It's good for the purposes shown above, but I'd like to use it as a retail test tool as well. I should be able to select one of the barcode layouts used/produced by the Barcode Tool applet and have a barcode decoded into the corresponding fields defined in the layout.

## Work log

I assigned this to an agent, but the agent ran out of tokens mid-flight. See the log below.

---

Scanner first, then. I'll gather what it depends on: the Barcode Tool engine's interface for reading data through layouts, how Sudoku is set up to install on a phone, and the candidate ZXing packages.

zxing-wasm 3.1.4 (MIT, wrapping the Apache-licensed zxing-cpp) came out three weeks ago. I'll look inside the package for a build the site can load without a bundler.

I'll check what text the Barcode Tool's GS1 parser and layout reader expect as input, so I can choose the decoder's text mode to match.

Confirmed: the Barcode Tool also makes Codabar and QR codes, so the scanner will read those too. Next, Open Food Facts' terms for reading a product from a browser.

Next, how the server's existing API controllers are written and registered, so the product lookup follows the same pattern:

The demonstration layouts are only used after the engine has loaded, so they can move into the engine cleanly. Moving them:

[At this point the agent started making edits to `barcode-engine.js` and `barcode-tool.js`.]


## Implementation decisions

This pass finishes the scanner and retail layout decoding first, as Paul confirmed. Product lookup and comparison follow separately. The scanner is a PUDL applet at `/page/barcode-scanner`, with a camera, an image-file reader and a text input for pasted values or a keyboard scanner. It shares the Barcode Tool engine, demonstration layouts and browser-local layout library. Imported customer layouts and captured values stay in the browser; no lookup request runs as a side effect of scanning.

ZXing-WASM 3.1.4 supplies the pinned decoder. Its documented Plain text mode preserves separators, and each result retains its raw bytes, reported format and AIM symbology identifier. The scanner converts GS1 element strings to the parenthesized form the existing engine accepts, using the engine's Application Identifier (AI) table. Unknown identifiers or malformed fields produce an explicit error. A barcode's reported format limits which layouts can match. Typed input has no detected format, so the reader can specify one or try all layouts.

A selected layout reports a mismatch explicitly. Automatic mode lists every applicable layout and its validation issues. The results show raw field values beside their meanings and retain check-digit failures. The scanner never opens a URL found in a QR code automatically.

Camera access starts only from the reader's action. Capturing a result, pressing Stop, hiding the page, minimizing its window or destroying the applet stops every camera track. Image decoding and camera decoding use the same local reader. Camera access still needs testing on physical iPhone and Android devices; automated tests cannot establish lens focus or camera selection quality.

The address records the layout and manual format choice. Raw scans remain transient, because putting customer barcodes in a query string would send them to the server and its access logs. Copy result exports the captured text, bytes, format and selected layout explicitly. Installation uses a dedicated manifest, following Sudoku; this pass makes no offline-use promise.

### Follow-on ideas

- Expected-value assertions could compare decoded fields with a saved test case and identify the exact mismatch.
- A scan log could export JSON or CSV for a test report, with repeat detection and an explicit clear action.
- An input inspector could expose control characters and scanner prefixes and suffixes, while keeping timing measurements separate from barcode validity.
- Product lookup should be an explicit action for suitable product identifiers, with attribution, missing-data states and request limits. Restricted-circulation price and weight codes should not silently become product searches.

### Dependency references

- [ZXing-WASM 3.1.4](https://github.com/Sec-ant/zxing-wasm/tree/v3.1.4) documents the reader, local WebAssembly loading and supported formats.
- [Reader options](https://github.com/Sec-ant/zxing-wasm/blob/v3.1.4/src/bindings/readerOptions.ts) define Plain text mode.
- [Read results](https://github.com/Sec-ant/zxing-wasm/blob/v3.1.4/src/bindings/readResult.ts) define raw bytes and the symbology identifier.

UPC-A can arrive as EAN-13 with an implied leading zero, as [GS1 General Specifications](https://ref.gs1.org/standards/genspecs/23.0.0/) permit. The scanner accepts that equivalence when applying a layout, explains it beside the match, and keeps the original capture unchanged. The engine's optional `preserveWhitespace` interpretation flag lets the scanner retain spaces in textual layouts without changing the Barcode Tool's existing forgiving input behavior.


## Current handoff

The scanner is implemented in `js/barcode-scanner.js` and `js/barcode-scanner-core.js`, with its stylesheet, content page and installation manifest. It is registered in both the development tree and the mounted site content, and appears in the site's applet navigation. The previous agent's demonstration-layout move is recovered in the repository. The existing live Barcode Tool's other changes were preserved.

`Tools/test-barcode-scanner.js` checks field validation, format mismatches, missing layouts, corrupt check digits, GS1 separators and whitespace preservation. Its browser checks generate and decode real images for all eight demonstration layouts and a QR code, import a layout, check that scan data stays out of the URL, exercise camera capture with a generated MediaStream, cancel delayed permission requests and stop tracks on capture, Clear and applet destruction. The same checks pass against the repository and mounted content. The scanner also loads through the running site's page and window routes, with no browser errors or horizontal overflow at phone width.

Physical iPhone and Android camera tests remain open. Installation has a dedicated manifest, but no offline cache is implemented. Product lookup, comparison, continuous scan logging and expected-value assertions remain follow-on work. Changes are not committed.

The browser suite passes in Chromium, Firefox and WebKit. This Windows WebKit build has no camera API, so its camera check verifies the unavailable-camera fallback; generated-stream capture and cleanup pass in Chromium and Firefox. After restarting `parkscomputing-dev`, the running site's cache hashes match the changed assets. The existing Barcode Tool and the scanner's installed-app route still load successfully. An automated request to the public HTTPS URL received HTTP 403; the running container was verified through localhost, so public edge access remains unverified in this session.


## Mobile-first revision

Paul verified the scanner with a desktop USB camera and a phone camera. The next revision centers the interface on reading a result without scrolling past setup controls. PUDL's raised controls, sunken inputs, flat data, semantic palette, Inter typography and spacing tokens remain unchanged. The camera control is a single latched button using `aria-pressed`; an adjacent PUDL popover holds the secondary commands and also works when the site menu bar is absent.

The applet has a compact command row, a layout selector and one bounded reading area. The decoded value and interpreted fields lead that area. Camera preview covers the same area while scanning, then yields its place to the result. The applet measures the available viewport or window body and fits within it. Long payloads and unusually large layouts can scroll inside the reading area, while the command row stays visible. This keeps the ordinary scan-and-read loop in view on a phone without reducing text to fit arbitrary payload sizes.

Text entry uses a native capture dialog reached through Actions. Raw bytes and decoder metadata are available through Scan details; they no longer precede the useful field values. Import, image opening, copying and clearing live in the Actions menu and remain in the applet's site menu. Routine status uses one compact line; errors retain PUDL notices. The camera and data occupy the same stable surface instead of forming a long vertical page.

## Paul's suggestions

- Make the applet border size to content the same way the Barcode Tool applet does.
- Make the applet installable to a phone or desktop as a web app like the Sudoku applet is
- Let the user toggle between barcode decode and product lookup (or whatever lookup source is appropriate for the barcode).
  - In fact, different symbologies may have different lookups.
  - Users may specify additional lookup sources. These may not necessarily be per-symbology; some endpoints may be able to accept multiple symbologies. The applet's symbology enumeration may have to map to endpoint identifiers for symbologies, etc. This will require some specification.

## Content sizing and installation

The scanner's reading border follows its content, like the Barcode Tool. Its maximum height remains the available viewport or window body, so long results scroll internally. Starting the camera temporarily expands the same surface to use the available height. Stopping or capturing restores content sizing. This supersedes the fixed-height decision above and retains the existing PUDL palette, typography and spacing.

The scanner already has a dedicated manifest, stable app identity and a standalone start URL at `/page/barcode-scanner?frame`. Actions now includes Install scanner with a link to that page and platform instructions. Opening that link from a desktop applet window ensures installation targets the scanner page. The browser controls installation. No offline guarantee is added.

Chromium selects `barcode-scanner.webmanifest` on both the page and frame routes and reports no manifest or installability errors. Sudoku's frame route passes the same check. This establishes browser eligibility on localhost; physical installation remains a manual check. [MDN's installation guidance](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable) documents the platform installation menus and the distinction between installation and offline support.

## Lookup specification, proposed v1

Lookup is not yet implemented. This specification captures Paul's requested extension. The cross-project [Architectural Principles](<C:/Users/paul/OneDrive/Documents/Architectural Principles.md>) govern implementation.

### Interaction

A PUDL segmented control switches between Decode and Lookup above the reading area. Both views share the capture and camera overlay. Switching views preserves the barcode and sends no request. Lookup shows identifier candidates, compatible sources and the selected source's result. An explicit Look up button sends the displayed value to the displayed destination. Scanning in Lookup mode prepares that request without sending it. Multiple compatible sources require a selection; the applet never queries every service automatically.

The URL records `view=decode|lookup`, the source ID and the existing layout and format selections. Browser Back restores these through the applet state contract. Raw captures and results stay out of the applet URL. Manage sources is an addressable `view=sources` state reached through Actions, with addressable Add and Edit states. Source management is not a modal page.

### Identifier and symbology contracts

A capture retains raw text, bytes, decoder format, AIM identifier and validation outcome. Canonical symbology keys match the engine: `ean13`, `ean8`, `upca`, `upce`, `itf`, `itf14`, `code39`, `codabar`, `code128`, `gs1-128` and `qr`. Unknown decoder formats retain their names without an invented mapping. Unknown typed formats remain unknown unless explicitly selected.

Identifier extraction is separate. Each candidate carries a kind, value, parser or source field, and normalization explanation. Proposed kinds are `gtin`, `isbn`, `uri`, `layout-field` and `raw`. A source accepts identifier kinds with optional symbology restrictions. A missing restriction permits any format with an established identifier, including unknown format. An explicit list permits only those formats. Layout-field rules name both layout and field IDs.

Product eligibility requires documented identifier rules and valid check digits. Digit count alone cannot establish a product. Restricted-circulation and price/weight codes must not silently yield public product queries. GTIN extraction from GS1, UPC-E expansion, ISBN conversion and GS1 Digital Link parsing require documented standards and fixtures before activation. Normalization never changes the raw capture.

QR content remains data. A URL does not automatically become a product lookup or navigation. Explicit opening permits validated HTTP(S) links only. Generic raw lookup remains available through a source configured for that purpose.

### Source configuration

Sources use a versioned `pc-barcode-lookup-sources` JSON document. Built-ins have reserved IDs and can be disabled; editing one creates a user source. User sources live in browser-local storage with import and export. Imports validate completely before writing and ask about conflicting IDs. Unsupported schema versions fail visibly.

| Field | Meaning |
| --- | --- |
| `id`, `name`, `description` | Stable identity and reader-facing explanation. |
| `accepts` | Identifier kinds with optional symbology or layout-field restrictions. |
| `symbologyMap` | Canonical keys mapped to endpoint-specific strings. |
| `request` | Transport, fixed HTTPS origin, path template and parameter bindings. |
| `response` | Named adapter or declarative JSON field mapping. |
| `attribution` | Provider name, link and required text. |

One source can accept several symbologies. Its map can translate `ean13` to `EAN_13` and `upca` to `UPC_A`, or map both to one endpoint value. A map is required only when the endpoint needs a symbology parameter. It does not determine whether the barcode contains an appropriate identifier.

The first transports are `json-get`, `json-post` and `external-link`. POST is limited to providers documenting read-only lookup. Browser fetch omits credentials. User configuration contains no executable code, arbitrary headers or secrets. Authenticated services and endpoints without permitted browser access need a separately specified connector. There is no arbitrary URL proxy.

Bindings use a closed vocabulary: `identifier.value`, `identifier.kind`, `symbology.endpoint`, `capture.text` and `capture.aim`. Raw capture bindings must be explicit and visible in the request preview. Path parameters are encoded individually, query values use URLSearchParams, and JSON bodies use typed bindings. Scan content cannot change the fixed origin. A missing required binding prevents sending.

This illustrative source sends two symbologies to one endpoint. The example endpoint does not claim to exist.

```json
{
  "format": "pc-barcode-lookup-sources",
  "version": 1,
  "sources": [{
    "id": "user:warehouse",
    "name": "Warehouse catalogue",
    "description": "Find a warehouse product",
    "accepts": [{ "kind": "gtin", "symbologies": ["ean13", "upca"] }],
    "symbologyMap": { "ean13": "EAN_13", "upca": "UPC_A" },
    "request": {
      "transport": "json-get",
      "origin": "https://catalogue.example",
      "path": "/products/{identifier.value}",
      "query": { "format": "symbology.endpoint" }
    },
    "response": {
      "adapter": "json-fields-v1",
      "found": { "pointer": "/found", "equals": true },
      "notFound": { "pointer": "/found", "equals": false },
      "title": "/product/name",
      "fields": [{ "label": "Brand", "pointer": "/product/brand" }]
    },
    "attribution": { "name": "Warehouse catalogue", "url": "https://catalogue.example" }
  }]
}
```

The JSON adapter uses RFC 6901 JSON Pointers and exact typed equality, with no evaluated expressions. Pointers address the parsed response. Exactly one of the found/not-found predicates must match; neither or both indicates a schema error. Found records require a nonempty string title. Optional missing fields are omitted; structured values require a dedicated adapter. A generic HTTP 404 is an endpoint error unless the provider's documented adapter defines it as a missing record.

### Execution and result contract

Each applet has one current request. New capture, source change, Clear and destruction abort it and invalidate its generation. Late results cannot replace newer scans. Requests time out after 15 seconds, accept at most 2 MiB of JSON and never retry automatically. Loading, found, not found, invalid response, unavailable, timeout and rate-limited states remain distinct. Network and cross-origin access failures use a combined message where the browser cannot distinguish them. Exposed Retry-After values govern the earliest retry after rate limiting.

Results show escaped text, source, fetch time, attribution and validated links in flat PUDL data. The initial adapter omits remote images to avoid incidental third-party requests. Fetch uses no-referrer and rejects redirects, so source configuration must name the final endpoint. External links use noopener and noreferrer. Errors retain the original decoded value. Captures and results remain transient and are not written to storage or analytics.

Open Food Facts is a candidate first provider for food products. Its [product endpoint](https://openfoodfacts.github.io/documentation/docs/Product-Opener/v2/products/get-product-by-code/) is documented. Before enabling it, implementation must verify current attribution, identification, rate limits and browser-access requirements. It does not establish universal product coverage.

### Acceptance and open boundaries

The lookup implementation must satisfy these checks.

- Switching views preserves the scan and updates the URL without sending a request.
- One source accepts multiple formats with different endpoint identifiers, and a source needing no format parameter works without a map.
- Invalid identifiers and missing required mappings prevent inappropriate requests with a readable explanation.
- Normalization preserves raw data, and restricted-circulation fixtures never become public product lookups implicitly.
- Import validates atomically and handles duplicate source IDs explicitly.
- Cancellation tests prove that older requests cannot overwrite the current result.
- Response fixtures cover missing products, malformed JSON, oversized responses, timeouts and rate limiting.
- Phone and installed-app layouts retain the visible camera/result area and expose source management.

The first bundled provider and its normalization rules remain provider-contract decisions. Authenticated endpoints, offline lookup and cross-device synchronization require separate specifications. The next implementation should prove the generic source contract against fixtures, then add the first verified provider.

The content-sizing and installation-menu changes are installed in the mounted site as scanner asset version 3. Chromium, Firefox and WebKit regression checks pass; WebKit checks the unavailable-camera path on this Windows build. The running page and standalone route were checked at 375 by 667: the border grows from the empty state to the decoded result, expands for camera preview and stays within the viewport. Lookup remains specification-only. Changes are uncommitted.

## Bundled lookup defaults and shipping

Paul wants useful default implementations of the lookup specification that readers can copy, inspect and customize. Defaults will therefore ship as versioned source definitions using the same validation, matching and execution paths as user definitions. View definition, Copy as new source and Export are available for each default. Copies record the original source ID and revision for reference but receive independent IDs; later bundled updates never overwrite user copies. A named parser or adapter dependency is visible in the definition and documented alongside its fixtures. Copying configuration does not imply that arbitrary parser code becomes editable.

A compatible source is offered automatically, but a scan still does not send a request. A single compatible source can be preselected. Where several apply, the reader chooses, and may explicitly save a preferred source for that identifier kind in this browser. A preference applies only while the source remains eligible. This replaces the earlier requirement to select again even when only one source applies; there is still no implicit preference based on list order or fallback request to another provider.

The first default set should cover the following cases. This is an implementation plan, not a statement that the sources are already enabled.

| Recognized content | Proposed default | Initial behavior |
| --- | --- | --- |
| Eligible EAN/UPC product identifier | Open Food Facts | Explicit food-product query, with an honest not-found state. |
| Valid ISBN carried in EAN-13 or other supported content | Open Library | Book details through its documented ISBN interface. |
| HTTP(S) URL, commonly carried in QR | Open URL | Local preview of the full address and host, followed by explicit navigation. |
| Supported GS1 Digital Link URI | Digital Link inspection | Local extraction of identifiers and explicit opening of the encoded link; eligible product identifiers can also use product sources. |
| Contact, Wi-Fi, email, telephone or SMS data | Local content handlers | Structured preview and copying; documented export or device actions can be enabled individually. |
| Carrier-qualified tracking identifier | Carrier tracking | Explicit navigation to the carrier's documented tracking interface, or copy the identifier and open its tracking page when no parameterized URL is documented. |
| GS1 Serial Shipping Container Code (SSCC) | Logistics identifier inspection | Local validation and display, with a configured logistics source if available. |

Open Food Facts covers food products rather than every retail item. Additional product providers can appear as choices once their licensing, credentials, identification, browser-access rules and rates have been verified. A missing record never triggers an undisclosed query to another service. The documented starting points are the [Open Food Facts API requirements](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/docs/api/index.md) and [Open Library Books API](https://openlibrary.org/dev/docs/api/books).

### Local handlers and the source contract

The source contract needs a `local` execution kind alongside HTTP lookup and external navigation. Every definition declares `execution=local|request|navigation`. Local definitions select a versioned, audited handler and declarative options. They have no endpoint or symbology map. Request definitions retain the existing request contract. Navigation definitions select either a fixed provider URL template or the built-in validated HTTP(S) URI handler; they cannot interpolate scanned text into an arbitrary origin. Each kind declares its required fields and rejects fields from the other execution kinds.

The identifier vocabulary gains `tracking-number`, `sscc`, `contact`, `wifi`, `email`, `telephone` and `sms`. Tracking candidates carry an optional carrier ID plus provenance: a documented carrier format, a configured layout or the reader's explicit selection. An SSCC remains a separate identifier kind. Local content handlers expose fields for reading and copying without contacting a provider. Wi-Fi passwords remain concealed until explicitly revealed. Exporting a contact or invoking a compose/dial action requires an explicit action and its own documented handler; an arbitrary URI scheme cannot bypass the HTTP(S) navigation restriction.

The [ZXing contents reference](https://github.com/zxing/zxing/wiki/Barcode-Contents) is a useful inventory of common QR payloads, but it also describes observed formats with incomplete specifications. Only documented formats become load-bearing parser contracts. GS1 Digital Link parsing follows the [GS1 URI syntax standard](https://ref.gs1.org/standards/digital-link/uri-syntax/); querying a resolver's linkset is a separate adapter governed by the [GS1 resolver standard](https://ref.gs1.org/standards/resolver/).

### Shipping scope

Paul decided that shipping lookup will require the reader to select the source. The applet will not guess or rank carriers from symbology, number length or prefix. The selected source supplies the carrier identity and its documented barcode parsing and validation rules. An incompatible scan reports a mismatch without switching sources or sending the value elsewhere. This supersedes the earlier proposals for carrier suggestions. Shipping remains deferred.

An SSCC identifies a logistics unit. It does not itself provide a public delivery-status service or establish which parcel carrier owns the movement. The [GS1 Logistic Label Guideline](https://www.gs1.org/standards/gs1-logistic-label-guideline/1-3) defines that logistics role. An organization can connect SSCCs to its own warehouse, shipment or traceability endpoint through a user source. The applet should display the SSCC and its validation even when no such endpoint exists.

The first shipping feature should provide carrier selection and explicit tracking-page actions. Carrier-specific deep-link parameters must have published documentation; otherwise the applet copies the number and opens the official tracking form without guessing its URL contract. Fetching status, events or delivery estimates inside the applet comes later through authenticated connectors. For example, [FedEx tracking](https://developer.fedex.com/api/en-us/catalog/track/v1/docs.html) documents tracking responses, and its [authorization API](https://developer.fedex.com/api/en-us/catalog/authorization/v1/docs.html) requires credentials to obtain access tokens. Those credentials belong in an operator-configured backend connector, never an exported browser source definition.

### Delivery order and acceptance additions

The first implementation should deliver the source registry and copy/edit/export workflow, Open Food Facts eligibility, Open Library eligibility and local URL preview. Common QR handlers and shipping-page actions follow on the same contract. Provider API integration remains gated by documented access requirements, with a visible setup-required state for sources needing a connector. No source should appear ready while its execution path is unavailable.

The following checks supplement the lookup acceptance criteria.

- Bundled and copied sources pass the same schema and execution tests.
- Updating a bundled definition leaves its user copies unchanged.
- A single compatible source is preselected without sending a request, and multiple choices honor only an eligible explicit preference.
- Local QR handling makes no network requests and does not automatically navigate, dial, send, import contacts or join networks.
- Every shipping lookup requires an explicitly selected source, and an SSCC never becomes a carrier tracking number implicitly.
- Shipping fixtures distinguish identifier parsing from successful retrieval of live shipment events.

## Implemented lookup slice

EAN/UPC food lookup, QR URL preview and reusable source definitions are implemented. Shipping, ISBN lookup and additional QR content handlers remain deferred. The implementation is the narrower version 1 described in the [source-format guide](../Application/parkscomputing-engine/wwwroot/content/barcode-lookup-guide.html); earlier proposed transports and identifier kinds are future work. The source library is available from Actions or the Lookup view, with copying, JSON editing, export and atomic import. Imports reject conflicting IDs; replacement uses Edit. Definitions contain no credentials or executable code.

The default accepts complete EAN-13, EAN-8, UPC-A and UPC-E captures after checksum validation. UPC-E uses the existing engine's expansion to UPC-A. Typed digits need an explicitly selected format, so arbitrary numeric QR content never becomes a product query. Restricted-circulation prefixes are rejected using the [GS1 General Specifications](https://www.gs1.org/docs/barcodes/GS1_General_Specifications.pdf), including RCN-8 prefixes 0 and 2 and RCN-13 prefixes 02, 04 and 20-29. The food connector additionally excludes book, periodical and coupon ranges. This limits eligibility; it does not assert that every remaining identifier names a food product or exists in the provider's database.

Open Food Facts requires an identifying User-Agent. The documented browser route cannot reliably supply that header, so this provider uses a fixed server connector at `/api/barcode-products/open-food-facts/{code}`. This is an explicit exception to the earlier browser-only request proposal. Pressing Look up sends the product identifier through Parks Computing to Open Food Facts; the interface names that route. The identifier appears in the requested resource URL and may therefore enter ordinary access logs. Camera images, source definitions and unrequested captures remain local. The connector never accepts a caller-supplied endpoint or forwards browser cookies.

The connector uses the documented v3 product resource, requests only code, name, brand, quantity and ingredients, identifies this app, disallows redirects and returns no-store responses. It applies a shared rolling limit of 15 requests per minute for the running server, honors provider rate limiting, bounds responses to 2 MiB and cancels after 12 seconds. The browser has a 15-second timeout and generation cancellation. Scaling this deployment to multiple server instances would require coordinating the provider limit across instances sharing an outbound IP.

The [provider's API guidance](https://openfoodfacts.github.io/openfoodfacts-server/api/) documents identification and rates, and requests that app owners register their usage. No account or usage form has been submitted on Paul's behalf. The staging endpoint returned HTTP 502 during verification. A read-only production request subsequently returned the expected product, and the deployed public page completed the same lookup through the connector. All repeatable tests use fixtures rather than provider requests.

Product results appear immediately below the captured value, ahead of source controls. Source selection and mode changes do not issue requests. An HTTP(S) URL gets a local destination preview and an explicit Open URL link. The installed-app and desktop applet routes use the same implementation. No external images are loaded. The source-format guide records supported configuration fields and includes an example multi-symbology endpoint.

Validation includes the Chromium, Firefox and WebKit scanner suite; pure lookup tests for identifiers, mappings, schema validation, response size and rate limits; and a .NET 10 connector harness for validation, headers, responses and the outbound rate limit. Generated-stream camera checks pass in Chromium and Firefox; this Windows WebKit build verifies the no-camera fallback. The Docker .NET 10 build succeeds with existing package and nullable warnings. The host's .NET 8 SDK cannot build this net10.0 application.

The live mount contains the scanner, lookup scripts, stylesheet and guide, with scanner version 5 in both registries. The running container includes the new connector. The public page was verified with a real product response and phone-width rendering. Changes remain uncommitted.


Selecting the shipping source removes carrier-detection ambiguity and makes the first shipping implementation smaller. It does not remove provider authentication, access requirements or the need to interpret each source's label format. The initial implementation can still use documented tracking-page links, with in-app delivery events reserved for a configured connector.


## Outer window sizing correction

The earlier sizing change affected only the scanner's inner reading panel. Paul correctly pointed out that the outer applet window still retained a fixed frame. The live Barcode Tool uses `size "content"` in its sitenav node, which the server renders as PUDL's `data-win-size="content"`; the applet then receives flow sizing. The scanner now uses the same setting in both repository and live navigation.

A content-sized window cannot use its current bottom edge as the scanner's maximum height, because that would prevent growth after a small result. The scanner uses the available window layer instead, while retaining viewport bounds for the camera. The integration check in `Tools/test-barcode-scanner-window.js` verifies the actual outer frame grows for decoded data, shrinks on Clear, expands for scanning and returns when stopped. The live site uses scanner asset version 6. This correction is not yet committed.

The applet-owned sizing correction on 3 October supersedes the navigation setting above. Barcode Scanner now declares `data-applet-window-size="content"` on its own mount; the server renders the PUDL sizing attribute from that declaration.
