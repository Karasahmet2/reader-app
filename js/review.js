// review.js — practise your saved words (Update 17).
//
// Spaced review: every word keeps a small schedule in word.srs
//   { reps, interval (days), ease, due (time), lapses, streak, last, log[{t, g, d}] }
// Forgot → back later today · Hard → a little later · Knew it → much later.
// A session has the size you pick (7 / 14 / 21): due words first, then new words (at most a
// third), then the words due soonest, so it always fills up.
//
// Card types: What does it mean? · Which word fits? · Listen: hear the word · Listen: a
// sentence from your book · Use it in your own sentence (words you know well, now and then).
// The schedule lives on the word, so it's in backups and the Trash with it.

import * as db from './db.js';
import { esc, plural, short, svg, toast, goBack, replaceHash, openSheet, closeOverlay, I } from './ui.js';
import { allForms, groupHtml, saveWord, sayWord, openWordCard } from './words.js';
import { isLapse, inZone, logPoint, describe, colorOf, daysLabel, diamondSvg, attachPicker } from './diamond.js';

const DAY = 864e5;
const KNOWN = 21;                 // days between reviews that count as "known well"
const SIZES = [2, 3, 5, 7, 11, 13, 17, 19, 23];
// The practice styles: a symbol each, on or off.
const KINDS = [
  ['meaning', 'Meaning', '<path d="M3 5.5h6a3 3 0 0 1 3 3V20a2.5 2.5 0 0 0-2.5-2.5H3z"/><path d="M21 5.5h-6a3 3 0 0 0-3 3V20a2.5 2.5 0 0 1 2.5-2.5H21z"/>'],
  ['fits', 'Fill the gap', '<path d="M3 12h3.5M17.5 12H21"/><rect x="8.5" y="8" width="7" height="8" rx="1.5" stroke-dasharray="2.2 2"/>'],
  ['listenWord', 'Hear the word', '<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>'],
  ['listenSentence', 'Hear a sentence', '<path d="M3 9.5v5h3l4 3v-11l-4 3z"/><path d="M14 8.5h7M14 12h7M14 15.5h4.5"/>'],
  ['use', 'Write a sentence', '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>'],
];
const ALL_KINDS = KINDS.map(k => k[0]);
const kindIcon = (k, size = 22) => svg(KINDS.find(x => x[0] === k)[2], size, 1.8);
const K_SIZE = 'reader-review-count', K_STYLES = 'reader-review-styles', K_SERIES = 'reader-review-series', K_SORT = 'reader-review-sort';
const stylesOn = () => { const v = get(K_STYLES, null); return Array.isArray(v) ? v.filter(k => ALL_KINDS.includes(k)) : [...ALL_KINDS]; };

const norm = s => String(s || '').toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const canSpeak = () => 'speechSynthesis' in window;
const SPK = svg('<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16.5 9a4 4 0 0 1 0 6"/>', 20, 1.8);
const PLAY = svg('<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>', 26, 1.5);
const SLOW = svg('<path d="M12 20a8 8 0 1 1 8-8"/><path d="M12 8v4l2.5 2"/>', 18, 1.9);
const X = svg('<path d="M6 6l12 12M18 6L6 18"/>', 20, 2);

/* ------------------------------------------------------------------ schedule */

const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const endOfToday = () => dayStart(Date.now()) + DAY - 1;
export const srsOf = w => ({ reps: 0, interval: 0, ease: 2.5, due: 0, lapses: 0, streak: 0, log: [], ...(w.srs || {}) });
export const isNew = w => !srsOf(w).reps;
export const isDue = (w, at = endOfToday()) => !isNew(w) && srsOf(w).due <= at;
export const isKnown = w => srsOf(w).interval >= KNOWN;
/** Positions of a word's reviews, oldest first. */
export const pointsOf = w => (srsOf(w).log || []).map(logPoint).filter(Boolean);
/** Tough: the average of the last 3 spots is inside the tough zone. */
export function isTough(w) {
  const pts = pointsOf(w).slice(-3);
  if (pts.length < 3) return false;
  return inZone(pts.reduce((s, p) => s + p.x, 0) / 3, pts.reduce((s, p) => s + p.y, 0) / 3);
}

/** Days until the next review if you put the dot at (x, y). 0 = again later today. */
export function daysFor(w, x, y) {
  const s = srsOf(w);
  if (isLapse(x, y)) return x <= -3 && y <= 0 ? 0 : 1;
  const rem = (x + 3) / 6, ease = (y + 3) / 6;
  const base = !s.reps ? 3 : (s.interval || 1.5);
  return Math.max(1, Math.round(base * (0.3 + 1.5 * rem + 0.8 * ease)));
}

/** Record a review at point (x, y). Returns the word as saved. */
export async function rate(w, x, y, now = Date.now()) {
  const s = srsOf(w);
  const days = daysFor(w, x, y);
  const wasDue = s.reps > 0 && s.due <= now;
  const lapse = isLapse(x, y);
  const next = { ...s, reps: s.reps + 1, last: now, interval: lapse ? 0 : days };
  next.due = days === 0 ? now + 10 * 60e3 : dayStart(now) + days * DAY;
  next.lapses = s.lapses + (lapse ? 1 : 0);
  next.streak = inZone(x, y) ? 0 : s.streak + 1;
  next.log = [...(s.log || []), { t: now, x, y, s: 3, n: days, d: wasDue ? 1 : 0 }].slice(-30);
  return saveWord({ ...(await db.getWord(w.id)), srs: next });
}

/* ------------------------------------------------------------------ which words */

async function library() {
  const [words, notes, series] = await Promise.all([db.getAllWords(), db.getAllNotes(), db.getAllSeries()]);
  const inSeries = new Map(); // word id → Set(series id)
  for (const n of notes) if (n.wordId) (inSeries.get(n.wordId) || inSeries.set(n.wordId, new Set()).get(n.wordId)).add(n.seriesId);
  let pick = get(K_SERIES, 'all');
  if (pick !== 'all' && !series.some(s => s.id === pick)) pick = 'all';
  const shown = words.filter(w => pick === 'all' || inSeries.get(w.id)?.has(pick));
  return { words, notes, series, inSeries, pick, shown };
}

