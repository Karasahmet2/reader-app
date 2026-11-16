// app.js — screens, navigation and reading behavior.
//
// Screens (hash routes, so the phone's back button works):
//   #/            Library
//   #/import      Import
//   #/series/ID   Series page with chapter list
//   #/read/ID     Reader

import * as db from './db.js';
import { parseChapter, decodeBytes, nameKey } from './parser.js';
import {
  THEMES, ACCENTS, FONTS, MIN_SIZE, MAX_SIZE, themeById, isLightTheme, ensureAllFonts,
  loadSettings, saveSettings, applySettings,
} from './settings.js';
import {
  esc, fmtNum, plural, I, toast, openOverlay, closeOverlay, openSheet, isOverlayOpen,
} from './ui.js';
import * as notes from './notes.js';
import * as backup from './backup.js';
import * as find from './find.js';
import * as sounds from './sounds.js';
import * as dictionary from './dictionary.js';
import * as codex from './codex.js';

const app = document.getElementById('app');
const fileInput = document.getElementById('file-input');
const imageInput = document.getElementById('image-input');
const folderInput = document.getElementById('folder-input');

let settings = loadSettings();
applySettings(settings);

let cleanupView = null;     // runs before leaving a screen (e.g. saves reading position)
let activeReader = null;    // hooks into the open reader, used to keep your place when text settings change
let seriesOrderDesc = false;
let currentSeries = null;   // series shown on the series page (for its menus)
let importTarget = null;    // when set, imported files all go into this series
let libQuery = '';          // library search text
let libSearchOpen = false;

const STATUS = {
  reading: { label: 'Reading', hint: 'You’re following it right now' },
  waiting: { label: 'Waiting', hint: 'Caught up, waiting for new chapters' },
  finished: { label: 'Finished', hint: 'The story is over for you' },
};
const statusOf = s => (STATUS[s?.status] ? s.status : 'reading');

const SORTS = {
  opened: 'Last opened',
  updated: 'Latest update',
  title: 'Title A–Z',
  chapters: 'Most chapters',
  read: 'Most read',
  unread: 'Most unread',
  added: 'Date added',
};

/* ------------------------------------------------------------------ helpers */

