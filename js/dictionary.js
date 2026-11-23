// dictionary.js — "Define": English definitions for a selected word.
//
// Two dictionaries, with a switch at the top of the sheet (the last one used opens first):
//  • Merriam-Webster: the Learner's Dictionary (clear definitions written for learners),
//    then the Collegiate for rarer words. Needs your free keys (Settings → Dictionary).
//  • Wiktionary, via FreeDictionaryAPI.com: the fuller entry — more meanings, sub-meanings,
//    word forms. "regarded" (past tense of regard) opens regard's full entry.
// Every word looked up is saved per dictionary, so it opens instantly and offline.
// Once downloaded (Settings → Dictionary), the offline dictionary (Open English WordNet) gets a
// third tab, Offline, and also answers in the other tabs when there's no internet.
// Every sheet also has links to open the word on Cambridge, Oxford and Longman.

import * as db from './db.js';
import { esc, I, svg, plural, toast, openSheet } from './ui.js';
import { loadSettings } from './settings.js';

const FREE_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const MW_API = 'https://www.dictionaryapi.com/api/v3/references/';
const RETRY_MISSING = 30 * 24 * 3600 * 1000; // try "not found" words again after 30 days
const PACK_URL = 'data/wordnet-en.json.gz';

const SOURCES = {
  learners: 'Merriam-Webster Learner’s',
  collegiate: 'Merriam-Webster Collegiate',
  free: 'Wiktionary',
  wiki: 'Wiktionary',
  wordnet: 'Open English WordNet (offline pack)',
};

export const OPEN_IN = [
  ['Cambridge', w => `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(w)}`],
  ['Oxford', w => `https://www.oxfordlearnersdictionaries.com/search/english/?q=${encodeURIComponent(w)}`],
  ['Longman', w => `https://www.ldoceonline.com/search/english/direct/?q=${encodeURIComponent(w)}`],
];

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

async function getJSON(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Dictionary error ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ Merriam-Webster */

/** Turn Merriam-Webster's markup ({it}word{/it}, {bc}, {sx|word||}…) into plain text. */
function mwText(s) {
  return String(s || '')
    .replace(/\{bc\}/g, '')
    .replace(/\{ldquo\}/g, '“').replace(/\{rdquo\}/g, '”')
    .replace(/\{(?:sx|a_link|d_link|i_link|et_link|mat|dxt)\|([^|}]*)[^}]*\}/g, '$1')
    .replace(/\{\/?(?:it|b|inf|sup|sc|wi|phrase|qword|gloss|parahw|dx|dx_def|dx_ety|ma)\}/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[:;,]\s*/, '');
}

function mwAudio(prs) {
  const a = prs?.find(p => p.sound?.audio)?.sound.audio;
  if (!a) return '';
  const dir = a.startsWith('bix') ? 'bix' : a.startsWith('gg') ? 'gg' : /^[^a-z]/i.test(a) ? 'number' : a[0];
  return `https://media.merriam-webster.com/audio/prons/en/us/mp3/${dir}/${a}.mp3`;
}

/** Definitions with their first example, from one entry's sense list. */
function mwSenses(entry) {
  const out = [];
  const walk = node => {
    if (!Array.isArray(node) || out.length >= 3) return;
    if (node[0] === 'sense' && node[1]?.dt) {
      let text = '';
      let example = '';
      for (const [kind, val] of node[1].dt) {
        if (kind === 'text' && !text) text = mwText(val);
        if (kind === 'vis' && !example && val?.[0]?.t) example = mwText(val[0].t);
        if (kind === 'uns' && !text) {
          // usage notes hold the text for some learner senses
          const t = val?.[0]?.find?.(x => x[0] === 'text');
          if (t) text = mwText(t[1]);
        }
      }
      if (text) out.push({ text, example });
      return;
    }
    node.forEach(walk);
  };
  for (const d of entry.def || []) walk(d.sseq);
  if (!out.length) for (const s of (entry.shortdef || []).slice(0, 3)) out.push({ text: s, example: '' });
  return out;
}

