# Poker: No-Limit Hold'em against language models

Status: direction agreed with Paul on 2026-10-19; stage 1 live on parkscomputing.com the same day (see "Stage 1 as built").

## What it is

Poker is an applet in which language models play No-Limit Texas Hold'em. Each seat at a table is a model from some provider (Claude, a model on Ollama, Codex, and later whatever key the player brings), and a person may take a seat or leave every seat to the models and watch them play each other. The chips are play money and stay play money.

It is for one person's entertainment, and for comparing models against each other, which Paul counts as the same thing. It is not a site where people play poker with one another (Paul, 2026-10-19): a table belongs to the person who opened it, and that person is the only one who can sit at it or watch it.

## Decisions

### P1. No-Limit Texas Hold'em, two to six seats

Paul chose No-Limit Hold'em (2026-10-19). A table has two to six seats. Other games may come later, and the engine's rules sit behind one interface so that a second game does not mean a second engine, but nothing is built for one now.

### P2. Staff only first, then the public bringing their own keys

At first only the site's staff can play, and the seats use the providers in `/etc/chat.json` with the server's own keys, as the Chat applet does. Later the game opens to the public on a bring-your-own-keys basis (Paul, 2026-10-19): a person signs up, adds one or more API keys (as many as the seats they want to fill need), and starts a table. The site never pays for a public player's model calls.

### P3. A package for the table, a Poker section in the engine for the game

The table is a PUDL applet package, `pudl-poker`, built like `pudl-chat`: it talks to its service through `pudlHost.service('poker')` and draws the table, the cards, the bets and the talk. The game runs in the engine, in `Poker/`: the deck and the shuffle, the betting, the pots and side pots, the showdown, and the model seats' turns. Paul asked whether it could all be JavaScript in the applet (2026-10-19). The model calls cannot: the staff's tables use the server's keys, which never reach a browser, most providers refuse calls made from a web page, and a model on the server's own Ollama cannot be reached from a visitor's browser at all. Once the calls are on the server, the cards and the rules belong beside them, so that the page shows the game and never holds the deck or decides what is legal.

### P4. The server runs the hand; each model sees only what its seat may see

The engine deals with a cryptographic random number generator and keeps the hand's state. When it is a model's turn, the engine sends that model one request holding only what a player in that seat would know: its own two cards, the board, every stack, the pot, the betting so far in this hand, the blinds and the button, and its own notes on the other players (P7). The request asks for one move through a tool with a schema: fold, check, call, or raise to an amount. The engine checks the move against the legal ones it computed. A move that is not legal, or no answer within the seat's time limit, gets one retry with the reason, and after that the seat checks if it can and folds if it cannot. A model never sees another seat's cards, or the deck.

The calls go through the Chat's provider code (`Chat/ChatProviders.cs`), so streaming, thinking, keys from the environment and the providers' quirks are handled in one place.

### P5. Table talk

With its move, a model may say one short line to the table. The line is shown beside its seat and given to the other models as part of the betting history, so a model can needle, bluff or misdirect in words as well as chips. The prompt tells the models that talk is part of the game and may be false.

### P6. Watching

A table with no person seated can be watched. The watcher may choose to see every seat's hole cards and each model's reasoning as it decides, since no player at the table can be helped by it. With a person seated, nobody sees another seat's cards before the showdown, whatever they choose. Between moves the table waits a pace the watcher sets, so a hand between fast models can still be followed.

### P7. Players remember each other

After each hand, each model seat may update a short note on each opponent (for example "raises light on the button"). The notes are the seat's own, and they go into that seat's later requests, so a model can adapt over a session. They are kept with the table.

### P8. A person in a seat

A person seated at the table gets the same legal moves the engine gives a model, as buttons and a raise amount, and the table waits for them without a time limit. Only the person who opened the table can sit at it (Paul, 2026-10-19), so a table has at most one person.

### P9. Every seat may have a bio

Each seat may have a short bio of its player, shown beside the seat (Paul, 2026-10-19). When a table opens, each model seat is asked to write its own: a name to play under and a few sentences about itself as a player, which every other seat will read. The model chooses what to say, true or not, and the request says that the bio may be part of its game. A person writes their own bio, or leaves it empty. Bios are optional, and a model that declines, or whose answer is not usable, plays under its model's name. Every seat's bio goes into every model's requests with the betting, so a model can use what it said about itself and read what the others said. Paul wants to see what the models do with this and whether they make the persona part of their strategy, so the hand history keeps the bios beside the play.

## Stages

1. **The game and a staff table.** The rules engine with its hand evaluator and side pots, under unit tests; the table runner with model seats from `/etc/chat.json`; one optional person seat; bios (P9); watching (P6); table talk (P5); the package's table view; staff only. Each seat shows its token use.
2. **Sessions and comparison.** Opponent notes (P7); hand history with replay; each seat's results over a session (chips won, hands played, how often it put money in, how often it raised), so models can be compared.
3. **The public, with their own keys.** Key storage (below), sign-up gating, the provider list for public seats, limits on tables and hands so one person cannot load the server, and the words on the page saying that model calls are billed to the player's own key. A public player's tables live in their home folder, which means building the member half of the home directory first (Paul, 2026-10-19: "maybe the home folder").

