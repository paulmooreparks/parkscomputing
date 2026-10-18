# Chat

Chat is a conversation with a language model for the site's staff, ported from GK Companion's Chat. Paul asked for it on 2026-10-18: configurable, able to point at any LLM provider, starting with Claude, and available to admins only.

## Decisions (Paul, 2026-10-18)

1. **Billing.** Anthropic's terms limit a Claude subscription's sign-in to Claude Code and Anthropic's own apps, and they ask anything built on Claude to use an API key. A server endpoint on Paul's Max plan fits neither, so Claude goes through the Messages API with a key billed separately. Paul chose to start with an OpenAI-compatible provider and add Claude when he has a key. The research is summarised under "Claude through a subscription" below.
2. **Site tools, with prompts.** The model may use the site's own MCP tools. Reading is free, and anything that changes something asks the reader first.
3. **Scope.** The first version carries attachments, the queue and Steer, Mermaid diagrams and the model's thinking, besides conversations, streaming, Markdown, the model picker and Stop.

## What came from GK Companion

GK Companion's Chat is about 3,600 lines inside its desktop page script. It talks to Go through Wails bindings and events, and it is built around agents that run on the reader's machine (Devin over ACP, Codex over its app server). None of that transport fits a web host, and GK has no client for an HTTP LLM API. What carried over is the shape of a conversation as ACP streams it (message chunks, thought chunks, tool calls with their status, permission requests with allow-once, allow-always and reject), the Markdown renderer, the folding of several tool calls into one line, the permission card, and the composer's Send, Queue, Steer and Stop. GK's Jira and Confluence chips, skills, flows, Devin's cost reporting and the applet MCP server stayed behind.

## The parts

**The applet** is the package `chat` in the repo `pudl-chat` (local at `C:\Users\paul\source\repos\pudl-chat`, Apache-2.0). It asks the host for the service `chat` (`pudlHost.service('chat')`) and sends its requests through `pudlHost.fetch`, which kit 0.4.0 adds, so the site's token against forgery travels with them without the package knowing about it. Code and diagrams use highlight.js and Mermaid when the host page has loaded them. The applet's state is the conversation's id, `c=<id>`.

**The server** is `Chat/` in the engine:

- `ChatModel.cs` holds the conversation as files store it, in parts no provider owns (text, thinking with its signature, image, file, tool_use, tool_result), and the settings.
- `ChatProviders.cs` holds one interface and two providers. `OpenAiProvider` speaks any OpenAI-compatible chat completions API: OpenAI, Ollama's `/v1`, OpenRouter and the many that copy it. `AnthropicProvider` speaks Anthropic's Messages API, with thinking and its signature sent back as the API requires. Both stream server-sent events, and both turn the stream into the same events.
- `ChatTurns.cs` runs one turn at a time per conversation, on the server, so a reply carries on when the page goes away. It runs the tools the model asks for, asks the reader about any that changes something, and holds the queue. Steer stops the reply and sends its message next. Stop ends the turn and empties the queue.
- `ChatTools.cs` gives the model the site's tools by being a client of the site's own `/mcp` on the loopback address. It uses a grant made in memory for the turn (`Identity/ChatGrants.cs`, secrets starting `pcchat_`), which `AccessTokenAuthentication` accepts as it accepts a personal access token. Each tool therefore checks and logs the call exactly as before, and nothing is stored in the token list. A tool runs without asking only when its MCP annotations say it is read-only.
- `ChatStore.cs` keeps each conversation as `~/.chat/<id>.json` in its owner's home directory on the server.
- `ChatController.cs` is the service at `/api/admin/chat/`, listed with the server's tools in `EditOriginGate`.

**Events.** A page follows a conversation through `GET conversations/{id}/events`, a server-sent event stream whose events are numbered within the conversation. The page subscribes, then reads the conversation, which carries the number of the last event it includes, the reply in progress, the questions waiting and the queue. It then applies the newer events it held, so nothing is lost or seen twice. A stream that breaks and reconnects reads the conversation again.

## Settings and keys

The providers are in `/etc/chat.json` on the server, which the super-user edits like any other settings file. It is read again when it changes. A key is never written there; `keyEnv` names the environment variable that holds it, which the container gets from `.env` through `docker-compose.yml`. The file is readable through the site's own tools, so a key kept in it could be read back into a conversation; keeping keys in the environment prevents that.

