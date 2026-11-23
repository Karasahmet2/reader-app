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
import { allForms, groupHtml, saveWord, sayWord } from './words.js';
import { toXY, isLapse, inZone, logPoint, describe, colorOf, daysLabel, diamondSvg, attachPicker } from './diamond.js';

const DAY = 864e5;
const KNOWN = 21;                 // days between reviews that count as "known well"
const SIZES = [[7, 'I don’t have much time', 'about 2 minutes'], [14, 'I have some time', 'about 5 minutes'], [21, 'I have time', 'about 8 minutes']];
const TYPES = [
  ['meaning', 'What does it mean?', ''],
  ['fits', 'Which word fits?', ''],
  ['listenWord', 'Listen: hear the word, type it', 'Only words with a pronunciation'],
  ['listenSentence', 'Listen: a sentence from your book', 'The phone’s voice reads it; type the saved word'],
  ['use', 'Use it in your own sentence', 'Only words you know well, now and then'],
];
const K_SIZE = 'reader-review-size', K_TYPES = 'reader-review-types', K_SERIES = 'reader-review-series';

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
  const xy = pts.map(p => toXY(p.a, p.b));
  return inZone(xy.reduce((s, p) => s + p.x, 0) / 3, xy.reduce((s, p) => s + p.y, 0) / 3);
}

/** Days until the next review if you put the dot at (a, b). 0 = again later today. */
export function daysFor(w, a, b) {
  const s = srsOf(w);
  const { x, y } = toXY(a, b);
  if (isLapse(a, b)) return y > 0 ? 1 : 0;
  const rem = (x + 2) / 4, ease = (y + 2) / 4;
  const base = !s.reps ? 3 : (s.interval || 1.5);
  return Math.max(1, Math.round(base * (0.3 + 1.5 * rem + 0.8 * ease)));
}

/** Record a review at point (a, b). Returns the word as saved. */
export async function rate(w, a, b, now = Date.now()) {
  const s = srsOf(w);
  const days = daysFor(w, a, b);
  const { x, y } = toXY(a, b);
  const wasDue = s.reps > 0 && s.due <= now;
  const lapse = isLapse(a, b);
  const next = { ...s, reps: s.reps + 1, last: now, interval: lapse ? 0 : days };
  next.due = days === 0 ? now + 10 * 60e3 : dayStart(now) + days * DAY;
  next.lapses = s.lapses + (lapse ? 1 : 0);
  next.streak = inZone(x, y) ? 0 : s.streak + 1;
  next.log = [...(s.log || []), { t: now, a, b, n: days, d: wasDue ? 1 : 0 }].slice(-30);
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
  return renderHome(app);
}

const head = (title, subtitle, right = '') => `<div class="row-head rv-head">
  <a class="icon-btn" href="#/words" data-back aria-label="Back">${I.back}</a>
  <div class="txt"><h1 class="page-title">${title}</h1>${subtitle ? `<small>${subtitle}</small>` : ''}</div>${right}</div>`;

