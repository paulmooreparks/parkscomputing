# Parks Computing site, for VS Code

This extension connects VS Code to the site engine's language server, `ParksComputing.Engine.dll lsp` (`Application/parkscomputing-engine/Lsp/SiteLanguageServer.cs`), for the site's Markdown, and colours shortcodes in it: the braces and name as a tag, a parameter's name as an attribute and its value as a string (`syntaxes/shortcode.injection.json`, a grammar laid over VS Code's own Markdown). The server gives completion of shortcode names after `{{` and of a shortcode's parameters inside its call, hover text for a shortcode, and the problems the site's own renderer finds when it renders the file, each marked where its shortcode is. All of it comes from the engine's shortcode definitions, so it always matches the site and its Editor.

## Using it

Open the site's `wwwroot` folder (the live content in OneDrive) in VS Code. By default the extension runs the engine's image with that folder as its web root:

```
docker run -i --rm --entrypoint dotnet -v <folder>:/site:ro parkscomputing-local:dev ParksComputing.Engine.dll lsp --root /site
```

The setting `parkscomputingSite.server` changes the command, for example to a locally built engine: `["dotnet", "C:/…/ParksComputing.Engine.dll", "lsp", "--root", "${workspaceFolder}"]`.

## Building it

```
npm install
npx @vscode/vsce package
code --install-extension parkscomputing-site-0.1.0.vsix
```

`Tools/test-lsp.js` drives the server the same way, without VS Code.