/** Escape a paragraph, then turn _text_ into italics (inner thoughts in your files). */
const inline = text => esc(text).replace(/(^|[^\w])_([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>');

/* ------------------------------------------------------------------ covers */
// Auto-generated tiles: the color comes from the name, or from series.coverColor
// once you tap "New tile color". Custom images are kept in IndexedDB.

const COVERS = [
  ['#3a2f22', '#e0bd85'], ['#22302d', '#a8c9bf'], ['#30263a', '#cbb3d6'],
  ['#2c2d22', '#c8c99f'], ['#22293a', '#b0c3e6'], ['#3a2426', '#e3b0aa'],
];
const coverUrls = new Map(); // seriesId -> object URL of the custom image
let coversLoaded = false;

const coverColors = new Map(); // seriesId -> "r, g, b" main color of the custom image

/** The main color of a photo: average of a tiny copy, made a little livelier. */
async function imageColor(blob) {
  try {
    const bmp = await createImageBitmap(blob, { resizeWidth: 16, resizeHeight: 16 });
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, 16, 16);
    bmp.close?.();
    const px = ctx.getImageData(0, 0, 16, 16).data;
    let r = 0; let g = 0; let b = 0;
    for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
    const n = px.length / 4;
    [r, g, b] = [r / n, g / n, b / n];
    const gray = (r + g + b) / 3;
    [r, g, b] = [r, g, b].map(v => gray + (v - gray) * 1.5);          // more color
    const max = Math.max(r, g, b, 1);
    if (max < 150) [r, g, b] = [r, g, b].map(v => v * (150 / max));   // not too dark to see
    return [r, g, b].map(v => Math.round(Math.min(255, Math.max(0, v)))).join(', ');
  } catch {
    return null;
  }
}

async function loadCovers() {
  if (coversLoaded) return;
  for (const c of await db.getAllCovers()) {
    coverUrls.set(c.seriesId, URL.createObjectURL(c.blob));
    const color = await imageColor(c.blob);
    if (color) coverColors.set(c.seriesId, color);
  }
  coversLoaded = true;
}

async function setCoverUrl(seriesId, blob) {
  if (coverUrls.has(seriesId)) URL.revokeObjectURL(coverUrls.get(seriesId));
  coverColors.delete(seriesId);
  if (blob) {
    coverUrls.set(seriesId, URL.createObjectURL(blob));
    const color = await imageColor(blob);
    if (color) coverColors.set(seriesId, color);
  } else {
    coverUrls.delete(seriesId);
  }
}

const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ');

/** "r, g, b" color used for the gradients behind a series: its photo, or its tile's color. */
function coverRgb(series) {
  return coverColors.get(series.id) || hexToRgb(COVERS[tileIndex(series)][1]);
}

function tileIndex(series) {
  if (Number.isInteger(series.coverColor)) return series.coverColor % COVERS.length;
  let h = 0;
  for (const ch of series.name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % COVERS.length;
}

/** series: a series object, or just a name (for series that don't exist yet). */
function cover(series, size) {
  const s = typeof series === 'string' ? { name: series } : series;
  const url = s.id != null && coverUrls.get(s.id);
  if (url) {
    return `<span class="cover cover-${size} has-img" aria-hidden="true"><img src="${url}" alt=""></span>`;
  }
  const [bg, fg] = COVERS[tileIndex(s)];
  return `<span class="cover cover-${size}" style="background:${bg};color:${fg}" aria-hidden="true">${esc(s.name)}</span>`;
}

/** Shrink and crop a photo to a 5:7 cover so storage stays small. */
async function makeCoverBlob(file) {
  const bmp = await createImageBitmap(file);
  const ratio = 5 / 7;
  let sw = bmp.width;
  let sh = bmp.height;
  if (sw / sh > ratio) sw = sh * ratio; else sh = sw / ratio;
  const sx = (bmp.width - sw) / 2;
  const sy = (bmp.height - sh) / 2;
  const outH = Math.min(700, Math.round(sh));
  const outW = Math.round(outH * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  canvas.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, outW, outH);
  bmp.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not process image'))), 'image/jpeg', 0.85));
}

/* ------------------------------------------------------------------ small UI helpers */

function relDay(ts) {
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString();
}

function ring(p) {
  const c = 56.5;
  return `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="var(--surface-3)" stroke-width="3"/><circle cx="12" cy="12" r="9" fill="none" stroke="var(--accent)" stroke-width="3" stroke-dasharray="${(c * p).toFixed(1)} ${c}" stroke-linecap="round" transform="rotate(-90 12 12)"/></svg>`;
}

function nav(active) {
  const link = (id, href, label, icon) =>
    `<a href="${href}"${active === id ? ' aria-current="page"' : ''}>${icon}${label}</a>`;
  return `<nav class="bottom-nav" aria-label="Main">
    ${link('library', '#/', 'Library', I.library)}
    ${link('import', '#/import', 'Import', I.import)}
    ${link('sounds', '#/sounds', 'Sounds', sounds.HEADPHONES)}
    ${link('settings', '#/settings', 'Settings', I.settings)}
  </nav>`;
}

/** Close the open sheet and redraw the current screen with fresh data. */
function closeAndRefresh() {
  closeOverlay();
  route();
}

/* ------------------------------------------------------------------ router */

async function route() {
  if (cleanupView) {
    const fn = cleanupView;
    cleanupView = null;
    await fn();
  }
  document.body.classList.remove('controls-open');
  const parts = (location.hash.replace(/^#/, '') || '/').split('/');
  const [, view, id, sub, subId] = parts;
  // #/read/ID/find/PARA/NTH/WHOLE/TERM — open a chapter at a search result
  const findJump = sub === 'find'
    ? { para: Number(parts[4]), nth: Number(parts[5]), whole: parts[6] === '1', term: decodeURIComponent(parts.slice(7).join('/')) }
    : null;
  const keepScroll = view === (route.lastView) && view !== 'read';
  const y = window.scrollY;
  route.lastView = view;
  try {
    await loadCovers();
    if (view === 'series' && id) await renderSeries(Number(id), sub);
    else if (view === 'codex' && id) await codex.renderEntryPage(app, Number(id));
    else if (view === 'read' && id) await renderReader(Number(id), sub === 'note' ? Number(subId) : null, findJump);
    else if (view === 'import') await renderImport();
    else if (view === 'notes') await notes.renderNotes(app, nav(''), s => cover(s, 'xs'), id ? Number(id) : null);
    else if (view === 'sounds') await sounds.renderSoundsPage(app, nav('sounds'));
    else if (view === 'settings') await renderSettings();
    else if (view === 'backup') await renderBackup();
    else await renderLibrary();
    window.scrollTo(0, keepScroll ? y : (view === 'read' ? window.scrollY : 0));
  } catch (err) {
    console.error(err);
    app.innerHTML = `<main class="page"><div class="empty">
      <strong>Something went wrong</strong><span>${esc(err.message)}</span>
      <a class="btn" href="#/">Back to library</a></div></main>`;
  }
}

window.addEventListener('hashchange', route);

/* ------------------------------------------------------------------ library data */

async function loadGroups() {
  const [series, chapters, progress] = await Promise.all([
    db.getAllSeries(), db.getAllChapters(), db.getAllProgress(),
  ]);
  const chapterById = new Map(chapters.map(c => [c.id, c]));
  const groups = new Map(series.map(s => [s.id, { series: s, chapters: [], latest: null }]));
  for (const c of chapters) groups.get(c.seriesId)?.chapters.push(c);
  for (const p of progress) {
    const c = chapterById.get(p.chapterId);
    const g = c && groups.get(c.seriesId);
    if (g && (!g.latest || p.updatedAt > g.latest.updatedAt)) g.latest = { ...p, chapter: c };
  }
  for (const g of groups.values()) {
    g.chapters.sort((a, b) => a.number - b.number);
    g.unread = g.chapters.filter(c => !c.read).length;
    g.readCount = g.chapters.length - g.unread;
    const rated = g.chapters.filter(c => c.rating);
    g.avgRating = rated.length ? rated.reduce((sum, c) => sum + c.rating, 0) / rated.length : 0;
  }
  return [...groups.values()];
}

/** Where "Continue" should take you in a series. */
function continueTarget(g) {
  if (!g.latest) return null;
  const c = g.latest.chapter;
  if (c.read && g.latest.percent >= 0.97) {
    const next = g.chapters.find(x => x.number > c.number);
    if (next) return { chapter: next, percent: 0 };
  }
  return { chapter: c, percent: g.latest.percent || 0 };
}

const newCount = g => (g.series.lastOpenedAt
  ? g.chapters.filter(c => !c.read && c.importedAt > g.series.lastOpenedAt).length
  : 0);

const lastActive = g =>
  Math.max(g.series.lastOpenedAt || 0, g.latest?.updatedAt || 0) || g.series.createdAt || 0;

function sortGroups(groups) {
  const by = {
    opened: (a, b) => lastActive(b) - lastActive(a),
    updated: (a, b) => (b.series.updatedAt || 0) - (a.series.updatedAt || 0),
    title: (a, b) => a.series.name.localeCompare(b.series.name, undefined, { sensitivity: 'base', numeric: true }),
    chapters: (a, b) => b.chapters.length - a.chapters.length,
    read: (a, b) => b.readCount - a.readCount,
    unread: (a, b) => b.unread - a.unread,
    added: (a, b) => (b.series.createdAt || 0) - (a.series.createdAt || 0),
  }[settings.libSort] || ((a, b) => lastActive(b) - lastActive(a));
  const sorted = [...groups].sort((a, b) => by(a, b) || a.series.name.localeCompare(b.series.name));
  return settings.libReverse ? sorted.reverse() : sorted;
}

function seriesSubtitle(g) {
  const status = statusOf(g.series);
  const count = plural(g.chapters.length, 'chapter');
  if (status === 'finished') return `Finished · ${count}`;
  const t = continueTarget(g);
  const last = g.chapters[g.chapters.length - 1];
  if (status === 'waiting') {
    return g.unread ? `Waiting · ${plural(g.unread, 'unread chapter')}` : 'Waiting for chapters · caught up';
  }
  if (!t) return `Not started · ${count}`;
  return `Reading · Ch. ${fmtNum(t.chapter.number)} of ${fmtNum(last?.number)}`;
}

/* ------------------------------------------------------------------ library screen */

let libGroups = [];

async function renderLibrary() {
  libGroups = await loadGroups();

  if (!libGroups.length) {
    app.innerHTML = `<main class="page">
      <div class="row-head"><h1 class="page-title">Library</h1></div>
      <div class="empty">
        <span class="empty-ico">${I.file}</span>
        <strong>Your library is empty</strong>
        <span>Import your first .txt chapters to start reading.</span>
        <a class="btn btn-accent" href="#/import">${I.plus} Import chapters</a>
      </div></main>${nav('library')}`;
    return;
  }

  const filters = ['all', 'reading', 'waiting', 'finished'];
  const counts = { all: libGroups.length };
  for (const f of filters.slice(1)) counts[f] = libGroups.filter(g => statusOf(g.series) === f).length;

  app.innerHTML = `<main class="page">
    <div class="row-head">
      <h1 class="page-title">Library</h1>
      <span class="head-actions">
        <a class="icon-btn" href="#/notes" aria-label="Notes from all series">${I.notes}</a>
        <button type="button" class="icon-btn" data-action="toggle-search" aria-label="Search library" aria-expanded="${libSearchOpen}">${I.search}</button>
      </span>
    </div>
    ${libSearchOpen ? `<label class="search-box">
      ${I.search}
      <span class="visually-hidden">Search series</span>
      <input id="lib-search" type="search" placeholder="Search series" value="${esc(libQuery)}" autocomplete="off">
    </label>` : ''}
    ${backupBanner()}
    <nav class="filter-chips" aria-label="Filter series">
      ${filters.map(f => `<button type="button" data-filter="${f}" aria-pressed="${settings.libFilter === f}">
        ${f === 'all' ? 'All' : STATUS[f].label}${f !== 'all' && counts[f] ? ` <span class="count">${counts[f]}</span>` : ''}
      </button>`).join('')}
    </nav>
    <div class="list-meta">
      <span id="lib-count"></span>
      <button type="button" class="sort-btn" data-action="open-sort">${I.sort}${SORTS[settings.libSort]}${settings.libReverse ? ' (reversed)' : ''}</button>
    </div>
    <section class="series-list cards" id="lib-list" aria-label="Series"></section>
  </main>${nav('library')}`;

  drawLibraryList();

  const search = document.getElementById('lib-search');
  if (search) {
    search.addEventListener('input', () => { libQuery = search.value; drawLibraryList(); });
    if (!libQuery) search.focus();
  }
}

function drawLibraryList() {
  const q = nameKey(libQuery || '');
  const searching = libSearchOpen && q;
  const filter = settings.libFilter;
  const shown = sortGroups(libGroups.filter(g =>
    (filter === 'all' || statusOf(g.series) === filter)
    && (!searching || g.series.nameKey.includes(q))));

  document.getElementById('lib-count').textContent = `${shown.length} series`;

  const list = document.getElementById('lib-list');
  if (!shown.length) {
    list.innerHTML = `<div class="empty" style="padding:32px 16px">
      <span>${searching ? `No series match “${esc(libQuery)}”` : `No series marked ${STATUS[filter].label}`}</span></div>`;
    return;
  }
  list.innerHTML = shown.map(seriesCard).join('');
}

/** One library card: cover, name, where you are, and a resume button. */
const count = n => n.toLocaleString('en-US');

function seriesCard(g) {
  const s = g.series;
  const status = statusOf(s);
  const t = continueTarget(g);
  const fresh = newCount(g);
  const firstUnread = g.chapters.find(c => !c.read) || g.chapters[0];
  let sub;
  let progress = '';
  let button;

  if (status === 'finished') {
    sub = 'Finished';
    button = `<span class="resume is-done" aria-hidden="true">${I.check}</span>`;
  } else if (!g.unread && g.chapters.length) {
    sub = status === 'waiting' ? 'Waiting · caught up' : 'Caught up';
    button = `<span class="resume is-done" aria-hidden="true">${I.check}</span>`;
  } else if (t) {
    const pct = Math.round(t.percent * 100);
    sub = `Ch. ${fmtNum(t.chapter.number)} · ${pct}%${fresh ? ` · ${fresh} new` : ''}`;
    progress = `<span class="mini-progress" aria-hidden="true"><span style="width:${pct}%"></span></span>`;
    button = `<a class="resume" href="#/read/${t.chapter.id}" aria-label="Continue ${esc(s.name)}, chapter ${fmtNum(t.chapter.number)}">${I.play}</a>`;
  } else {
    sub = 'Not started';
    button = firstUnread
      ? `<a class="resume is-start" href="#/read/${firstUnread.id}" aria-label="Start reading ${esc(s.name)}">${I.play}</a>`
      : '';
  }

  return `<div class="series-card" style="--cc:${coverRgb(s)}">
    <a class="series-card-main" href="#/series/${s.id}">
      ${cover(s, 'sm')}
      <span class="series-card-info">
        <span class="series-card-name">${esc(s.name)}</span>
        <span class="series-card-sub">${sub}</span>
        <span class="series-card-stats">${count(g.readCount)} / ${count(g.chapters.length)} read · ${g.avgRating
          ? `<b aria-label="average rating">★</b> ${g.avgRating.toFixed(1)}` : 'no rating yet'}</span>
        ${progress}
      </span>
    </a>
    ${button}
  </div>`;
}

function openSortSheet() {
  openSheet(`
    <h2>Sort by</h2>
    <div class="option-list" role="radiogroup" aria-label="Sort series">
      ${Object.entries(SORTS).map(([k, label]) => `
        <label class="option-row${settings.libSort === k ? ' is-on' : ''}">
          <span class="txt">${label}${k === 'updated' ? '<small>Newest chapters imported first</small>' : ''}</span>
          <input type="radio" name="sort" value="${k}" ${settings.libSort === k ? 'checked' : ''}>
        </label>`).join('')}
    </div>
    <label class="switch-row" style="border-top:1px solid var(--line);padding-top:12px">
      <span class="txt"><b>Reverse order</b><small>Z–A, oldest first, fewest first…</small></span>
      <input type="checkbox" role="switch" id="sort-rev" ${settings.libReverse ? 'checked' : ''}>
    </label>`, sheet => {
    sheet.addEventListener('change', e => {
      if (e.target.name === 'sort') {
        settings = { ...settings, libSort: e.target.value };
        saveSettings(settings);
        closeAndRefresh();
      } else if (e.target.id === 'sort-rev') {
        settings = { ...settings, libReverse: e.target.checked };
        saveSettings(settings);
        closeAndRefresh();
      }
    });
  });
}

/* ------------------------------------------------------------------ series page */

async function renderSeries(id, tab = 'chapters') {
  if (!['chapters', 'notes', 'codex'].includes(tab)) tab = 'chapters';
  const series = await db.getSeries(id);
  if (!series) throw new Error('This series no longer exists.');
  currentSeries = series;
  const [chapters, progress, allNotes, entries] = await Promise.all([
    db.getChaptersOfSeries(id), db.getAllProgress(), db.getAllNotes(), db.getCodexOfSeries(id)]);
  const noteCount = allNotes.filter(n => n.seriesId === id).length;
  const ids = new Set(chapters.map(c => c.id));
  const prog = new Map(progress.filter(p => ids.has(p.chapterId)).map(p => [p.chapterId, p]));

  let latest = null;
  for (const p of prog.values()) if (!latest || p.updatedAt > latest.updatedAt) latest = p;
  const g = { series, chapters, latest: latest && { ...latest, chapter: chapters.find(c => c.id === latest.chapterId) } };
  const target = continueTarget(g)
    || (chapters.length ? { chapter: chapters.find(c => !c.read) || chapters[0], percent: 0, fresh: true } : null);
  const fresh = newCount(g);
  const unread = chapters.filter(c => !c.read).length;
  currentSeries.chapterCount = chapters.length;
  currentSeries.allRead = chapters.length > 0 && unread === 0;
  currentSeries.range = chapters.length
    ? [chapters[0].number, chapters[chapters.length - 1].number] : null;

  const ordered = seriesOrderDesc ? [...chapters].reverse() : chapters;
  const rows = ordered.map(c => {
    const isCurrent = target && c.id === target.chapter.id && !target.fresh;
    const p = prog.get(c.id);
    const isNew = !c.read && series.lastOpenedAt && c.importedAt > series.lastOpenedAt;
    let state = '';
    if (isCurrent) state = `<span class="state">${Math.round((p?.percent || 0) * 100)}% ${ring(p?.percent || 0)}</span>`;
    else if (c.read) state = `<span class="state">${I.check}</span>`;
    else if (isNew) state = `<span class="badge" style="font-size:11px;padding:3px 9px">New</span>`;
    return `<a class="chapter-row${isCurrent ? ' is-current' : ''}${c.read && !isCurrent ? ' is-read' : ''}" href="#/read/${c.id}" data-num="${c.number}">
      <span class="num">${fmtNum(c.number)}</span>
      <span class="title">${esc(c.title || `Chapter ${fmtNum(c.number)}`)}</span>
      ${c.rating ? `<span class="ch-rating" aria-label="Rated ${c.rating} of 9">★ ${c.rating}</span>` : ''}
      ${c.thoughts ? `<span class="ch-thoughts" role="img" aria-label="Has your thoughts">${I.noteSm}</span>` : ''}
      ${state}
    </a>`;
  }).join('');

  let cta = '';
  if (target) {
    const label = target.fresh ? 'Start reading' : 'Continue';
    const pct = target.fresh ? '' : ` · ${Math.round(target.percent * 100)}%`;
    cta = `<a class="btn btn-accent" href="#/read/${target.chapter.id}">${I.play} ${label} · Ch. ${fmtNum(target.chapter.number)}${pct}</a>`;
  }

  const rated = chapters.filter(c => c.rating);
  const meta = [plural(chapters.length, 'chapter')];
  if (rated.length) {
    const avg = rated.reduce((sum, c) => sum + c.rating, 0) / rated.length;
    meta.push(`★ ${avg.toFixed(1)} average`);
  }
  if (unread && unread !== chapters.length) meta.push(`${unread} unread`);
  if (fresh) meta.push(`${fresh} new`);

  app.innerHTML = `<div class="wash" style="--cc:${coverRgb(series)}"></div>
  <main class="page" style="gap:18px;padding-top:14px">
    <header style="display:flex;align-items:center;justify-content:space-between">
      <a class="icon-btn" href="#/" aria-label="Back to library">${I.back}</a>
      <button type="button" class="icon-btn" data-action="series-menu" aria-label="Series options">${I.dots}</button>
    </header>
    <section class="series-hero" aria-label="Series details">
      <div class="cover-wrap">
        ${cover(series, 'lg')}
        <button type="button" class="cover-edit" data-action="series-menu" aria-label="Change cover">${I.camera}</button>
      </div>
      <div class="series-hero-info">
        <h1>${esc(series.name)}</h1>
        <span class="meta">${meta.join(' · ')}</span>
        <button type="button" class="status-pill" data-action="series-status">
          <i aria-hidden="true" class="dot-${statusOf(series)}"></i>${STATUS[statusOf(series)].label}${I.down}
        </button>
      </div>
    </section>
    ${cta}
    <nav class="series-tabs" role="tablist" aria-label="Series sections">
      ${[['chapters', 'Chapters', ''], ['notes', 'Notes', noteCount], ['codex', 'Codex', entries.length]].map(([k, label, n]) => `
        <button type="button" role="tab" aria-selected="${tab === k}" data-action="series-tab" data-tab="${k}">${label}${n ? ` <span class="count">${n}</span>` : ''}</button>`).join('')}
    </nav>
    ${tab !== 'chapters' ? '<div id="series-tab"></div>' : `<section class="chapter-list" aria-label="Chapters">
      <div class="chapter-list-head">
        <p class="label" style="padding:0">Chapters</p>
        <div style="display:flex;gap:2px">
          ${chapters.length > 8 ? `<button type="button" class="icon-btn" data-action="jump" aria-label="Jump to chapter">${I.hash}</button>` : ''}
          <button type="button" class="sort-btn" data-action="toggle-order">${I.sort}${seriesOrderDesc ? 'Newest first' : 'Oldest first'}</button>
        </div>
      </div>
      ${rows || '<div class="empty" style="padding:24px"><span>No chapters yet.</span></div>'}
    </section>`}
  </main>`;
  const tabRoot = app.querySelector('#series-tab');
  if (tab === 'notes') await notes.renderNotes(app, '', s => cover(s, 'xs'), null, { seriesId: id, root: tabRoot });
  if (tab === 'codex') await codex.renderCodexTab(tabRoot, id);
}

/* ---------- series sheets ---------- */

function openSeriesMenu() {
  const s = currentSeries;
  if (!s) return;
  const hasImage = coverUrls.has(s.id);
  openSheet(`
    <p class="label" style="padding:0 4px">Cover</p>
    <div class="cover-editor">
      ${cover(s, 'md')}
      <div class="cover-actions">
        <button type="button" class="btn btn-accent" data-sa="gallery">${I.image} Choose from gallery</button>
        ${hasImage
          ? `<button type="button" class="btn" data-sa="remove-cover">${I.trash} Remove photo</button>`
          : `<button type="button" class="btn" data-sa="color">${I.shuffle} New tile color</button>`}
      </div>
    </div>
    <div class="menu-list">
      <button type="button" data-sa="rename">${I.pencil}<span>Rename series</span></button>
      <button type="button" data-sa="status">${I.status}<span>Status</span><em>${STATUS[statusOf(s)].label}</em></button>
      ${s.chapterCount ? `<button type="button" data-sa="readall">${I.checks}<span>${s.allRead ? 'Mark all as unread' : 'Mark all as read'}</span></button>` : ''}
      <button type="button" data-sa="import">${I.import}<span>Import chapters into this series</span></button>
      <button type="button" data-sa="delete" class="danger">${I.trash}<span>Delete series</span></button>
    </div>`, sheet => {
    sheet.addEventListener('click', async e => {
      const b = e.target.closest('[data-sa]');
      if (!b) return;
      switch (b.dataset.sa) {
        case 'gallery':
          imageInput.value = '';
          imageInput.click();
          break;
        case 'color': {
          const next = (tileIndex(s) + 1) % COVERS.length;
          s.coverColor = next;
          await db.updateSeries(s.id, { coverColor: next });
          closeAndRefresh();
          break;
        }
        case 'remove-cover':
          await db.deleteCover(s.id);
          setCoverUrl(s.id, null);
          closeAndRefresh();
          break;
        case 'rename': openRenameSheet(); break;
        case 'status': openStatusSheet(); break;
        case 'readall':
          await db.setSeriesRead(s.id, !s.allRead);
          toast(s.allRead ? 'Marked all as unread' : 'Marked all as read');
          closeAndRefresh();
          break;
        case 'import':
          importTarget = { id: s.id, name: s.name };
          closeOverlay();
          fileInput.value = '';
          fileInput.click();
          break;
        case 'delete': openDeleteSheet(); break;
        default: break;
      }
    });
  });
}

imageInput.addEventListener('change', async () => {
  const file = imageInput.files?.[0];
  const s = currentSeries;
  if (!file || !s) return;
  try {
    const blob = await makeCoverBlob(file);
    await db.putCover(s.id, blob);
    await setCoverUrl(s.id, blob);
    toast('Cover updated');
  } catch (err) {
    console.error(err);
    toast('Couldn’t read that image');
  }
  if (isOverlayOpen()) closeAndRefresh(); else route();
});

function openStatusSheet() {
  const s = currentSeries;
  openSheet(`
    <h2>Status</h2>
    <div class="option-list" role="radiogroup" aria-label="Series status">
      ${Object.entries(STATUS).map(([k, v]) => `
        <label class="option-row${statusOf(s) === k ? ' is-on' : ''}">
          <i aria-hidden="true" class="dot-${k}"></i>
          <span class="txt">${v.label}<small>${v.hint}</small></span>
          <input type="radio" name="status" value="${k}" ${statusOf(s) === k ? 'checked' : ''}>
        </label>`).join('')}
    </div>
    <p class="hint">A series switches to Waiting by itself when you finish its last chapter, and back to Reading when new chapters are imported.</p>`, sheet => {
    sheet.addEventListener('change', async e => {
      if (e.target.name !== 'status') return;
      await db.updateSeries(s.id, { status: e.target.value });
      closeAndRefresh();
    });
  });
}

function openRenameSheet() {
  const s = currentSeries;
  openSheet(`
    <h2>Rename series</h2>
    <label class="field">
      <span class="visually-hidden">Series name</span>
      <input id="rename-input" class="text-input" type="text" value="${esc(s.name)}" autocomplete="off">
    </label>
    <div class="two-btns">
      <button type="button" class="btn" data-r="cancel">Cancel</button>
      <button type="button" class="btn btn-accent" data-r="save">Save</button>
    </div>`, sheet => {
    const input = sheet.querySelector('#rename-input');
    input.focus();
    input.select();
    const save = async () => {
      const name = input.value.replace(/\s+/g, ' ').trim();
      if (!name || name === s.name) { closeOverlay(); return; }
      const other = await db.getSeriesByKey(nameKey(name));
      if (other && other.id !== s.id) { openMergeSheet(name, other); return; }
      await db.renameSeries(s.id, name);
      toast('Renamed');
      closeAndRefresh();
    };
    sheet.addEventListener('click', e => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      if (b.dataset.r === 'save') save(); else closeOverlay();
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  });
}

function openMergeSheet(name, other) {
  const s = currentSeries;
  openSheet(`
    <h2>Merge into “${esc(other.name)}”?</h2>
    <p class="hint" style="font-size:14px">You already have a series with this name. Its chapters stay as they are, and the
      ${plural(s.chapterCount || 0, 'chapter')} from “${esc(s.name)}” move into it. If both have the same chapter number,
      the one already in “${esc(other.name)}” is kept.</p>
    <div class="two-btns">
      <button type="button" class="btn" data-m="cancel">Cancel</button>
      <button type="button" class="btn btn-accent" data-m="merge">Merge</button>
    </div>`, sheet => {
    sheet.addEventListener('click', async e => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      if (b.dataset.m === 'cancel') { closeOverlay(); return; }
      const r = await db.renameSeries(s.id, name, true);
      setCoverUrl(s.id, null);
      coversLoaded = false;
      coverUrls.forEach(u => URL.revokeObjectURL(u));
      coverUrls.clear();
      coverColors.clear();
      toast('Series merged');
      closeOverlay({ navTo: `#/series/${r.id}` });
    });
  });
}

function openDeleteSheet() {
  const s = currentSeries;
  openSheet(`
    <h2>Delete “${esc(s.name)}”?</h2>
    <p class="hint" style="font-size:14px">This removes ${plural(s.chapterCount || 0, 'chapter')}, your reading progress and the cover from this phone. It can’t be undone.</p>
    <div class="two-btns">
      <button type="button" class="btn" data-d="cancel">Cancel</button>
      <button type="button" class="btn btn-danger" data-d="delete">${I.trash} Delete</button>
    </div>`, sheet => {
    sheet.addEventListener('click', async e => {
      const b = e.target.closest('[data-d]');
      if (!b) return;
      if (b.dataset.d === 'cancel') { closeOverlay(); return; }
      await db.deleteSeries(s.id);
      setCoverUrl(s.id, null);
      currentSeries = null;
      toast(`Deleted ${s.name}`);
      closeOverlay({ navTo: '#/' });
    });
  });
}

function openJumpSheet() {
  const s = currentSeries;
  if (!s?.range) return;
  openSheet(`
    <h2>Jump to chapter</h2>
    <label class="field">
      <span class="label" style="padding:0">Chapters ${fmtNum(s.range[0])}–${fmtNum(s.range[1])}</span>
      <input id="jump-input" class="text-input" type="number" inputmode="decimal" step="any" placeholder="Chapter number">
    </label>
    <button type="button" class="btn btn-accent" data-j="go">${I.play} Open chapter</button>`, sheet => {
    const input = sheet.querySelector('#jump-input');
    input.focus();
    const go = async () => {
      const n = parseFloat(input.value);
      if (!Number.isFinite(n)) return;
      const list = await db.getChaptersOfSeries(s.id);
      const hit = list.find(c => c.number === n) || list.find(c => c.number > n) || list[list.length - 1];
      if (hit) closeOverlay({ navTo: `#/read/${hit.id}` });
    };
    sheet.querySelector('[data-j="go"]').addEventListener('click', go);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  });
}

/* ------------------------------------------------------------------ reader */

async function renderReader(id, jumpNoteId = null, findJump = null) {
  const chapter = await db.getChapter(id);
  if (!chapter) throw new Error('This chapter no longer exists.');
  const [series, paragraphs, siblings, saved] = await Promise.all([
    db.getSeries(chapter.seriesId), db.getText(id), db.getChaptersOfSeries(chapter.seriesId), db.getProgress(id),
  ]);
  const index = siblings.findIndex(c => c.id === id);
  const prev = siblings[index - 1];
  const next = siblings[index + 1];
  const n = fmtNum(chapter.number);

  db.updateSeries(series.id, { lastOpenedAt: Date.now() });
  document.title = `Ch. ${n} · ${series.name}`;

  const heading = chapter.title
    ? `<p class="ch-label">Chapter ${n}</p><h1 class="ch-title">${esc(chapter.title)}</h1>`
    : `<h1 class="ch-title">Chapter ${n}</h1>`;

  const stars = Array.from({ length: 9 }, (_, i) => i + 1).map(k => `<button type="button" role="radio" data-star="${k}"
      class="${k <= (chapter.rating || 0) ? 'on' : ''}" aria-checked="${chapter.rating === k}" aria-label="${k} star${k === 1 ? '' : 's'}">${I.star}</button>`).join('');
  const reflect = `
      <div class="rate-card">
        <div class="rate-head"><span>How was this chapter?</span><b id="rate-val">${chapter.rating ? `${chapter.rating} / 9` : 'Not rated'}</b></div>
        <div class="stars" role="radiogroup" aria-label="Rate this chapter from 1 to 9" data-rating="${chapter.rating || 0}">${stars}</div>
      </div>
      <label class="thoughts-card">
        <span class="th-head"><span>Your thoughts</span><small id="th-state">${chapter.thoughts ? 'Saved' : 'Saved automatically'}</small></span>
        <textarea id="thoughts" class="text-area" rows="4" placeholder="How did this chapter make you feel? What stood out?">${esc(chapter.thoughts || '')}</textarea>
      </label>`;

  const end = next ? `
      <div class="done"><strong>Chapter ${n} finished</strong><span id="read-note">${chapter.read ? 'Marked as read' : ''}</span></div>
      ${reflect}
      <a class="next-card" href="#/read/${next.id}">
        <span class="txt"><small>Up next</small><b>Chapter ${fmtNum(next.number)}${next.title ? ': ' + esc(next.title) : ''}</b></span>
        <span class="round-go">${I.next}</span>
      </a>
      <div class="two-btns">
        <a class="btn btn-outline" href="#/series/${series.id}">${I.list} All chapters</a>
        <a class="btn btn-outline" href="#/">${I.library} Library</a>
      </div>` : `
      <div class="done"><strong>You’re caught up</strong><span id="read-note">Import Chapter ${fmtNum(chapter.number + 1)} when it comes out.</span></div>
      ${reflect}
      <div class="two-btns">
        <a class="btn btn-outline" href="#/import">${I.import} Import</a>
        <a class="btn btn-outline" href="#/">${I.library} Library</a>
      </div>`;

  const navBtn = (c, label, isNext) => c
    ? `<a class="btn" href="#/read/${c.id}">${isNext ? '' : I.back} ${label} ${isNext ? I.next : ''}</a>`
    : `<span class="btn" aria-disabled="true" style="opacity:.4">${isNext ? '' : I.back} ${label} ${isNext ? I.next : ''}</span>`;

  app.innerHTML = `
    <header class="reader-top">
      <a class="icon-btn" href="#/series/${series.id}" aria-label="Back to series">${I.back}</a>
      <div class="titles"><b>${esc(series.name)}</b><span>Ch. ${n}${chapter.title ? ' · ' + esc(chapter.title) : ''}</span></div>
      <button type="button" class="icon-btn snd-btn${sounds.isPlaying() ? ' is-playing' : ''}" data-action="open-sounds" aria-label="Background sounds">${sounds.HEADPHONES}</button>
      <a class="icon-btn" href="#/series/${series.id}" aria-label="Chapter list">${I.list}</a>
    </header>

    <div class="reader" id="reader">
      <div class="reader-meta"><span>${esc(series.name)}</span><span>Ch. ${n}</span></div>
      <article class="reader-text" id="text">
        ${heading}
        ${paragraphs.map((p, i) => `<p data-p="${i}">${inline(p)}</p>`).join('')}
      </article>
      <section class="chapter-end" aria-label="End of chapter">
        <div class="dots" aria-hidden="true">· · ·</div>
        ${end}
      </section>
    </div>

    <div class="reader-footer" aria-hidden="true"><span id="pct">0%</span><span id="left"></span></div>

    <section class="reader-panel" aria-label="Reading controls">
      <div class="panel-progress">
        <div class="row"><span id="panel-pct">0% of chapter</span><span id="panel-left"></span></div>
        <label><span class="visually-hidden">Position in chapter</span>
          <input id="seek" type="range" min="0" max="1000" value="0"></label>
      </div>
      <div class="prev-next">${navBtn(prev, 'Previous', false)}${navBtn(next, 'Next chapter', true)}</div>
      <div class="tools">
        <button type="button" data-action="open-settings">${I.text}Text</button>
        <button type="button" data-action="cycle-theme">${I.moon}Theme</button>
        <button type="button" data-action="chapter-notes">${I.notes}Notes</button>
        <button type="button" data-action="reader-codex">${codex.CODEX_ICON}Codex</button>
      </div>
    </section>`;

  const textEl = document.getElementById('text');
  const readerEl = document.getElementById('reader');
  const paras = [...textEl.querySelectorAll('p[data-p]')];
  const seek = document.getElementById('seek');
  const els = ['pct', 'left', 'panel-pct', 'panel-left'].map(x => document.getElementById(x));
  const totalWords = chapter.words || paragraphs.join(' ').split(/\s+/).length;
  const TOP = 60; // px from the top of the screen used as the "reading line"

  // ---- notes in this chapter ----
  const where = `${series.name} · Ch. ${n}`;
  let cxEntries = [];
  async function refreshNotes() {
    const [list, tags, entries] = await Promise.all([db.getNotesOfChapter(id), db.getAllTags(), db.getCodexOfSeries(series.id)]);
    const schema = await codex.schemaOf(series.id, entries);
    // Only what you knew by this chapter (re-reading Ch. 5 hides what you learned in Ch. 9).
    cxEntries = schema ? codex.knownAt(entries, schema, chapter.number) : [];
    codex.clearNames(textEl);
    notes.clearMarks(textEl);
    notes.applyMarks(paras, list, tags);
    // Codex names get a dotted underline (after the note marks, which use text positions).
    if (settings.codexNames !== false && schema) codex.applyNames(paras, cxEntries, schema);
  }
  function jumpTo(noteId) {
    const marks = textEl.querySelectorAll(`mark[data-note="${noteId}"]`);
    if (!marks.length) { toast('Couldn’t find that note’s text in this chapter'); return; }
    const y = marks[0].getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.35;
    window.scrollTo(0, Math.max(0, y));
    measure();
    updateUI();
    marks.forEach(m => { m.classList.add('flash'); setTimeout(() => m.classList.remove('flash'), 1800); });
  }
  /** Jump to the nth search match in a paragraph of this chapter. */
  function jumpToMatch(para, nth, term, whole) {
    if (!find.flashMatch(paras[para], nth, term, whole)) {
      toast('Couldn’t find that spot in this chapter');
      return;
    }
    measure();
    updateUI();
    find.showStepper({ paras, term, whole, para, nth, onMove: () => { measure(); updateUI(); } });
  }
  const noteCtx = { chapter, series, where, onChanged: refreshNotes, onJump: jumpTo, onFindJump: jumpToMatch };

  // ---- rating & thoughts (end of chapter) ----
  const starsEl = readerEl.querySelector('.stars');
  starsEl.addEventListener('click', async e => {
    const b = e.target.closest('[data-star]');
    if (!b) return;
    const k = Number(b.dataset.star);
    chapter.rating = chapter.rating === k ? 0 : k; // tap the same star again to clear
    await db.putChapter(chapter);
    starsEl.dataset.rating = String(chapter.rating);
    starsEl.querySelectorAll('[data-star]').forEach(x => {
      x.setAttribute('aria-checked', String(Number(x.dataset.star) === chapter.rating));
      x.classList.toggle('on', Number(x.dataset.star) <= chapter.rating);
    });
    readerEl.querySelector('#rate-val').textContent = chapter.rating ? `${chapter.rating} / 9` : 'Not rated';
  });
  const thoughtsEl = readerEl.querySelector('#thoughts');
  const thState = readerEl.querySelector('#th-state');
  let thTimer = null;
  async function saveThoughts() {
    clearTimeout(thTimer);
    thTimer = null;
    const text = thoughtsEl.value.trim();
    if (text === (chapter.thoughts || '')) return;
    chapter.thoughts = text;
    await db.putChapter(chapter);
    thState.textContent = 'Saved';
  }
  thoughtsEl.addEventListener('input', () => {
    thState.textContent = 'Typing…';
    clearTimeout(thTimer);
    thTimer = setTimeout(saveThoughts, 700);
  });
  thoughtsEl.addEventListener('blur', saveThoughts);

  let percent = 0;
  let markedRead = !!chapter.read;
  let saveTimer = null;
  let ticking = false;
  let seeking = false;
  let lastY = window.scrollY;
  let wakeLock = null;

  // Scroll position at which the last line of the chapter reaches the bottom of the screen.
  const endScroll = () => Math.max(1, textEl.offsetTop + textEl.offsetHeight - window.innerHeight + 80);

  function measure() {
    percent = Math.min(1, Math.max(0, window.scrollY / endScroll()));
  }

  function updateUI() {
    const p = Math.round(percent * 100);
    const mins = Math.max(1, Math.ceil((totalWords * (1 - percent)) / 230));
    const left = percent >= 0.995 ? 'End of chapter' : `${mins} min left`;
    els[0].textContent = `${p}%`;
    els[1].textContent = percent >= 0.995 ? left : `${left} in chapter`;
    els[2].textContent = `${p}% of chapter`;
    els[3].textContent = left;
    if (!seeking) seek.value = String(Math.round(percent * 1000));
  }

  // Remember the paragraph at the reading line (survives font/size changes).
  function anchor() {
    for (const p of paras) {
      const r = p.getBoundingClientRect();
      if (r.bottom > TOP) {
        return { para: Number(p.dataset.p), offset: Math.min(1, Math.max(0, (TOP - r.top) / Math.max(1, r.height))) };
      }
    }
    return { para: paras.length - 1, offset: 1 };
  }

  function restore(a) {
    const p = paras[a?.para];
    if (!p) return;
    const y = p.getBoundingClientRect().top + window.scrollY + (a.offset || 0) * p.offsetHeight - TOP;
    window.scrollTo(0, Math.max(0, y));
    measure();
    updateUI();
    lastY = window.scrollY;
  }

  async function save() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const a = anchor();
    await db.putProgress({ chapterId: id, para: a.para, offset: a.offset, percent, updatedAt: Date.now() });
  }

  async function markRead() {
    if (markedRead) return;
    markedRead = true;
    chapter.read = true;
    await db.putChapter(chapter);
    const note = document.getElementById('read-note');
    if (note && next) note.textContent = 'Marked as read';
    // Finished the newest chapter you have: the series is now waiting for more.
    if (!next) {
      const fresh = await db.getSeries(series.id);
      if (fresh && statusOf(fresh) === 'reading') await db.updateSeries(series.id, { status: 'waiting' });
    }
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      measure();
      updateUI();
      if (percent >= 0.98) markRead();
      if (!seeking && document.body.classList.contains('controls-open') && Math.abs(window.scrollY - lastY) > 30) {
        document.body.classList.remove('controls-open');
      }
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 700);
    });
  }

  // Tap the page to show or hide the controls.
  readerEl.addEventListener('click', e => {
    if (e.target.closest('a, button, input, textarea, label, .rate-card')) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const mark = e.target.closest('mark.note-mark');
    const name = e.target.closest('span.cx-name');
    if (name) {
      codex.openPeek(Number(name.dataset.entry), {
        asOf: chapter.number,
        onNote: mark ? () => notes.openNoteCard(Number(mark.dataset.note), noteCtx) : null,
        noteLabel: 'Open note',
      });
      return;
    }
    if (mark) { notes.openNoteCard(Number(mark.dataset.note), noteCtx); return; }
    lastY = window.scrollY;
    document.body.classList.toggle('controls-open');
  });

  seek.addEventListener('input', () => {
    seeking = true;
    window.scrollTo(0, (Number(seek.value) / 1000) * endScroll());
  });
  seek.addEventListener('change', () => {
    seeking = false;
    lastY = window.scrollY;
  });

  // Keep the screen on while reading.
  async function lockScreen() {
    if (!settings.keepAwake || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* not allowed here */ }
  }
  async function unlockScreen() {
    try { await wakeLock?.release(); } catch { /* already released */ }
    wakeLock = null;
  }
  const onVisibility = () => (document.visibilityState === 'hidden' ? save() : lockScreen());

  activeReader = {
    anchor,
    restore,
    refreshNotes,
    chapterNotes: () => notes.openChapterNotes(noteCtx),
    openCodex: () => codex.openReaderCodex({ seriesId: series.id, chapterText: paras.map(p => p.textContent).join('\n'), asOf: chapter.number, onChanged: refreshNotes }),
    relock: () => (settings.keepAwake ? lockScreen() : unlockScreen()),
  };

  // Wait for fonts so the restored position is exact.
  if (document.fonts?.ready) await document.fonts.ready;
  await refreshNotes();
  if (jumpNoteId) jumpTo(jumpNoteId);
  else if (findJump) jumpToMatch(findJump.para, findJump.nth, findJump.term, findJump.whole);
  else if (saved) restore(saved);
  else { window.scrollTo(0, 0); measure(); updateUI(); }

  // Selecting text shows the Note · Highlight · Copy bar.
  const teardownSelection = notes.setupSelectionBar(textEl, paras, async (action, sel) => {
    const draft = { seriesId: series.id, chapterId: id, ...sel };
    if (action === 'note') {
      notes.openNoteEditor({ note: draft, where, onSaved: refreshNotes });
    } else if (action === 'highlight') {
      await notes.saveHighlight(draft);
      refreshNotes();
    } else if (action === 'find') {
      find.openFind({ term: sel.quote.split('\n')[0], chapterId: id, seriesId: series.id, onJumpHere: jumpToMatch });
    } else if (action === 'copy') {
      try { await navigator.clipboard.writeText(sel.quote); toast('Copied'); } catch { toast('Couldn’t copy'); }
    } else if (action === 'codex') {
      const known = codex.entryNamed(cxEntries, sel.quote);
      if (known) codex.openPeek(known.id, { asOf: chapter.number });
      else {
        codex.openEntryEditor({
          seriesId: series.id,
          ctx: chapter.number,
          name: sel.quote.replace(/\s+/g, ' ').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/['’]s$/u, '').slice(0, 80),
          onSaved: refreshNotes,
        });
      }
    } else if (action === 'define') {
      dictionary.openDefine({
        text: sel.quote,
        onNote: async text => {
          const tagIds = text ? [(await notes.vocabularyTag()).id] : [];
          notes.openNoteEditor({ note: { ...draft, text, tagIds }, where, onSaved: refreshNotes });
        },
        onFind: w => find.openFind({ term: w || dictionary.cleanWord(sel.quote), chapterId: id, seriesId: series.id, onJumpHere: jumpToMatch }),
        onCodex: () => codex.openEntryEditor({
          seriesId: series.id,
          ctx: chapter.number,
          name: sel.quote.replace(/\s+/g, ' ').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/['’]s$/u, ''),
          onSaved: refreshNotes,
        }),
      });
    }
  });

  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', save);
  lockScreen();

  // The reader keeps its own place, so the browser mustn't restore old scroll positions
  // when a sheet closes (that used to undo jumps to Find results).
  history.scrollRestoration = 'manual';
  cleanupView = async () => {
    history.scrollRestoration = 'auto';
    find.hideStepper();
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', save);
    teardownSelection();
    await saveThoughts();
    activeReader = null;
    await unlockScreen();
    await save();
    document.title = 'Reader';
  };
}

/* ------------------------------------------------------------------ text settings sheet */

/** Change settings without losing your place in the chapter. */
function updateSettings(patch) {
  const a = activeReader?.anchor();
  settings = { ...settings, ...patch };
  saveSettings(settings);
  applySettings(settings);
  if (patch.theme) activeReader?.refreshNotes(); // tag colors differ on Dim Paper
  if (a) requestAnimationFrame(() => activeReader?.restore(a));
}

const pressed = (key, v) => `data-set="${key}" data-v="${v}" aria-pressed="${settings[key] === v}"`;
const favThemes = () => (settings.favThemes || []).filter(id => THEMES.some(t => t.id === id));

function themeTilesHtml() {
  const favs = favThemes();
  const accent = ACCENTS[settings.accent] || ACCENTS.amber;
  return `<div data-part="themes" style="display:flex;flex-direction:column;gap:10px"><div class="theme-choices">
    ${THEMES.map(t => {
      const fav = favs.includes(t.id);
      const starColor = fav ? (t.light ? accent.paper : accent.dark) : (t.light ? 'rgba(0,0,0,.38)' : 'rgba(255,255,255,.38)');
      return `<div class="theme-tile">
        <button type="button" class="theme-choice" ${pressed('theme', t.id)} style="background:${t.bg};color:${t.fg}">
          <span class="aa">Aa</span><small>${t.label}</small></button>
        <button type="button" class="fav" data-fav="${t.id}" aria-pressed="${fav}"
          aria-label="${fav ? 'Remove' : 'Add'} ${t.label} ${fav ? 'from' : 'to'} the reader’s theme button"
          style="color:${starColor}">${fav ? '★' : '☆'}</button>
      </div>`;
    }).join('')}
  </div>
  <p class="hint" style="padding:0">★ = in the reader’s theme button. Tap a star to add or remove.</p></div>`;
}

function accentSwatchesHtml() {
  const light = isLightTheme(settings.theme);
  return `<div class="swatches" data-part="accents">
    ${Object.entries(ACCENTS).map(([k, a]) => `<button type="button" class="swatch" ${pressed('accent', k)} aria-label="${a.label}">
      <span style="background:${light ? a.paper : a.dark}"></span></button>`).join('')}
  </div>`;
}

const sizeRowHtml = () => `<div class="size-row">
    <button type="button" class="btn" data-step="-1" aria-label="Smaller text" style="font-size:13px">A</button>
    <label style="flex-grow:1"><span class="visually-hidden">Text size</span>
      <input type="range" data-range="size" min="${MIN_SIZE}" max="${MAX_SIZE}" step="1" value="${settings.size}"></label>
    <button type="button" class="btn" data-step="1" aria-label="Larger text" style="font-size:22px">A</button>
  </div>`;

const alignHtml = () => `<div class="segmented">
    <button type="button" ${pressed('align', 'left')} style="gap:8px">${I.alignLeft}Left</button>
    <button type="button" ${pressed('align', 'justify')} style="gap:8px">${I.alignJustify}Justified</button>
  </div>`;

const spacingMarginsHtml = () => `<div class="field-row">
    <div class="field">
      <p class="label" style="padding:0">Line spacing</p>
      <div class="segmented">
        <button type="button" ${pressed('spacing', 'tight')} aria-label="Tight">${I.lines(4)}</button>
        <button type="button" ${pressed('spacing', 'normal')} aria-label="Normal">${I.lines(6)}</button>
        <button type="button" ${pressed('spacing', 'relaxed')} aria-label="Relaxed">${I.lines(8)}</button>
      </div>
    </div>
    <div class="field">
      <p class="label" style="padding:0">Margins</p>
      <div class="segmented">
        <button type="button" ${pressed('margin', 'narrow')} aria-label="Narrow">${I.margin(6)}</button>
        <button type="button" ${pressed('margin', 'medium')} aria-label="Medium">${I.margin(4)}</button>
        <button type="button" ${pressed('margin', 'wide')} aria-label="Wide">${I.margin(2)}</button>
      </div>
    </div>
  </div>`;

/** The reader's Aa sheet. */
function settingsSheetHtml() {
  return `
    <h2>Reading settings</h2>
    <div class="field"><p class="label" style="padding:0">Theme</p>${themeTilesHtml()}</div>
    <div class="field"><p class="label" style="padding:0">Accent color</p>${accentSwatchesHtml()}</div>
    <div class="field">
      <p class="label" style="padding:0">Font</p>
      <div class="font-chips">
        ${Object.entries(FONTS).map(([k, f]) => `<button type="button" ${pressed('font', k)} style="font-family:${f.family}">${f.label}</button>`).join('')}
      </div>
    </div>
    <div class="field"><p class="label" style="padding:0">Alignment</p>${alignHtml()}</div>
    <div class="field"><p class="label" style="padding:0">Size · <span data-size-val>${settings.size}px</span></p>${sizeRowHtml()}</div>
    ${spacingMarginsHtml()}
    <div class="field">
      <p class="label" style="padding:0">Extra dim</p>
      <label><span class="visually-hidden">Extra dim level</span>
        <input type="range" data-range="dim" min="0" max="60" step="1" value="${settings.dim}"></label>
    </div>
    <label class="switch-row">
      <span class="txt"><b>Keep screen on</b><small>While a chapter is open</small></span>
      <input type="checkbox" role="switch" data-toggle="keepAwake" ${settings.keepAwake ? 'checked' : ''}>
    </label>`;
}

function toggleFavTheme(id) {
  const favs = favThemes();
  updateSettings({ favThemes: favs.includes(id) ? favs.filter(x => x !== id) : [...favs, id] });
}

/** Update the controls inside `root` in place after a change (no redraw, no jump). */
function refreshAppearance(root) {
  root.querySelectorAll('[data-part="themes"]').forEach(el => { el.outerHTML = themeTilesHtml(); });
  root.querySelectorAll('[data-part="accents"]').forEach(el => { el.outerHTML = accentSwatchesHtml(); });
  root.querySelectorAll('[data-set]').forEach(b =>
    b.setAttribute('aria-pressed', String(settings[b.dataset.set] === b.dataset.v)));
  root.querySelectorAll('[data-range="size"]').forEach(i => { i.value = settings.size; });
  root.querySelectorAll('[data-size-val]').forEach(x => { x.textContent = `${settings.size}px`; });
}

/** Wire up theme, accent, font, size… controls inside `root`. */
function bindAppearance(root, onChange = () => refreshAppearance(root)) {
  root.addEventListener('click', e => {
    const fav = e.target.closest('[data-fav]');
    if (fav) { toggleFavTheme(fav.dataset.fav); onChange(); return; }
    const opt = e.target.closest('[data-set]');
    if (opt) { updateSettings({ [opt.dataset.set]: opt.dataset.v }); onChange(); return; }
    const step = e.target.closest('[data-step]');
    if (step) {
      updateSettings({ size: Math.min(MAX_SIZE, Math.max(MIN_SIZE, settings.size + Number(step.dataset.step))) });
      onChange();
    }
  });
  root.addEventListener('input', e => {
    const range = e.target.dataset.range;
    if (range === 'size') {
      updateSettings({ size: Number(e.target.value) });
      root.querySelectorAll('[data-size-val]').forEach(x => { x.textContent = `${settings.size}px`; });
    } else if (range === 'dim') {
      updateSettings({ dim: Number(e.target.value) });
    }
  });
  root.addEventListener('change', e => {
    const key = e.target.dataset.toggle;
    if (!key) return;
    updateSettings({ [key]: e.target.checked });
    if (key === 'keepAwake') activeReader?.relock();
  });
}

function mountSettings(sheet) {
  ensureAllFonts();
  bindAppearance(sheet);
}

/* ------------------------------------------------------------------ import */

async function renderImport() {
  const [chapters, series] = await Promise.all([db.getAllChapters(), db.getAllSeries()]);
  const seriesById = new Map(series.map(s => [s.id, s]));

  // Group recent imports by series and day.
  const groups = new Map();
  for (const c of chapters) {
    const key = `${c.seriesId}|${new Date(c.importedAt).toDateString()}`;
    const g = groups.get(key) || { seriesId: c.seriesId, nums: [], at: 0 };
    g.nums.push(c.number);
    g.at = Math.max(g.at, c.importedAt);
    groups.set(key, g);
  }
  const recent = [...groups.values()].sort((a, b) => b.at - a.at).slice(0, 8);

  const recentHtml = recent.length ? `
    <section aria-label="Recent imports" style="display:flex;flex-direction:column">
      <p class="label" style="margin-bottom:6px">Recent imports</p>
      ${recent.map(g => {
        const s = seriesById.get(g.seriesId);
        if (!s) return '';
        const min = Math.min(...g.nums);
        const max = Math.max(...g.nums);
        const range = g.nums.length === 1 ? `Ch. ${fmtNum(min)}` : `Ch. ${fmtNum(min)}–${fmtNum(max)}`;
        return `<a class="series-row" href="#/series/${s.id}">
          ${cover(s, 'sm')}
          <span class="series-row-info">
            <span class="series-row-name">${esc(s.name)}</span>
            <span class="series-row-sub">${range} · ${plural(g.nums.length, 'chapter')}</span>
          </span>
          <span class="series-row-sub">${relDay(g.at)}</span>
        </a>`;
      }).join('')}
    </section>` : '';

  app.innerHTML = `<main class="page" style="gap:22px">
    <div class="row-head"><h1 class="page-title">Import</h1></div>
    <section class="drop-card" aria-label="Choose files">
      <span class="ico">${I.file}</span>
      <strong>Add chapters</strong>
      <p>${canPickFolder
        ? 'Pick a whole folder or single files. Every .txt inside, subfolders too, goes to the review screen first. Codex files (.codex.json) work here too.'
        : 'Pick one or many .txt files (in the picker: ⋮ → Select all). You check everything before it’s saved. Codex files (.codex.json) work here too.'}</p>
      <div class="btn-stack">
        ${canPickFolder ? `<button type="button" class="btn btn-accent" data-action="pick-folder">${I.folder} Choose folder</button>` : ''}
        <button type="button" class="btn ${canPickFolder ? '' : 'btn-accent'}" data-action="pick-files">${I.fileSm} Choose files</button>
      </div>
    </section>
    ${recentHtml}
  </main>${nav('import')}`;
}

// Folder picking is new in mobile browsers; the button only shows where it works.
const canPickFolder = 'webkitdirectory' in folderInput;

fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) handleFiles(fileInput.files);
});
folderInput.addEventListener('change', () => {
  if (folderInput.files?.length) handleFiles(folderInput.files);
});

