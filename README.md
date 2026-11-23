# Reader — personal web novel reader

A small app (PWA) for reading .txt chapters of ongoing series on the phone.
Plain HTML, CSS and JavaScript — no build step.

## Phase 1 — what works now

- **Import** one or many `.txt` chapters. Series and chapter number come from the
  `Novel:` / `Chapter N: Title` lines at the top (file name as a fallback).
  Duplicates are detected, with Skip / Replace.
- **Library** with "Continue reading" and your series.
- **Series page** with the chapter list (current, read, new).
- **Reader**: continuous scroll, `_italics_` shown as italics, progress and time left,
  tap the page for controls, previous / next chapter, end-of-chapter card.
- **Your place is saved** (by paragraph, so it survives font and size changes).
- **Text settings**: Night / Dusk / Dim Paper themes, 6 accent colors, Lexend or Inter,
  size 14–24px, line spacing, margins, extra dim, keep screen on.
- Works **offline** once installed.

## Phase 2 — library & series

- **Library**: filter chips (All / Reading / Waiting / Finished), search, and sorting
  (last opened, latest update, title A–Z, most chapters, most unread, date added, reverse).
  Your choice is remembered.
- **Covers**: pick a photo from the gallery (cropped to 5:7 and shrunk), or cycle the tile color.
- **Series status**: Reading / Waiting / Finished. Finishing the last chapter switches to
  Waiting; importing new chapters switches back to Reading.
- **Series options**: rename (or merge into a series with the same name), mark all as
  read/unread, import chapters straight into this series, delete.
- **Jump to chapter** for long series.

## Phase 3 — notes & tags

- **Select text** (long-press a word, drag the handles) → a bar appears at the bottom:
  **Note · Highlight · Copy**.
- **Notes** have any number of tags and free text. Create tags right in the note sheet.
- **Chapter notes**: tap the page → **Notes** → *Add chapter note* (no text selection needed).
- Noted text is **underlined in its tag's color**; plain highlights get a soft background.
  Tap marked text to see, edit or delete the note.
- **Notes tab**: every note grouped by series and chapter, filter by tag, search.
  Tap a note to jump to that exact spot in the chapter.
- **Tag manager** (tag icon in the Notes tab): rename, recolor, delete, add.
- Notes remember the quoted text, so they find their place again if a chapter is re-imported
  with changes.

## Phase 4 — settings & backup

- **Settings tab**: backup status, theme, accent color, text & layout, keep screen on,
  show/hide the progress footer, storage used, and protection from Chrome's automatic cleanup.
- **Backup**: one compressed file (`reader-backup-YYYY-MM-DD.json.gz`) in Downloads with
  every series, chapter text, reading position, read mark, note, tag, cover and your
  reading settings. Upload a copy to Google Drive to be safe.
- **Restore**: pick a backup file; it shows what's in it and what's on the phone now, then
  replaces everything (all or nothing — if anything fails, nothing changes).