/** Pick the words for one session. */
export function buildSession(words, size, now = Date.now()) {
  const due = words.filter(w => isDue(w, endOfToday())).sort((a, b) => srsOf(a).due - srsOf(b).due);
  const fresh = words.filter(isNew).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const out = due.slice(0, size);
  const maxNew = Math.ceil(size / 3);
  out.push(...fresh.splice(0, Math.min(maxNew, size - out.length)));
  if (out.length < size) {
    const soon = words.filter(w => !isNew(w) && !out.includes(w)).sort((a, b) => srsOf(a).due - srsOf(b).due);
    out.push(...soon.slice(0, size - out.length));
  }
  if (out.length < size) out.push(...fresh.splice(0, size - out.length));
  return out;
}

/* ------------------------------------------------------------------ sentences from your books */

const textCache = new Map();
async function paragraphs(chapterId) {
  if (!textCache.has(chapterId)) textCache.set(chapterId, db.getText(chapterId));
  return textCache.get(chapterId);
}

/** The sentence around [start, end) in a paragraph. */
export function sentenceAround(p, start, end) {
  let a;
  const before = p.slice(0, start);
  const m = [...before.matchAll(/[.!?…]["”’)\]]*\s+/g)].pop();
  a = m ? m.index + m[0].length : 0;
  const after = p.slice(end);
  const n = after.match(/[.!?…]["”’)\]]*(\s|$)/);
  const b = n ? end + n.index + n[0].trimEnd().length : p.length;
  let s = p.slice(a, b).trim();
  let off = start - a - (p.slice(a, b).length - p.slice(a, b).trimStart().length);
  if (s.length > 240) { // very long sentence: keep a window around the word
    const from = Math.max(0, off - 110);
    s = (from > 0 ? '…' : '') + s.slice(from, from + 220) + (from + 220 < s.length ? '…' : '');
    off = off - from + (from > 0 ? 1 : 0);
  }
  return { text: s, start: off, end: off + (end - start) };
}

/** Find a saved form of the word in a text: { start, end } or null. */
function findForm(w, text) {
  const forms = allForms(w).sort((a, b) => b.length - a.length).map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!forms.length) return null;
  const m = new RegExp(`(?<![\\p{L}\\p{N}])(?:${forms.join('|')})(?![\\p{L}\\p{N}])`, 'iu').exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

/** Sentences for a word: where you saved it, and sentences you wrote. */
export async function sentencesOf(w, notes, seriesName) {
  const out = [];
  for (const n of notes) {
    if (n.wordId !== w.id || n.sp == null || !n.chapterId) continue;
    const p = (await paragraphs(n.chapterId))[n.sp];
    if (!p) continue;
    let at = null;
    if (n.so != null && n.eo != null && norm(p.slice(n.so, n.eo)) === norm(n.quote)) at = { start: n.so, end: n.eo };
    else at = findForm(w, p);
    if (!at) continue;
    const ch = await db.getChapter(n.chapterId);
    out.push({ ...sentenceAround(p, at.start, at.end), src: `${seriesName(n.seriesId)} · Ch. ${ch?.number ?? '?'}`, href: `#/read/${n.chapterId}/note/${n.id}` });
  }
  for (const t of w.own || []) {
    const at = findForm(w, t);
    if (at) out.push({ text: t, ...at, src: 'Your sentence' });
  }
  return out;
}

const withWord = (c, mid) => `${esc(c.text.slice(0, c.start))}${mid}${esc(c.text.slice(c.end))}`;

/* ------------------------------------------------------------------ checking a typed answer */

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
/** 'right' | 'nearly' (one letter off) | 'wrong' — any saved form counts. */
export function judge(input, w) {
  const a = norm(input).replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  if (!a) return 'wrong';
  const forms = allForms(w);
  if (forms.includes(a)) return 'right';
  if (forms.some(f => f.length >= 4 && lev(a, f) <= 1)) return 'nearly';
  return 'wrong';
}

/* ------------------------------------------------------------------ speaking */

function speak(text, slow) {
  if (!canSpeak()) { toast('This phone can’t read text aloud'); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = slow ? 0.6 : 0.9;
  speechSynthesis.speak(u);
}
function sayWordSlow(w, slow) {
  if (!slow) { sayWord(w); return; }
  if (w.audio) {
    const a = new Audio(w.audio);
    a.playbackRate = 0.7;
    a.play().catch(() => speak(w.word, true));
  } else speak(w.word, true);
}

/* ------------------------------------------------------------------ pages */

let session = null; // { queue, i, size, points, started, again, notes, seriesName }

/** #/review, #/review/go, #/review/progress, #/review/tough. Returns a clean-up function. */
export async function renderReview(app, sub) {
  if (sub === 'go') {
    if (!session) { replaceHash('#/review'); return null; }
    drawCard(app);
    return () => { if (canSpeak()) speechSynthesis.cancel(); };
  }
  if (sub === 'progress') return renderProgress(app);
  if (sub === 'tough') return renderTough(app);
  if (sub === 'words') return renderWordList(app);
  return renderHome(app);
}

const head = (title, subtitle, right = '') => `<div class="row-head rv-head">
  <a class="icon-btn" href="#/words" data-back aria-label="Back">${I.back}</a>
  <div class="txt"><h1 class="page-title">${title}</h1>${subtitle ? `<small>${subtitle}</small>` : ''}</div>${right}</div>`;

async function renderHome(app) {
  const lib = await library();
  const { shown, series, pick } = lib;
  let on = stylesOn();
  let size = SIZES.includes(get(K_SIZE, 7)) ? get(K_SIZE, 7) : 7;
  const due = shown.filter(w => isDue(w)).length;
  const fresh = shown.filter(isNew).length;
  const known = shown.filter(isKnown).length;
  const tough = shown.filter(isTough).length;
  const seriesLabel = pick === 'all' ? 'All series' : series.find(s => s.id === pick)?.name || 'All series';

  app.innerHTML = `<main class="page rv-page">
    ${head('Review', 'Your saved words', `<button type="button" class="chip rv-series" data-rv="series">${esc(seriesLabel)} ▾</button>`)}
    ${!lib.words.length ? `<div class="empty"><strong>No saved words yet</strong><span>Select a word while reading → Define → Save. Your saved words are practised here.</span></div>` : `
    <div class="rv-stats">
      <span><b>${due}</b><small>due today</small></span>
      <span><b>${fresh}</b><small>new words</small></span>
      <span><b>${known}</b><small>known well</small></span></div>
    <section class="rv-sec"><h2 class="rv-label">Practice styles</h2>
      <div class="rv-kinds">${KINDS.map(([k, t]) => `<button type="button" class="rv-kind${on.includes(k) ? ' is-on' : ''}" data-style="${k}" aria-pressed="${on.includes(k)}" aria-label="${t}" title="${t}">${kindIcon(k, 26)}</button>`).join('')}</div>
      <p class="rv-kinds-on"></p></section>
    <section class="rv-sec"><h2 class="rv-label">How many cards?</h2>
      <div class="rv-counts">${SIZES.map(n => `<button type="button" class="rv-count-btn${n === size ? ' is-on' : ''}" data-size="${n}" aria-pressed="${n === size}">${n}</button>`).join('')}</div>
      <p class="hint tip">Due words first, then new ones.</p></section>
    <a class="btn rv-all" href="#/review/words">All words and their progress · ${shown.length}</a>
    <div class="rv-two">
      <a class="btn" href="#/review/progress">Progress</a>
      <a class="btn" href="#/review/tough">Tough words${tough ? ` · ${tough}` : ''}</a></div>
    <div class="rv-start"><button type="button" class="btn btn-accent" data-rv="start"></button></div>`}
  </main>`;
  const page = app.querySelector('.rv-page');
  const showOn = () => {
    const names = KINDS.filter(([k]) => on.includes(k)).map(k => k[1]);
    const line = page.querySelector('.rv-kinds-on');
    if (line) line.innerHTML = names.length
      ? `On: <b>${names.join(' · ')}</b><br><span>Tap a symbol to turn it on or off. New words start with their meaning.</span>`
      : '<b>All styles are off.</b> Turn at least one on to start.';
    const startBtn = page.querySelector('[data-rv="start"]');
    if (startBtn) { startBtn.textContent = `Start · ${size} cards`; startBtn.disabled = !names.length; }
  };
  showOn();

  page.addEventListener('click', async e => {
    const st = e.target.closest('[data-style]');
    if (st) {
      const k = st.dataset.style;
      on = on.includes(k) ? on.filter(x => x !== k) : ALL_KINDS.filter(x => x === k || on.includes(x));
      set(K_STYLES, on);
      st.classList.toggle('is-on', on.includes(k));
      st.setAttribute('aria-pressed', on.includes(k));
      showOn();
      return;
    }
    const sz = e.target.closest('[data-size]');
    if (sz) {
      size = Number(sz.dataset.size);
      set(K_SIZE, size);
      page.querySelectorAll('[data-size]').forEach(b => { b.classList.toggle('is-on', b === sz); b.setAttribute('aria-pressed', b === sz); });
      showOn();
      return;
    }
    if (e.target.closest('[data-rv="start"]')) {
      if (!on.length) return;
      if (!start(lib, size)) { toast('No words to review here yet'); return; }
      location.hash = '#/review/go';
      return;
    }
    if (e.target.closest('[data-rv="series"]')) { openSeriesPicker(lib, () => renderHome(app)); return; }
  });
  return null;
}

/** Set up a session. Returns false if there's nothing to review. */
function start(lib, size) {
  const list = buildSession(lib.shown, size);
  if (!list.length) return false;
  const names = new Map(lib.series.map(s => [s.id, s.name]));
  session = {
    size, lib,
    queue: list.map(w => ({ id: w.id })),
    i: 0, again: new Set(), useCount: 0,
    points: [], started: 0,
    notes: lib.notes, seriesName: id => names.get(id) || '?',
  };
  return true;
}

/** Can this word be shown as this kind of card? */
function canKind(w, ctxs, k) {
  if (k === 'meaning' || k === 'use') return true;
  if (k === 'fits') return !!(ctxs.length && w.meanings?.length);
  if (k === 'listenWord') return !!((w.audio || w.phonetic) && (w.audio || canSpeak()));
  if (k === 'listenSentence') return !!(ctxs.length && canSpeak());
  return false;
}
function pickType(w, ctxs) {
  // A brand-new word starts with its meaning; after that, only the styles you turned on.
  if (isNew(w)) return 'meaning';
  const l = stylesOn().filter(k => canKind(w, ctxs, k));
  return l.length ? l[Math.floor(Math.random() * l.length)] : 'meaning';
}

/** The row for trying the word another way. */
const switcher = (w, ctxs, cur, label = '') => `<div class="rv-switch" role="group" aria-label="Try this word another way">
  ${label ? `<small>${label}</small>` : ''}${KINDS.map(([k, t]) => `<button type="button" class="rv-sw${k === cur ? ' is-on' : ''}" data-kind="${k}" ${canKind(w, ctxs, k) ? '' : 'disabled'} aria-pressed="${k === cur}" aria-label="${t}" title="${t}">${kindIcon(k, 20)}</button>`).join('')}</div>`;

const bar = () => {
  const total = session.queue.length;
  return `<header class="rv-bar">
    <button type="button" class="icon-btn" data-rv="end" aria-label="End session">${X}</button>
    <span class="rv-track"><span style="width:${Math.round(session.i / total * 100)}%"></span></span>
    <span class="rv-count">${Math.min(session.i + 1, total)} / ${total}</span></header>
    <div class="rv-deck"><span>Vocabulary</span></div>`;
};
const ctxBox = (c, mid) => `<div class="rv-ctx"><p>${withWord(c, mid)}</p><small>${esc(c.src)}</small></div>`;
const hl = c => `<mark class="rv-hl">${esc(c.text.slice(c.start, c.end))}</mark>`;
const gap = n => `<span class="rv-gap" style="min-width:${Math.max(5, n) * 0.62}em" aria-label="missing word"></span>`;

/* ------------------------------------------------------------------ swipeable rows (Update 18) */

const CHEV_L = svg('<path d="M15 6l-6 6 6 6"/>', 16, 2);
const CHEV_R = svg('<path d="M9 6l6 6-6 6"/>', 16, 2);
/** Meanings, one per item. */
const meaningItems = w => (w.meanings || []).map(m => `<p class="rv-car-text"><b>${esc(m.pos)}</b> ${esc(m.text)}</p>${m.example ? `<em class="rv-car-ex">“${esc(m.example)}”</em>` : ''}`);
/** A row you swipe (or step with ‹ ›) through: items are html strings. */
const car = (items, label, name = '') => {
  if (!items.length) return '';
  const many = items.length > 1;
  return `<section class="rv-car" data-car="${name}" data-i="0">
    <div class="rv-car-head"><span class="rv-label">${label}</span>${many ? `<b class="rv-car-n">1 of ${items.length}</b>` : ''}
      ${many ? `<span class="rv-car-btns"><button type="button" class="rv-car-btn" data-car-step="-1" aria-label="Previous" disabled>${CHEV_L}</button><button type="button" class="rv-car-btn" data-car-step="1" aria-label="Next">${CHEV_R}</button></span>` : ''}</div>
    <div class="rv-car-track">${items.map((h, i) => `<div class="rv-car-item"${i ? ' hidden' : ''}>${h}</div>`).join('')}</div>
    ${many ? `<div class="rv-dots">${items.map((_, i) => `<i${i ? ' class="is-on"' : ''}></i>`).join('')}</div>` : ''}
  </section>`;
};
function stepCar(el, d) {
  if (!el) return;
  const items = [...el.querySelectorAll(':scope > .rv-car-track > .rv-car-item')];
  const cur = Number(el.dataset.i || 0);
  const i = Math.max(0, Math.min(items.length - 1, cur + d));
  if (i === cur) return;
  el.dataset.i = String(i);
  items.forEach((x, k) => { x.hidden = k !== i; });
  el.querySelectorAll('.rv-dots i').forEach((x, k) => x.classList.toggle('is-on', k === i));
  el.querySelector('.rv-car-n').textContent = `${i + 1} of ${items.length}`;
  el.querySelector('[data-car-step="-1"]').disabled = i === 0;
  el.querySelector('[data-car-step="1"]').disabled = i === items.length - 1;
}
/** Buttons and swipes for every carousel under root. */
function wireCars(root) {
  let x0 = null, box = null;
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-car-step]');
    if (b && !b.disabled) stepCar(b.closest('.rv-car'), Number(b.dataset.carStep));
  });
  root.addEventListener('pointerdown', e => {
    const t = e.target.closest('.rv-car-track');
    if (t) { x0 = e.clientX; box = t.closest('.rv-car'); }
  });
  root.addEventListener('pointerup', e => {
    if (x0 == null || !box) return;
    const dx = e.clientX - x0, el = box;
    x0 = null; box = null;
    if (Math.abs(dx) > 40) stepCar(el, dx < 0 ? 1 : -1);
  });
  root.addEventListener('pointercancel', () => { x0 = null; box = null; });
}

/* ------------------------------------------------------------------ cards */

async function drawCard(app) {
  if (session.i >= session.queue.length) { drawDone(app); return; }
  const item = session.queue[session.i];
  const w = await db.getWord(item.id);
  if (!w) { session.i++; drawCard(app); return; }
  const ctxs = item.ctxs || (item.ctxs = await sentencesOf(w, session.notes, session.seriesName));
  const type = item.type || (item.type = pickType(w, ctxs));
  if (type === 'use') session.useCount++;
  const c = item.ctx || (item.ctx = ctxs.length ? ctxs[Math.floor(Math.random() * ctxs.length)] : null);
  // The flashcard: the word, its forms, sentences and meanings to swipe, notes, then the square.
  if (type === 'meaning') { drawAnswer(app, w, c, null); return; }
  const meaning = (w.meanings || [])[0];

  let body = '', foot = '';
  if (type === 'fits') {
    const first = c.text.slice(c.start, c.end);
    body = `<p class="rv-ask">Which word fits?</p>
      ${player('Play the sentence')}
      <div class="rv-ctx"><p>${withWord(c, gap(first.length))}</p><small>${esc(c.src)} · starts with “${esc(first[0].toLowerCase())}”</small></div>
      ${car(meaningItems(w), 'Meanings', 'mean')}
      ${answerInput('Your answer')}`;
    foot = `<button type="button" class="btn" data-rv="reveal">Show answer</button><button type="button" class="btn btn-accent" data-rv="check">Check</button>`;
  } else if (type === 'listenWord') {
    body = `<p class="rv-ask big">Which word do you hear?</p>
      ${player('Play the word')}
      ${car(meaningItems(w), 'Meanings', 'mean')}
      ${answerInput('Type what you hear')}`;
    foot = `<button type="button" class="btn" data-rv="reveal">Show answer</button><button type="button" class="btn btn-accent" data-rv="check">Check</button>`;
  } else if (type === 'listenSentence') {
    const first = c.text.slice(c.start, c.end);
    body = `<p class="rv-ask big">Which saved word is in this sentence?</p>
      ${player('Play the sentence')}
      <div class="rv-ctx"><small>${esc(c.src)}</small><p>${withWord(c, gap(first.length))}</p></div>
      ${answerInput('The word you heard')}`;
    foot = `<button type="button" class="btn" data-rv="reveal">Show answer</button><button type="button" class="btn btn-accent" data-rv="check">Check</button>`;
  } else { // use
    body = `<p class="rv-ask">Use it in your own sentence</p>
      <div class="rv-word col"><h1>${esc(w.word)}</h1>${meaning ? `<small>${esc(meaning.pos)} — ${esc(meaning.text)}</small>` : ''}</div>
      <label class="rv-own"><span class="rv-label">Your sentence</span><textarea class="text-area" rows="4" id="rv-own"></textarea></label>
      <p class="hint tip">Saved to the word’s My notes, and can come back as the sentence in later reviews.</p>`;
    foot = `<button type="button" class="btn" data-rv="skip">Skip</button><button type="button" class="btn btn-accent" data-rv="own">Save sentence</button>`;
  }
  app.innerHTML = `<main class="page rv-card rv-${type}">${bar()}${switcher(w, ctxs, type)}<div class="rv-body">${body}</div><div class="rv-foot">${foot}</div></main>`;
  wire(app, w, type, c);
  wireCars(app.querySelector('.rv-card'));
  if (type === 'listenWord') sayWordSlow(w, false);
  if (type === 'listenSentence') speak(c.text, false);
}

const answerInput = ph => `<input class="rv-input" id="rv-answer" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${ph}">`;
const player = label => `<div class="rv-player">
  <button type="button" class="rv-play" data-rv="play" aria-label="${label}">${PLAY}</button><b>${label}</b>
  <button type="button" class="chip" data-rv="slow">${SLOW} Slower</button></div>`;

function wire(app, w, type, c) {
  const main = app.querySelector('.rv-card');
  const input = main.querySelector('#rv-answer');
  input?.addEventListener('keydown', e => { if (e.key === 'Enter') main.querySelector('[data-rv="check"]')?.click(); });
  main.addEventListener('click', async e => {
    const kb = e.target.closest('[data-kind]');
    if (kb && !kb.disabled) {
      const item = session.queue[session.i];
      if (item.type === kb.dataset.kind) return;
      if (canSpeak()) speechSynthesis.cancel();
      item.type = kb.dataset.kind;
      item.tried = [...(item.tried || []), type];
      drawCard(app);
      return;
    }
    const b = e.target.closest('[data-rv]');
    if (!b) return;
    const act = b.dataset.rv;
    if (act === 'end') { if (canSpeak()) speechSynthesis.cancel(); goBack('#/review'); return; }
    if (act === 'say') sayWord(w);
    if (act === 'play' || act === 'slow') {
      const slow = act === 'slow';
      if (type === 'listenWord') sayWordSlow(w, slow); else speak(c.text, slow);
    }
    if (act === 'reveal') drawAnswer(app, w, c, { verdict: 'shown', typed: '' });
    if (act === 'check') {
      const typed = input.value;
      if (!typed.trim()) { input.focus(); return; }
      drawAnswer(app, w, c, { verdict: judge(typed, w), typed });
    }
    if (act === 'skip') await answer(app, w, { x: 3, y: 1 });
    if (act === 'own') {
      const t = main.querySelector('#rv-own').value.trim();
      if (!t) { main.querySelector('#rv-own').focus(); return; }
      const cur = await db.getWord(w.id);
      await saveWord({ ...cur, own: [...(cur.own || []), t].slice(-10), mine: [cur.mine?.trim(), `• ${t}`].filter(Boolean).join('\n') });
      toast('Sentence saved to My notes');
      await answer(app, w, { x: 2, y: 1 });
    }
  });
  setTimeout(() => input?.focus(), 50);
}

const DIA = { size: 280, margin: 22 };

/** The flashcard, and the answer side after a typed answer: the word and its forms, the sentences
 *  and meanings to swipe through, your notes, then the square. */
function drawAnswer(app, w, c, check) {
  if (canSpeak()) speechSynthesis.cancel();
  const item = session.queue[session.i];
  const ctxs = item.ctxs || [];
  const sents = c ? [c, ...ctxs.filter(x => x !== c)] : ctxs;
  const said = c ? c.text.slice(c.start, c.end) : w.word;
  // A typed answer places the dot on the side it earned; you can still move it.
  const placed = !check ? null : check.verdict === 'right' ? { x: 2, y: 1 } : check.verdict === 'nearly' ? { x: 0, y: 0 } : { x: -3, y: 0 };
  let sel = placed;
  const ghost = pointsOf(w).at(-1) || null;
  const banner = !check ? '' : check.verdict === 'right'
    ? `<div class="rv-verdict is-right"><b>Right — ${esc(w.word)}</b>${norm(said) !== norm(w.word) ? `<small>The book says “${esc(said)}”; other forms of the word count too.</small>` : ''}</div>`
    : check.verdict === 'nearly'
      ? `<div class="rv-verdict is-nearly"><b>Nearly — check the spelling</b><small>You wrote “${esc(check.typed)}” · it’s “${esc(w.word)}”</small></div>`
      : `<div class="rv-verdict is-wrong"><b>${check.verdict === 'shown' ? 'The answer' : 'Not quite'} — ${esc(w.word)}</b>${check.typed ? `<small>You wrote “${esc(check.typed)}”</small>` : ''}</div>`;
  const ask = !check ? 'How did it feel? Drag the dot — it snaps to the points'
    : check.verdict === 'right' ? 'Right answer → the dot starts on the remembered side. Move it if it felt hard.'
      : check.verdict === 'nearly' ? 'Nearly → the dot starts in the middle. Move it to where it felt.'
        : 'The dot starts at F. Move it if it was nearly there — or try the word another way above.';
  const top = !check ? switcher(w, ctxs, 'meaning')
    : check.verdict !== 'right' ? switcher(w, ctxs, null, 'Try another way') : '';
  const sentItems = sents.map(x => `<p class="rv-car-text">${withWord(x, hl(x))}</p><small class="rv-car-src">${esc(x.src)}</small>`);
  app.innerHTML = `<main class="page rv-card rv-answer">${bar()}<div class="rv-body">
    ${banner}
    ${top}
    <div class="rv-word left"><span><h1>${esc(w.word)}</h1>${w.phonetic ? `<span class="rv-ipa">${esc(w.phonetic)}</span>` : ''}</span>
      <button type="button" class="rv-say" data-rv="say" aria-label="Pronounce">${SPK}</button></div>
    ${w.forms?.length ? `<div class="rv-forms">${w.forms.map(f => `<span class="chip">${esc(f)}</span>`).join('')}</div>` : ''}
    ${car(sentItems, 'Sentences', 'sent')}
    ${car(meaningItems(w), 'Meanings', 'mean')}
    ${w.mine?.trim() ? `<div class="rv-box"><span class="rv-label">My notes</span><p>${esc(short(w.mine.trim(), 400))}</p></div>` : ''}
    ${w.hook?.trim() ? `<div class="rv-box is-hook"><span class="rv-label">Memory hook</span><p>${esc(w.hook.trim())}</p></div>` : ''}
    <section class="rv-rate">
      <p class="rv-q">${ask}</p>
      <div class="rv-dia"></div>
    </section>
  </div>
  <div class="rv-foot col">
    <div class="rv-readout"></div>
    <button type="button" class="btn btn-accent" data-rv="next">Next</button></div></main>`;
  const main = app.querySelector('.rv-card');
  const holder = main.querySelector('.rv-dia');
  const readout = main.querySelector('.rv-readout');
  const nextBtn = main.querySelector('[data-rv="next"]');
  const draw = () => {
    holder.innerHTML = diamondSvg({ ...DIA, sel, ghost, pick: true, label: 'Rate how it felt' });
    if (sel) {
      const d = daysFor(w, sel.x, sel.y), col = colorOf(sel.x, sel.y);
      const mine = placed && sel.x === placed.x && sel.y === placed.y && check?.verdict === 'right';
      readout.innerHTML = `<i style="background:${col}"></i><span>${describe(sel.x, sel.y)}${mine ? ' · placed for you' : ''}</span><b style="color:${col}">${d === 0 ? 'again later today' : d === 1 ? 'next tomorrow' : `next in ${daysLabel(d)}`}</b>`;
    } else {
      readout.innerHTML = `<span class="rv-readout-hint">${ghost ? 'The dashed ring is where you put it last time.' : 'Tap or drag inside the diamond.'}</span>`;
    }
    nextBtn.disabled = !sel;
  };
  draw();
  attachPicker(holder, DIA, p => { sel = p; draw(); });
  wireCars(main);
  main.addEventListener('click', async e => {
    const kb = e.target.closest('[data-kind]');
    if (kb && !kb.disabled) {
      const item = session.queue[session.i];
      item.type = kb.dataset.kind;
      drawCard(app);
      return;
    }
    if (e.target.closest('[data-rv="say"]')) { sayWord(w); return; }
    if (e.target.closest('[data-rv="end"]')) { goBack('#/review'); return; }
    if (e.target.closest('[data-rv="next"]') && sel) {
      nextBtn.disabled = true;
      await answer(app, w, sel);
    }
  });
}

async function answer(app, w, pt) {
  const before = srsOf(w);
  if (!before.reps) session.started++;
  await rate(w, pt.x, pt.y);
  session.points.push(pt);
  // Forgotten: once more at the end of this session.
  if (isLapse(pt.x, pt.y) && !session.again.has(w.id)) {
    session.again.add(w.id);
    session.queue.push({ id: w.id, ctx: session.queue[session.i].ctx });
  }
  session.i++;
  window.scrollTo(0, 0);
  drawCard(app);
}

async function drawDone(app) {
  const pts = session.points;
  const forgot = pts.filter(p => isLapse(p.x, p.y)).length;
  const tough = pts.filter(p => !isLapse(p.x, p.y) && inZone(p.x, p.y)).length;
  const remembered = pts.length - forgot - tough;
  const all = await db.getAllWords();
  const ids = new Set(session.lib.shown.map(w => w.id));
  const lib = { shown: all.filter(w => ids.has(w.id)) };
  const tomorrowEnd = endOfToday() + DAY;
  const nextDue = lib.shown.filter(w => !isNew(w) && srsOf(w).due > endOfToday() && srsOf(w).due <= tomorrowEnd).length;
  const left = buildSession(lib.shown.filter(w => isDue(w) || isNew(w)), session.size).length;
  const reviewed = pts.length;
  app.innerHTML = `<main class="page rv-done">
    <div class="rv-done-top"><h1>${plural(reviewed, 'answer')}</h1>
      <div class="rv-done-dia">${diamondSvg({ size: 230, margin: 16, dots: pts, zone: true })}</div>
      <div class="rv-stats three">
        <span class="is-knew"><b>${remembered}</b><small>remembered</small></span>
        <span class="is-hard"><b>${tough}</b><small>tough</small></span>
        <span class="is-forgot"><b>${forgot}</b><small>forgot</small></span></div>
      <p class="hint">${session.started ? `${plural(session.started, 'new word')} started. ` : ''}${nextDue ? `Next words are due tomorrow (${nextDue}).` : 'Nothing more is due tomorrow.'} The dashed area is the tough zone.</p></div>
    <div class="rv-foot col">
      ${left ? `<button type="button" class="btn" data-rv="more">${left} more</button>` : ''}
      <button type="button" class="btn btn-accent" data-rv="home">Back to Review</button></div></main>`;
  app.querySelector('.rv-done').addEventListener('click', async e => {
    if (e.target.closest('[data-rv="home"]')) {
      session = null;
      goBack('#/review'); // the Review page you started from
      return;
    }
    if (!e.target.closest('[data-rv="more"]')) return;
    const fresh = await library();
    if (!start(fresh, session.size)) return;
    drawCard(app);
  });
}

/* ------------------------------------------------------------------ the word list (Update 18) */

/** The small trail of the last reviews, in their colours. */
const trailSvg = pts => {
  if (!pts.length) return '<span class="rv-vnew">New</span>';
  const xs = pts.map((_, i) => 6 + i * 16);
  const w = xs[xs.length - 1] + 6;
  const line = pts.length > 1 ? `<polyline points="${xs.map(x => `${x},8`).join(' ')}" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="1.5"/>` : '';
  return `<svg class="rv-trail" width="${w}" height="16" viewBox="0 0 ${w} 16" aria-hidden="true">${line}${pts.map((p, i) => `<circle cx="${xs[i]}" cy="8" r="${i === pts.length - 1 ? 5.5 : 4}" fill="${colorOf(p.x, p.y)}"/>`).join('')}</svg>`;
};

/** The series picker: all series, or one at a time. */
function openSeriesPicker(lib, onPick) {
  const { series, pick } = lib;
  const opts = [['all', 'All series'], ...series.filter(s => lib.words.some(w => lib.inSeries.get(w.id)?.has(s.id))).map(s => [s.id, s.name])];
  const count = id => (id === 'all' ? lib.words.length : lib.words.filter(w => lib.inSeries.get(w.id)?.has(id)).length);
  openSheet(`<h2>Words from</h2><div class="option-list">${opts.map(([id, name]) => `<button type="button" class="option-row${id === pick ? ' is-on' : ''}" data-pick="${id}"><span class="txt">${esc(name)}<small>${plural(count(id), 'word')}</small></span>${id === pick ? I.check : ''}</button>`).join('')}</div>`, sheet => {
    sheet.addEventListener('click', ev => {
      const b = ev.target.closest('[data-pick]');
      if (!b) return;
      set(K_SERIES, b.dataset.pick === 'all' ? 'all' : Number(b.dataset.pick));
      closeOverlay();
      onPick();
    });
  });
}

const SORTS = [['az', 'A–Z'], ['first', 'First met'], ['most', 'Most met'], ['tough', 'Tough']];

/** Every saved word, sorted and searchable. With one series picked, where you met each word there
 *  and its progress beside it. */
async function renderWordList(app) {
  const lib = await library();
  const chapters = new Map((await db.getAllChapters()).map(c => [c.id, c]));
  let sort = SORTS.some(([k]) => k === get(K_SORT, 'az')) ? get(K_SORT, 'az') : 'az';
  let query = '';
  const seriesLabel = lib.pick === 'all' ? 'All series' : lib.series.find(s => s.id === lib.pick)?.name || 'All series';
  const metOf = w => lib.notes.filter(n => n.wordId === w.id && (lib.pick === 'all' || n.seriesId === lib.pick));
  const rows = lib.shown.map(w => {
    const ns = metOf(w);
    const chaps = [...new Set(ns.map(n => n.chapterId))].map(id => chapters.get(id)).filter(Boolean).sort((a, b) => a.number - b.number);
    const first = Math.min(w.createdAt || Infinity, ...ns.map(n => n.createdAt || Infinity));
    return { w, ns, chaps, first, seriesN: new Set(ns.map(n => n.seriesId)).size };
  });
  const az = (a, b) => a.w.word.localeCompare(b.w.word, 'en', { sensitivity: 'base' });
  const cmp = {
    az,
    first: (a, b) => (a.first === b.first ? az(a, b) : a.first < b.first ? -1 : 1),
    most: (a, b) => b.ns.length - a.ns.length || az(a, b),
    tough: (a, b) => Number(isTough(b.w)) - Number(isTough(a.w)) || az(a, b),
  };
  const rowHtml = r => {
    const w = r.w, m = w.meanings?.[0];
    const days = Math.round((srsOf(w).due - dayStart(Date.now())) / DAY);
    const due = isNew(w) ? 'New' : isDue(w) ? 'Due today' : `Next ${daysLabel(days)}`;
    const where = lib.pick === 'all'
      ? `<em>${r.seriesN} series · met ${r.ns.length}×</em>`
      : `<span class="rv-vchips">${r.chaps.map(c => `<i>Ch. ${c.number}</i>`).join('')}${r.ns.length > 1 ? `<i>met ${r.ns.length}×</i>` : ''}</span>`;
    return `<button type="button" class="rv-vrow" data-wid="${w.id}">
      <span class="rv-vtxt"><b>${esc(w.word)}</b><small>${m ? `${esc(m.pos)} — ${esc(m.text)}` : 'No meaning saved'}</small>${where}</span>
      <span class="rv-vprog">${trailSvg(pointsOf(w).slice(-3))}<small class="${isDue(w) ? 'is-due' : ''}">${due}</small></span></button>`;
  };
  const due = rows.filter(r => isDue(r.w)).length;
  const size = SIZES.includes(get(K_SIZE, 7)) ? get(K_SIZE, 7) : 7;

  app.innerHTML = `<main class="page rv-page rv-words">
    <div class="row-head rv-head"><a class="icon-btn" href="#/review" data-back aria-label="Back">${I.back}</a>
      <div class="txt"><h1 class="page-title">Words</h1><small>${plural(rows.length, 'word')} · ${due} due today</small></div>
      <button type="button" class="chip rv-series" data-rv="series">${esc(seriesLabel)} ▾</button></div>
    ${!rows.length ? `<div class="empty"><strong>No words here yet</strong><span>Select a word while reading → Define → Save.</span></div>` : `
    <label class="search-box rv-wsearch">${I.search}<input id="rv-q" type="search" placeholder="Search words and forms" autocomplete="off"></label>
    <div class="rv-sorts" role="group" aria-label="Sort words">${SORTS.map(([k, t]) => `<button type="button" class="chip${k === sort ? ' is-on' : ''}" data-sort="${k}" aria-pressed="${k === sort}">${t}</button>`).join('')}</div>
    <div class="rv-vlist" id="rv-vlist"></div>
    <div class="rv-foot col"><button type="button" class="btn btn-accent" data-rv="practice">Practice · ${size} cards</button></div>`}
  </main>`;
  const list = app.querySelector('#rv-vlist');
  const draw = () => {
    const q = query.trim().toLowerCase();
    const shown = rows.filter(r => !q || r.w.word.toLowerCase().includes(q) || (r.w.forms || []).some(f => f.toLowerCase().includes(q)))
      .sort(cmp[sort]);
    list.innerHTML = shown.length ? shown.map(rowHtml).join('') : '<p class="hint">No word matches that.</p>';
  };
  if (list) draw();
  const page = app.querySelector('.rv-words');
  page.addEventListener('input', e => { if (e.target.id === 'rv-q') { query = e.target.value; draw(); } });
  page.addEventListener('click', async e => {
    const s = e.target.closest('[data-sort]');
    if (s) {
      sort = s.dataset.sort;
      set(K_SORT, sort);
      page.querySelectorAll('[data-sort]').forEach(b => { b.classList.toggle('is-on', b === s); b.setAttribute('aria-pressed', b === s); });
      draw();
      return;
    }
    if (e.target.closest('[data-rv="series"]')) { openSeriesPicker(lib, () => renderWordList(app)); return; }
    if (e.target.closest('[data-rv="practice"]')) {
      if (!start(lib, size)) { toast('Nothing to practise here yet'); return; }
      location.hash = '#/review/go';
      return;
    }
    const row = e.target.closest('[data-wid]');
    if (row) openWordCard(Number(row.dataset.wid), { onChanged: () => renderWordList(app) });
  });
  return null;
}

/* ------------------------------------------------------------------ progress */

async function renderProgress(app) {
  const lib = await library();
  const { shown, series, inSeries } = lib;
  const known = shown.filter(isKnown).length;
  const fresh = shown.filter(isNew).length;
  const learning = shown.length - known - fresh;
  const since = Date.now() - 30 * DAY;
  const dueLogs = shown.flatMap(w => (srsOf(w).log || []).filter(l => l.t >= since && l.d)).map(logPoint).filter(Boolean);
  const onTime = dueLogs.length ? Math.round(dueLogs.filter(p => !isLapse(p.x, p.y)).length / dueLogs.length * 100) : null;
  const today = dayStart(Date.now());
  const days = Array.from({ length: 7 }, (_, i) => {
    const a = today + (i + 1) * DAY, b = a + DAY;
    return { label: new Date(a).toLocaleDateString('en-GB', { weekday: 'short' }), n: shown.filter(w => !isNew(w) && srsOf(w).due >= a && srsOf(w).due < b).length };
  });
  const most = Math.max(1, ...days.map(d => d.n));
  const bySeries = series.map(s => {
    const ws = lib.words.filter(w => inSeries.get(w.id)?.has(s.id));
    return { name: s.name, n: ws.length, known: ws.filter(isKnown).length };
  }).filter(x => x.n).sort((a, b) => b.n - a.n);

  app.innerHTML = `<main class="page rv-page">
    ${head('Progress', esc(lib.pick === 'all' ? 'Vocabulary · all series' : `Vocabulary · ${series.find(s => s.id === lib.pick)?.name || ''}`))}
    <div class="rv-grid">
      <span><b>${known}</b><small>known well (3 weeks+)</small></span>
      <span><b>${learning}</b><small>learning</small></span>
      <span><b>${onTime == null ? '—' : `${onTime}%`}</b><small>remembered on time (30 days)</small></span>
      <span><b>${fresh}</b><small>new, not started</small></span></div>
    <section class="rv-sec"><h2 class="rv-label">Due in the next 7 days</h2>
      <div class="rv-bars">${days.map(d => `<span><em>${d.n}</em><i style="height:${Math.round(d.n / most * 100)}%"></i><small>${d.label}</small></span>`).join('')}</div></section>
    ${bySeries.length ? `<section class="rv-sec"><h2 class="rv-label">By series</h2><div class="rv-list">${bySeries.map(x => `<div class="rv-row"><span>${esc(x.name)}</span><small>${plural(x.n, 'word')} · ${x.known} known</small></div>`).join('')}</div></section>` : ''}
    <p class="hint">No streaks — skip a day and the words simply wait. Review progress is part of the backup.</p>
  </main>`;
  return null;
}

/* ------------------------------------------------------------------ tough words */

async function renderTough(app) {
  const lib = await library();
  const list = lib.shown.filter(isTough).sort((a, b) => srsOf(b).lapses - srsOf(a).lapses);
  const row = w => `<div class="rv-tough" data-word="${w.id}">
    <div class="rv-mini">${diamondSvg({ size: 96, margin: 8, trail: pointsOf(w).slice(-6), zone: true, letters: false })}</div>
    <div class="rv-tough-txt"><b>${esc(w.word)}</b>
    ${w.meanings?.[0] ? `<span>${esc(w.meanings[0].pos)} — ${esc(w.meanings[0].text)}</span>` : ''}
    ${w.hook?.trim()
      ? `<button type="button" class="rv-hook" data-hook="${w.id}">${esc(w.hook.trim())}</button>`
      : `<button type="button" class="chip is-dashed" data-hook="${w.id}">+ Add a memory hook</button>`}</div></div>`;
  app.innerHTML = `<main class="page rv-page">
    ${head('Tough words', 'Your last 3 reviews were mostly forgot or hard')}
    ${list.length ? `<p class="hint">A memory hook — a picture, a word it sounds like, a scene from the story — usually works better than more repetition.</p>
      <div class="rv-tough-list">${list.map(row).join('')}</div>
      <p class="hint tip">The dashed area is the tough zone. A word leaves the list once its last 3 dots move out of it — up or to the right.</p>`
    : `<div class="empty"><strong>No tough words</strong><span>A word shows up here when your last 3 reviews of it land, on average, in the forgot-or-hard corner of the diamond.</span></div>`}
  </main>`;
  app.querySelector('.rv-page').addEventListener('click', async e => {
    const b = e.target.closest('[data-hook]');
    if (!b) return;
    const box = b.closest('.rv-tough-txt');
    const w = await db.getWord(Number(b.dataset.hook));
    b.outerHTML = `<div class="rv-hook-edit"><textarea class="text-area" rows="2" placeholder="A picture, a word it sounds like, a scene…">${esc(w.hook || '')}</textarea>
      <button type="button" class="btn btn-accent" data-save-hook>Save</button></div>`;
    const ta = box.querySelector('textarea');
    ta.focus();
    box.querySelector('[data-save-hook]').addEventListener('click', async () => {
      await saveWord({ ...(await db.getWord(w.id)), hook: ta.value.trim() });
      renderTough(app);
    });
  });
  return null;
}

/** Words due now (for the Library and Words page). */
export async function dueCount() {
  const words = await db.getAllWords();
  return { total: words.length, due: words.filter(w => isDue(w)).length, fresh: words.filter(isNew).length };
}
