// backup.js — save the whole library to one file, and bring it back.
//
// A backup holds every series, chapter text, reading position, read mark, note,
// tag, Codex entry and cover, plus your settings and per-series choices (hidden tags and
// rooms, Codex and Notes filters, dictionary tab). Your Merriam-Webster keys are included
// unless "Include dictionary keys" is off. It's JSON, gzip-compressed when the browser
// supports it (chapter text shrinks to about a quarter).
//
// Not included: your own sounds (large audio), the Trash, saved dictionary look-ups and the
// offline WordNet pack.

import * as db from './db.js';

const FORMAT = 1; // bump if the file layout ever changes (new optional parts don't need it)

/** Per-series choices and small preferences kept in the browser, saved with the backup. */
const CHOICE_KEYS = [
  'reader-hidden-tags', 'reader-hidden-rooms', 'reader-codex-view', 'reader-notes-sort',
  'reader-notes-series', 'reader-define-tab', 'reader-define-mw', 'reader-sounds',
];
const DICT_KEYS = ['mwLearnersKey', 'mwCollegiateKey'];

const blobToDataUrl = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

const dataUrlToBlob = async url => (await fetch(url)).blob();

const pad = n => String(n).padStart(2, '0');

/** Build the backup file. Returns { blob, filename, size, counts, exportedAt }. */
export async function createBackup(settings) {
  const data = await db.exportAll();
  data.covers = await Promise.all(data.covers.map(async c => ({
    seriesId: c.seriesId,
    image: await blobToDataUrl(c.blob),
  })));

  // Keep reading preferences; leave out backup bookkeeping.
  const { lastBackupAt, backupSnoozeUntil, ...prefs } = settings;
  if (settings.backupKeys === false) DICT_KEYS.forEach(k => delete prefs[k]);
  const local = {};
  for (const k of CHOICE_KEYS) {
    try { const v = localStorage.getItem(k); if (v != null) local[k] = v; } catch { /* private mode */ }
  }
  const exportedAt = Date.now();
  const json = JSON.stringify({ app: 'reader-app', format: FORMAT, exportedAt, settings: prefs, local, data });

  let blob = new Blob([json], { type: 'application/json' });
  let ext = 'json';
  if ('CompressionStream' in window) {
    const gz = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    blob = new Blob([gz], { type: 'application/gzip' });
    ext = 'json.gz';
  }
  const d = new Date(exportedAt);
  return {
    blob,
    filename: `reader-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.${ext}`,
    size: blob.size,
    exportedAt,
    counts: { series: data.series.length, chapters: data.chapters.length, notes: data.notes.length },
  };
}

/** Save a blob to the phone's Downloads folder. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Open and check a backup file. Throws an Error with a readable message if it isn't one. */
export async function readBackup(file) {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  let text;
  if (head[0] === 0x1f && head[1] === 0x8b) {
    if (!('DecompressionStream' in window)) throw new Error('This browser can’t open compressed backups.');
    text = await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  } else {
    text = await file.text();
  }
  let backup;
  try { backup = JSON.parse(text); } catch { backup = null; }
  if (!backup || backup.app !== 'reader-app' || !backup.data || !Array.isArray(backup.data.series)) {
    throw new Error('That file isn’t a Reader backup.');
  }
  if (backup.format > FORMAT) throw new Error('This backup was made by a newer version of the app.');
  return backup;
}

export const summarize = backup => ({
  series: backup.data.series?.length || 0,
  chapters: backup.data.chapters?.length || 0,
  notes: backup.data.notes?.length || 0,
  codex: backup.data.codex?.length || 0,
  exportedAt: backup.exportedAt,
  hasSettings: !!backup.settings && Object.keys(backup.settings).some(k => !DICT_KEYS.includes(k)),
  hasKeys: !!backup.settings && DICT_KEYS.some(k => backup.settings[k]),
});

/**
 * Replace the whole library with the backup.
 *  current: the settings on this phone now
 *  settings: also bring back settings and per-series choices
 *  keys: also bring back the dictionary keys
 * Returns the settings to use from now on.
 */
export async function restoreBackup(backup, { current = {}, settings = true, keys = true } = {}) {
  const d = backup.data;
  const covers = await Promise.all((d.covers || []).map(async c => ({
    seriesId: c.seriesId,
    blob: await dataUrlToBlob(c.image),
  })));
  await db.replaceAll({
    series: d.series || [],
    chapters: d.chapters || [],
    texts: d.texts || [],
    progress: d.progress || [],
    covers,
    tags: d.tags || [],
    notes: d.notes || [],
    codex: d.codex || [],
    words: d.words || [],
  });
  const saved = backup.settings || {};
  let next = { ...current };
  if (settings) {
    const { ...rest } = saved;
    DICT_KEYS.forEach(k => delete rest[k]);
    next = { ...next, ...rest };
    for (const [k, v] of Object.entries(backup.local || {})) {
      if (CHOICE_KEYS.includes(k)) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
    }
  }
  if (keys) DICT_KEYS.forEach(k => { if (saved[k]) next[k] = saved[k]; });
  return next;
}