- **Weekly reminder**: a small banner in the Library when the last backup is over a week old
  (or there's none yet). "Later" hides it for 3 days.

## Update 2

- **Import a whole folder** (every .txt inside, subfolders too), when the browser supports it.
- **Library cards** tinted with each cover's main color, with a ▶ resume button and a thin
  progress line on every series. New sort: **Most read**.
- **Series page** gets a soft wash of the cover's color at the top.
- **Notes** grouped by series (sort: recent, name, most notes), with a colored bar per tag
  and small tag names.
- **8 themes** (Night, Dusk, Black, Midnight, Forest, Dim Paper, Sepia, Day), **12 accent
  colors**, **8 fonts** (downloaded the first time you pick one), text size **12–24px**.
- **★ favorite themes**: the reader's theme button cycles only through these.
- The **Note · Highlight · Copy** bar appears right under the selected text.

## Update 3

- **19 tag colors** (the 12 accents + Yellow, Mint, Magenta, Brown, Slate, Silver, Olive).
  Tap a tag's color dot in the tag manager to pick from all 19; new tags start with an unused color.
- **Find uses**: in the selection bar (Note · Highlight · Find · Copy) and on note cards.
  Shows every use with its sentence, in this chapter / this series / all series, with an
  editable search term and a "Whole word" switch. Tap a result to jump to that exact spot.
- **Chapter rating** (1–9 stars) and **your thoughts** at the end of every chapter,
  saved automatically. The series page shows the average rating, and each chapter's
  stars and a note icon when you wrote thoughts.

## Update 4

- **Background sounds**: tap the screen while reading → headphones icon (top right).
  6 built-in sounds made by the app itself (Ocean waves, Rain, River, Wind, Fireplace,
  Night crickets), plus **your own** audio files from the phone (birds, forest…).
  Play several at once with a volume for each; all loop without a gap and keep playing
  with the screen off (pause/play from the lock screen). **Sleep timer** 15 / 30 / 60 min,
  fading out over the last 30 seconds. Your own sounds stay on the phone and are not in backups.
- **Library cards** show chapters read out of the total and the series' average rating:
  "40 / 120 read · ★ 6.8".
- **Notes tab**: tapping a note opens it with **Go to text · Edit · Find uses · Copy · Delete**,
  so you can edit without opening the chapter.
- **12 tag colors** that are clearly different from each other (instead of 19, several of
  which looked alike). Existing tags move to the closest new color automatically, each
  tag getting its own color while there are free ones.

## Update 5

- **Define**: select a single word → **Define** (next to Note). Shows pronunciation (tap to
  play), meanings by word type with examples, and similar words, from the Free Dictionary
  API (Wiktionary). Inflected words are looked up in their base form ("regarded" → "regard").
  Every looked-up word is **saved on the phone**, so it works offline the next time.
  **Save as vocabulary note** opens the note sheet with the definition filled in and the
  shared Vocabulary tag picked. Words not in the dictionary (web-novel terms, names) offer
  *Add a note* instead. Needs internet the first time a word is looked up.
- **Tags per series**: each series has its own tags; **shared** tags (Vocabulary, Sayings,
  Likes…) appear in every series. The note sheet shows the series' tags, then the shared
  ones. A new tag belongs to the series you're reading unless you switch on *Share with all
  series*. Colors only need to differ within one series.
- **Notes tab**: pick a series at the top (or All series). Filter chips show that series'
  tags, a divider, then the shared tags.
- **Tag manager**: grouped into Shared and one section per series. ⋯ on a tag: make it
  shared, move it to one series (other series that used it keep a copy), or delete it.
- **Series page menu → Notes & tags** opens the Notes tab on that series.
- Existing tags were sorted automatically: Vocabulary/Sayings/Likes-type names and tags used
  in several series became shared; a tag used in only one series went to that series.

## Update 6

- **Series page tabs: Chapters · Notes · Codex.** The Notes tab shows only that series'
  notes (its own tags, then the shared ones; *Tags* manages them).
- **Bottom bar: Library · Import · Sounds · Settings.** The Sounds page has the same
  controls as the reader's headphones panel. Notes from all series together: the notes
  icon at the top of the Library.
- **Codex**: a small wiki per series. Entries are Characters, Places, Factions, Skills or
  Items, with other names, a few fields (title, lives in, faction, skills, relations…),
  free text, and links between entries. Each entry shows what links to it, the notes that
  mention it, where it first appears, and *Find every mention*.
  Add one by selecting a name while reading → **Codex**, from the reader's Codex tool, or
  from the series page. Names in the Codex get a dotted underline in the text (Settings →
  *Underline Codex names*); tap one for a quick card.
- **Selection bar**: six equal buttons with a short word under each icon —
  Note · Define · Codex · Mark · Find · Copy (Define only for single words).
- **Find**: tapping a use now really scrolls there (a bug used to undo the jump), and a
  small bar lets you step ↑ ↓ through the other uses in the chapter.
- **Reader tools**: Text · Theme · Notes · Codex (chapters are in the top bar).
- The Codex is included in backups.

## Update 7 — better dictionary

- **Merriam-Webster inside Define**: the Learner's Dictionary (clear definitions written for
  people learning English, with examples and pronunciation), then the Collegiate for rarer
  words. Needs two free keys: Settings → Dictionary (see below). Without keys, Define keeps
  using Wiktionary. When a word isn't found, "Did you mean" suggestions are shown.
