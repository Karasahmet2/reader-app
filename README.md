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

## Project structure

```
index.html            the single page
css/style.css         all styles (themes are CSS variables)
js/app.js             screens, navigation, reader behavior
js/db.js              IndexedDB storage (series, chapters, texts, progress, covers, tags, notes)
js/parser.js          reads .txt files (header, paragraphs, encoding)
js/settings.js        themes, accents, reading settings
js/notes.js           notes, highlights, tags, Notes tab
js/ui.js              shared helpers: icons, toasts, bottom sheets
js/backup.js          backup file: create, check, restore
sw.js                 offline support (bump VERSION after changes)
manifest.webmanifest  app name and icons for "Add to Home screen"
icons/                app icons
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

1. Change the files, then bump `VERSION` in `sw.js` (`reader-v7` → `reader-v8`).
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
