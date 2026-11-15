// db.js — IndexedDB storage (lives in the phone's browser, works offline).
//
// Stores ("tables"):
//   series    { id, name, nameKey, status, coverColor, createdAt, updatedAt, lastOpenedAt }
//   chapters  { id, seriesId, number, title, words, importedAt, read }   <- light metadata
//   texts     { chapterId, paragraphs: [string] }                       <- heavy chapter text
//   progress  { chapterId, para, offset, percent, updatedAt }
//   covers    { seriesId, blob }                                        <- custom cover images (v2)
//   tags      { id, name, color, order }                                <- your note tags (v3)
//   notes     { id, seriesId, chapterId, sp, so, ep, eo, quote, text, tagIds: [], createdAt, updatedAt } (v3)
//   sounds    { id, name, blob, duration, addedAt }                     <- your own background sounds (v4, not in backups)
//   dictionary { word, entries | null, at }                             <- looked-up definitions, for offline use (v5, not in backups)
//   (tags got seriesId in v5: a series' id, or null for shared tags)
//
// A note points at text with paragraph + character offsets (sp/so = start, ep/eo = end).
// The quoted text is stored too, so a note can find its place again if the chapter is re-imported.
// Chapter notes have no quote and sp = null. tagIds links notes and tags (many-to-many).
//
// series.status: 'reading' | 'waiting' | 'finished' (missing = 'reading')

import { nameKey } from './parser.js';