- **Offline dictionary**: Settings → Dictionary → Download (7.4 MB, Open English WordNet,
  ~152,000 words). Used when there's no internet, and as a backup for words Merriam-Webster
  doesn't have.
- **Open in Cambridge · Oxford · Longman** at the bottom of every Define sheet.
- **Saved words** can be cleared in Settings → Dictionary.
- Merriam-Webster asks apps to show its logo: download it from your dictionaryapi.com account
  and save it as `icons/mw-logo.png`; the Define sheet shows it automatically.

### Getting the Merriam-Webster keys

1. Go to https://dictionaryapi.com/register/index and create a free account.
2. Pick **Merriam-Webster's Learner's Dictionary** and **Merriam-Webster's Collegiate
   Dictionary** as your two APIs, and say it's for personal, non-commercial use.
3. Confirm the email; your two keys appear under *Your Keys* on dictionaryapi.com.
4. In the app: Settings → Dictionary → paste each key into its box.

The keys stay on your phone (and in your backup files), never in the GitHub code.

Offline dictionary data: Open English WordNet 2024 (https://en-word.net), CC BY 4.0.

## Update 8 — two dictionaries in Define

- The Define sheet has a switch at the top: **Merriam-Webster** (Learner's — clear, short
  definitions) and **Wiktionary** (via FreeDictionaryAPI.com — the fuller entry: more
  meanings, sub-meanings, UK/US pronunciation, word forms, similar words).
- It opens on the one you used last. Each word is saved per dictionary, so both tabs work
  offline for words you've looked up before; otherwise the offline pack answers.
- "regarded" in Wiktionary opens the full entry of *regard* ("past tense of regard").
- If one dictionary doesn't have the word, the sheet says so and offers **Show it** when the
  other one does, plus *Did you mean*, **Add a note** and **Add to Codex**.
- Inside the Merriam-Webster tab, a small **Learner's · Collegiate** switch (when both keys are
  set). It remembers your choice; if the chosen one doesn't have the word, the other is shown
  with a short note. Both are saved for offline use.
- Once the offline dictionary is downloaded (Settings → Dictionary), a third tab, **Offline**
  (Open English WordNet), appears and works with no internet at all.
- Wiktionary needs no key (up to 1,000 lookups an hour). Credit: content from Wiktionary
  (CC BY-SA 4.0) via FreeDictionaryAPI.com, shown under every Wiktionary definition.

## Update 9 — Codex structures, chapter-aware

- **Each series has its own Codex structure**: the "rooms" (kinds of things in the book —
  e.g. Characters, Organizations, Concepts for *1984*; Characters, Sects, Martial skills for a
  Murim novel) and their "walls" (fields, and which rooms each field links to).
  A structure never contains entries: you fill the Codex yourself while reading.
- **Codex files** (`Series name.codex.json`) describe a structure. Import them in the Import tab
  (together with chapters or alone) or from the series page → Codex. The app checks the file,
  fixes small mistakes and lists what it changed. *Codex → ⋯ → Codex format guide* has a
  prompt you can give an AI agent to write one from the chapters.
- **Ready-made structures**: Murim / cultivation, Classic novel. Series that already had
  Codex entries keep working with the Murim structure.
- **Chapter-aware**: every entry has *Known from Ch. N* (the chapter you're reading when you
  add it, adjustable). Every connection has *True from Ch. N*, and when a text value changes
  (e.g. a title), the old value stays as history with its chapter.
  While reading, the Codex shows only what was known by that chapter — re-reading Ch. 5 hides
  the "secret brother" you learned about in Ch. 9 (tap **Show** to peek). The entry page has
  **Viewing as of Ch. …**. Switch it all off with *Codex → ⋯ → Hide what comes later*.