/** Look up in one Merriam-Webster dictionary. Returns { info } or { suggestions } or null. */
async function mwLookup(ref, key, word) {
  const data = await getJSON(`${MW_API}${ref}/json/${encodeURIComponent(word)}?key=${encodeURIComponent(key)}`);
  if (!Array.isArray(data) || !data.length) return null;
  if (typeof data[0] === 'string') return { suggestions: data.slice(0, 6) };
  const head = e => String(e.meta?.id || '').split(':')[0].toLowerCase();
  const matches = data.filter(e => e.fl && (head(e) === word || (e.meta?.stems || []).some(s => s.toLowerCase() === word)));
  const list = (matches.length ? matches : data.filter(e => e.fl)).slice(0, 3);
  if (!list.length) return null;
  const parts = [];
  for (const e of list) {
    const senses = mwSenses(e);
    if (!senses.length) continue;
    const same = parts.find(p => p[0] === e.fl);
    if (same) same[1].push(...senses.slice(0, 3 - same[1].length));
    else parts.push([e.fl, senses]);
  }
  if (!parts.length) return null;
  const first = list[0];
  const prs = first.hwi?.prs || [];
  const ipa = prs.find(p => p.ipa)?.ipa;
  const mw = prs.find(p => p.mw)?.mw;
  return {
    info: {
      word: String(first.hwi?.hw || head(first)).replace(/\*/g, ''),
      phonetic: ipa ? `/${ipa}/` : mw ? `\\${mw}\\` : '',
      audio: mwAudio(prs),
      parts: parts.slice(0, 3),
      synonyms: [],
      source: ref,
    },
  };
}

/* ------------------------------------------------------------------ Free Dictionary (Wiktionary) */

function freeInfo(entries) {
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
    source: 'free',
  };
}

async function freeLookup(word) {
  for (const w of candidates(word)) {
    const data = await getJSON(FREE_API + encodeURIComponent(w));
    if (Array.isArray(data) && data.length) return { info: freeInfo(data) };
  }
  return null;
}

/* ------------------------------------------------------------------ Wiktionary (FreeDictionaryAPI.com) */

const WIKI_API = 'https://freedictionaryapi.com/api/v1/entries/en/';

// "simple past and past participle of regard", "plural of sect", "alternative spelling of …"
const FORM_OF = /\b(?:of|form of|spelling of)\s+["“]?([\p{L}][\p{L}'’ -]*?)["”]?\s*(?:\(.*\))?[.;:]?$/u;
const FORM_WORDS = /^(?:(?:simple )?(?:past|present)|past participle|present participle|plural|third-person|comparative|superlative|alternative|obsolete|archaic|nonstandard|misspelling|en dash|former|eye dialect|abbreviation|inflection|singular|gerund)/i;

function wikiPhonetic(entries) {
  const ipa = entries.flatMap(e => e.pronunciations || []).filter(p => p.type === 'ipa' && p.text);
  if (!ipa.length) return '';
  const tagged = ['UK', 'US'].map(t => {
    const p = ipa.find(x => (x.tags || []).some(tag => tag.includes(t === 'UK' ? 'Received' : 'General American') || tag === t));
    return p ? `${t} ${p.text}` : '';
  }).filter(Boolean);
  return tagged.length === 2 ? tagged.join(' · ') : ipa[0].text;
}

/** If every meaning just says "past tense of X", return X (and that line). */
function formOf(entries) {
  const senses = entries.flatMap(e => e.senses || []);
  if (!senses.length) return null;
  const all = senses.every(s => (s.tags || []).includes('form-of') || FORM_WORDS.test(s.definition || ''));
  if (!all) return null;
  const m = (senses[0].definition || '').match(FORM_OF);
  return m ? { base: m[1].trim().toLowerCase(), line: senses[0].definition.replace(/[.;:]$/, '') } : null;
}

function wikiInfo(data) {
  const entries = (data.entries || []).filter(e => !e.language || e.language.code === 'en');
  const parts = [];
  const synonyms = new Set();
  const forms = new Set();
  for (const e of entries) {
    const list = [];
    for (const s of e.senses || []) {
      if (list.length >= 4 || !s.definition) continue;
      const sub = (s.subsenses || []).find(x => x.definition)?.definition || '';
      list.push({ text: s.definition, example: s.examples?.[0] || s.quotes?.[0]?.text || '', sub });
      (s.synonyms || []).forEach(x => synonyms.add(x));
    }
    (e.synonyms || []).forEach(x => synonyms.add(x));
    for (const f of e.forms || []) {
      if (f.word && f.word !== data.word && !(f.tags || []).some(t => /table|inflection-template|romanization|canonical/.test(t))) forms.add(f.word);
    }
    if (!list.length) continue;
    const same = parts.find(p => p[0] === e.partOfSpeech);
    if (same) same[1].push(...list.slice(0, 4 - same[1].length));
    else parts.push([e.partOfSpeech, list]);
  }
  return {
    word: data.word,
    phonetic: wikiPhonetic(entries),
    audio: '',
    parts: parts.slice(0, 4),
    synonyms: [...synonyms].slice(0, 8),
    forms: [...forms].slice(0, 6),
    sourceUrl: data.source?.url || `https://en.wiktionary.org/wiki/${encodeURIComponent(data.word)}`,
    source: 'wiki',
  };
}

