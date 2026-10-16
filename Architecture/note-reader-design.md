# Note Reader: practising the piece you're learning, away from the instrument

Status: proposal, revised 2026-10-16. Nothing is built. The open questions are at the end.

## What it is for

Paul is learning pieces on piano and guitar, and wants to keep practising reading them when he is away from both instruments. Apps that drill random notes are plentiful and don't help: what helps is reading the actual piece he is working on, bar by bar, until reading it is fluent. So the applet is built around the reader's own scores. It shows the piece with a cursor under the first note, and the reader types each note's letter, A to G, with octaves ignored for now. A right letter moves the cursor on, skipping rests. A wrong letter marks an error and the cursor stays. After a set number of wrong tries it can show the answer and move on. For an interval or a chord, the reader names every note in it before the cursor moves.

An earlier draft of this note made generated drills the core. Paul rejected that: drills are what every other app does, and they don't help him. The applet has no drill mode.

## Getting a piece in

Everything depends on getting the piece Paul is learning into the applet, so this comes first.

**MusicXML is the format.** It is the standard exchange format for printed music, and every notation program writes it: MuseScore (free), Sibelius, Dorico, Finale and Guitar Pro. MuseScore.com, where many arrangements are shared, offers MusicXML downloads. The applet reads `.musicxml`, `.xml` and compressed `.mxl`.

**A piece that exists only on paper or as a PDF needs converting first, outside the applet.** Reading printed music from an image (optical music recognition) is a hard problem the applet should not take on. MuseScore 4 imports a PDF through its own recognition service, and Audiveris is a free program that does the same locally; either gives a MusicXML file after some correcting. The applet's help should say this plainly, since it is where most readers will start.

**Pieces live in the site's file system, in a visible folder, `~/scores` by default.** On the public site `~` is the reader's browser, and for a signed-in member with a home on the server it is their server folder, which follows them to any device. The applet follows the same rule as Files and the Editor, so they can see, rename and delete the scores too, and the applet needs no storage of its own. Add a score takes a file from the device.

The scores and what the applet records about them are kept apart (decided with Paul, 2026-10-16):

```
~/scores/                       the reader's pieces, visible
~/.note-reader/<score>.json     each score's position, passages and per-measure tally
~/.config/note-reader.json      settings, including the scores folder
```

A score is the reader's document, not the applet's, so it goes where Files shows it, and where a later applet that also works from scores, such as a player or a page-turner, can find it without reaching into Note Reader's own folder. The record of practice is the applet's housekeeping, never edited by hand, so it goes in a dot-folder as the terminal's `~/.history` does. Paul's first thought was `~/.note-reader/scores`, which keeps everything the applet touches together and can't collide with a folder of the reader's own; the setting "Scores folder" answers that, since the reader can point it anywhere, that folder included. The applet makes the scores folder only when the first piece is added. A record whose score has been renamed or deleted is left behind harmlessly and tidied away by the applet.

**A small sample library** keeps the applet from opening empty for a new visitor: a few pieces under CC0, such as OpenScore's public-domain scores typeset in MusicXML. Each records its source and licence. It is a sample, not a curriculum.

## Rendering

**OpenSheetMusicDisplay (OSMD) draws the score.** Engraving music well is a large field of its own, and the applet should not attempt it. OSMD is BSD-licensed, renders MusicXML in the browser through VexFlow, and has a documented cursor that walks a score by time, giving at each step every note that starts there across the staves. That is the unit this quiz needs: one note, an interval or a chord. It would be vendored as a pinned bundle beside the applet, as CodeMirror and xterm are, and loaded only when the applet opens. Its size, about 1.5 MB before compression, is the main cost.

## Practising a piece

**Choosing the part.** A piano score has a staff for each hand, and practice often means one hand at a time, so the reader chooses right hand, left hand or both. Guitar music is a single staff, often with a tablature staff under it. The tablature gives the answer away, so the applet hides it while quizzing, with a setting to show it.

**Choosing the passage.** Real practice works on a few bars at a time. The reader can start from any measure, by clicking it or naming its number, and can set a passage from one measure to another that loops when it ends, so a hard phrase can be read over and over.

**Picking up where you left off.** Each score remembers its last position, so opening it again carries on there. Within a session the snapshot (`js/snapshot.js`) keeps the step and the tries, so a reload loses nothing.

**Finding the weak bars.** The applet counts the wrong tries in each measure across sessions, and can shade the measures where the reader stumbles most. Practise weak bars then runs the cursor through just those, which is the part of practice that a random drill can never give.

**Away from the piano means a phone or tablet.** The layout has to work at phone width, with a row of large A to G buttons under the score, PUDL's raised buttons, and the score following the cursor as it moves. A physical keyboard's A to G keys work as well.

## The quiz itself

**What counts as one step.** Each step is the set of notes that start together at the cursor, in the part being practised. A tied note's continuation is not a new note and is skipped, as are rests and, at first, grace notes. A step with a single note takes one letter. An interval or chord takes one letter for each distinct note name in it, in any order, so a C major chord with two Cs takes C, E and G. Each right letter marks its notes as named, and the cursor moves when all are named.

**What a letter means.** The letter is the note's name on the staff, ignoring sharps and flats, so an F in G major is answered F. That keeps the first version a test of reading the staff. Asking for the accidental too, with `#` and `b`, can come later as a setting.

**Wrong answers.** A wrong letter flashes the cursor and the status line in the error colour and counts a try against the step and its measure. The setting "Show the answer after" takes a number of wrong tries, or Never. When the limit is reached, the applet marks the missing notes with their names, waits for any key, and moves on.

**Sound.** A right answer can play the note at its written pitch, through the Web Audio API, which ties the written note to the sound Paul knows from his instrument. A setting turns it off.

**Rests** could later take R, which makes the reader notice them rather than skip them.

**Later, octaves.** For a real piece, knowing which C matters, especially on piano. A later version could take the octave from an on-screen keyboard for piano, or a string and fret for guitar, which would also practise finding the note on the instrument.

## As a PUDL applet

The applet is `note-reader` in the registry, in a window and on its own page. Its state string, which a link carries, says which score and which measure. Its settings (scores folder, part, tablature, reveal-after, sound) are kept in `~/.config/note-reader.json` through `pcConfig`, and each score's last position, passages and per-measure tally in `~/.note-reader/`, as above. Its menus are Score (Open, Add a score, Samples), Practice (Start at measure, Set a passage, Practise weak bars, Show answer, Skip) and the applet's Settings.

## To find out before building

A short spike with a real piece of Paul's should confirm three things using only documented OSMD calls: that the cursor gives the right notes for a piano score with both hands and for a guitar score with tablature, that marking named notes is quick enough to feel instant on a long score, and that a page renders acceptably at phone width.

## Open questions for Paul

1. Where do your pieces come from now: MuseScore files, PDFs, printed books? That decides how much the help has to say about converting them.
2. Piano and guitar both from the start, or one first?
3. Answers by letter only, ignoring accidentals, for the first version?
4. Mostly on a phone, a tablet, or a laptop?
5. The name: Note Reader, or something else?