- **Export the structure** to reuse it for another book or give it to an agent to improve.
  **Remove this Codex** deletes the structure and its entries.

## Update 17.3 — A 7 × 7 grid

- The rating square now has 3 points on each side of the centre lines: 7 × 7 = 49 points,
  x = forgot −3 … remembered +3, y = hard −3 … easy +3. The two left columns count as forgotten;
  the far-left column (not easy) comes back later today. Tough zone scaled to match:
  (−3,0) · (0,0) · (1.5,−1.5) · (1.5,−3) · (−3,−3).
- Clearer words for each spot ("Barely remembered, a bit hard", "Remembered well, very easy").
- Earlier reviews move to the matching spot on the bigger grid.

## Update 17.2 — The rating square, practice styles

- The diamond is now a **square** with E on top, R right, H bottom, F left: left → right is
  forgot → remembered, bottom → top is hard → easy. 25 points (5 × 5). The two left columns
  count as forgotten. Tough zone: the lower-left area (−2,0) · (0,0) · (1,−1) · (1,−2) · (−2,−2).
- **Practice style** on the Review page (instead of the card-type switches): Mixed · Meaning ·
  Fill the gap · Listening · Write a sentence. A word that can't use the style gets a meaning card.
- **Switch style on any card**: the row under "Vocabulary" (Meaning · Fill the gap · Hear the
  word · Hear a sentence · Write). After a wrong or nearly-right typed answer, "Try another way"
  takes you back to the word in another style; you rate it once, at the end.

## Update 17.1 — Rate on the diamond

- Forgot / Hard / Knew it are replaced by a **diamond**: E (easy) at the top, R (remembered)
  right, H (hard) at the bottom, F (forgot) left. Drag the dot — it snaps to 25 points on a
  dotted grid — and each point shows its next review ("next in 6 days"). Then Next.
- Typed answers place the dot for you (right → remembered side, wrong → F); move it if it felt
  different. The dashed ring is where you put the word last time.
- The 6 points nearest F count as forgotten (comes back later today, or tomorrow if it felt
  easy, and once more at the end of the session).
- **Tough words** = the average of a word's last 3 dots is in the tough zone
  (−2,0) · (0,0) · (1,−1) · (0,−2): forgot or hard. Each shows a small diamond with its trail.
- **Word card → Progress tab**: every review's spot, numbered and joined, a trend line
  (getting easier / harder / steady) and the list of reviews.
- The session summary shows today's answers on the diamond: remembered · tough · forgot.

## Update 17 — Vocabulary review

- **Review** (Library → "Review your words", or the Words page): pick 7, 14 or 21 cards. Due
  words come first, then new words (at most a third), then the words due soonest.
- **Card types** (switch them on/off on the Review page): What does it mean? · Which word fits?
  (type it; any saved form counts, one letter off is "Nearly") · Listen: hear the word · Listen:
  a sentence from your book (the phone's voice reads it) · Use it in your own sentence (known
  words, now and then; saved to My notes).
- The answer side is a small word card: pronunciation, meanings, My notes, memory hook, the
  sentence from your book, forms. Forgot / Hard / Knew it set the next review; a forgotten word
  comes back once more at the end of the session.
- **Progress**: known well (3 weeks+), learning, remembered on time, due in the next 7 days, by
  series. No streaks. **Tough words**: forgotten 4 times or more — add a memory hook.
- Memory hook also on the word card (My notes tab). The schedule is saved on each word, so it's
  in backups. Choices (size, card types, series) are kept in the backup too.

## Update 16.4 — Pronunciation

- Saving a word from Define keeps its written pronunciation (e.g. "UK /ɡlɑːs/ · US /ɡlæs/"),
  shown under the word on its card. Wiktionary and Webster give it; WordNet (offline) doesn't.
- The recording (Webster) is kept on the phone, so it plays without internet. Words saved
  before are kept when the app starts.
- No recording? The speaker button uses the phone's own voice instead (grey button).
- An older word without a pronunciation: word card → Define → Update meanings fills it in.

