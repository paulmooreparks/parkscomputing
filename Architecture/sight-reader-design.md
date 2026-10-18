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

**OpenSheetMusicDisplay (OSMD) draws the score.** Engraving music well is a large field of its own, and the applet should not attempt it. OSMD is BSD-licensed, renders MusicXML in the browser through VexFlow, and has a documented cursor that walks a score by time, giving at each step every note that starts there across the staves. That is the unit this quiz needs: one note, an interval or a chord. It is vendored as a pinned bundle beside the applet, version 2.2.1 (BSD-3-Clause), as CodeMirror and xterm are, and loaded only when the applet opens. Its size, 1.4 MB, or 360 KB compressed, is the main cost.

## Practising a piece

**Choosing what to read: by clef, and by part** (Paul, 2026-10-16). The reader chooses which clefs to practise from those the score uses, so for piano music treble, bass or both. The choice follows the clef in effect at each note, not the staff it is on, so a left hand that moves up into the treble clef for a few bars is treble while it is there. A score in one clef, as most single-staff music is, offers no choice and shows none. A score with several parts, such as a song or a quartet, also lets the reader tick the parts to read, so a singer can read the voice alone or a violist the viola line, with its alto clef. Everything is chosen at first. The applet knows nothing about which instrument a part is for, and needs to know nothing, since every clef is read the same way. A tablature staff, as guitar music often has, is not notation to read and gives the answer away, so it is hidden while quizzing, with a setting to show it.

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

## What the spike found (2026-10-16)

The spike ran on the sample scores, with OpenSheetMusicDisplay loaded from its CDN for the test only, and used only calls in OSMD's documentation. Its script is kept in the session's scratch folder; the applet's own tests will replace it.

**Version 2.2.1, not 1.9.** The documented API is 2.x: `GraphicalNote.setColor`, which marks a note without redrawing, is not in 1.9.0. The applet vendors 2.2.1. It also renders faster, Wolf's Nachtzauber in 342 ms against 724 in 1.9.0.

**Every check passed:**

- **Marking is instant.** Colouring each step's notes and moving the cursor on took a median of 0.3 ms and at most 0.9 ms a step, over all 787 steps and 1,501 notes of Nachtzauber, the longest sample song.
- **Reading one clef or one part works.** The cursor gives every note starting at a step (`Cursor.NotesUnderCursor`, which also takes an instrument), and each note says which staff it is on (`Note.ParentStaff`). The clef in effect is followed through the score's clef instructions as the cursor walks (`SourceStaffEntry.Instructions`), at the start of each measure (`SourceMeasure.FirstInstructionsStaffEntries`), within it, and at its end (`SourceMeasure.LastInstructionsStaffEntries`). The spike missed the last of these and so under-counted the bass clef in Schumann's Frühlingsnacht at 100 notes; the applet, which follows all three, counts 1,219 in the treble clef and 280 in the bass, which is what reading the score's XML note by note gives too. A part can be hidden (`Instrument.Visible`), and the rest of the score still reads.
- **Letters and accidentals** come from each note's pitch (`Pitch.FundamentalNote`, `Pitch.AccidentalHalfTones`): Frühlingsnacht's six sharps read as F♯, C♯ and A♯. A tied note's continuation is told apart by its tie (`Note.NoteTie`) and skipped, 14 of them in that song.
- **The view follows the cursor** (the `followCursor` option): 200 steps into Strauss's Morgen!, the page had scrolled 1,662 pixels and the cursor was in view.
- **Phone width works.** At 390 pixels wide, Ode to Joy and Schubert's Morgengruß render to the screen's width with no sideways scrolling. A song then shows one bar a line, with the part names taking much of the width, so on a narrow screen the applet should draw the score smaller and leave the part names out.

**Still to check:** hiding a guitar score's tablature staff, since no sample has one. That waits for a guitar piece of Paul's.

**A long score needs care.** A whole string quartet, Beethoven's Op. 18 No. 1 with 6,500 steps, took 23 seconds to render in 1.9.0, so the samples use a single quartet movement, which renders in under a second. For a long score of the reader's own, the applet can draw a range of measures at a time (`drawFromMeasureNumber`, `drawUpToMeasureNumber`), which also suits practising a passage.

## What was built (2026-10-17)

The applet is `js/sight-reader.js` and `css/sight-reader.css`, registered in `js/applets.js`, with a page and a menu entry in the live site's content, and `Tools/test-sight-reader.js`, whose 67 browser checks cover everything below. OpenSheetMusicDisplay 2.2.1 is in `js/vendor/osmd-2.2.1`.