const DB_NAME = 'reader-app';
const DB_VERSION = 5;
let dbPromise = null;

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    // Upgrades run step by step, so a phone on an older version keeps its data.
    open.onupgradeneeded = event => {
      const db = open.result;
      if (event.oldVersion < 1) {
        const series = db.createObjectStore('series', { keyPath: 'id', autoIncrement: true });
        series.createIndex('nameKey', 'nameKey', { unique: true });

        const chapters = db.createObjectStore('chapters', { keyPath: 'id', autoIncrement: true });
        chapters.createIndex('seriesId', 'seriesId');
        chapters.createIndex('seriesNumber', ['seriesId', 'number'], { unique: true });

        db.createObjectStore('texts', { keyPath: 'chapterId' });
        db.createObjectStore('progress', { keyPath: 'chapterId' });
      }
      if (event.oldVersion < 2) {
        db.createObjectStore('covers', { keyPath: 'seriesId' });
      }
      if (event.oldVersion < 3) {
        const tags = db.createObjectStore('tags', { keyPath: 'id', autoIncrement: true });
        [['Vocabulary', 'blue'], ['Sayings', 'green'], ['Characters', 'purple'], ['Plot', 'red']]
          .forEach(([name, color], order) => tags.add({ name, color, order }));
        const notes = db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
        notes.createIndex('chapterId', 'chapterId');
        notes.createIndex('seriesId', 'seriesId');
      }
      if (event.oldVersion < 4) {
        db.createObjectStore('sounds', { keyPath: 'id', autoIncrement: true });
      }
      if (event.oldVersion < 5) {
        db.createObjectStore('dictionary', { keyPath: 'word' });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  return dbPromise;
}

/** Run fn inside one transaction; resolves with fn's return value once committed. */
async function withTx(storeNames, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    const stores = Object.fromEntries(storeNames.map(n => [n, tx.objectStore(n)]));
    let result;
    Promise.resolve(fn(stores)).then(r => { result = r; }, err => { tx.abort(); reject(err); });
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Remove a chapter's metadata, text and progress inside an open transaction. */
async function removeChapter(s, chapterId) {
  await req(s.chapters.delete(chapterId));
  await req(s.texts.delete(chapterId));
  await req(s.progress.delete(chapterId));
  const noteIds = await req(s.notes.index('chapterId').getAllKeys(chapterId));
  for (const id of noteIds) await req(s.notes.delete(id));
}

// ---------- Series ----------
export const getAllSeries = () => withTx(['series'], 'readonly', s => req(s.series.getAll()));
export const getSeries = id => withTx(['series'], 'readonly', s => req(s.series.get(id)));
export const getSeriesByKey = key =>
  withTx(['series'], 'readonly', s => req(s.series.index('nameKey').get(key)));
export const putSeries = obj => withTx(['series'], 'readwrite', s => req(s.series.put(obj)));

/** Change only some fields of a series (reads the latest copy first). */
export const updateSeries = (id, patch) => withTx(['series'], 'readwrite', async s => {
  const series = await req(s.series.get(id));
  if (!series) return null;
  Object.assign(series, patch);
  await req(s.series.put(series));
  return series;
});

/**
 * Rename a series. If another series already has that name and merge is true,
 * all chapters move into it (chapters it already has are kept from the other series).
 * Returns { id } of the series that remains.
 */
export function renameSeries(id, newName, merge = false) {
  const key = nameKey(newName);
  return withTx(['series', 'chapters', 'texts', 'progress', 'covers', 'notes', 'tags'], 'readwrite', async s => {
    const series = await req(s.series.get(id));
    const other = await req(s.series.index('nameKey').get(key));

    if (!other || other.id === id) {
      series.name = newName.trim();
      series.nameKey = key;
      await req(s.series.put(series));
      return { id };
    }
    if (!merge) return { conflict: other.id };

    const moving = await req(s.chapters.index('seriesId').getAll(id));
    for (const c of moving) {
      const clash = await req(s.chapters.index('seriesNumber').get([other.id, c.number]));
      if (clash) {
        await removeChapter(s, c.id);
      } else {
        c.seriesId = other.id;
        await req(s.chapters.put(c));
        for (const n of await req(s.notes.index('chapterId').getAll(c.id))) {
          n.seriesId = other.id;
          await req(s.notes.put(n));
        }
      }
    }
    // Keep a custom cover if the remaining series has none.
    const cover = await req(s.covers.get(id));
    if (cover && !(await req(s.covers.get(other.id)))) {
      await req(s.covers.put({ seriesId: other.id, blob: cover.blob }));
    }
    await req(s.covers.delete(id));
    // This series' own tags move along; one with the same name as a tag there is joined into it.
    const allTags = await req(s.tags.getAll());
    for (const t of allTags.filter(x => x.seriesId === id)) {
      const same = allTags.find(x => x.seriesId === other.id && x.name.toLowerCase() === t.name.toLowerCase());
      if (same) {
        await retagNotes(s, n => n.seriesId === other.id, t.id, same.id);
        await req(s.tags.delete(t.id));
      } else {
        t.seriesId = other.id;
        await req(s.tags.put(t));
      }
    }
    other.updatedAt = Math.max(other.updatedAt || 0, series.updatedAt || 0);
    other.lastOpenedAt = Math.max(other.lastOpenedAt || 0, series.lastOpenedAt || 0);
    await req(s.series.put(other));
    await req(s.series.delete(id));
    return { id: other.id, merged: true };
  });
}

/** Delete a series with all its chapters, texts, progress and cover. */
export const deleteSeries = id =>
  withTx(['series', 'chapters', 'texts', 'progress', 'covers', 'notes', 'tags'], 'readwrite', async s => {
    const ids = await req(s.chapters.index('seriesId').getAllKeys(id));
    for (const chapterId of ids) await removeChapter(s, chapterId);
    for (const t of await req(s.tags.getAll())) if (t.seriesId === id) await req(s.tags.delete(t.id));
    await req(s.covers.delete(id));
    await req(s.series.delete(id));
    return ids.length;
  });

/** Mark every chapter of a series as read (true) or unread (false). */
export const setSeriesRead = (id, read) => withTx(['chapters'], 'readwrite', async s => {
  const list = await req(s.chapters.index('seriesId').getAll(id));
  for (const c of list) {
    if (c.read !== read) { c.read = read; await req(s.chapters.put(c)); }
  }
});

// ---------- Covers ----------
export const getAllCovers = () => withTx(['covers'], 'readonly', s => req(s.covers.getAll()));
export const putCover = (seriesId, blob) =>
  withTx(['covers'], 'readwrite', s => req(s.covers.put({ seriesId, blob })));
export const deleteCover = seriesId => withTx(['covers'], 'readwrite', s => req(s.covers.delete(seriesId)));

// ---------- Your own background sounds ----------
export const getAllSounds = () => withTx(['sounds'], 'readonly', s => req(s.sounds.getAll()));
export const getSound = id => withTx(['sounds'], 'readonly', s => req(s.sounds.get(id)));
export const addSound = obj => withTx(['sounds'], 'readwrite', s => req(s.sounds.add(obj)));
export const deleteSound = id => withTx(['sounds'], 'readwrite', s => req(s.sounds.delete(id)));

// ---------- Chapters ----------
export const getAllChapters = () => withTx(['chapters'], 'readonly', s => req(s.chapters.getAll()));
export const getChapter = id => withTx(['chapters'], 'readonly', s => req(s.chapters.get(id)));
export const putChapter = obj => withTx(['chapters'], 'readwrite', s => req(s.chapters.put(obj)));
export const getText = chapterId =>
  withTx(['texts'], 'readonly', s => req(s.texts.get(chapterId))).then(t => (t ? t.paragraphs : []));

export async function getChaptersOfSeries(seriesId) {
  const list = await withTx(['chapters'], 'readonly',
    s => req(s.chapters.index('seriesId').getAll(seriesId)));
  return list.sort((a, b) => a.number - b.number);
}

export const findChapter = (seriesId, number) =>
  withTx(['chapters'], 'readonly', s => req(s.chapters.index('seriesNumber').get([seriesId, number])));

/**
 * Save one parsed chapter. Creates the series if needed.
 * mode: 'add' for new chapters, 'replace' to overwrite text of an existing chapter.
 */
export function saveImportedChapter({ seriesName, seriesKey, number, title, paragraphs, words }, mode) {
  return withTx(['series', 'chapters', 'texts'], 'readwrite', async s => {
    const now = Date.now();
    let series = await req(s.series.index('nameKey').get(seriesKey));
    if (!series) {
      const id = await req(s.series.add({
        name: seriesName, nameKey: seriesKey, status: 'reading',
        createdAt: now, updatedAt: now, lastOpenedAt: 0,
      }));
      series = await req(s.series.get(id));
    }

    const existing = await req(s.chapters.index('seriesNumber').get([series.id, number]));
    let chapterId;
    if (existing && mode === 'replace') {
      Object.assign(existing, { title, words, importedAt: now });
      chapterId = await req(s.chapters.put(existing));
    } else if (!existing) {
      chapterId = await req(s.chapters.add({
        seriesId: series.id, number, title, words, importedAt: now, read: false,
      }));
      // New chapters arrived for a series you were waiting on: back to Reading.
      if (series.status === 'waiting') series.status = 'reading';
    } else {
      return { skipped: true };
    }
    series.updatedAt = now;
    await req(s.series.put(series));
    await req(s.texts.put({ chapterId, paragraphs }));
    return { chapterId, seriesId: series.id };
  });
}

// ---------- Progress ----------
export const getProgress = chapterId =>
  withTx(['progress'], 'readonly', s => req(s.progress.get(chapterId)));
export const getAllProgress = () => withTx(['progress'], 'readonly', s => req(s.progress.getAll()));
export const putProgress = obj => withTx(['progress'], 'readwrite', s => req(s.progress.put(obj)));

// ---------- Tags ----------
export async function getAllTags() {
  const list = await withTx(['tags'], 'readonly', s => req(s.tags.getAll()));
  return list.sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id));
}
/** Add a tag. seriesId: the series it belongs to, or null for a tag shared by every series. */
export const addTag = (name, color, seriesId = null) => withTx(['tags'], 'readwrite', async s => {
  const all = await req(s.tags.getAll());
  const order = all.reduce((m, t) => Math.max(m, t.order ?? 0), -1) + 1;
  const tag = { name, color, order, seriesId };
  tag.id = await req(s.tags.add(tag));
  return tag;
});