## Update 16.3 — Sheets hold the page still, and pull down to close

- While a sheet or panel is open (word card, notes, Show in text, Define, sounds…), the chapter
  behind it can't be scrolled any more, so your reading place stays where it was.
- Close a sheet by pulling its handle down — or pull the sheet itself down when it's scrolled to
  its top. A short pull springs back. Tapping outside still closes it too.

## Update 16.2 — Deleted words really go

- Deleting a saved word's last spot (Remove this spot, Delete in Notes, select mode) now deletes
  the word too, so it stops getting the dotted "met again" line in your books. Undo or Trash →
  Restore brings both back.
- Words left behind by deletes before this update are moved to the Trash when the app starts.

## Update 16 — Word card refinements (mockups v16.1)

- **Four icons** on the word card: Forms · Find · Define · Attach (long-press or screen reader
  gives their names). "Where you met it" is gone — Find shows every use, in every form.
- **Find** from the word card searches the word and all its saved forms at once
  ("All forms: regard, regards, regarded"). Typing a new search drops the forms.
- **Define from the word card** opens with your saved meanings already ticked and marked
  "saved". Meanings saved from another tab (or an older note) are under "Saved from elsewhere".
  Tick to add, untick to remove, then **Update meanings · +N new · M removed**.
- **One meaning everywhere**: every vocabulary note shows its word's current meanings and
  My notes — change them once and the Notes lists, series Notes tab and backups all follow.
- The edit sheet is now **Forms of "word"**; the words list sort is **Most saved**.

## Update 15.1 — Back steps through sheets

- **Sheets opened from sheets** now sit on top of each other: the phone's back gesture (and Cancel)
  returns to the sheet you came from instead of closing everything. For example word card → Edit →
  back = the word card again (showing your changes); note card → Edit → Cancel = the note card;
  series ⋯ → Rename → back = the menu. Finishing an action (Save, Delete…) still closes them all.
- Edit / Define / Attach from the word card return to the card when you save.
- An old link to a deleted series or chapter now says so plainly instead of "Something went wrong".
- New test `t08_walkthrough` walks every page, sheet and back route.

## Update 15 — Vocabulary as words

- **Vocabulary is built in**: every series has a Vocabulary tag, always first; it can't be renamed
  or deleted (you can change its colour and the "met again" colour). An old tag called "Vocab…"
  became the built-in one.
- **Words, shared by all series**: a word is saved once and collects every place you met it.
  Old vocabulary notes were turned into words automatically ("verb — …" lines became dictionary
  meanings, the rest became My notes; notes of the same word were joined).
- **Saving from Define**: if the dictionary gives the same entry as a word you saved before
  (e.g. "regarded" → regard), the sheet says "Same word as regard" with **Add to "regard"** or
  **Save as new word**.
- **Word card** (tap a vocabulary note or a dotted word): forms, **Dictionary** (meanings grouped
  by noun / verb / …) and **My notes** tabs, and **Where you met it** (tap to jump there).
  Edit (base form, other forms, detach), Define (add more meanings), Attach… (join with another word).
- **Met again**: other appearances of saved words (any form, any series) get a dotted line in a
  second colour. Switch it off in the eye panel → Notes → "Saved words met again".
- **Words list**: Notes → Words. Search words and forms, sort A–Z / Recently saved / Most met, and
  show all series or only one.
- Deleting a word puts it and its places in the Trash (Undo works).

## Update 14 — Pick the meanings to save, notes inside notes, settings in the backup

- **Define → tick meanings**: tap the meanings you want (from any tab — Webster, Wiktionary,
  Offline); the button becomes "Save 3 meanings · 2 from Webster · 1 from Wiktionary". A ticked
  meaning with an example gets an "Include example" switch. Nothing ticked = first meanings, as before.
- **Notes inside notes**: a word note inside a sentence note gets its own line just below the
  sentence's line, so both colours show. Tapping where they overlap opens "2 notes here" to pick one.