**Built:** the quiz, with keys and buttons; the answer shown after a chosen number of wrong tries; sharps and flats named by a key or a button before the letter (`=` or `#` for a sharp, `-` for a flat, ♯ and ♭ buttons beside the letters, which wait for the setting); clefs and parts chosen in an Options dialog, with the clef followed through its changes; a tone for each right letter; samples and files from the device; a reload that brings back the place, the marks and the choices; phone width, and a window.

**The piano keyboard (2026-10-17, Paul).** The default keyboard is a piano of two octaves and the C above them, with the buttons A to G, and ♯ and ♭, as an option. It follows the notes: its range moves only when it would then show more of the step's notes, so it does not jump about between near notes, and its C keys say their octaves. A key the reader clicks has to be the right note in the right octave, and says "Right note, wrong octave" when only the octave is off, which still counts as a wrong try. A letter typed on a PC keyboard has no octave, so any octave of that letter is accepted and the note lights in its own. Named notes stay lit, at their own octave, until every note of the interval or chord is in; the answer, when it is shown, lights the missing notes in red. Black keys are pitches, so with Name sharps and flats on a black key is right for either spelling of it (F sharp or G flat), where a typed or buttoned spelling must match the score's; with it off the black keys are disabled and a white key names its letter, in its octave. A step whose notes are too far apart to be on the keyboard together, a bass note and a melody more than two octaves above it, has the notes that are not on it accept any octave. Next, Paul suggested an option to type the octave as a digit before the letter, as the sharp and flat keys are typed, which would make a typed note judge its octave too.

**Not yet built:** starting at a bar and looping a passage, the weak-bar tally, remembering a score's place between visits, and the reader's own scores in `~/scores` with Add a score. These are the next stage.

**Two things differ from the design above.** Sound plays the pitch as written, where the design said the pitch a transposing instrument would sound. OpenSheetMusicDisplay documents a part's transposition (`Instrument.Transpose`, in half tones) without saying whether it is added to the written pitch or taken from it, and the applet does not guess; a B flat trumpet hears a note a tone higher than its part sounds until that is settled by a test against a score that has a transposition. And `LastInstructionsStaffEntries`, which the clef tracking needs, is a documented accessor whose page has no description, so its meaning, that a clef change at a barline is filed with the bar before it, rests on its name and on the checks above.

## The sample scores

The samples are in the live site's `content/scores/` folder, sorted into `beginner`, `intermediate` and `advanced`, where Paul can add, remove and re-sort them. `CREDITS.md` beside them records where each came from. There are nineteen:

- **Beginner:** four single-line tunes typeset for the site (Twinkle, Twinkle; Ode to Joy; Frère Jacques; Au clair de la lune), and three short, plain songs (Beethoven's Marmotte, Schubert's Morgengruß, Brahms's Volkslied).
- **Intermediate:** six songs by Schubert, Schumann, Strauss and Brahms, including Der Leiermann and Morgen!.
- **Advanced:** four songs in remote keys with dense accompaniment, including Schumann's Frühlingsnacht in six sharps, and a movement of Mozart's quartet K. 464, whose viola part is in the alto clef.

The songs and the quartet come from OpenScore, whose editions are CC0, through a collection that converted them to compressed MusicXML with MuseScore's own converter (codeberg.org/HerrBenedikt/MusicXML). The levels were set by measuring each song's key signature, accidentals, chords and notes per bar, and ranking all 1,028 single-key songs by that. Two other sources in the same collection were left out. Its Galician folk melodies are labelled BSD-2 there, but their own licence puts the scores under CC BY-NC 4.0, which forbids commercial use. Its Mutopia scores were rebuilt from MIDI, so their rhythms and spellings are guesses, which is no use for learning to read. Project Gutenberg's sheet music is public domain in the USA only, and holds only strings and orchestra.

**The applet needs nothing from the site's engine** (Paul asked, 2026-10-17). It is a script, a stylesheet, a page and a menu entry, deployed by copying files as Dice is, with no rebuild. The scores are in `content/scores/` because the site already serves any file type under `/content/` as a download, which `.mxl` needs, since the static-file rule elsewhere refuses types it does not know. The applet first listed the samples from `content/scores/index.json`, written by a tool after every change to the folder, so that it needed nothing from the engine. Paul reversed that later the same day, when a score he added didn't appear: a file dropped into the folder should simply be there. The engine now lists any folder under `/content` that holds a file named `.listed` (`GET /api/site/listing?path=scores`, `Controllers/ContentListingController.cs`), reading the disk on each request, and only such folders, so a folder of drafts is never shown. `content/scores` holds `.listed`, and the applet groups the files itself: by folder, the four levels first, licenses left out. The index and its tool are gone. The listing is general, so a later applet or page can use it the same way.

**Since 2026-10-18 Sight Reader is an applet package** in the repo `pudl-sight-reader` (`applet-packages-design.md`, step 7), so the files named above as `js/…` and `js/vendor/…` are in that package. The package ships its own copy of the samples, with an index its repo's `tools/make-index.js` writes, and the site's `content/scores` reaches it as the service `score-library` (`/api/score-library/`, `Controllers/ScoreLibraryController.cs`), still read from the disk on each request, so a score dropped into the folder still appears at once. Paul chose to keep both, so the applet works with samples on any host and keeps the drop-in folder here.

## Decided with Paul, 2026-10-16

- **Pieces come from everywhere**: notation programs, MuseScore.com, PDFs and printed books, and pieces Paul writes himself. The help explains each route. MuseScore's own `.mscz` files are not MusicXML, so a piece written in MuseScore is exported as MusicXML (File, Export) before it is added.
- **No instrument modes.** The applet teaches reading, for any instrument; the reader chooses which of the score's staves to read, and the answer is always the written note.
- **Accidentals** as above: letters only by default; with the setting on, a key before the letter (`#` or `=` sharp, `-` flat) or the ♯ and ♭ buttons.
- **Keyboard and buttons on every device.** Paul uses a desktop or laptop most, and a phone must work too; on all of them both inputs are there and can be mixed, so he can type or click on a full-screen PC.

- **The name is Sight Reader** (Paul, 2026-10-16), `sight-reader` in the registry and in its folders. Note Reader, Sightline, Read Ahead and Staff Work were the other names considered.

Nothing is left open. The next step is the spike above, with one of Paul's own pieces.

## Bars to practise, and a default change (2026-10-17, Paul)

Name sharps and flats is now on by default, because typing with the keyboard felt wrong when the black keys and the sharp and flat buttons were disabled. A reader whose settings file already holds the old value keeps it.

The toolbar has a first bar and a last bar, a Loop box and a Clear button. Practice starts at the first bar and ends after the last, and with Loop on it goes round again, reporting each round. The bars, the loop and the round survive a reload with the rest of the snapshot. On the applet's own page the title of the piece sits on the line of the page heading, at the right and smaller; in a window or the installed app it stays on the toolbar.

A step now records each of its notes as named or not, instead of naming whole letters, so a piano key names only the note it is on. The library colours every notehead of a chord together, so a chord's heads are matched to its notes by height on the page and only one head is coloured; if they cannot be matched, the whole chord takes the colour.

## The whole keyboard (2026-10-17, Paul)

The piano is always all 88 keys, A0 to C8, which replaces the two octaves that moved with the music and then widened for a chord. Each key is addressed by its MIDI number, so a click is judged against the exact pitch and there is no window to track. When the keys would each be narrower than 2.1rem the board is wider than its box and the box scrolls sideways, by its scrollbar, by touch, or by dragging with the mouse. The keyboard is centred on the range of the notes the piece uses, and it scrolls again only when the notes of the step are out of sight. The octaves cost nothing in the quiz: there is no off-keyboard note, so the rule that let a note below the keys count in any octave is gone.

Amended the same day: the keyboard is not centred on the piece and does not follow the music. It opens centred on middle C and the reader moves it. The white keys are at least 1rem wide (1.9rem on a touch screen) and the board scrolls only when the box cannot hold that, so on a wide page there is no scrolling. On its own page the applet is no longer held to the article column's width. Options has Key labels: every key, only the C keys (the default), or none.

A Help button at the right of the toolbar opens a dialog with a staff for each of the treble, bass, alto and tenor clefs, the notes from the ledger line below to the ledger line above each named with their octave and middle C marked in green. The staves are drawn in SVG by the applet from each clef's lowest line, with the four clef signs as embedded outlines taken from OSMD's Bravura glyphs (SIL OFL), so no font is needed and nothing is fetched.

## The sample scores, regrouped (2026-10-17, Paul)

Songs with a voice part were taken out of the samples (they are kept in `backup/scores-with-voice-2026-10-17` in the content volume), and the samples now have four levels. Simple is one staff of tunes a reader may know, with the same tunes in the bass, alto and tenor clefs so each clef is met on familiar music. Beginner is where the treble and bass clefs are read together, with some longer single-line parts. Intermediate and advanced follow. The piano scores are the piano parts of OpenScore Lieder (CC0), with the voice staff cut away, graded by how many notes a bar holds, how many chords, and how many accidentals and sharps or flats there are. The violin, viola and cello scores are single parts cut from OpenScore string quartets. The graded set was made by `Tools/make-scores.js`, which reads the MusicXML collection at https://codeberg.org/HerrBenedikt/MusicXML and rate-limits itself because the site answers 429 to a fast reader. The extra tunes and their clef versions come from `Tools/make-tunes.js`. The applet's chooser knows the four levels. Three Lieder with a voice part are kept as files in `Tools/test-scores` for the tests, which need a real song with a voice and a piano.

MIDI-derived Mutopia piano pieces were looked at and left out: their clefs, staves and spellings are unreliable.

## For later: fingerboards and wind instruments (2026-10-17, Paul)

Paul would like a clickable fingerboard as another way to answer, beside the letters and the piano: guitar, bass guitar, violin, viola, cello, double bass, mandolin, ukulele and similar. He is not sure wind instruments can be done the same way. Nothing here is built.

**Stringed instruments fit the quiz as it is.** The piano already answers by pitch: each key has one MIDI number and a click is right when it is the pitch of a note in the step. A fingerboard is the same thing with a grid in place of a row, where each position (a string and a fret, or for a bowed instrument a string and a semitone from the open string) has a pitch, and the judging, the lit keys, the wrong-octave message and the typed-letter path stay as they are. Open questions are the following.
- The same pitch lies on several strings. The first version accepts any position that has the right pitch, as the piano accepts the right key, and lights the one clicked. Training for a position (for example the first position on a violin) is a later option.
- Written and sounding pitch differ for the guitar and the double bass, which sound an octave below what is written, and the bass guitar likewise. The board should be labelled by written pitch, so the reader presses the position that matches the page, and sound should follow the transposition when the applet corrects for it.
- A bowed instrument has no frets. A grid of semitones over the first two or three octaves of each string, with the open strings marked, is enough for reading practice, and it makes no claim about intonation.
- The tunings are G D A E for the violin and mandolin, C G D A for the viola and cello, E A D G for the double bass and bass guitar (and E A D G B E for the guitar, G C E A for the ukulele), with the number of frets as a setting. The board scrolls sideways when it does not fit, as the piano does, and takes the same key labels.
- A score for the instrument could choose it by default, from the part name.

**Wind instruments are possible, but the answer is a fingering, not a pitch.** A trumpet or euphonium has three valves and eight combinations, a recorder or tin whistle has holes to cover, a flute, clarinet and saxophone have keys and several registers reached by the same fingering. A diagram of valves or holes can be clicked, and the answer is right when the fingering is one that produces the note. That needs a chart for each instrument written by hand, the transposition of each (B-flat trumpet and clarinet, E-flat alto saxophone), and a rule for which octave a fingering gives, since overblowing reaches several notes from one fingering. A trumpet and a recorder are small enough to do first. A cheaper start for any wind instrument is to show the fingering for the note under the cursor as a reference, without asking for it.

**Related:** some scores carry a guitar tablature staff, which the quiz now skips (`Staff.isTab`). The same board could show where the cursor's note is on the neck.

## Guitar and violin fingerboards, built as a proof of concept (2026-10-17, Paul)

Options now offers a guitar fingerboard and a violin fingerboard beside the piano and the letters. The mockups are in `Architecture/mockups/sight-reader-fingerboards.html`, made by `Tools/mockup-fingerboards.js`; the applet draws the same board in SVG itself (`fingerboardMarkup`), so there is no image to license. The nut is at the left, the highest string at the top and the lowest at the bottom, as in tablature, with the open string in a column left of the nut. The guitar has 15 frets and wires and inlays; the violin has no frets, only a faint line at each semitone over 14 positions. Labels are the written pitch.

A position is judged by its pitch, as a piano key is, so any position with the right pitch is right, on any string, and a typed letter still names one note at a time. A named pitch is lit on every string it lies on, and after a right press the other places it lies are ringed in dashes for about two seconds. With Name sharps and flats off the black-key positions are dimmed and cannot be pressed, and the Key labels option applies. A note outside the instrument's range (below the guitar's written E3, say) is named by that letter in any octave, lowest first, as notes below the keys once were. The board scrolls sideways under 46rem. Nothing is played on a fingerboard yet except the pitch of a right answer.