/** On notes matching `which`, replace tag `from` with tag `to`. */
async function retagNotes(s, which, from, to) {
  for (const n of await req(s.notes.getAll())) {
    if (!which(n) || !n.tagIds?.includes(from)) continue;
    n.tagIds = [...new Set(n.tagIds.map(t => (t === from ? to : t)))];
    await req(s.notes.put(n));
  }
}

/**
 * Make a tag shared (toSeriesId null) or give it to one series.
 * A shared tag given to one series leaves a copy behind in every other series whose
 * notes use it, so no note loses a tag. A tag with the same name already in the
 * new place is joined instead of making a duplicate.
 */
export const moveTag = (id, toSeriesId) => withTx(['tags', 'notes'], 'readwrite', async s => {
  const all = await req(s.tags.getAll());
  const tag = all.find(t => t.id === id);
  if (!tag) return null;
  const sameName = sid => all.find(t => t.id !== id && (t.seriesId ?? null) === sid
    && t.name.toLowerCase() === tag.name.toLowerCase());
  let order = all.reduce((m, t) => Math.max(m, t.order ?? 0), -1);

  if (toSeriesId != null) {
    const users = new Set((await req(s.notes.getAll()))
      .filter(n => n.tagIds?.includes(id) && n.seriesId !== toSeriesId).map(n => n.seriesId));
    for (const sid of users) {
      let copy = sameName(sid);
      if (!copy) {
        copy = { name: tag.name, color: tag.color, order: ++order, seriesId: sid };
        copy.id = await req(s.tags.add(copy));
        all.push(copy);
      }
      await retagNotes(s, n => n.seriesId === sid, id, copy.id);
    }
  }
  const target = sameName(toSeriesId ?? null);
  if (target) {
    await retagNotes(s, () => true, id, target.id);
    await req(s.tags.delete(id));
    return target;
  }
  tag.seriesId = toSeriesId ?? null;
  await req(s.tags.put(tag));
  return tag;
});
export const updateTag = (id, patch) => withTx(['tags'], 'readwrite', async s => {
  const tag = await req(s.tags.get(id));
  if (!tag) return null;
  Object.assign(tag, patch);
  await req(s.tags.put(tag));
  return tag;
});
/** Delete a tag and take it off every note that had it. */
export const deleteTag = id => withTx(['tags', 'notes'], 'readwrite', async s => {
  await req(s.tags.delete(id));
  for (const n of await req(s.notes.getAll())) {
    if (n.tagIds?.includes(id)) {
      n.tagIds = n.tagIds.filter(t => t !== id);
      await req(s.notes.put(n));
    }
  }
});