async function handleFiles(fileList) {
  const target = importTarget;
  importTarget = null;
  const all = [...fileList].filter(f => !f.name.startsWith('.'));
  const files = all.filter(f => /\.txt$/i.test(f.name) || f.type === 'text/plain');
  // Codex files (.codex.json): the rooms of a series' Codex.
  const codexItems = [];
  for (const f of all.filter(x => /\.json$/i.test(x.name))) {
    let data;
    try { data = JSON.parse(await f.text()); } catch { toast(`“${f.name}” isn’t valid JSON`); continue; }
    if (!codex.isCodexData(data)) { toast(`“${f.name}” isn’t a Codex file`); continue; }
    const r = codex.readCodexFile(data, f.name);
    if (!r.ok) { toast(`${f.name}: ${r.errors[0]}`); continue; }
    const seriesName = target ? target.name : r.structure.series;
    codexItems.push({ fileName: f.name, structure: r.structure, warnings: r.warnings, seriesName, seriesKey: nameKey(seriesName), include: true });
  }
  if (!files.length && !codexItems.length) { toast('No .txt chapters or Codex files found'); return; }
  if (files.length > 20) toast(`Reading ${files.length} files…`);

  const items = [];
  for (const file of files) {
    try {
      const parsed = parseChapter(decodeBytes(await file.arrayBuffer()), file.name);
      if (target) parsed.seriesName = target.name; // "Import chapters into this series"
      if (parsed.paragraphs.length) items.push({ ...parsed, fileName: file.name, include: true, action: 'skip' });
    } catch (err) {
      console.warn('Could not read', file.name, err);
    }
  }
  if (!items.length && !codexItems.length) { toast('No readable chapters in those files'); return; }
  await checkDuplicates(items);
  showReview(items, codexItems);
}