**Play mode, for later.** Paul suggests a mode where the piece plays at a configurable speed and the notes light on the chosen instrument. It would reuse the step list and the lighting: a timer walks the steps in time, lights each step's pitches on the keyboard or fingerboard (and the alternatives on a fingerboard, as a suggestion of where to put the fingers), moves the cursor, and plays the tones, with a tempo control (from the score's marking, scaled) and Pause. The steps already carry the pitches but not the durations, so the build pass would need to note each step's length from the score. Rests and ties would need thought: the step list leaves rests out, so a player needs them back to keep time.

## Options, Read and Help, reworked (2026-10-17, Paul)

Mockups: `Architecture/mockups/sight-reader-options.html`, drawn with the site's PUDL. Options was one long dialog that mixed preferences with a choice about the piece, and put a paragraph under every control. It is now two PUDL settings cards, Answer on (the keyboard, as a segmented control of piano, guitar, violin and letters, and the names on the keys) and Marking (a switch for Name sharps and flats, a segmented control for the wrong tries before the answer is shown, a switch for sound), with no paragraphs, and a title attribute on a control where a hover helps. A segmented control shows every choice at once and takes one click, where the select it replaces hid them; a switch is PUDL's control for a setting that takes effect at once.

The clefs and parts of the piece moved to a new Read dialog, from a Read… button beside Options. Clefs are toggle segments and parts are a scrolling list with a check box and an Only link on each row, All, and a filter box when there are more than eight. A part with no note to read is listed, greyed, saying so. The note counts are gone from the screen (the controls carry them in `data-notes` for the tests). Read is disabled for a piece with one clef and one part. When less than the whole piece is read, a line under the toolbar says which ("Reading 1 of 10 parts. change"), and the Read button's tooltip says it too. Read is a dialog, not a docked pane, which Paul chose.

