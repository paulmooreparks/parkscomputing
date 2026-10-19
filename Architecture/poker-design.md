# Poker: No-Limit Hold'em against language models

Status: direction agreed with Paul on 2026-10-19; nothing built yet. Stage 1 is next.

## What it is

Poker is an applet in which language models play No-Limit Texas Hold'em. Each seat at a table is a model from some provider (Claude, a model on Ollama, Codex, and later whatever key the player brings), and a person may take a seat or leave every seat to the models and watch them play each other. The chips are play money and stay play money.

## Decisions

### P1. No-Limit Texas Hold'em, two to six seats

Paul chose No-Limit Hold'em (2026-10-19). A table has two to six seats. Other games may come later, and the engine's rules sit behind one interface so that a second game does not mean a second engine, but nothing is built for one now.

### P2. Staff only first, then the public bringing their own keys

At first only the site's staff can play, and the seats use the providers in `/etc/chat.json` with the server's own keys, as the Chat applet does. Later the game opens to the public on a bring-your-own-keys basis (Paul, 2026-10-19): a person signs up, adds one or more API keys (as many as the seats they want to fill need), and starts a table. The site never pays for a public player's model calls.

### P3. A package for the table, a Poker section in the engine for the game

The table is a PUDL applet package, `pudl-poker`, built like `pudl-chat`: it talks to its service through `pudlHost.service('poker')` and draws the table, the cards, the bets and the talk. The game runs in the engine, in `Poker/`: the deck and the shuffle, the betting, the pots and side pots, the showdown, and the model seats' turns. The server is the only thing that knows the hole cards. If the page or a shared prompt held them, any model, or any reader of the page's source, could see them.

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

A person seated at the table gets the same legal moves the engine gives a model, as buttons and a raise amount, and the table waits for them without a time limit. Stage 1 allows one person per table, the person who opened it.

## Stages

1. **The game and a staff table.** The rules engine with its hand evaluator and side pots, under unit tests; the table runner with model seats from `/etc/chat.json`; one optional person seat; watching (P6); table talk (P5); the package's table view; staff only. Each seat shows its token use.
2. **Sessions.** Opponent notes (P7); a persona per seat (a name and a style, such as tight and aggressive); hand history with replay; a table's results over a session.
3. **The public, with their own keys.** Key storage (below), sign-up gating, the provider list for public seats, limits on tables and hands so one person cannot load the server, and the words on the page saying that model calls are billed to the player's own key.
4. **More than one person at a table**, if wanted (open question 1).

## Keeping a player's keys (stage 3)

A key is stored encrypted, shown back only as its last four characters, and used only for that player's own seats. It never goes into a prompt or a log. The site already has ASP.NET Data Protection with its key ring in the identity database; encrypting with it alone would put the encrypted keys and the means to decrypt them in the same database, so one leaked database would expose both. I recommend envelope encryption: each key encrypted with Data Protection under a purpose of its own, and the ring itself protected by a key-encryption key held only in the server's environment, as the site's other secrets are. A player can delete a key at any time, and deleting the account deletes its keys.

Public seats may use only providers on a fixed list, each at its own published address. A player cannot enter an address of their own, because the server would then make requests to wherever they pointed it, including the server's own network.

## Open questions

1. **More than one person at a table.** Paul said people may sit in. Does that mean only the person who opened the table, or friends joining the same table from their own browsers? The second needs seat invitations and the table pushed live to several people. Stage 1 assumes only the opener.
2. **Envelope encryption for stored keys** (above): recommended, for Paul to confirm before stage 3.
3. **Which providers for public seats.** I suggest Anthropic, OpenAI, Google Gemini, OpenRouter (one key reaches many models) and Ollama's cloud. Codex is out for the public, because it runs a program on the server.
4. **Where a public player's tables live.** The member half of the home directory is not built (Paul left it that way on 2026-10-18), so stage 3 either builds it or keeps tables in the database.
