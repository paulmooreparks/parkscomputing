# Proposal to PUDL: applets that publish actions

From parkscomputing.com, 2026-10-17, against PUDL 0.63.0. The site runs this today as its own code: the broker is `js/applet-actions.js`, the manifests are in `js/actions`, and `js/applets.js` wraps `pudlApplets.define` to see them (marked as a workaround). `Architecture/applet-platform-design.md` (P2) has the site's design. This proposal asks PUDL to take the declaration and the broker into the applet runtime, so the wrapper can be deleted and other PUDL sites can publish actions the same way.

## The problem

An applet today can be used in one way, by a person in its window. PUDL's requests (`handles`, `request`, `can`) let one applet ask another to open something, but the answer is always a window, and nothing comes back to the caller. A script in the site's Terminal that wants a barcode, a dice roll or a file's text has to know the applet's private functions. An AI client driving the site through MCP has nothing at all to discover.

GK Companion, which is built on PUDL, solved this with a contract for applet actions. Each applet publishes a manifest. Every action in it has a reference such as `parks.barcode/generate@1`, JSON Schema for its input and output, the capabilities it needs from a closed list that the host grants, and a replay policy. A broker validates both ends and records every invocation. The contract has run GK's chat agents and flows for months. parkscomputing.com has now taken it into the page, which is where a PUDL site's applets live.

## The proposed contract

**Declaring.** `define` gains one optional key, `actions`, the address of a manifest file:

```js
pudlApplets.define('barcodes', {
  src: '/js/barcode-tool.js', css: '/css/barcode-tool.css', page: '/page/barcodes', ver: '31',
  actions: '/js/actions/barcode.json'
});
```

The manifest is a file rather than an object in `define` for three reasons. The site's registry script is loaded on every page and the schemas are several kilobytes that only scripts read. A server can read a JSON file without running the applet. And it is the part of an applet that a package (`applet.json`) would publish. The runtime stamps it with `ver` as it stamps `src`.

The manifest is GK's, with two optional additions:

```json
{ "id": "parks.dice", "version": "1.0.0", "apiVersion": 1, "title": "Dice", "description": "…",
  "module": "dice.js",
  "actions": [ { "ref": "parks.dice/roll@1", "title": "…", "description": "…",
                 "inputSchema": { … }, "outputSchema": { … },
                 "capabilities": [], "replay": "pure" } ] }
```

- `module` is a script beside the manifest that gives the actions' handlers, loaded the first time one of them runs. It runs without the applet's window.
- An action may say `"handles": "open"`, naming one of the applet's `handles` verbs. The broker carries it out as a request for the window, so the existing verbs become ordinary actions that a script can discover, and need no handler.

**Providing handlers.** The module hands its handlers to the runtime:

```js
pudlApplets.provide('parks.dice', {
  'roll@1': function (input, ctx) { return { output: { values: [4, 2], total: 6 } }; }
});
```

A handler resolves to `{ output, artifacts, request }`, as GK's `Result` does. `ctx` holds the invocation's id and an `AbortSignal`, and only the services the action declared.

**Calling.** The broker's surface is GK's SDK, minus GK's workspaces:

```js
pudlApplets.catalog()                       // the manifests
pudlApplets.invoke(ref, input, opts)        // a record, once done, failed, or waiting for a person
pudlApplets.run(ref, input, opts)           // the output, or a thrown error
pudlApplets.status(id), wait(id), cancel(id), artifact(id), invocations()
```

`opts.grant` is the list of capabilities the caller holds, `opts.id` an idempotency key, and `opts.owner` who is asking.

**Capabilities and replay.** The capability list is the project's, as `handles` verbs are, and closed: a manifest that names a capability the project does not list is refused when the catalog loads. PUDL should own the mechanism (refusing unknown capabilities, matching an action's against the caller's grant, giving a handler only what it declared) and leave the list to the project. It could ship a starting list: `artifact.create`, `attention.request`, `notification.post` and `window.open`. Replay keeps GK's three values. A `human` action asks its question in a PUDL dialog.

**Validation.** Input and output are checked against draft 2020-12 JSON Schema, and a `$ref` outside the schema is refused. The site vendors `@cfworker/json-schema` (MIT), because it does not compile schemas to code, which a strict content security policy would forbid. PUDL could vendor the same library, or let a project supply its validator.

## What stays with the project

- **The capability list and the services behind it.** The site's `files.read` and `files.write` are its own file system; another site would have its own.
- **Where records last.** In the page they last as long as the page. A project with a server, as GK has and as the site will have for MCP, keeps durable records there.
- **Provider ids.** The site uses `parks.`, as GK's barcode provider already did.

## Questions for PUDL

1. **Names.** Is `actions` right for the key, when its value is a manifest's address? `manifest` is plainer but says less.
2. **Where it lives.** The broker is about 600 lines with its dialog. It could be part of `pudl-applets.js`, or a separate `pudl-actions.js` loaded on demand, which is how the site loads it.
3. **The window actions.** In the classic view a request navigates the page, which would end a script that asked for it. The site's broker opens the applet's page in a new tab instead. Should `request` itself take an option for that?