```jsonc
{
  "providers": [
    { "id": "ollama", "name": "Ollama", "kind": "openai", "baseUrl": "http://host.docker.internal:11434/v1/" },
    { "id": "anthropic", "name": "Claude", "kind": "anthropic", "baseUrl": "https://api.anthropic.com/v1/",
      "keyEnv": "ANTHROPIC_API_KEY", "models": ["claude-opus-5-5", "claude-sonnet-5-5"], "thinkingBudget": 4096 }
  ],
  "defaultProvider": "ollama",
  "defaultModel": "glm-5.3-flash:cloud",
  "system": "(optional: replaces the default system prompt)",
  "maxToolRounds": 25
}
```

Without `models`, a provider's own list (`GET models`) is offered. A provider whose key variable is empty says so in the picker.

## Who may use it

Every call needs an Admin or SuperAdmin on a live session, the bar Files, the Editor and the Terminal hold to; anyone else gets 404. The site's tools are offered in the super-user's chats only, since they act as the super-user. In the menu, Chat is `{ slug "chat" title "Chat" when "admin" }` in the Applets menu. `NavService` now keeps a package that the menu offers to an audience out of the Applets section, which everyone sees, and gives its menu entries the package's title, icon and window shape.

## Claude through a subscription

Paul asked to look hard for any way to use his Claude Code or Cowork subscription. The findings, from Anthropic's documentation on 2026-10-18:

- Headless Claude Code (`claude -p --output-format stream-json`) can run on a subscription sign-in or a `claude setup-token` token, and it streams. Anthropic's legal page limits that sign-in to "ordinary use of Claude Code and other native Anthropic applications". It also says developers building products or services should use API keys, and that they may not store or intermediate Claude.ai credentials. A server endpoint fits none of the allowed uses.
- The Agent SDK, and the ACP adapter built on it, document API keys, Bedrock, Vertex and Foundry. Claude.ai sign-in for a third-party product needs Anthropic's approval.
- Claude Code on the web, cloud sessions (`claude -p --cloud`) and routines' API triggers do run on plan usage, but they queue work and give back a session; they do not stream a chat reply.
- Cowork has no programmatic interface.

A provider for headless Claude Code on a subscription would fit the provider interface if Anthropic ever approves it in writing. The ACP transport GK uses for Devin and Codex would fit the same way, for any agent installed in the container.

## The look, after GK Companion's (Paul, 2026-10-18)

The first version was built from the protocol up and looked nothing like GK Companion's Chat; Paul wants GK's look and features on the site. The applet now keeps GK's shape and most of its markup and rules: a page head with the chat's title, the rename and delete buttons and a state line; the run as a log of rows with the time at the left (your messages and the model's as cards with Copy, Edit and Quote, the model's thoughts as muted rows shown by a preference, each tool call as a row with its status and folded details, several in a row folded into a PUDL disclosure card that counts them, and the end of each turn with its length and tokens); your last message pinned at the top of the run once it scrolls away; Jump to the Latest; the questions between the run and the composer; and GK's composer, a bar of small controls (the provider, Thinking on or off, the model as a button with a menu, Add for files and pictures, the site tools, anything queued, Usage, and Stop at the end while a reply runs) over the box with Send and Steer stacked beside it. Esc stops, F2 renames, and files drop onto the window.

GK's Chats pane is a window of its own; here the list of chats sits inside the window, as Paul asked: the list and the chat pane share the space over the composer across PUDL's splitter, whose width the reader sets is kept with their preferences, and the composer runs the whole width below them. A glyph button beside the title, and the View menu, collapse the list, which PUDL's `data-split-pane="second"` does by giving the pane the whole width. The list is grouped as GK groups them: Needs You (a question waits), Working (a reply runs) and Chats, with the provider and time under each title and a badge for its state.

A second message sent while the first chat was still being made had made another chat (two "Liveness check" chats, 0.85 s apart). Sending is now guarded: one chat is made at a time, and Send waits while a message goes.

**The settings dialog** (File > Chat Settings…) has two tabs. Providers edits the server's `/etc/chat.json` through `GET` and `PUT settings`: each provider's id, name, kind, address, the name of its key's environment variable (and whether the server has a value for it), its models, its largest reply and thinking budget; the default provider and model; the tool rounds; the system prompt. The super-user alone may save it; other staff see it read-only. Preferences are the reader's own, kept by `pudlHost.config` as `~/.config/chat.json`: whether thoughts show, whether the list of chats shows, and whether Enter or Ctrl+Enter sends.

## GK's code, adapted (Paul, 2026-10-18)

The second version still fell short of GK Companion's: a margin round the window, Thinking as a drop-down, no `/` skills, no `@` mentions, no prompt history, and Claude 5 refusing the thinking request. Paul's instruction was to use GK's code and adapt it, and the applet now carries GK's composer code (app.js and skill-inputs.js) with the host's services in place of GK's own.