/** Mark chapters already in the library, or picked twice in this batch. */
async function checkDuplicates(items) {
  const seen = new Set();
  for (const it of items) {
    it.seriesKey = nameKey(it.seriesName);
    const series = await db.getSeriesByKey(it.seriesKey);
    it.existingSeries = !!series;
    it.dup = false;
    it.twice = false;
    if (it.number == null) continue;
    const key = `${it.seriesKey}|${it.number}`;
    if (seen.has(key)) { it.twice = true; it.include = false; }
    seen.add(key);
    if (series && await db.findChapter(series.id, it.number)) it.dup = true;
  }
}

const willImport = it => (it.dup ? it.action === 'replace' : it.include && it.number != null);

function showReview(items, codexItems = []) {
  const root = document.createElement('div');
  root.className = 'review';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Review import');
  const bar = document.createElement('div');
  bar.className = 'sticky-action';
  openOverlay([root, bar]);

  async function draw() {
    const groups = new Map();
    items.forEach((it, i) => {
      const g = groups.get(it.seriesKey) || { name: it.seriesName, existing: it.existingSeries, list: [], codex: [] };
      g.list.push([it, i]);
      groups.set(it.seriesKey, g);
    });
    const existing = await Promise.all([...groups.keys()].map(k => db.getSeriesByKey(k)));
    const seriesByKey = new Map([...groups.keys()].map((k, i) => [k, existing[i]]));
    // Codex files join their series' group (or get their own, for series already in the library).
    for (const [ci, cx] of codexItems.entries()) {
      if (!groups.has(cx.seriesKey)) {
        const s = await db.getSeriesByKey(cx.seriesKey);
        groups.set(cx.seriesKey, { name: s?.name || cx.seriesName, existing: !!s, list: [], codex: [], onlyCodex: true, missing: !s });
        seriesByKey.set(cx.seriesKey, s);
      }
      groups.get(cx.seriesKey).codex.push([cx, ci]);
      cx.usable = !groups.get(cx.seriesKey).missing;
    }
    const dupCount = items.filter(it => it.dup).length;
    const newCountNow = items.filter(it => !it.dup && it.number != null).length;
    const total = items.filter(willImport).length;
    const codexTotal = codexItems.filter(c => c.include && c.usable).length;

    root.innerHTML = `<div class="review-inner">
      <div class="review-head">
        <button type="button" class="icon-btn" data-review="cancel" aria-label="Cancel import">${I.close}</button>
        <div><h1>Review import</h1><small>${plural(items.length + codexItems.length, 'file')} · ${groups.size} series</small></div>
      </div>
      <div class="chips">
        ${newCountNow ? `<span class="chip"><i></i>${plural(newCountNow, 'new chapter')}</span>` : ''}
        ${dupCount ? `<span class="chip"><i class="warn"></i>${plural(dupCount, 'duplicate')}</span>` : ''}
      </div>
      ${[...groups.entries()].map(([key, g]) => `
        <section class="group" aria-label="${esc(g.name)}">
          <div class="group-head">
            ${cover(seriesByKey.get(key) || g.name, 'sm')}
            <span class="info">
              ${g.existing || g.onlyCodex
                ? `<span class="name">${esc(g.name)}</span><span class="kind${g.missing ? ' warn' : ''}">${g.missing ? 'Not in your library' : g.onlyCodex ? 'Existing series' : 'Adding to existing series'}</span>`
                : `<input class="name" data-rename="${esc(key)}" value="${esc(g.name)}" aria-label="Series name">
                   <span class="kind new">New series</span>`}
            </span>
          </div>
          ${g.codex.map(([cx, ci]) => `
            <div class="cx-import${cx.usable ? '' : ' is-off'}">
              <label class="cx-import-head">
                <input type="checkbox" data-cxinc="${ci}" ${cx.include && cx.usable ? 'checked' : ''} ${cx.usable ? '' : 'disabled'}>
                <span class="ico">${codex.CODEX_ICON}</span>
                <span class="t"><b>Codex structure</b><small>${esc(cx.fileName)} · ${plural(cx.structure.types.length, 'room')} · no entries</small></span>
              </label>
              ${cx.usable ? codex.structureSummaryHtml(cx.structure)
                : `<p class="hint" style="margin:0">Import this series’ chapters first (they can be in the same import), or check that the "series" name in the file matches exactly.</p>`}
              ${cx.warnings.length ? `<details class="cx-warn"><summary>${plural(cx.warnings.length, 'small fix', 'small fixes')} made</summary><ul>${cx.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}
              ${cx.usable ? '<p class="hint" style="margin:0">The rooms start empty — you add entries while reading. Entries you already have stay.</p>' : ''}
            </div>`).join('')}
          ${g.list.sort((a, b) => (a[0].number ?? 1e9) - (b[0].number ?? 1e9)).map(([it, i]) => it.dup ? `
            <div class="item">
              <span style="width:20px;color:var(--danger);display:flex">${I.copy}</span>
              <span class="num">Ch. ${fmtNum(it.number)}</span>
              <span class="t">${esc(it.title || `Chapter ${fmtNum(it.number)}`)}<small>Already in your library</small></span>
              <div class="segmented" role="group" aria-label="Chapter ${fmtNum(it.number)}">
                <button type="button" data-act="skip" data-i="${i}" aria-pressed="${it.action === 'skip'}">Skip</button>
                <button type="button" data-act="replace" data-i="${i}" aria-pressed="${it.action === 'replace'}">Replace</button>
              </div>
            </div>` : `
            <label class="item">
              <input type="checkbox" data-inc="${i}" ${it.include ? 'checked' : ''}>
              <span class="num">${it.number == null
                ? `<input type="number" step="any" inputmode="decimal" data-num="${i}" placeholder="#" aria-label="Chapter number">`
                : `Ch. ${fmtNum(it.number)}`}</span>
              <span class="t">${esc(it.title || (it.number == null ? it.fileName : `Chapter ${fmtNum(it.number)}`))}
                ${it.number == null ? '<small>Type the chapter number</small>' : ''}
                ${it.twice ? '<small>Picked twice — only one will be saved</small>' : ''}</span>
            </label>`).join('')}
        </section>`).join('')}
    </div>`;

    const label = total && codexTotal ? `Import ${plural(total, 'chapter')} + Codex`
      : total ? `Import ${plural(total, 'chapter')}` : codexTotal ? (codexTotal === 1 ? 'Set up the Codex' : `Set up ${codexTotal} Codexes`) : 'Nothing to import';
    bar.innerHTML = `<button type="button" class="btn btn-accent" data-review="import" ${total || codexTotal ? '' : 'disabled'}>
      ${I.check} ${label}</button>`;
  }

  root.addEventListener('click', e => {
    const act = e.target.closest('[data-act]');
    if (act) { items[Number(act.dataset.i)].action = act.dataset.act; draw(); return; }
    if (e.target.closest('[data-review="cancel"]')) closeOverlay();
  });
  root.addEventListener('change', async e => {
    const t = e.target;
    if (t.dataset.inc != null) { items[Number(t.dataset.inc)].include = t.checked; draw(); }
    if (t.dataset.cxinc != null) { codexItems[Number(t.dataset.cxinc)].include = t.checked; draw(); }
    if (t.dataset.num != null) {
      const v = parseFloat(t.value);
      items[Number(t.dataset.num)].number = Number.isFinite(v) ? v : null;
      await checkDuplicates(items); draw();
    }
    if (t.dataset.rename != null) {
      const name = t.value.replace(/\s+/g, ' ').trim();
      if (!name) { draw(); return; }
      items.filter(it => it.seriesKey === t.dataset.rename).forEach(it => { it.seriesName = name; });
      codexItems.filter(c => c.seriesKey === t.dataset.rename).forEach(c => { c.seriesName = name; c.seriesKey = nameKey(name); });
      await checkDuplicates(items); draw();
    }
  });
  bar.addEventListener('click', async e => {
    const btn = e.target.closest('[data-review="import"]');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    let saved = 0;
    const seriesIds = new Set();
    for (const it of items.filter(willImport)) {
      try {
        const r = await db.saveImportedChapter(it, it.dup ? 'replace' : 'add');
        if (!r.skipped) { saved += 1; seriesIds.add(r.seriesId); }
      } catch (err) {
        console.error('Import failed for', it.fileName, err);
      }
    }
    // Codex structures, now that their series exist.
    let codexDone = 0;
    for (const cx of codexItems.filter(c => c.include && c.usable)) {
      const s = await db.getSeriesByKey(cx.seriesKey);
      if (!s) continue;
      await codex.applyStructure(s.id, cx.structure, cx.fileName);
      seriesIds.add(s.id);
      codexDone += 1;
    }
    // Ask Chrome not to clear this app's data during automatic cleanups.
    navigator.storage?.persist?.().catch(() => {});
    toast([saved ? `Imported ${plural(saved, 'chapter')}` : '', codexDone ? `${codexDone === 1 ? 'Codex' : `${codexDone} Codexes`} set up` : ''].filter(Boolean).join(' · ') || 'Nothing imported');
    const dest = seriesIds.size === 1 ? `#/series/${[...seriesIds][0]}${codexDone && !saved ? '/codex' : ''}` : '#/';
    const samePage = location.hash === dest || (dest === '#/' && !location.hash);
    closeOverlay({ navTo: dest });
    if (samePage) route(); // no hash change, so redraw by hand
  });

  draw();
}