## Stage 1 as built

The engine's part is in `Poker/`. `PokerCards.cs` has the cards, the shuffled deck and the hand evaluator; `HoldemHand.cs` is one hand's rules, from the blinds to the pots; `PokerAgent.cs` writes a model's request (`Situation`) and reads its answer from the `act` tool or from a JSON object in its text, which is how Codex answers; `PokerRunner.cs` runs a table; `PokerModel.cs` keeps a table in `~/.poker/<id>.json`; `PokerController.cs` is the API at `/api/admin/poker/`, which `Identity/EditOriginGate.cs` lists among the server's tools, as it does the chat's. The unit tests in `PokerTests.cs` cover the evaluator, the order of play heads up and three-handed, minimum raises, a short all-in that does not reopen the betting, side pots, a split pot's odd chip, and 2,000 hands of random legal play that never make or lose a chip, as well as a model's request holding no other seat's cards.

The table is the package `pudl-poker` (local repository, like the other packages). The page reads the whole table again after each event, so what a viewer sees is always the one view the server computes. A table plays only while it is "playing" and watched: a minute with no page open pauses it after the hand, since every model move is a paid call. A pause asked for takes effect when the hand in progress ends. A table is saved between hands, so a hand cut short by a restart of the server is lost and the stacks are as they were before it. Each model seat has a time limit for a move (120 seconds unless the table says otherwise); an answer that cannot be played is sent back once with the reason, and after a second failure, or no answer in time, the table checks or folds for the seat and says so in the log.

The table's window, after Paul's first evening with it (2026-10-19): the side column is three tabs (Moves, the hand's play-by-play and talk at full height; Hands; Players), and a seat's bio and figures open from an info button on its plate, so nothing has to be scrolled past to follow a hand. A seat's speech sits on its outer side, below the plate in the lower half of the table, so it never covers a bet. When a hand ends, a panel under the board says who won each pot, how much and with what, the winners' plates are marked, and the table waits at least six seconds (four times the pace, when that is longer) before dealing again. The bar shows the hand's number and the blinds.

A game ends cleanly with End game (Paul, 2026-10-19), which finishes the table for good when the hand in progress ends, unlike Pause, which can be resumed; until then the same button, now Keep playing, takes it back. The felt then shows only the final standings: every player by chips, with what each won or lost, the hands each was dealt and what plays the seat. A seat can be removed with Remove after this hand (Leave, for the person) in its details: it leaves when the hand ends, taking its chips, is no longer drawn, and stays in the Players tab and the standings; a table left with one player is over. Both endpoints are `POST tables/{id}/end` and `POST tables/{id}/seats/{n}/leave`, each with `{ on }` so a second press takes it back. Speech bubbles show a line whole, up to five lines and 17rem wide, with seats at the sides keeping theirs inside the window, and a line a model wrapped in its own quotation marks is kept without them.

A model's time limit covers its whole move, the second try included, and the call is watched by a clock of its own beside the request's cancellation (`PokerAgent.Within`), because a GLM seat on Ollama held a live table for minutes past its limit: whatever the provider does with a cancelled stream, the table moves on, checks or folds for the seat and says so. Every model call is logged with its seat, model, time and outcome. A model the provider lists but no longer serves (Ollama still lists a retired DeepSeek) fails at once on every move, and the table folds for it each time with the provider's reason in the log.

Codex can take a seat, working in an empty folder of its own under the server's temporary folder, but it is slow, because each move starts a new Codex thread.

## Keeping a player's keys (stage 3)

A key is stored encrypted, shown back only as its last four characters, and used only for that player's own seats. It never goes into a prompt or a log. The site already has ASP.NET Data Protection with its key ring in the identity database; encrypting with it alone would put the encrypted keys and the means to decrypt them in the same database, so one leaked database would expose both. I recommend envelope encryption: each key encrypted with Data Protection under a purpose of its own, and the ring itself protected by a key-encryption key held only in the server's environment, as the site's other secrets are. A player can delete a key at any time, and deleting the account deletes its keys.

Public seats may use only providers on a fixed list, each at its own published address. A player cannot enter an address of their own, because the server would then make requests to wherever they pointed it, including the server's own network.

Paul agreed to envelope encryption on 2026-10-19.

Public seats may use Anthropic, OpenAI, Google Gemini, OpenRouter (one key reaches many models) and Ollama's cloud (Paul, 2026-10-19). Codex stays with the staff, because it runs a program on the server.

## Open questions

None at present. Whether the home folder really is the right place for a public player's tables is to be settled when stage 3 begins.