**The window is flush.** The applet marks its mount `data-applet-flush`, and the site's stylesheet drops the window body's padding for a filling applet so marked (`pudl-site.css`, beside the fill rule). Other applets keep PUDL's padding.

**Thinking is a PUDL switch** (`role="switch"`, `aria-checked`) in the composer bar, patched onto the conversation as before. Claude 5 takes `thinking: {type: "adaptive"}` and refuses `enabled` with a budget, so `AnthropicProvider` sends adaptive unless the provider is configured with `thinkingType: "enabled"`, which older models want; the budget then applies.

**Skills** are folders holding `SKILL.md` with GK's front matter (`name`, `description`, `argument-hint`), in the reader's `~/skills` ("My Skills") or the site's `/etc/skills` ("Site Skills"). `ChatSkills` lists them for `GET skills`, and when a message starts with `/name`, `ChatTurns.ForModel` sends the model the skill's body with the typed command, so the expansion is the server's and the chat keeps the command the reader typed. The applet has GK's three ways in: the Skills button's menu with a filter, the `/` pop-up over the box as a word starting with `/` is typed (Up and Down choose, Enter or Tab inserts, Esc closes), and the parameter form over the box when a skill with an argument hint is chosen with nothing after it. The hint is read as GK reads it (`<required>`, `[optional]`, `a|b` for a choice, `--flag`, `--flag <value>`, quotes for a value with spaces, and a last parameter written as words standing for the box itself); the form assembles the command, marks missing required fields, and Esc drops back to typing it by hand.

**`@` mentions.** A word starting with `@` offers the host's files and pages through `pudlHost.fs.find` (kit 0.5.0), grouped as Files and Pages; picking one puts `@path` in the box, and when the message goes the applet reads each mentioned file still in the text with `fs.readText` and attaches it as text. The site's `find` walks the page's file tree, the reader's own files first.

**Prompt history.** Every sent text is kept in the reader's preferences (`history`, the last 200), Up and Down at the box's first and last line recall them as a shell does, and File > Prompt History… lists them with a filter, Forget All, and a press to put one back in the box.

**Applet actions run on the reader's desktop.** When the model calls `applet_invoke` while a page is watching the conversation, `ChatTurns` does not run it on the server: it publishes a `run_action` event with the action's reference and input, the applet runs it through the host's action broker (`pudlHost.actions.run`, the site's `pcActions` with an owner of kind `chat`), and posts the output or error to `POST conversations/{id}/actions`, which completes the tool call. So "play Space Invaders" opens the game's window on the desktop the reader is looking at, a dice roll runs in the page, and the model sees the result. The server waits ten minutes for the desktop. With no page watching, the server runs the action itself as before (pure actions only). A model now and then writes the input as JSON text; the server reads it into the object the action expects. The system prompt tells the model the applets publish actions and that `applet_discover` lists them.

**Tools only when asked (Paul, 2026-10-18).** A "liveness check" had the model reading the moderation queue in one turn and the server log in the next, unasked, with nothing on screen saying tools were on: the conversation's tools default to on and the only sign was a box in the Add menu. The system prompt now says to use a tool only when the message needs it, never to look around the site or run an action unasked, and to answer a check-in with words alone; and the site's tools are a switch beside Thinking in the composer bar. The applet tools' own descriptions, written for a token over MCP, said window-opening actions wait for the desktop queue, and Claude repeated that when asked to play Space Invaders; `ChatTools.Describe` appends to `applet_discover` and `applet_invoke` that in this chat every action runs on the reader's desktop, windows included.

