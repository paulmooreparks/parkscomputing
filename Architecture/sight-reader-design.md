# Sight Reader: practising the piece you're learning, away from the instrument

Status: designed, 2026-10-16. Nothing is built yet. The decisions taken with Paul are at the end.

## What it is for

Paul is learning pieces on piano and guitar, and wants to keep practising reading them when he is away from both instruments. Apps that drill random notes are plentiful and don't help: what helps is reading the actual piece he is working on, bar by bar, until reading it is fluent. So the applet is built around the reader's own scores.

The applet teaches reading, not an instrument (Paul, 2026-10-16): a trumpeter or a viola player should be able to use it as well as a pianist or a guitarist. So it has no instrument modes. It works from what is on the page, the parts and staves of the score and whatever clef each is in, treble, bass, alto or tenor. It shows the piece with a cursor under the first note, and the reader types each note's letter, A to G, with octaves ignored for now. A right letter moves the cursor on, skipping rests. A wrong letter marks an error and the cursor stays. After a set number of wrong tries it can show the answer and move on. For an interval or a chord, the reader names every note in it before the cursor moves.

An earlier draft of this note made generated drills the core. Paul rejected that: drills are what every other app does, and they don't help him. The applet has no drill mode.

## Getting a piece in

Everything depends on getting the piece Paul is learning into the applet, so this comes first.

**MusicXML is the format.** It is the standard exchange format for printed music, and every notation program writes it: MuseScore (free), Sibelius, Dorico, Finale and Guitar Pro. MuseScore.com, where many arrangements are shared, offers MusicXML downloads. The applet reads `.musicxml`, `.xml` and compressed `.mxl`.

**A piece that exists only on paper or as a PDF needs converting first, outside the applet.** Reading printed music from an image (optical music recognition) is a hard problem the applet should not take on. MuseScore 4 imports a PDF through its own recognition service, and Audiveris is a free program that does the same locally; either gives a MusicXML file after some correcting. The applet's help should say this plainly, since it is where most readers will start.

**Pieces live in the site's file system, in a visible folder, `~/scores` by default.** On the public site `~` is the reader's browser, and for a signed-in member with a home on the server it is their server folder, which follows them to any device. The applet follows the same rule as Files and the Editor, so they can see, rename and delete the scores too, and the applet needs no storage of its own. Add a score takes a file from the device.

The scores and what the applet records about them are kept apart (decided with Paul, 2026-10-16):

```
~/scores/                       the reader's pieces, visible
~/.sight-reader/<score>.json     each score's position, passages and per-measure tally
~/.config/sight-reader.json      settings, including the scores folder
```

A score is the reader's document, not the applet's, so it goes where Files shows it, and where a later applet that also works from scores, such as a player or a page-turner, can find it without reaching into Sight Reader's own folder. The record of practice is the applet's housekeeping, never edited by hand, so it goes in a dot-folder as the terminal's `~/.history` does. Paul's first thought was `~/.sight-reader/scores`, which keeps everything the applet touches together and can't collide with a folder of the reader's own; the setting "Scores folder" answers that, since the reader can point it anywhere, that folder included. The applet makes the scores folder only when the first piece is added. A record whose score has been renamed or deleted is left behind harmlessly and tidied away by the applet.

**A small sample library** keeps the applet from opening empty for a new visitor: a few pieces under CC0, such as OpenScore's public-domain scores typeset in MusicXML. Each records its source and licence. It is a sample, not a curriculum.

## Rendering

**OpenSheetMusicDisplay (OSMD) draws the score.** Engraving music well is a large field of its own, and the applet should not attempt it. OSMD is BSD-licensed, renders MusicXML in the browser through VexFlow, and has a documented cursor that walks a score by time, giving at each step every note that starts there across the staves. That is the unit this quiz needs: one note, an interval or a chord. It would be vendored as a pinned bundle beside the applet, as CodeMirror and xterm are, and loaded only when the applet opens. Its size, about 1.5 MB before compression, is the main cost.

## Practising a piece

**Choosing what to read.** A score may have several parts, and a part several staves, and a reader often wants only one of them: a pianist one hand at a time, a singer the voice of a song, a violist the viola line of a quartet. The applet lists the score's parts and staves as the score names them, with each staff's clef, and the reader ticks the ones to read; all are ticked at first. The applet knows nothing about which instrument a part is for, and needs to know nothing, since every staff is read the same way. A tablature staff, as guitar music often has, is not notation to read and gives the answer away, so it is hidden while quizzing, with a setting to show it.