- **Backup**: now also saves your per-series choices (hidden tags and Codex rooms, Codex sort and
  rooms, Notes filters, dictionary tab, sound volumes). "Include dictionary keys" decides whether
  your Merriam-Webster keys go in the file. When restoring you choose whether settings and keys come
  back. Older backups still restore (your current settings stay).

### Tests
`tests/` holds automated checks for the app (navigation, tags, Codex, Trash, tips, this update).
Run them from the reader-app folder with `python3 tests/run_all.py` (needs Python + Playwright).
They aren't needed to use the app.

## Update 13 — Shorter entry line, "Add files", Show tips

- Codex entries say just "Character · Ch. 1" (the "Known from" chapter); tap Ch. 1 to open that
  chapter. How often a name appears is under Find every mention.
- The reader's quick card uses the same line; tap the name row to open the entry.
- Import: the button is now "Add files" (chapters and Codex files).
- Settings → Reading → **Show tips**: switch off the how-to explanations. Status messages, empty
  pages and warnings stay.
- "Underline Codex names" left Settings: use the reader's eye button → Codex → All off instead
  (if it was off, every room is switched off there automatically).

## Update 12 — Codex sorting, getting back, select & delete, Trash

- **Codex tab**: search (also matches other names), room chips with counts (tap several to combine),
  and Sort: A–Z, Recently added, Order of appearance, Recently changed. Remembered per series.
- **Return bar on Codex entries**: "↩ Ch. 41" jumps straight back to where you were reading (or
  "↩ Series"), however many entries deep; the names on the way take you back to that entry.
- **Delete quickly**: every row on an entry page has the ▾ drawer with Edit and Delete. Long-press
  any value or connection to select several ("Select all" per field) and delete them together.
  Notes lists: long-press a note or tap "Select"; then Delete or Tag (add/remove a tag on all).
- **Trash** (Settings → Trash): deleted notes, tags, Codex entries, values and connections go
  here. Every delete shows "… moved to Trash · Undo". Restore puts things back exactly (a tag goes
  back on its notes, an entry gets its connections back). Emptied after 30 days (7 / 90 / Never).
- No more "tap again to delete".

## Update 11 — Navigation fixes and Codex editing

**Getting back where you were**
- Every back arrow now goes back to the page you came from, the same as the phone's back
  gesture (Codex entry → back to the reader, Notes → note → back to Notes, and so on). Only when
  there is nothing behind (opened from a bookmark, after a restart) does it go to its parent page.
- The Notes page has a back arrow.
- Lists keep their scroll position when you come back to them.
- Next / previous chapter replace the reader page, so back leaves the reader instead of walking
  back through every chapter.

**Codex**
- Entry page: each field is its own card, values listed one under another.
  Connections show only the name; the ▾ opens the description, the chapters and an Edit button.
  Tapping the name still goes to that entry.
- Connections can end: "Until → Ended · Last true in Ch. X". Ended ones move to a "Past" group
  with their chapters (e.g. Ch. 6–17).
- "Viewing as of" is one choice for the whole series' Codex: it stays while you move between
  entries ("Back to my progress" resets it). Opening an entry from the reader starts at that chapter.
- Edit anything without deleting it: in the editor every value and connection is a row; tap it to
  change the text, the description, the chapters, or what it links to. The phone's back gesture
  steps back inside the editor.
- Chapter picker instead of − / +: type a number, use "This chapter" / "My progress", or pick
  from the list.
- Reader: the eye button ("Show in text") has two tabs: Notes (as before) and Codex, with a switch
  per room to stop marking those names in the text. Remembered per series.

## Update 10 — Series tags, notes on/off, chapter ranges

- **No more shared tags.** Every series has its own tags. Old shared tags are sorted out
  automatically on first start: a shared tag used in several series becomes a copy in each of
  them (notes keep their tag); one nobody used is removed.
- **Series page → Tags tab**: see every tag with its note count, add a new one, rename it,
  change its colour (colours already used in this series are faded), or delete it (two taps;
  the notes stay, just without that tag).