// ---------- Dictionary (saved lookups) ----------
export const getDefinition = word => withTx(['dictionary'], 'readonly', s => req(s.dictionary.get(word)));
export const putDefinition = obj => withTx(['dictionary'], 'readwrite', s => req(s.dictionary.put(obj)));

// ---------- Notes ----------
export const getAllNotes = () => withTx(['notes'], 'readonly', s => req(s.notes.getAll()));
export const getNote = id => withTx(['notes'], 'readonly', s => req(s.notes.get(id)));
export const getNotesOfChapter = chapterId =>
  withTx(['notes'], 'readonly', s => req(s.notes.index('chapterId').getAll(chapterId)));
/** Add or update a note. Returns its id. */
export const putNote = note => withTx(['notes'], 'readwrite', s => {
  const now = Date.now();
  const copy = { ...note, updatedAt: now };
  if (!copy.createdAt) copy.createdAt = now;
  if (copy.id == null) delete copy.id;
  return req(s.notes.put(copy));
});
export const deleteNote = id => withTx(['notes'], 'readwrite', s => req(s.notes.delete(id)));

// ---------- Whole library (backup & restore) ----------
const ALL_STORES = ['series', 'chapters', 'texts', 'progress', 'covers', 'tags', 'notes'];

/** Read every record of every store, in one consistent snapshot. */
export const exportAll = () => withTx(ALL_STORES, 'readonly', async s => {
  const out = {};
  for (const name of ALL_STORES) out[name] = await req(s[name].getAll());
  return out;
});

/** Replace everything with the given data (all or nothing: if any write fails, nothing changes). */
export const replaceAll = data => withTx(ALL_STORES, 'readwrite', async s => {
  for (const name of ALL_STORES) {
    await req(s[name].clear());
    for (const record of data[name] || []) await req(s[name].put(record));
  }
});

/** How much is in the library. */
export const counts = () => withTx(['series', 'chapters', 'notes'], 'readonly', async s => ({
  series: await req(s.series.count()),
  chapters: await req(s.chapters.count()),
  notes: await req(s.notes.count()),
}));

// ---------- Search ----------
/** Call fn(chapterId, paragraphs) for every stored chapter text, one at a time (low memory). */
export const forEachText = fn => withTx(['texts'], 'readonly', s => new Promise((resolve, reject) => {
  const r = s.texts.openCursor();
  r.onsuccess = () => {
    const cur = r.result;
    if (!cur) { resolve(); return; }
    fn(cur.value.chapterId, cur.value.paragraphs);
    cur.continue();
  };
  r.onerror = () => reject(r.error);
}));