**Choosing the passage.** Real practice works on a few bars at a time. The reader can start from any measure, by clicking it or naming its number, and can set a passage from one measure to another that loops when it ends, so a hard phrase can be read over and over.

**Picking up where you left off.** Each score remembers its last position, so opening it again carries on there. Within a session the snapshot (`js/snapshot.js`) keeps the step and the tries, so a reload loses nothing.

**Finding the weak bars.** The applet counts the wrong tries in each measure across sessions, and can shade the measures where the reader stumbles most. Practise weak bars then runs the cursor through just those, which is the part of practice that a random drill can never give.

**Every input on every device** (Paul, 2026-10-16). The keyboard and the on-screen buttons both work everywhere, side by side: a row of A to G buttons with ♯ and ♭ beside them, PUDL's raised buttons, sits under the score on a full-screen PC as well as on a phone, and the keys A to G and the accidental keys work wherever there is a keyboard. They can be mixed within one answer, so a ♭ clicked and then B typed is B flat. The buttons are always shown, never only on touch screens, and are sized for a finger at phone width and for a pointer at desktop width. The score follows the cursor as it moves, whatever the window's size.

## The quiz itself

**What counts as one step.** Each step is the set of notes that start together at the cursor, in the part being practised. A tied note's continuation is not a new note and is skipped, as are rests and, at first, grace notes. A step with a single note takes one letter. An interval or chord takes one letter for each distinct note name in it, in any order, so a C major chord with two Cs takes C, E and G. Each right letter marks its notes as named, and the cursor moves when all are named.

**What a letter means.** By default the letter is the note's name on the staff, ignoring sharps and flats, so an F in G major is answered F. That keeps the default a test of reading the staff.

**The written note, not the sounding one.** A part for a transposing instrument, such as a trumpet in B flat, sounds a different note from the one written; a written C on a B flat trumpet sounds B flat. The answer is always the note as written, since reading the page is what the applet practises, and a trumpeter reads written notes.

**Accidentals, as a setting.** With "Name sharps and flats" on, the answer is the note's full name as it is played: the key signature counts, so an F in G major is F sharp, and so do accidentals earlier in the bar. The spelling must be the written one, so F sharp is not accepted for G flat. The keys:

- **On a keyboard, a key typed before the letter, for sharp and flat alike** (Paul, 2026-10-16): `#` or `=` for sharp, `-` for flat, so F sharp is `=` then F. Shift with the letter, Paul's first thought for sharps, was dropped so that both accidentals work the same way.
- **On screen, a ♯ and a ♭ button** beside the letter buttons, on every device, pressed before the letter in the same way.
- **Why not a modifier for flats.** Paul suggested Ctrl with the letter, but the browser keeps Ctrl with a letter for itself (Ctrl+F finds, Ctrl+D bookmarks, Ctrl+A selects all, and some cannot be taken back), and Alt with a letter opens the browser's menus on Windows. Ctrl+Shift with the letter, Paul's second thought, is no better: on the letters A to G it is tab search, the bookmarks bar, the developer tools' element picker, bookmarking every tab, a browser panel and find-previous, and which of those a page may take back differs between browsers and is documented by none of them, so the design would rest on undocumented behaviour. A key typed before the letter avoids all of it. `b` cannot be the flat key, since B is a note.
- **Doubles and mistakes.** A prefix typed twice is a double sharp or double flat, and Escape drops a prefix typed by mistake.
- **A natural is the letter alone.** The reader has to know the note is natural, which is the point of the setting.

A prefix shows in the status line, and its button stays pressed, until its letter comes. A note answered with the right letter and the wrong accidental is a wrong try, and the revealed answer shows the accidental.

**Wrong answers.** A wrong letter flashes the cursor and the status line in the error colour and counts a try against the step and its measure. The setting "Show the answer after" takes a number of wrong tries, or Never. When the limit is reached, the applet marks the missing notes with their names, waits for any key, and moves on.