/* ------------------------------------------------------------------ backup status */

const DAY = 86400000;

function daysAgo(ts) {
  const d = Math.floor((Date.now() - ts) / DAY);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

/** 'none' (never backed up), 'old' (over a week ago) or 'ok'. */
function backupState() {
  if (!settings.lastBackupAt) return 'none';
  return Date.now() - settings.lastBackupAt > 7 * DAY ? 'old' : 'ok';
}

/** Small reminder at the top of the Library, at most once a week. */
function backupBanner() {
  if (!settings.backupReminder || backupState() === 'ok' || Date.now() < settings.backupSnoozeUntil) return '';
  // Give a brand-new library a couple of days before the first nudge.
  const firstAdded = Math.min(...libGroups.map(g => g.series.createdAt || Date.now()));
  if (backupState() === 'none' && Date.now() - firstAdded < 2 * DAY) return '';
  const msg = backupState() === 'none' ? 'Your library isn’t backed up yet' : `Last backup ${daysAgo(settings.lastBackupAt)}`;
  return `<section class="backup-banner" aria-label="Backup reminder">
    <span class="ico">${I.shield}</span>
    <span class="txt"><b>${msg}</b><small>One file keeps your chapters, notes and progress safe.</small></span>
    <span class="acts">
      <button type="button" class="btn" data-action="snooze-backup">Later</button>
      <a class="btn btn-accent" href="#/backup">Back up</a>
    </span>
  </section>`;
}

const seriesCount = n => (n === 1 ? '1 series' : `${n} series`);

/* ------------------------------------------------------------------ settings screen */

async function renderSettings() {
  const [count, estimate, persisted, pack, savedWords] = await Promise.all([
    db.counts(),
    navigator.storage?.estimate?.().catch(() => null) ?? null,
    navigator.storage?.persisted?.().catch(() => false) ?? false,
    dictionary.packStatus().catch(() => ({ ready: false })),
    db.countDefinitions().catch(() => 0),
  ]);
  const state = backupState();
  const mb = estimate?.usage != null ? (estimate.usage / 1048576).toFixed(estimate.usage < 10485760 ? 1 : 0) : null;
  const status = {
    none: '<span class="warn">No backup yet</span>',
    old: `<span class="warn">Last backup ${daysAgo(settings.lastBackupAt)}</span>`,
    ok: `<span>Last backup ${daysAgo(settings.lastBackupAt)}</span>`,
  }[state];

  app.innerHTML = `<main class="page">
    <div class="row-head"><h1 class="page-title">Settings</h1></div>

    <a class="backup-link is-${state}" href="#/backup">
      <span class="ico">${state === 'ok' ? I.shieldOk : I.shield}</span>
      <span class="txt"><b>Backup &amp; restore</b>${status}</span>
      ${I.chevron}
    </a>

    <section class="set-group" aria-label="Appearance">
      <p class="label">Appearance</p>
      <div class="set-card">
        <div class="set-block"><span class="set-title">Theme</span>${themeTilesHtml()}</div>
        <div class="set-block"><span class="set-title">Accent color</span>${accentSwatchesHtml()}</div>
        <div class="set-block" style="border-bottom:0">
          <span class="set-title">Text &amp; layout</span>
          <div class="text-preview">The Ghost Adept silently regarded his late-night visitor. As the master of the Ghost Gate, he had fought his way through mountains of blades and forests of swords.</div>
        </div>
      </div>
    </section>

    <section class="set-group" aria-label="Font">
      <p class="label">Font</p>
      <div class="font-grid">
        ${Object.entries(FONTS).map(([k, f]) => `<button type="button" class="font-card" ${pressed('font', k)}>
          <span class="ag" style="font-family:${f.family}">Ağ</span>
          <span class="nm" style="font-family:${f.family}">${f.label}</span>
          <small>${f.hint}</small>
        </button>`).join('')}
      </div>
    </section>

    <section class="set-group" aria-label="Layout">
      <p class="label">Layout</p>
      <div class="set-card">
        <div class="set-block"><span class="set-title">Alignment</span>${alignHtml()}</div>
        <div class="set-block">
          <span class="set-title" style="display:flex;justify-content:space-between">Size <b data-size-val style="color:var(--accent)">${settings.size}px</b></span>
          ${sizeRowHtml()}
        </div>
        <div class="set-block" style="border-bottom:0">${spacingMarginsHtml()}</div>
      </div>
    </section>

    <section class="set-group" aria-label="Reading">
      <p class="label">Reading</p>
      <div class="set-card">
        <label class="set-row">
          <span class="txt"><b>Keep screen on</b><small>While a chapter is open</small></span>
          <input type="checkbox" role="switch" data-toggle="keepAwake" ${settings.keepAwake ? 'checked' : ''}>
        </label>
        <label class="set-row">
          <span class="txt"><b>Show progress footer</b><small>Percent and time left at the bottom</small></span>
          <input type="checkbox" role="switch" data-toggle="showFooter" ${settings.showFooter !== false ? 'checked' : ''}>
        </label>
        <label class="set-row">
          <span class="txt"><b>Underline Codex names</b><small>Dotted line under characters, places… you added; tap for a quick card</small></span>
          <input type="checkbox" role="switch" data-toggle="codexNames" ${settings.codexNames !== false ? 'checked' : ''}>
        </label>
      </div>
    </section>

    <section class="set-group" aria-label="Dictionary">
      <p class="label">Dictionary</p>
      <div class="set-card dict-card">
        <div class="set-row is-info is-stack">
          <span class="txt"><b>Merriam-Webster keys</b>
            <small>Free for personal use. Get them at <a href="https://dictionaryapi.com/register/index" target="_blank" rel="noopener">dictionaryapi.com</a>
            (choose Learner’s and Collegiate). Without keys, Define uses Wiktionary.</small></span>
          <label class="key-field"><span>Learner’s</span>
            <input type="text" data-dict-key="mwLearnersKey" value="${esc(settings.mwLearnersKey || '')}" placeholder="Paste the Learner’s key" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
          <label class="key-field"><span>Collegiate</span>
            <input type="text" data-dict-key="mwCollegiateKey" value="${esc(settings.mwCollegiateKey || '')}" placeholder="Paste the Collegiate key" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
        </div>
        <div class="set-row is-info">
          <span class="txt"><b>Offline dictionary</b>
            <small id="pack-status">${pack.ready
              ? `${Number(pack.words).toLocaleString('en-US')} words · used when there’s no internet`
              : 'Open English WordNet · 7.4 MB download · any word without internet'}</small></span>
          ${pack.ready
            ? '<button type="button" class="btn" data-action="pack-remove" style="height:40px;padding:0 14px;font-size:14px">Remove</button>'
            : '<button type="button" class="btn btn-accent" data-action="pack-download" style="height:40px;padding:0 14px;font-size:14px">Download</button>'}
        </div>
        <div class="set-row is-info">
          <span class="txt"><b>Saved words</b>
            <small>${plural(savedWords, 'word')} looked up and kept for offline use</small></span>
          ${savedWords ? '<button type="button" class="btn" data-action="dict-clear" style="height:40px;padding:0 14px;font-size:14px">Clear</button>' : ''}
        </div>
      </div>
    </section>

    <section class="set-group" aria-label="Storage">
      <p class="label">Storage</p>
      <div class="set-card">
        <div class="set-row is-info">
          <span class="txt"><b>On this phone</b>
            <small>${seriesCount(count.series)} · ${plural(count.chapters, 'chapter')} · ${plural(count.notes, 'note')}${mb ? ` · ${mb} MB` : ''}</small></span>
        </div>
        <div class="set-row is-info">
          <span class="txt"><b>Protected from cleanup</b>
            <small>${persisted
              ? 'Chrome won’t clear this app’s data on its own.'
              : 'Chrome may clear this data when the phone is low on space.'}</small></span>
          ${persisted ? `<span class="ok-mark">${I.check}</span>` : '<button type="button" class="btn" data-action="persist" style="height:40px;padding:0 14px;font-size:14px">Protect</button>'}
        </div>
      </div>
    </section>

    <p class="hint" style="text-align:center;padding:4px 0 8px">Reader · your personal web novel app</p>
  </main>${nav('settings')}`;

  ensureAllFonts();
  bindAppearance(app.querySelector('main'));
  app.querySelectorAll('[data-dict-key]').forEach(input => input.addEventListener('change', () => {
    settings = { ...settings, [input.dataset.dictKey]: input.value.trim() };
    saveSettings(settings);
    toast(input.value.trim() ? 'Key saved' : 'Key removed');
  }));
}

/* ------------------------------------------------------------------ backup screen */

const backupInput = document.createElement('input');
backupInput.type = 'file';
backupInput.hidden = true;
document.body.append(backupInput);

async function renderBackup() {
  const state = backupState();
  const count = await db.counts();
  const statusHtml = {
    none: `<section class="backup-status is-warn" aria-label="Backup status">
      ${I.shield}<span><b>No backup yet</b>
      <small>Your library is stored only on this phone. If the browser data is cleared or the phone is lost, a backup file is the only way to get it back.</small></span></section>`,
    old: `<section class="backup-status is-warn" aria-label="Backup status">
      ${I.shield}<span><b>Last backup ${daysAgo(settings.lastBackupAt)}</b>
      <small>Chapters, notes and progress added since then aren’t in a backup yet.</small></span></section>`,
    ok: `<section class="backup-status is-ok" aria-label="Backup status">
      ${I.shieldOk}<span><b>Backed up ${daysAgo(settings.lastBackupAt)}</b>
      <small>${new Date(settings.lastBackupAt).toLocaleString()}</small></span></section>`,
  }[state];

  app.innerHTML = `<main class="page" style="gap:18px;padding-top:14px">
    <header style="display:flex;align-items:center;gap:6px">
      <a class="icon-btn" href="#/settings" aria-label="Back to settings">${I.back}</a>
      <h1 style="margin:0;font-family:Lexend,sans-serif;font-size:20px;font-weight:500;color:var(--strong)">Backup &amp; restore</h1>
    </header>
    ${statusHtml}
    <section class="set-card included" aria-label="What a backup includes">
      <p class="label" style="padding:0">One file includes</p>
      ${['All series and chapter texts', 'Reading progress and read marks', 'Notes, highlights and tags', 'Covers and reading settings']
        .map(t => `<span>${I.check}${t}</span>`).join('')}
      <small>Right now: ${seriesCount(count.series)}, ${plural(count.chapters, 'chapter')}, ${plural(count.notes, 'note')}.</small>
    </section>
    <label class="set-row set-card">
      <span class="txt"><b>Remind me weekly</b><small>A small nudge in the Library when it’s been a while</small></span>
      <input type="checkbox" role="switch" data-toggle="backupReminder" ${settings.backupReminder ? 'checked' : ''}>
    </label>
    <div class="backup-actions">
      <button type="button" class="btn btn-accent" data-action="create-backup" ${count.series ? '' : 'disabled'}>${I.download} Create backup file</button>
      <button type="button" class="btn" data-action="restore-backup">${I.upload} Restore from a backup</button>
      <p class="hint" style="text-align:center">The file is saved to your Downloads folder. Keep a copy in Google Drive or on your computer to be extra safe.</p>
    </div>
  </main>`;

  app.querySelector('main').addEventListener('change', e => {
    if (e.target.dataset.toggle) updateSettings({ [e.target.dataset.toggle]: e.target.checked });
  });
}

async function createBackupFile(btn) {
  btn.disabled = true;
  btn.innerHTML = 'Creating backup…';
  try {
    const file = await backup.createBackup(settings);
    backup.downloadBlob(file.blob, file.filename);
    settings = { ...settings, lastBackupAt: file.exportedAt, backupSnoozeUntil: 0 };
    saveSettings(settings);
    toast(`Saved ${file.filename} (${(file.size / 1048576).toFixed(1)} MB)`);
  } catch (err) {
    console.error(err);
    toast('Backup failed. Please try again.');
  }
  route();
}

backupInput.addEventListener('change', async () => {
  const file = backupInput.files?.[0];
  backupInput.value = '';
  if (!file) return;
  let data;
  try {
    data = await backup.readBackup(file);
  } catch (err) {
    toast(err.message);
    return;
  }
  const incoming = backup.summarize(data);
  const now = await db.counts();
  const when = incoming.exportedAt ? new Date(incoming.exportedAt).toLocaleString() : 'an unknown date';
  openSheet(`
    <h2>Restore this backup?</h2>
    <div class="restore-compare">
      <div><small>Backup from ${esc(when)}</small>
        <b>${seriesCount(incoming.series)} · ${plural(incoming.chapters, 'chapter')} · ${plural(incoming.notes, 'note')}</b></div>
      <div><small>On this phone now</small>
        <b>${seriesCount(now.series)} · ${plural(now.chapters, 'chapter')} · ${plural(now.notes, 'note')}</b></div>
    </div>
    <p class="hint" style="font-size:14px">Restoring <b style="color:var(--danger)">replaces everything</b> on this phone with the backup. Anything added after the backup was made will be gone.</p>
    <div class="two-btns">
      <button type="button" class="btn" data-rb="cancel">Cancel</button>
      <button type="button" class="btn btn-danger" data-rb="go">Replace &amp; restore</button>
    </div>`, sheet => {
    sheet.addEventListener('click', async e => {
      const b = e.target.closest('[data-rb]');
      if (!b) return;
      if (b.dataset.rb === 'cancel') { closeOverlay(); return; }
      b.disabled = true;
      b.textContent = 'Restoring…';
      try {
        const restored = await backup.restoreBackup(data);
        saveSettings({ ...settings, ...restored, lastBackupAt: data.exportedAt || Date.now(), backupSnoozeUntil: 0 });
        sessionStorage.setItem('reader-toast', 'Backup restored');
        location.replace('#/');
        location.reload();
      } catch (err) {
        console.error(err);
        toast('Restore failed. Nothing was changed.');
        closeOverlay();
      }
    });
  });
});

/* ------------------------------------------------------------------ global actions */

document.addEventListener('click', e => {
  const filter = e.target.closest('[data-filter]');
  if (filter) {
    settings = { ...settings, libFilter: filter.dataset.filter };
    saveSettings(settings);
    document.querySelectorAll('[data-filter]').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.filter === settings.libFilter)));
    drawLibraryList();
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  switch (el.dataset.action) {
    case 'open-settings':
      openSheet(settingsSheetHtml(), mountSettings);
      break;
    case 'open-sounds':
      sounds.openSoundsPanel();
      break;
    case 'cycle-theme': {
      // Cycle through your ★ favorite themes (all themes if none are starred).
      const list = favThemes().length ? favThemes() : THEMES.map(t => t.id);
      const next = list[(list.indexOf(settings.theme) + 1) % list.length];
      updateSettings({ theme: next });
      toast(themeById(next).label);
      break;
    }
    case 'pick-files':
      importTarget = null;
      fileInput.value = '';
      fileInput.click();
      break;
    case 'pick-folder':
      importTarget = null;
      folderInput.value = '';
      folderInput.click();
      break;
    case 'series-tab': {
      const t = el.dataset.tab;
      location.replace(`#/series/${currentSeries.id}${t === 'chapters' ? '' : `/${t}`}`);
      break;
    }
    case 'toggle-order':
      seriesOrderDesc = !seriesOrderDesc;
      route();
      break;
    case 'toggle-search':
      libSearchOpen = !libSearchOpen;
      if (!libSearchOpen) libQuery = '';
      route();
      break;
    case 'open-sort': openSortSheet(); break;
    case 'series-menu': openSeriesMenu(); break;
    case 'series-status': openStatusSheet(); break;
    case 'jump': openJumpSheet(); break;
    case 'chapter-notes':
      activeReader?.chapterNotes();
      break;
    case 'pack-download': {
      el.disabled = true;
      const status = document.getElementById('pack-status');
      dictionary.downloadPack(p => { el.textContent = `${Math.round(p * 100)}%`; })
        .then(words => { toast(`Offline dictionary ready · ${words.toLocaleString('en-US')} words`); route(); })
        .catch(err => {
          console.warn(err);
          el.disabled = false;
          el.textContent = 'Try again';
          if (status) status.textContent = 'Download failed — check the internet connection.';
        });
      break;
    }
    case 'pack-remove':
      dictionary.removePack().then(() => { toast('Offline dictionary removed'); route(); });
      break;
    case 'dict-clear':
      db.clearDefinitions().then(() => { toast('Saved words cleared'); route(); });
      break;
    case 'reader-codex':
      activeReader?.openCodex();
      break;
    case 'snooze-backup':
      settings = { ...settings, backupSnoozeUntil: Date.now() + 3 * DAY };
      saveSettings(settings);
      el.closest('.backup-banner')?.remove();
      break;
    case 'create-backup': createBackupFile(el); break;
    case 'restore-backup': backupInput.click(); break;
    case 'persist':
      if (!navigator.storage?.persist) {
        toast('Available once the app is published with https');
        break;
      }
      navigator.storage.persist().then(ok => {
        toast(ok ? 'Protected' : 'Chrome didn’t allow it yet. Installing the app usually helps.');
        route();
      });
      break;
    default:
      break;
  }
});

/* ------------------------------------------------------------------ start */

// Offline support runs on the real https address (GitHub Pages).
// It stays off on Live Server (127.0.0.1 / your Wi-Fi IP), so edits show up immediately while you work.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  const hadWorker = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker not registered', err));
  // A new version finished downloading in the background.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadWorker) toast('App updated — close and reopen to see what’s new');
  });
}

// Message carried over a reload (e.g. after restoring a backup).
const pending = sessionStorage.getItem('reader-toast');
if (pending) { sessionStorage.removeItem('reader-toast'); setTimeout(() => toast(pending), 400); }

// The headphones button in the reader shows a dot while sounds play.
sounds.onChange(() => document.querySelectorAll('.snd-btn')
  .forEach(b => b.classList.toggle('is-playing', sounds.isPlaying())));

// Update 4: tags still using an old color move to the new 12, then the app starts.
notes.migrateTagColors()
  .then(() => notes.migrateTagScopes()) // Update 5: series tags and shared tags
  .catch(err => console.warn('Tags not updated', err))
  .finally(route);