- **Reader → Notes button** (next to the headphones): switch each tag's notes on or off in the
  text, or use All on / All off. "Highlights & untagged" has its own switch. A dot on the button
  means something is hidden. Remembered per series.
  A note you add under a hidden tag stays visible until you switch that tag once.
  Opening a hidden note from the Notes list also shows it.
- **Series Notes tab → chapter range**: the first chip picks All chapters, Up to where I am,
  From chapter X to Y, or Only one chapter.
- **All-series Notes page**: tag chips are grouped by name, so "Vocabulary" shows the Vocabulary
  notes of every series.
- **Define → Note** uses this series' tag called "Vocabulary" if it has one; otherwise the note
  opens with no tag.

## Project structure

```
index.html            the single page
css/style.css         all styles (themes are CSS variables)
js/app.js             screens, navigation, reader behavior
js/db.js              IndexedDB storage (series, chapters, texts, progress, covers, tags, notes, sounds)
js/parser.js          reads .txt files (header, paragraphs, encoding)
js/settings.js        themes, accents, reading settings
js/notes.js           notes, highlights, tags, Notes tab
js/ui.js              shared helpers: icons, toasts, bottom sheets
js/backup.js          backup file: create, check, restore
js/find.js            Find uses: search chapters, jump to results
js/sounds.js          background sounds: built-in sounds, your own sounds, sleep timer
js/dictionary.js      Define: word lookups, saved definitions for offline use
js/codex.js           Codex: per-series structures, entries, links, chapter-aware views
js/codex-guide.js     the Codex file format, as a prompt for an AI agent
sw.js                 offline support (bump VERSION after changes)
manifest.webmanifest  app name and icons for "Add to Home screen"
icons/                app icons
data/wordnet-en.json.gz  offline dictionary pack (Open English WordNet, CC BY 4.0)
```

## Run it on your computer

1. Open this folder in VS Code (**File → Open Folder**).
2. Install the **Live Server** extension.
3. Right-click `index.html` → **Open with Live Server**.

## Test it on your phone (same Wi‑Fi)

1. Find your computer's local IP (Windows: `ipconfig` → IPv4 address, e.g. `192.168.1.20`).
2. On the phone, open Chrome and go to `http://192.168.1.20:5500`
   (5500 is Live Server's default port).
3. Allow Live Server through the firewall if Windows asks.

Over Live Server (plain `http://`), offline mode and "Install app" are off on purpose,
so your edits show up as soon as you save. Reading, importing and saving all work.

## Put it on GitHub Pages (installable, works offline)

1. In VS Code: **Source Control** panel → **Publish to GitHub** → choose **public**
   (free GitHub Pages needs a public repository; it holds only the app code, never your chapters).
2. On github.com, open the repository → **Settings → Pages** →
   *Deploy from a branch* → branch **main**, folder **/ (root)** → **Save**.
3. After 1–2 minutes the app is at `https://<username>.github.io/<repository>/`.
4. On the phone in Chrome: open that address → **⋮ → Add to Home screen → Install**.
   (Xiaomi/MIUI: if no icon appears, allow *Settings → Apps → Chrome → Other permissions →
   Home screen shortcuts*.)
5. Open it once with internet and open a chapter, so the fonts are saved too.

### Updating the app later

1. Change the files, then bump `VERSION` in `sw.js` (`reader-v31` → `reader-v32`).
2. VS Code Source Control: write a message → **Commit** → **Sync Changes**.
3. Next time the phone opens the app online, the update downloads quietly and is used
   the time after. A small message says when it's ready.

## Your data

Everything is stored in the phone's browser (IndexedDB), nothing is uploaded.
The app asks Chrome to keep its storage persistent. Use Settings → Backup & restore
to save everything to one file now and then.

## Roadmap

1. ✅ Reader + import
2. ✅ Library & series: sorting, filters, covers, status, series options
3. ✅ Notes & tags (selection bar, tag colors, Notes tab)
4. ✅ Backup & restore, settings screen
5. Extras: vocabulary review, EPUB/PDF