**Sound.** A right answer can play the note through the Web Audio API, which ties the written note to its sound. It plays the pitch the instrument would sound, which MusicXML gives in the part's transposition, so a trumpeter hears what their trumpet would play. A setting turns it off.

**Rests** could later take R, which makes the reader notice them rather than skip them.

**Later, octaves.** For a real piece, knowing which C matters. A later version could ask for the octave too, typed as a number after the letter in scientific pitch notation (C4 is middle C), which works the same for every instrument.

## As a PUDL applet

The applet is `sight-reader` in the registry, in a window and on its own page. Its state string, which a link carries, says which score and which measure. Its settings (scores folder, tablature, reveal-after, sound) are kept in `~/.config/sight-reader.json` through `pcConfig`, and each score's last position, passages and per-measure tally in `~/.sight-reader/`, as above. Its menus are Score (Open, Add a score, Samples), Practice (Start at measure, Set a passage, Practise weak bars, Show answer, Skip) and the applet's Settings.

## To find out before building

A short spike with a real piece of Paul's should confirm, using only documented OSMD calls, that marking named notes is quick enough to feel instant on a long score, that a page renders acceptably at phone width, that the cursor can be limited to the staves the reader chose, and that a guitar score's tablature staff can be hidden.

Part of this is already known from choosing the samples (2026-10-16). OSMD 1.9.0, loaded from its CDN for the test only, rendered all nineteen samples without an error, and its cursor walked each from start to end, one note at a time in a single line and up to six notes at a step in a song's piano part. A song renders in under a second. A whole string quartet, Beethoven's Op. 18 No. 1 with 6,500 steps, took 23 seconds, so a long score needs care: the samples use a single quartet movement instead.

## The sample scores

The samples are in the live web root under `scores/`, sorted into `beginner`, `intermediate` and `advanced`, where Paul can add, remove and re-sort them. `scores/CREDITS.md` records where each came from. There are nineteen:

- **Beginner:** four single-line tunes typeset for the site (Twinkle, Twinkle; Ode to Joy; Frère Jacques; Au clair de la lune), and three short, plain songs (Beethoven's Marmotte, Schubert's Morgengruß, Brahms's Volkslied).
- **Intermediate:** six songs by Schubert, Schumann, Strauss and Brahms, including Der Leiermann and Morgen!.
- **Advanced:** four songs in remote keys with dense accompaniment, including Schumann's Frühlingsnacht in six sharps, and a movement of Mozart's quartet K. 464, whose viola part is in the alto clef.

The songs and the quartet come from OpenScore, whose editions are CC0, through a collection that converted them to compressed MusicXML with MuseScore's own converter (codeberg.org/HerrBenedikt/MusicXML). The levels were set by measuring each song's key signature, accidentals, chords and notes per bar, and ranking all 1,028 single-key songs by that. Two other sources in the same collection were left out. Its Galician folk melodies are labelled BSD-2 there, but their own licence puts the scores under CC BY-NC 4.0, which forbids commercial use. Its Mutopia scores were rebuilt from MIDI, so their rhythms and spellings are guesses, which is no use for learning to read. Project Gutenberg's sheet music is public domain in the USA only, and holds only strings and orchestra.

The site serves `.mxl` and `.musicxml` once `Startup.cs` maps their media types, which is done and ships with the applet.

## Decided with Paul, 2026-10-16

- **Pieces come from everywhere**: notation programs, MuseScore.com, PDFs and printed books, and pieces Paul writes himself. The help explains each route. MuseScore's own `.mscz` files are not MusicXML, so a piece written in MuseScore is exported as MusicXML (File, Export) before it is added.
- **No instrument modes.** The applet teaches reading, for any instrument; the reader chooses which of the score's staves to read, and the answer is always the written note.
- **Accidentals** as above: letters only by default; with the setting on, a key before the letter (`#` or `=` sharp, `-` flat) or the ♯ and ♭ buttons.
- **Keyboard and buttons on every device.** Paul uses a desktop or laptop most, and a phone must work too; on all of them both inputs are there and can be mixed, so he can type or click on a full-screen PC.

- **The name is Sight Reader** (Paul, 2026-10-16), `sight-reader` in the registry and in its folders. Note Reader, Sightline, Read Ahead and Staff Work were the other names considered.

Nothing is left open. The next step is the spike above, with one of Paul's own pieces.
