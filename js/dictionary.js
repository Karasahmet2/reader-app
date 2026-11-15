// dictionary.js — "Define": English definitions for a selected word.
//
//  • Definitions come from the Free Dictionary API (dictionaryapi.dev, built on Wiktionary).
//  • Every word you look up is saved on the phone, so it opens instantly — and offline —
//    the next time.
//  • Inflected words are tried in their base form too: "regarded" → "regard",
//    "studies" → "study", "stopped" → "stop".
//  • "Save as vocabulary note" opens the note sheet with the definition filled in and
//    the shared Vocabulary tag picked.

import * as db from './db.js';
import { esc, I, svg, toast, openSheet } from './ui.js';

const API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const RETRY_MISSING = 30 * 24 * 3600 * 1000; // try "not found" words again after 30 days

/** The word itself, without punctuation around it or a possessive 's. */
export function cleanWord(text) {
  return String(text || '').trim()
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
    .replace(/['’]s$/iu, '')
    .toLowerCase();
}

/** True when the selection is one word (Define only shows for single words). */
export function isSingleWord(text) {
  const w = String(text || '').trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  return /^\p{L}[\p{L}'’-]{0,39}$/u.test(w);
}

/** The word, then likely base forms to try if the word itself isn't listed. */
function candidates(word) {
  const out = [word];
  const add = w => { if (w.length >= 2 && !out.includes(w)) out.push(w); };
  const undouble = w => (/([b-df-hj-np-tv-z])\1$/.test(w) ? w.slice(0, -1) : null);
  if (/ies$/.test(word)) add(word.slice(0, -3) + 'y');
  if (/ied$/.test(word)) add(word.slice(0, -3) + 'y');
  if (/(ier|iest)$/.test(word)) add(word.replace(/(ier|iest)$/, 'y'));
  if (/ing$/.test(word)) {
    const stem = word.slice(0, -3);
    add(stem); add(stem + 'e');
    const u = undouble(stem); if (u) add(u);
  }
  if (/ed$/.test(word)) {
    const stem = word.slice(0, -2);
    add(stem); add(word.slice(0, -1));
    const u = undouble(stem); if (u) add(u);
  }
  if (/(sses|xes|ches|shes|zes)$/.test(word)) add(word.slice(0, -2));
  if (/s$/.test(word) && !/ss$/.test(word)) add(word.slice(0, -1));
  if (/(er|est)$/.test(word)) {
    const stem = word.replace(/(er|est)$/, '');
    add(stem); add(stem + 'e');
  }
  if (/ly$/.test(word)) add(word.slice(0, -2));
  return out.slice(0, 6);
}

async function fetchEntries(word) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(API + encodeURIComponent(word), { signal: ctrl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Dictionary error ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) && data.length ? data : null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Look a word up: from the phone if it was looked up before, otherwise online.
 * Returns { status: 'ok', entries, base } | { status: 'none' } | { status: 'offline' }.
 */
export async function lookup(word) {
  const saved = await db.getDefinition(word).catch(() => null);
  if (saved?.entries) return { status: 'ok', entries: saved.entries, base: saved.base || word, saved: true };
  if (saved && Date.now() - saved.at < RETRY_MISSING) return { status: 'none' };
  try {
    for (const w of candidates(word)) {
      const entries = await fetchEntries(w);
      if (entries) {
        await db.putDefinition({ word, entries, base: w, at: Date.now() }).catch(() => {});
        return { status: 'ok', entries, base: w, saved: false };
      }
    }
    await db.putDefinition({ word, entries: null, at: Date.now() }).catch(() => {});
    return { status: 'none' };
  } catch (err) {
    console.warn(err);
    return { status: 'offline' };
  }
}

/** Gather the parts we show: pronunciation, meanings by word type, similar words. */
function summarize(entries) {
  const phonetic = entries.map(e => e.phonetic).find(Boolean)
    || entries.flatMap(e => e.phonetics || []).map(p => p.text).find(Boolean) || '';
  const audio = entries.flatMap(e => e.phonetics || []).map(p => p.audio).find(Boolean) || '';
  const parts = new Map();
  const synonyms = new Set();
  for (const e of entries) {
    for (const m of e.meanings || []) {
      const list = parts.get(m.partOfSpeech) || [];
      for (const d of m.definitions || []) {
        if (list.length < 3 && d.definition) list.push({ text: d.definition, example: d.example || '' });
        (d.synonyms || []).forEach(s => synonyms.add(s));
      }
      (m.synonyms || []).forEach(s => synonyms.add(s));
      parts.set(m.partOfSpeech, list);
    }
  }
  return {
    word: entries[0]?.word || '',
    phonetic,
    audio: audio.startsWith('//') ? `https:${audio}` : audio,
    parts: [...parts.entries()].filter(([, l]) => l.length).slice(0, 3),
    synonyms: [...synonyms].slice(0, 6),
  };
}

/** Short text for a vocabulary note: first meaning of up to two word types. */
function noteText(info) {
  return info.parts.slice(0, 2).map(([pos, defs]) => `${pos} — ${defs[0].text}`).join('\n');
}

const SPEAK = svg('<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>', 22);

/**
 * Open the Define sheet.
 *  text: the selected word
 *  onNote(text): open the note editor (text: definition to fill in, or '' for none)
 *  onFind(): open Find uses for the word
 */
export function openDefine({ text, onNote, onFind }) {
  const word = cleanWord(text);
  const sheet = openSheet(`<div class="define" aria-live="polite">
      <div class="def-head"><div class="def-title"><h2>${esc(word)}</h2><span class="def-sub">Looking up…</span></div></div>
      <div class="def-loading" aria-hidden="true"><i></i><i></i><i></i></div>
    </div>`, s => s.classList.add('define-sheet'));
  const box = sheet.querySelector('.define');

  const actionsNotFound = `
    <div class="two-btns">
      <button type="button" class="btn btn-accent" data-def="note">${I.note} Add a note</button>
      <button type="button" class="btn" data-def="find">${I.searchSm} Find uses</button>
    </div>`;

  let info = null;
  box.addEventListener('click', async e => {
    const b = e.target.closest('[data-def]');
    if (!b) return;
    const act = b.dataset.def;
    if (act === 'note') onNote(info ? noteText(info) : '');
    else if (act === 'find') onFind();
    else if (act === 'copy') {
      try {
        await navigator.clipboard.writeText(`${info.word} — ${noteText(info).replace(/\n/g, '; ')}`);
        toast('Copied');
      } catch { toast('Couldn’t copy'); }
    } else if (act === 'audio') {
      new Audio(info.audio).play().catch(() => toast('Can’t play the pronunciation right now'));
    }
  });

  lookup(word).then(res => {
    if (!box.isConnected) return;
    if (res.status === 'ok') {
      info = summarize(res.entries);
      const fromBase = res.base !== word ? `<span class="def-base">Base form of “${esc(word)}”</span>` : '';
      box.innerHTML = `
        <div class="def-head">
          <div class="def-title">
            <h2>${esc(info.word)}</h2>
            ${info.phonetic ? `<span class="def-sub">${esc(info.phonetic)}</span>` : ''}
            ${fromBase}
          </div>
          ${info.audio ? `<button type="button" class="def-audio" data-def="audio" aria-label="Play pronunciation">${SPEAK}</button>` : ''}
        </div>
        ${info.parts.map(([pos, defs]) => `
          <section class="def-part">
            <span class="def-pos">${esc(pos)}</span>
            <ol>${defs.map(d => `<li><span>${esc(d.text)}</span>${d.example ? `<em>“${esc(d.example)}”</em>` : ''}</li>`).join('')}</ol>
          </section>`).join('')}
        ${info.synonyms.length ? `<section class="def-part"><h3>Similar words</h3>
          <div class="def-syn">${info.synonyms.map(s => `<span>${esc(s)}</span>`).join('')}</div></section>` : ''}
        <div class="def-actions">
          <button type="button" class="btn btn-accent" data-def="note">${I.note} Save as vocabulary note</button>
          <div class="two-btns">
            <button type="button" class="btn" data-def="find">${I.searchSm} Find uses</button>
            <button type="button" class="btn" data-def="copy">${I.copy} Copy</button>
          </div>
        </div>
        <p class="def-foot">${I.checkSm}Saved on this phone · works offline next time · Wiktionary</p>`;
    } else if (res.status === 'none') {
      box.innerHTML = `
        <div class="def-head"><div class="def-title"><h2>${esc(word)}</h2><span class="def-sub">Not in the dictionary</span></div></div>
        <p class="def-msg">Web-novel terms, names and sects usually aren’t in normal dictionaries. Write your own meaning as a note instead.</p>
        ${actionsNotFound}`;
    } else {
      box.innerHTML = `
        <div class="def-head"><div class="def-title"><h2>${esc(word)}</h2><span class="def-sub">No connection</span></div></div>
        <p class="def-msg">This word hasn’t been looked up before, so it needs internet once. Words you looked up before still work offline.</p>
        ${actionsNotFound}`;
    }
  });
}