**The `@` menu lists the applets** as GK's does, from the action manifests the site's applets publish (`pcAppletActions`, read once by `appletManifests()` in applets.js and given by `fs.find` as `kind: "applet"` with the manifest's address). A mentioned applet goes with the message as its manifest, so the model has the exact action references.

**The settings are a window**, as GK's Settings are (Paul, 2026-10-18, after a dialog with a heading over the tabs was rejected twice). File > Chat settings… on a desktop asks PUDL for a `chat-settings` window, which the chat applet itself answers (its `handles` verb, `reuse: false`, up to four instances) and renders as the settings view when its state is `view=settings`: the tab strip at the very top across the whole width, the body scrolling under it, Cancel and Save at the foot; the window gives the title (retitled "Chat Settings") and the resizing, so nothing moves between tabs. On a page without windows the same view fills a resizable dialog with no heading of its own, whose size is kept in the preferences. Saving fires `pudl-chat:settings-saved` on the document, and every open chat lists its providers again.

**Web search, both ways (Paul, 2026-10-18: "Both").** No model reaches the web on its own, and Ollama documents no API for its library, so the chat gives them two routes. Claude searches through the API's own `web_search` server tool, declared in the request when the provider is Anthropic and `webSearch` is not off (`webSearchMaxUses`, 5 by default; $10 a thousand searches on the key): the stream's `server_tool_use` and `web_search_tool_result` blocks are kept whole as `server_block` parts and sent back unchanged in later turns, as the API requires (their `encrypted_content`), each text block's citations stay with it (`citations`, with `encrypted_index`) and go back too, a `pause_turn` stop sends the reply so far back and goes on, and the page shows each search as a tool row and the citations as a Sources line under the reply. Every other model gets the chat's own `web_search` tool (`Chat/ChatSearch.cs`) when a search engine is configured under `search` in `/etc/chat.json`: Brave's Search API (its key in the environment `keyEnv` names) or a SearXNG instance with its JSON format on; the settings window has the section. `web_fetch` (`Chat/ChatWeb.cs`) then reads the pages that matter: public internet only, never the server's own network, at most 60,000 characters of text. A provider that searches for itself is not given the chat's tool as well.

## Playing Sudoku, and the chat knowing itself (Paul, 2026-10-18)

Paul asked whether the model could play the site's games. Space Invaders cannot be played from outside: its one action opens the game at a level and gives nothing back, and driving it would need observe and control actions with a turn-based clock, which is parked. Sudoku is turn-based with a state of 81 characters, so it is the game the model plays while the reader watches the board.

**The broker's live handlers.** Confirming the route first: the action broker (`js/applet-actions.js`) ran only module handlers, with no way to a running applet, and PUDL's requests hand state into an open window but give nothing back. So the broker gained a documented pair: a running applet calls `pcActions.attach(id, handlers)` (through the host-neutral `pudlActions`) for the actions that act on its open window and gets back the function that detaches them, and a module's handler asks `pcActions.attached(id, ms)` for the newest instance's handlers, waiting up to `ms` for one that is opening. The broker fires `pudl:actions-ready` on the document when it loads, for an applet that started first. Nothing in PUDL changed.

**Sudoku's actions** (pudl-sudoku 1.1.0, `actions.json`): `new@1` (difficulty) opens Sudoku on the desktop if it is not open, through the applet's new `sudoku` handles verb whose parameter is the difficulty, deals a fresh game and gives the board; `board@1` gives the board as the reader sees it (the puzzle, the board, the nine rows, the wrong entries, the pencil marks, how many cells are empty, whether it is complete); `enter@1` takes up to twenty entries, each a digit for a cell (0 clears) or the cell's pencil marks set outright, selects each cell as a click would, lets the board mark a wrong digit and erase a right digit's marks from its row, column and box, and gives each entry's result (placed, wrong, cleared, marked, clue, off the board) and the board after them. All three carry `window.open` and replay `once`, so the server's MCP runner refuses them and the chat runs them on the reader's desktop. The applet attaches the handlers at init and detaches them at destroy; the module hands each call on, and `new` opens the window when none is open. Pencil marks are the model's working memory on the board, and the system prompt says to play by reasoning, a few cells a call, marking the cells it is working, and to use the solver only when asked.

**`chat_info`** (`Chat/ChatSelf.cs`) is a built-in, read-only tool every staff reader's chat offers, beside the site's tools, answering from the chat's own code: the providers and their models (the same listing `GET providers` gives, now shared), this conversation's settings, the reader's chats, the skills, the settings file and the API's routes. A question about the chat itself is answered from it rather than guessed; it asks no permission.

## Checks

- `ChatTests` (6 unit tests): both stream parsers, both request bodies (Anthropic adaptive by default, enabled with a budget when configured), and the grants.
- `AppletCatalogTests`: a package kept for an audience.
- `Tools/test-chat.js`, on the test instance against a real provider:
  - hidden from readers, and present for staff;
  - a reply streamed with its thinking;
  - a read-only tool run without asking, and a writing tool that asks first and runs once allowed;
  - an attachment;
  - the flush window and the Thinking switch;
  - a skill in the menu, in the `/` pop-up, through its form, and expanded by the server;
  - an `@` mention found, inserted and sent with the message;
  - Up recalling the last two prompts;
  - a dice roll run on the desktop through the page and its result given to the model;
  - the queue and Stop;
  - the conversation brought back by its address.
- `Tools/test-sudoku-play.js`, on the test instance's windowed desktop: the three Sudoku actions through the page's broker (a board dealt, marks, a wrong digit, a right one seen on the board, a clue refused, the window closed), then the model asked about the chat through `chat_info` and asked to start an easy game and make one move.