Help is real help, in three tabs: Getting started, Answering, and Clefs, the last holding the staves drawn before. It opens from the Help button at the right of the toolbar and from the Sight Reader menu. The tabs use PUDL's tab look but are switched by the applet, because pudl-tabs.js records the chosen panel in the page's address, which a dialog should not do.

## Six more fingerboards (2026-10-17, Paul)

Bass guitar, ukulele, mandolin, viola, cello and double bass join the guitar and violin, each a line in `BOARDS` (open strings at their written pitch, fret count, fretted or not), with no new drawing or judging code. The bass guitar and the double bass are written an octave above the sound, as the guitar is, so their open strings are the written E2, A2, D3 and G3. The ukulele's G string is higher than its C but lies below it, so its strings are drawn in the order a player holds them rather than by pitch. A mandolin's paired strings are drawn as one. Options lists the instruments in a select grouped as keyboard, fingerboards, and the letters. The banjo is left for later, since its short fifth string begins at the fifth fret.

## Play (2026-10-17, Paul)

Play and Stop glyph buttons at the right of the toolbar, before Help, with a speed beside them (50% to 150% of the score's tempo, kept in the settings), plays the piece from where the cursor is, within the bars chosen and round again with Loop. Each step moves the cursor, lights its notes in blue on whichever instrument is shown (every place a note lies on a fingerboard, its key on the piano, its letter on the letters), and sounds them for their length when sound is on. The button reads Stop while it plays; Stop, any answer, Restart or another score ends it, and the cursor goes back to the quiz, which Play leaves untouched. Each step now keeps when it sounds (`CurrentEnrolledTimestamp`, in whole notes, with repeats played out) and the length of its longest note, so rests take their time. The tempo is the score's opening one (`DefaultStartTempoInBpm`, 100 if the score has none); later tempo changes are not followed yet.

## Starting faster, and a choice made while starting (2026-10-17, Paul)

Paul found the applet slow to start and, worse, that a score he chose during the start was replaced by the one in the address or the snapshot once the start finished. The applet waited for the reader's settings before it asked for the music library and the score, so the three slow fetches ran one after another. Now the library and the score the page opens on are fetched at once, beside the settings, and the page head preloads the library (`<link rel="preload">` in `content/sight-reader.html`), so it starts with the page. The score is still read only after the settings are in, since how notes are named depends on them. While it starts the applet says "Opening <score>…". If the reader opens a score before the start finishes, the start does not open its own over it. Measured over the internet through Cloudflare from a cold browser, the time to the drawn score went from about 8.4 seconds to about 5.5; a warm reload takes about one second. Most of what is left is the site's own pages and scripts coming through Cloudflare, which revalidates them with the server every four hours because the server sends no long cache lifetime for files whose names never change.