async function renderHome(app) {
  const lib = await library();
  const { shown, series, pick } = lib;
  const types = get(K_TYPES, {});
  const size = get(K_SIZE, 14);
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
    <section class="rv-sec"><h2 class="rv-label">How much time do you have?</h2>
      ${SIZES.map(([n, t, s]) => `<button type="button" class="rv-size${n === size ? ' is-last' : ''}" data-size="${n}">
        <b>${n}</b><span><span>${t}</span><small>${s}${n === size ? ' · last time you picked this' : ''}</small></span></button>`).join('')}
      <p class="hint tip">Due words come first; the rest is filled with new words (at most a third), so the session always has the size you picked.</p></section>
    <section class="rv-sec"><h2 class="rv-label">Card types</h2>
      <div class="rv-types">${TYPES.map(([k, t, note]) => `<label class="rv-type">
        <span><span>${t}</span>${note ? `<small>${note}</small>` : ''}</span>
        <input type="checkbox" role="switch" data-type="${k}" ${types[k] !== false ? 'checked' : ''} ${k === 'meaning' ? 'disabled' : ''}><i aria-hidden="true"></i></label>`).join('')}</div></section>
    <div class="rv-two">
      <a class="btn" href="#/review/progress">Progress</a>
      <a class="btn" href="#/review/tough">Tough words${tough ? ` · ${tough}` : ''}</a></div>`}
  </main>`;

  app.querySelector('.rv-page').addEventListener('change', e => {
    const t = e.target.closest('[data-type]');
    if (!t) return;
    set(K_TYPES, { ...get(K_TYPES, {}), [t.dataset.type]: t.checked });
  });
  app.querySelector('.rv-page').addEventListener('click', async e => {
    const sz = e.target.closest('[data-size]');
    if (sz) {
      const n = Number(sz.dataset.size);
      set(K_SIZE, n);
      if (!start(lib, n)) { toast('No words to review here yet'); return; }
      location.hash = '#/review/go';
      return;
    }
    if (e.target.closest('[data-rv="series"]')) {
      const opts = [['all', 'All series'], ...series.filter(s => lib.words.some(w => lib.inSeries.get(w.id)?.has(s.id))).map(s => [s.id, s.name])];
      const count = id => (id === 'all' ? lib.words.length : lib.words.filter(w => lib.inSeries.get(w.id)?.has(id)).length);
      openSheet(`<h2>Review words from</h2><div class="option-list">${opts.map(([id, name]) => `<button type="button" class="option-row${id === pick ? ' is-on' : ''}" data-pick="${id}"><span class="txt">${esc(name)}<small>${plural(count(id), 'word')}</small></span>${id === pick ? I.check : ''}</button>`).join('')}</div>`, sheet => {
        sheet.addEventListener('click', ev => {
          const b = ev.target.closest('[data-pick]');
          if (!b) return;
          set(K_SERIES, b.dataset.pick === 'all' ? 'all' : Number(b.dataset.pick));
          closeOverlay();
          renderHome(app);
        });
      });
    }
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

function pickType(w, ctxs) {
  const s = srsOf(w);
  if (!s.reps) return 'meaning';
  const on = get(K_TYPES, {});
  const ok = k => on[k] !== false;
  if (ok('use') && isKnown(w) && session.useCount < 2 && Math.random() < 0.3) return 'use';
  const opts = ['meaning'];
  if (ok('fits') && ctxs.length && w.meanings?.length) opts.push('fits');
  if (ok('listenWord') && (w.audio || w.phonetic) && (w.audio || canSpeak())) opts.push('listenWord');
  if (ok('listenSentence') && ctxs.length && canSpeak()) opts.push('listenSentence');
  return opts[Math.floor(Math.random() * opts.length)];
}

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

async function drawCard(app) {
  if (session.i >= session.queue.length) { drawDone(app); return; }
  const item = session.queue[session.i];
  const w = await db.getWord(item.id);
  if (!w) { session.i++; drawCard(app); return; }
  const ctxs = item.ctxs || (item.ctxs = await sentencesOf(w, session.notes, session.seriesName));
  const type = item.type || (item.type = pickType(w, ctxs));
  if (type === 'use') session.useCount++;
  const c = item.ctx || (item.ctx = ctxs.length ? ctxs[Math.floor(Math.random() * ctxs.length)] : null);
  const meaning = (w.meanings || [])[0];

  let body = '', foot = '';
  if (type === 'meaning') {
    body = `<p class="rv-ask">What does it mean?</p>
      <div class="rv-word"><h1>${esc(w.word)}</h1><button type="button" class="rv-say" data-rv="say" aria-label="Pronounce">${SPK}</button></div>
      ${c ? ctxBox(c, hl(c)) : ''}
      <p class="hint tip">Think of the meaning first, then check.</p>`;
    foot = `<button type="button" class="btn btn-accent" data-rv="show">Show meaning</button>`;
  } else if (type === 'fits') {
    const first = c.text.slice(c.start, c.end);
    body = `<p class="rv-ask">Which word fits?</p>
      <div class="rv-mean"><small>Meaning</small><span>${esc(meaning.pos)} — ${esc(meaning.text)}</span></div>
      <div class="rv-ctx"><p>${withWord(c, gap(first.length))}</p><small>${esc(c.src)} · starts with “${esc(first[0].toLowerCase())}”</small></div>
      ${answerInput('Your answer')}`;
    foot = `<button type="button" class="btn" data-rv="reveal">Show answer</button><button type="button" class="btn btn-accent" data-rv="check">Check</button>`;
  } else if (type === 'listenWord') {
    body = `<p class="rv-ask big">Which word do you hear?</p>
      ${player('Play the word')}
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
  app.innerHTML = `<main class="page rv-card rv-${type}">${bar()}<div class="rv-body">${body}</div><div class="rv-foot">${foot}</div></main>`;
  wire(app, w, type, c);
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
    const b = e.target.closest('[data-rv]');
    if (!b) return;
    const act = b.dataset.rv;
    if (act === 'end') { if (canSpeak()) speechSynthesis.cancel(); goBack('#/review'); return; }
    if (act === 'say') sayWord(w);
    if (act === 'play' || act === 'slow') {
      const slow = act === 'slow';
      if (type === 'listenWord') sayWordSlow(w, slow); else speak(c.text, slow);
    }
    if (act === 'show') drawAnswer(app, w, c, null);
    if (act === 'reveal') drawAnswer(app, w, c, { verdict: 'shown', typed: '' });
    if (act === 'check') {
      const typed = input.value;
      if (!typed.trim()) { input.focus(); return; }
      drawAnswer(app, w, c, { verdict: judge(typed, w), typed });
    }
    if (act === 'skip') await answer(app, w, { a: 4, b: 3 });
    if (act === 'own') {
      const t = main.querySelector('#rv-own').value.trim();
      if (!t) { main.querySelector('#rv-own').focus(); return; }
      const cur = await db.getWord(w.id);
      await saveWord({ ...cur, own: [...(cur.own || []), t].slice(-10), mine: [cur.mine?.trim(), `• ${t}`].filter(Boolean).join('\n') });
      toast('Sentence saved to My notes');
      await answer(app, w, { a: 4, b: 2 });
    }
  });
  setTimeout(() => input?.focus(), 50);
}

const DIA = { size: 280, margin: 22 };

/** The answer side: the word card, the sentence, and the diamond. */
function drawAnswer(app, w, c, check) {
  if (canSpeak()) speechSynthesis.cancel();
  const said = c ? c.text.slice(c.start, c.end) : w.word;
  // A typed answer places the dot on the side it earned; you can still move it.
  const placed = !check ? null : check.verdict === 'right' ? { a: 3, b: 2 } : check.verdict === 'nearly' ? { a: 2, b: 2 } : { a: 0, b: 0 };
  let sel = placed;
  const ghost = pointsOf(w).at(-1) || null;
  const banner = !check ? '' : check.verdict === 'right'
    ? `<div class="rv-verdict is-right"><b>Right — ${esc(w.word)}</b>${norm(said) !== norm(w.word) ? `<small>The book says “${esc(said)}”; other forms of the word count too.</small>` : ''}</div>`
    : check.verdict === 'nearly'
      ? `<div class="rv-verdict is-nearly"><b>Nearly — check the spelling</b><small>You wrote “${esc(check.typed)}” · it’s “${esc(w.word)}”</small></div>`
      : `<div class="rv-verdict is-wrong"><b>${check.verdict === 'shown' ? 'The answer' : 'Not quite'} — ${esc(w.word)}</b>${check.typed ? `<small>You wrote “${esc(check.typed)}”</small>` : ''}</div>`;
  const ask = !check ? 'How did it feel? Drag the dot — it snaps to the points'
    : check.verdict === 'right' ? 'Right answer → the dot starts on the remembered side. Move it if it felt hard.'
      : 'The dot starts at F. Move it if it was nearly there.';
  app.innerHTML = `<main class="page rv-card rv-answer">${bar()}<div class="rv-body">
    ${banner}
    <div class="rv-word left"><span><h1>${esc(w.word)}</h1>${w.phonetic ? `<span class="rv-ipa">${esc(w.phonetic)}</span>` : ''}</span>
      <button type="button" class="rv-say" data-rv="say" aria-label="Pronounce">${SPK}</button></div>
    ${w.meanings?.length ? `<div class="wd-dict rv-dict">${groupHtml(w.meanings)}</div>` : ''}
    ${w.mine?.trim() ? `<div class="rv-box"><span class="rv-label">My notes</span><p>${esc(short(w.mine.trim(), 400))}</p></div>` : ''}
    ${w.hook?.trim() ? `<div class="rv-box is-hook"><span class="rv-label">Memory hook</span><p>${esc(w.hook.trim())}</p></div>` : ''}
    ${c ? `<p class="rv-line">${withWord(c, hl(c))} <small>${esc(c.src)}</small></p>` : ''}
    ${w.forms?.length ? `<div class="wd-forms"><small>Forms</small>${w.forms.map(f => `<span class="chip">${esc(f)}</span>`).join('')}</div>` : ''}
    <section class="rv-rate">
      <p class="rv-q">${ask}</p>
      <span class="rv-axis">E · Easy</span>
      <div class="rv-dia-row"><span class="rv-axis side">F · Forgot</span><div class="rv-dia"></div><span class="rv-axis side right">R · Remembered</span></div>
      <span class="rv-axis">H · Hard</span>
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
      const d = daysFor(w, sel.a, sel.b), col = colorOf(sel.a, sel.b);
      const mine = placed && sel.a === placed.a && sel.b === placed.b && check?.verdict === 'right';
      readout.innerHTML = `<i style="background:${col}"></i><span>${describe(sel.a, sel.b)}${mine ? ' · placed for you' : ''}</span><b style="color:${col}">${d === 0 ? 'again later today' : d === 1 ? 'next tomorrow' : `next in ${daysLabel(d)}`}</b>`;
    } else {
      readout.innerHTML = `<span class="rv-readout-hint">${ghost ? 'The dashed ring is where you put it last time.' : 'Tap or drag inside the diamond.'}</span>`;
    }
    nextBtn.disabled = !sel;
  };
  draw();
  attachPicker(holder, DIA, p => { sel = p; draw(); });
  main.addEventListener('click', async e => {
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
  await rate(w, pt.a, pt.b);
  session.points.push(pt);
  // Forgotten: once more at the end of this session.
  if (isLapse(pt.a, pt.b) && !session.again.has(w.id)) {
    session.again.add(w.id);
    session.queue.push({ id: w.id, type: 'meaning', ctx: session.queue[session.i].ctx });
  }
  session.i++;
  window.scrollTo(0, 0);
  drawCard(app);
}

async function drawDone(app) {
  const pts = session.points;
  const forgot = pts.filter(p => isLapse(p.a, p.b)).length;
  const tough = pts.filter(p => !isLapse(p.a, p.b) && inZone(toXY(p.a, p.b).x, toXY(p.a, p.b).y)).length;
  const remembered = pts.length - forgot - tough;
  const all = await db.getAllWords();
  const ids = new Set(session.lib.shown.map(w => w.id));
  const lib = { shown: all.filter(w => ids.has(w.id)) };
  const tomorrowEnd = endOfToday() + DAY;
  const nextDue = lib.shown.filter(w => !isNew(w) && srsOf(w).due > endOfToday() && srsOf(w).due <= tomorrowEnd).length;
  const left = buildSession(lib.shown.filter(w => isDue(w) || isNew(w)), session.size).length;
  const reviewed = pts.length;
  const progress = (await db.getAllProgress()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
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
      <a class="btn btn-accent" href="${progress ? `#/read/${progress.chapterId}` : '#/'}">Back to reading</a></div></main>`;
  app.querySelector('.rv-done').addEventListener('click', async e => {
    if (!e.target.closest('[data-rv="more"]')) return;
    const fresh = await library();
    if (!start(fresh, session.size)) return;
    drawCard(app);
  });
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
  const onTime = dueLogs.length ? Math.round(dueLogs.filter(p => !isLapse(p.a, p.b)).length / dueLogs.length * 100) : null;
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