async function wikiFetch(word) {
  const data = await getJSON(WIKI_API + encodeURIComponent(word));
  const entries = (data?.entries || []).filter(e => !e.language || e.language.code === 'en');
  return entries.length ? { ...data, entries } : null;
}

/** Look up in Wiktionary, following "past tense of X" to X's full entry. */
async function wikiLookup(word) {
  for (const w of candidates(word).slice(0, 3)) {
    const data = await wikiFetch(w);
    if (!data) continue;
    const f = formOf(data.entries);
    if (f && f.base !== w) {
      const base = await wikiFetch(f.base);
      if (base) return { info: { ...wikiInfo(base), note: `“${w}”: ${f.line}` } };
    }
    return { info: wikiInfo(data) };
  }
  return null;
}

/* ------------------------------------------------------------------ offline pack (WordNet) */

let packForms = null;
const chunkKey = w => w.slice(0, 2).padEnd(2, '_').replace(/[^a-z]/g, '_');

export async function packStatus() {
  const meta = await db.wordnetGet('__meta').catch(() => null);
  return meta ? { ready: true, words: meta.words, name: meta.name } : { ready: false };
}

/** Download the offline pack and store it on the phone. onProgress(0..1). */
export async function downloadPack(onProgress) {
  const res = await fetch(PACK_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Couldn’t download (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 7.5e6;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(Math.min(0.95, got / total));
  }
  let bytes = new Blob(chunks);
  const head = new Uint8Array(await bytes.slice(0, 2).arrayBuffer());
  if (head[0] === 0x1f && head[1] === 0x8b) {
    bytes = await new Response(bytes.stream().pipeThrough(new DecompressionStream('gzip'))).blob();
  }
  const pack = JSON.parse(await bytes.text());
  const records = Object.entries(pack.chunks).map(([k, words]) => ({ k, words }));
  const words = records.reduce((n, r) => n + Object.keys(r.words).length, 0);
  records.push({ k: '__forms', words: pack.forms });
  records.push({ k: '__meta', name: pack.name, license: pack.license, words });
  await db.wordnetPutAll(records);
  packForms = pack.forms;
  onProgress?.(1);
  return words;
}

export async function removePack() {
  await db.wordnetClear();
  packForms = null;
}

async function packLookup(word) {
  if (!packForms) {
    const f = await db.wordnetGet('__forms').catch(() => null);
    if (!f) return null;
    packForms = f.words;
  }
  for (const w of [packForms[word], ...candidates(word)].filter(Boolean)) {
    const rec = await db.wordnetGet(chunkKey(w));
    const raw = rec?.words?.[w];
    if (!raw) continue;
    const display = typeof raw[0] === 'string' ? raw[0] : w;
    const senses = raw.filter(x => Array.isArray(x));
    const parts = [];
    const synonyms = new Set();
    for (const [pos, text, example, syn] of senses) {
      let p = parts.find(x => x[0] === pos);
      if (!p) { p = [pos, []]; parts.push(p); }
      if (p[1].length < 3) p[1].push({ text, example });
      (syn || []).forEach(s => synonyms.add(s));
    }
    // An -ed / -ing word is almost always the verb.
    if (w !== word && /(ed|ing)$/.test(word)) parts.sort((a, b) => (b[0] === 'verb') - (a[0] === 'verb'));
    return { info: { word: display, phonetic: '', audio: '', parts: parts.slice(0, 3), synonyms: [...synonyms].slice(0, 6), source: 'wordnet' } };
  }
  return null;
}

/* ------------------------------------------------------------------ lookup, one dictionary at a time */

function keys() {
  const s = loadSettings();
  return { learners: (s.mwLearnersKey || '').trim(), collegiate: (s.mwCollegiateKey || '').trim() };
}
export const hasMWKeys = () => { const k = keys(); return !!(k.learners || k.collegiate); };

/** Saved lookups are kept per dictionary: "mw:word", "wiki:word". Older ones were just "word". */
async function saved(src, word) {
  const rec = await db.getDefinition(`${src}:${word}`).catch(() => null);
  if (rec) return rec;
  const old = await db.getDefinition(word).catch(() => null);
  const info = old?.info || (old?.entries ? freeInfo(old.entries) : null);
  if (!info) return null;
  if (src === 'mw' && (info.source === 'learners' || info.source === 'collegiate')) return { info, at: old.at };
  if (src === 'wiki' && info.source === 'free') return { info, at: old.at, stale: true };
  return null;
}
const save = (src, word, rec) => db.putDefinition({ word: `${src}:${word}`, ...rec, at: Date.now() }).catch(() => {});

/**
 * Look a word up in one dictionary ('mw' or 'wiki').
 * Returns { status: 'ok', info, saved, fallback } | { status: 'none', suggestions }
 *       | { status: 'nokey' } | { status: 'offline' }.
 */
const MW_REF_KEY = 'reader-define-mw';
const MW_NAMES = { learners: 'Learner’s', collegiate: 'Collegiate' };
/** Which Merriam-Webster dictionary to show first: 'learners' or 'collegiate'. */
export function mwChoice() {
  const k = keys();
  let v = 'learners';
  try { v = localStorage.getItem(MW_REF_KEY) || v; } catch { /* ignore */ }
  if (v === 'collegiate' && !k.collegiate) v = 'learners';
  if (v === 'learners' && !k.learners) v = 'collegiate';
  return v;
}
function setMwChoice(v) { try { localStorage.setItem(MW_REF_KEY, v); } catch { /* ignore */ } }

/**
 * Merriam-Webster: the chosen dictionary first, the other one if it doesn't have the word.
 * Each is saved separately ("mw-learners:word", "mw-collegiate:word").
 */
async function mwLookupIn(word, first) {
  const k = keys();
  const order = (first === 'collegiate' ? ['collegiate', 'learners'] : ['learners', 'collegiate']).filter(r => k[r]);
  let suggestions = [];
  let offline = false;
  const legacy = await db.getDefinition(`mw:${word}`).catch(() => null) || await db.getDefinition(word).catch(() => null);
  for (const ref of order) {
    const swapped = ref !== order[0];
    const rec = await db.getDefinition(`mw-${ref}:${word}`).catch(() => null)
      || (legacy?.info?.source === ref ? legacy : null);
    if (rec?.info) return { status: 'ok', info: rec.info, saved: true, ref, swapped };
    if (rec && !rec.info && Date.now() - rec.at < RETRY_MISSING) {
      if (rec.suggestions?.length && !suggestions.length) suggestions = rec.suggestions;
      continue;
    }
    if (offline) continue;
    try {
      const r = await mwLookup(ref, k[ref], word);
      if (r?.info) {
        await save(`mw-${ref}`, word, { info: r.info });
        return { status: 'ok', info: r.info, saved: false, ref, swapped };
      }
      if (r?.suggestions && !suggestions.length) suggestions = r.suggestions;
      await save(`mw-${ref}`, word, { info: null, suggestions: r?.suggestions || [] });
    } catch (err) {
      console.warn(err);
      offline = true;
    }
  }
  if (!offline) return { status: 'none', suggestions };
  const pack = await packLookup(word).catch(() => null);
  if (pack) return { status: 'ok', info: pack.info, saved: false, fallback: true };
  return { status: 'offline' };
}

export async function lookupIn(src, word, opts = {}) {
  if (src === 'mw' && !hasMWKeys()) return { status: 'nokey' };
  if (src === 'mw') return mwLookupIn(word, opts.mwRef || mwChoice());
  if (src === 'pack') {
    const r = await packLookup(word).catch(() => null);
    return r ? { status: 'ok', info: r.info, saved: true } : { status: 'none', suggestions: [] };
  }
  const rec = await saved(src, word);
  if (rec?.info && !rec.stale) return { status: 'ok', info: rec.info, saved: true };
  if (rec && !rec.info && Date.now() - rec.at < RETRY_MISSING) return { status: 'none', suggestions: rec.suggestions || [] };

  try {
    let r = await wikiLookup(word).catch(() => null);
    if (!r) r = await freeLookup(word).catch(() => null); // the older Wiktionary service, as a backup
    if (r?.info) { await save(src, word, { info: r.info }); return { status: 'ok', info: r.info, saved: false }; }
    await save(src, word, { info: null });
    return { status: 'none', suggestions: [] };
  } catch (err) {
    console.warn(err);
  }
  // No connection: an older saved answer, then the offline pack.
  if (rec?.info) return { status: 'ok', info: rec.info, saved: true };
  const offline = await packLookup(word).catch(() => null);
  if (offline) return { status: 'ok', info: offline.info, saved: false, fallback: true };
  return { status: 'offline' };
}

/** Short text for a vocabulary note: first meaning of up to two word types. */
function noteText(info) {
  return info.parts.slice(0, 2).map(([pos, defs]) => `${pos} — ${defs[0].text}`).join('\n');
}

/* ------------------------------------------------------------------ the Define sheet */

const SPEAK = svg('<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>', 22);
const OUT = svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', 14);
const KEY = svg('<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l3 3"/>', 22);
const CODEX = svg('<path d="M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/><circle cx="12" cy="8.5" r="2"/>', 18);
const TAB_KEY = 'reader-define-tab';
const TABS = { mw: ['Merriam-Webster', 'Learner’s'], wiki: ['Wiktionary', 'fuller entry'], pack: ['Offline', 'WordNet'] };

function preferredTab() {
  try { const t = localStorage.getItem(TAB_KEY); if (TABS[t]) return t; } catch { /* ignore */ }
  return hasMWKeys() ? 'mw' : 'wiki';
}

/**
 * Open the Define sheet, with a switch between Merriam-Webster and Wiktionary.
 *  text: the selected word
 *  onNote(text): open the note editor (text: definition to fill in, or '' for none)
 *  onFind(word): open Find uses for the word
 *  onCodex(word): add the word to the Codex (optional)
 *  saved + onUpdate(meanings): change a saved word's meanings — saved ones start ticked,
 *    untick to remove, tick others to add (from the word card)
 */
export function openDefine({ text, onNote, onFind, onCodex, saved = null, onUpdate = null }) {
  const editing = Array.isArray(saved) && !!onUpdate;
  const keep = (saved || []).map(() => true);
  const normT = t => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const savedIdx = t => (editing ? saved.findIndex(m => normT(m.text) === normT(t)) : -1);
  const family = src => (String(src).startsWith('mw') ? 'mw' : src);
  let word = cleanWord(text);
  let tab = preferredTab();
  let results = {};   // tab → result for the current word
  let peek = {};      // tab → result looked up quietly for "the other dictionary has it"
  let mwRef = mwChoice(); // Learner's or Collegiate, inside the Merriam-Webster tab
  let mwResults = {}; // 'learners' / 'collegiate' → result
  const sheet = openSheet(`
    <nav class="def-tabs" role="tablist" aria-label="Dictionary">
      ${Object.entries(TABS).map(([k, [name]]) => `<button type="button" role="tab" data-tab="${k}"${k === 'pack' ? ' hidden' : ''}><b>${name}</b><small></small></button>`).join('')}
    </nav>
    <div class="define" aria-live="polite"></div>`, s => s.classList.add('define-sheet'));
  const box = sheet.querySelector('.define');
  const other = t => (t === 'wiki' ? 'mw' : 'wiki'); // where to look quietly when this tab has nothing
  // The Offline tab shows only when the offline dictionary is downloaded.
  packStatus().then(p => {
    if (!p.ready) {
      if (tab === 'pack') { tab = hasMWKeys() ? 'mw' : 'wiki'; showWord(word); }
      return;
    }
    sheet.querySelector('.def-tabs [data-tab="pack"]').hidden = false;
    sheet.querySelector('.def-tabs [data-tab="mw"] b').textContent = 'Webster'; // three tabs: shorter name fits
  });

  const drawTabs = () => {
    sheet.querySelectorAll('.def-tabs [data-tab]').forEach(b => {
      const k = b.dataset.tab;
      const r = results[k];
      b.setAttribute('aria-selected', String(k === tab));
      const sub = k === 'mw' ? MW_NAMES[(r?.status === 'ok' && r.ref) || mwRef] : TABS[k][1];
      const n = picksIn(k) + (editing ? saved.filter((m, i) => keep[i] && family(m.src) === k).length : 0);
      b.querySelector('small').textContent = n ? `${n} ticked` : !r ? sub
        : r.status === 'nokey' ? 'add keys' : r.status === 'none' ? 'not found'
          : r.status === 'offline' ? 'no connection' : r.fallback ? 'offline pack' : sub;
      b.classList.toggle('has-picks', !!n);
    });
  };

  const info = () => (results[tab]?.status === 'ok' ? results[tab].info : null);

  /* Ticked meanings (any tab). key → { pos, text, example, src, withEx } */
  let picks = new Map();
  const srcOf = () => (tab === 'mw' ? `mw:${(results.mw?.status === 'ok' && results.mw.ref) || mwRef}` : tab);
  const SRC_NAME = { wiki: 'Wiktionary', pack: 'WordNet', 'mw:learners': 'Webster', 'mw:collegiate': 'Webster' };
  const picksIn = t => [...picks.values()].filter(p => (t === 'mw' ? p.src.startsWith('mw') : p.src === t)).length;
  /** The note text for the ticked meanings (one line each, with its word type). */
  const picksText = () => {
    const list = [...picks.values()];
    const mixed = new Set(list.map(p => SRC_NAME[p.src])).size > 1;
    return list.map(p => `${p.pos} — ${p.text}${mixed && !p.src.startsWith('mw') ? `  (${SRC_NAME[p.src]})` : ''}${p.withEx && p.example ? `\n   “${p.example}”` : ''}`).join('\n');
  };
  const saveLabel = () => {
    if (!picks.size) return `${I.note} Save as vocabulary note`;
    const by = {};
    for (const p of picks.values()) by[SRC_NAME[p.src]] = (by[SRC_NAME[p.src]] || 0) + 1;
    const from = Object.entries(by).map(([n, c]) => `${c} from ${n}`).join(' · ');
    return `<span class="def-save"><b>${I.note} Save ${plural(picks.size, 'meaning')}</b><small>${Object.keys(by).length > 1 ? from : `from ${Object.keys(by)[0]}`}</small></span>`;
  };

  /* Changing a saved word: meanings not shown in this tab, and the Update button. */
  const shownSaved = res => {
    const set = new Set();
    if (res?.status === 'ok') res.info.parts.forEach(([, defs]) => defs.forEach(d => { const i = savedIdx(d.text); if (i >= 0) set.add(i); }));
    return set;
  };
  const SRC_LONG = { wiki: 'Wiktionary', pack: 'WordNet', 'mw:learners': 'Webster', 'mw:collegiate': 'Webster', note: 'your note' };
  const editBlock = res => {
    if (!editing) return '';
    const shown = shownSaved(res);
    const rest = saved.map((m, i) => [m, i]).filter(([, i]) => !shown.has(i));
    const added = picks.size;
    const removed = keep.filter(k => !k).length;
    return `${rest.length ? `<section class="def-part def-elsewhere"><h3>Saved from elsewhere</h3><ol>${rest.map(([m, i]) => `
      <li class="def-sense${keep[i] ? ' is-picked' : ''}" data-keep="${i}" role="button" tabindex="0" aria-pressed="${keep[i]}">
        <span class="def-box" aria-hidden="true">${keep[i] ? I.checkSm : ''}</span>
        <span class="def-body"><span>${esc(m.pos)} — ${esc(m.text)}</span><small class="def-from">${esc(SRC_LONG[m.src] || '')}</small></span></li>`).join('')}</ol></section>` : ''}
      <button type="button" class="btn btn-accent def-save-btn" data-def="update"><span class="def-save"><b>Update meanings</b><small>+${added} new · ${removed} removed</small></span></button>`;
  };

  const openIn = () => `<div class="def-open"><span>Open in</span>
    ${OPEN_IN.map(([name, url]) => `<a href="${url(info()?.word || word)}" target="_blank" rel="noopener">${name}${OUT}</a>`).join('')}</div>`;

  const chips = (title, list) => (list?.length ? `<section class="def-part"><h3>${title}</h3>
    <div class="def-syn">${list.map(s => `<button type="button" data-def-word="${esc(s)}">${esc(s)}</button>`).join('')}</div></section>` : '');

  const footer = res => {
    const i = res.info;
    const where = res.saved ? 'saved on this phone' : 'saved for offline';
    if (i.source === 'wordnet') return `<p class="def-foot">${I.checkSm}Open English WordNet (offline pack) · CC BY 4.0</p>`;
    if (i.source === 'wiki' || i.source === 'free') {
      return `<p class="def-foot">${I.checkSm}<span>From <a href="${esc(i.sourceUrl || `https://en.wiktionary.org/wiki/${encodeURIComponent(i.word)}`)}" target="_blank" rel="noopener">Wiktionary</a> (CC BY-SA 4.0) via FreeDictionaryAPI.com · ${where}</span></p>`;
    }
    return `<p class="def-foot"><img class="mw-logo" src="icons/mw-logo.png" alt="Merriam-Webster" onerror="this.remove()">${I.checkSm}${SOURCES[i.source] || 'Merriam-Webster'} · ${where}</p>`;
  };

  const missingActions = `
    <div class="two-btns">
      <button type="button" class="btn btn-accent" data-def="note">${I.note} Add a note</button>
      ${onCodex ? `<button type="button" class="btn" data-def="codex">${CODEX} Add to Codex</button>`
        : `<button type="button" class="btn" data-def="find">${I.searchSm} Find uses</button>`}
    </div>`;

  const otherHint = () => {
    const o = other(tab);
    if (peek[o]?.status !== 'ok') return '';
    return `<div class="def-other"><span>${TABS[o][0]} has an entry for this word.</span>
      <button type="button" data-tab="${o}">Show it</button></div>`;
  };

  // Learner's · Collegiate switch inside the Merriam-Webster tab (when both keys are set).
  const mwSwitch = res => {
    if (tab !== 'mw') return '';
    const k = keys();
    const both = k.learners && k.collegiate;
    const swapped = res?.swapped && res.ref ? `<p class="def-msg is-small">Not in ${MW_NAMES[mwRef]} — showing ${MW_NAMES[res.ref]}.</p>` : '';
    if (!both) return swapped;
    return `<div class="def-mw" role="radiogroup" aria-label="Merriam-Webster dictionary">
      ${Object.entries(MW_NAMES).map(([r, n]) => `<button type="button" role="radio" data-mw="${r}" aria-checked="${mwRef === r}">${n}</button>`).join('')}
    </div>${swapped}`;
  };

  function render() {
    drawTabs();
    const res = results[tab];
    if (!res) {
      box.innerHTML = `<div class="def-head"><div class="def-title"><h2>${esc(word)}</h2><span class="def-sub">Looking up…</span></div></div>
        <div class="def-loading" aria-hidden="true"><i></i><i></i><i></i></div>`;
      return;
    }
    if (res.status === 'ok') {
      const i = res.info;
      const base = i.note ? `<span class="def-base">${esc(i.note)}</span>`
        : i.word.toLowerCase() !== word ? `<span class="def-base">Base form of “${esc(word)}”</span>` : '';
      const editing_sub = editing ? '<span class="def-base">Changing the meanings of your saved word</span>' : '';
      box.innerHTML = `
        <div class="def-head">
          <div class="def-title"><h2>${esc(i.word)}</h2>
            ${i.phonetic ? `<span class="def-sub">${esc(i.phonetic)}</span>` : ''}${base}${editing_sub}</div>
          ${i.audio ? `<button type="button" class="def-audio" data-def="audio" aria-label="Play pronunciation">${SPEAK}</button>` : ''}
        </div>
        ${mwSwitch(res)}
        ${res.fallback ? '<p class="def-msg is-small">No connection — showing the offline dictionary.</p>' : ''}
        ${i.parts.map(([pos, defs], pi) => `
          <section class="def-part">
            <span class="def-pos">${esc(pos)}</span>
            <ol>${defs.map((d, di) => {
              const key = `${srcOf()}|${pi}|${di}`;
              const p = picks.get(key);
              const si = savedIdx(d.text);
              const on = si >= 0 ? keep[si] : !!p;
              return `<li class="def-sense${on ? ' is-picked' : ''}" ${si >= 0 ? `data-keep="${si}"` : `data-pick="${esc(key)}"`} data-pos="${esc(pos)}" role="button" tabindex="0" aria-pressed="${on}">
                <span class="def-box" aria-hidden="true">${on ? I.checkSm : ''}</span>
                <span class="def-body"><span>${esc(d.text)}${si >= 0 ? ' <small class="def-saved">saved</small>' : ''}</span>${d.example ? `<em>“${esc(d.example)}”</em>` : ''}${d.sub ? `<span class="def-subsense">${esc(d.sub)}</span>` : ''}
                ${p && d.example ? `<button type="button" class="def-exsw" data-pickex="${esc(key)}" role="switch" aria-checked="${p.withEx}"><i aria-hidden="true"></i>Include example</button>` : ''}</span></li>`;
            }).join('')}</ol>
          </section>`).join('')}
        ${chips('Similar words', i.synonyms)}
        ${chips('Forms', i.forms)}
        <div class="def-actions">
          ${editing ? editBlock(res) : `<button type="button" class="btn btn-accent def-save-btn" data-def="note">${saveLabel()}</button>`}
          <div class="two-btns">
            <button type="button" class="btn" data-def="find">${I.searchSm} Find uses</button>
            ${picks.size ? `<button type="button" class="btn" data-def="clear">${svg('<path d="M6 6l12 12M18 6L6 18"/>', 16, 2)} Clear ticks</button>`
              : `<button type="button" class="btn" data-def="copy">${I.copy} Copy</button>`}
          </div>
          <p class="hint tip def-pick-tip">${editing ? 'Your saved meanings are ticked. Untick to remove, tick others to add — from any tab.' : 'Tap meanings to tick the ones you want to save — from any tab. Nothing ticked saves the first meanings.'}</p>
        </div>
        ${openIn()}
        ${footer(res)}`;
      return;
    }
    if (res.status === 'nokey') {
      box.innerHTML = `
        <div class="def-head"><div class="def-title"><h2>${esc(word)}</h2></div></div>
        <div class="def-key">${KEY}<span>Add your free keys in <b>Settings → Dictionary</b> to use Merriam-Webster.</span></div>
        ${otherHint() || `<div class="def-other"><span>Wiktionary works without keys.</span><button type="button" data-tab="wiki">Show it</button></div>`}
        ${editBlock(res)}
        ${openIn()}`;
      return;
    }
    if (res.status === 'none') {
      box.innerHTML = `
        <div class="def-head"><div class="def-title"><h2>${esc(word)}</h2><span class="def-sub">Not in ${tab === 'pack' ? 'the offline dictionary' : TABS[tab][0]}</span></div></div>
        ${mwSwitch(null)}
        ${otherHint()}
        ${chips('Did you mean', res.suggestions)}
        <p class="def-msg">Web-novel terms and names often aren’t in normal dictionaries.</p>
        ${editing ? editBlock(res) : missingActions}
        ${openIn()}`;
      return;
    }
    box.innerHTML = `
      <div class="def-head"><div class="def-title"><h2>${esc(word)}</h2><span class="def-sub">No connection</span></div></div>
      <p class="def-msg">This word hasn’t been looked up in ${TABS[tab][0]} before, so it needs internet once.
        Tip: the <b>Offline</b> tab (Settings → Dictionary → Download) works without internet.</p>
      ${otherHint()}
      ${editing ? editBlock(res) : missingActions}`;
  }

  async function load(t) {
    const w = word;
    if (results[t]) return;
    const ref = mwRef;
    const res = await lookupIn(t, w, { mwRef: ref });
    if (w !== word || !box.isConnected) return;
    if (t === 'mw') {
      mwResults[ref] = res;
      if (ref !== mwRef) return; // switched while it loaded
    }
    results[t] = res;
    if (t === tab) {
      // When this dictionary can't help, quietly check the other one for the "Show it" hint.
      if (res.status !== 'ok') {
        const o = other(t);
        if (!peek[o] && !results[o]) {
          lookupIn(o, w).then(r => { if (w === word) { peek[o] = r; results[o] ||= r; if (tab === t) render(); else drawTabs(); } });
        }
      }
      render();
    } else drawTabs();
  }

  function showWord(w) {
    word = w;
    picks = new Map();
    results = {};
    peek = {};
    mwResults = {};
    render();
    load(tab);
  }

  // Meanings are ticked with Enter / Space too.
  sheet.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-pick], [data-keep]')) { e.preventDefault(); e.target.click(); }
  });
  sheet.addEventListener('click', async e => {
    const t = e.target.closest('[data-tab]');
    if (t) {
      tab = t.dataset.tab;
      try { localStorage.setItem(TAB_KEY, tab); } catch { /* ignore */ }
      sheet.scrollTop = 0;
      render();
      load(tab);
      return;
    }
    const mw = e.target.closest('[data-mw]');
    if (mw) {
      mwRef = mw.dataset.mw;
      setMwChoice(mwRef);
      results.mw = mwResults[mwRef];
      render();
      load('mw');
      return;
    }
    const ex = e.target.closest('[data-pickex]');
    if (ex) {
      const p = picks.get(ex.dataset.pickex);
      if (p) { p.withEx = !p.withEx; render(); }
      return;
    }
    const kp = e.target.closest('[data-keep]');
    if (kp) {
      const i = Number(kp.dataset.keep);
      keep[i] = !keep[i];
      const y = sheet.scrollTop;
      render();
      sheet.scrollTop = y;
      return;
    }
    const pk = e.target.closest('[data-pick]');
    if (pk) {
      const key = pk.dataset.pick;
      if (picks.has(key)) picks.delete(key);
      else {
        const [, pi, di] = key.split('|').map(Number);
        const i = info();
        const d = i?.parts[pi]?.[1]?.[di];
        if (d) picks.set(key, { pos: i.parts[pi][0], text: d.text, example: d.example || '', src: srcOf(), withEx: false });
      }
      const y = sheet.scrollTop;
      render();
      sheet.scrollTop = y;
      return;
    }
    const again = e.target.closest('[data-def-word]');
    if (again) { showWord(cleanWord(again.dataset.defWord)); return; }
    const b = e.target.closest('[data-def]');
    if (!b) return;
    const act = b.dataset.def;
    if (act === 'update') {
      const meanings = [...saved.filter((m, i) => keep[i]),
        ...[...picks.values()].map(p => ({ pos: p.pos, text: p.text, example: p.withEx ? p.example : '', src: p.src }))];
      const i = info();
      onUpdate(meanings, { phonetic: i?.phonetic || '', audio: i?.audio || '' });
      return;
    }
    if (act === 'note') {
      const i = info();
      const meanings = picks.size
        ? [...picks.values()].map(p => ({ pos: p.pos, text: p.text, example: p.withEx ? p.example : '', src: p.src }))
        : (i ? i.parts.slice(0, 2).map(([pos, defs]) => ({ pos, text: defs[0].text, example: '', src: srcOf() })) : []);
      onNote(picks.size ? picksText() : i ? noteText(i) : '', {
        headword: i?.word || word, meanings, audio: i?.audio || '', phonetic: i?.phonetic || '', text: picks.size ? picksText() : i ? noteText(i) : '',
      });
    }
    else if (act === 'clear') { picks.clear(); render(); }
    else if (act === 'find') onFind?.(word);
    else if (act === 'codex') onCodex?.(word);
    else if (act === 'copy') {
      try {
        await navigator.clipboard.writeText(`${info().word} — ${noteText(info()).replace(/\n/g, '; ')}`);
        toast('Copied');
      } catch { toast('Couldn’t copy'); }
    } else if (act === 'audio') {
      new Audio(info().audio).play().catch(() => toast('Can’t play the pronunciation right now'));
    }
  });

  showWord(word);
}
