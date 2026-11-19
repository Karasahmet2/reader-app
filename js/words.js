// words.js — Vocabulary as words.
//
// A word is saved once and shared by all series: { word (base form), forms[], meanings[{pos,
// text, example, src}], mine (your own notes), keys[] (dictionary headwords), audio }.
// Every vocabulary note (a spot in a chapter) points to its word with note.wordId, so one word
// collects all the places you met it. Each series has a built-in Vocabulary tag (tag.builtin
// === 'vocab') that can't be renamed or deleted.

import * as db from './db.js';
import { esc, fmtNum, plural, short, I, svg, toast, openSheet, closeOverlay } from './ui.js';
import { tagColor } from './notes.js';
import { openDefine } from './dictionary.js';

const norm = s => String(s || '').toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
/** A selection cleaned to a word: trims punctuation and a trailing 's. */
export const cleanQuote = q => norm(q).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/'s$/u, '');
const allForms = w => [w.word, ...(w.forms || [])].map(norm).filter(Boolean);
const POS_ORDER = ['noun', 'verb', 'adjective', 'adverb'];
const SRC_NAME = { 'mw:learners': 'Merriam-Webster Learner’s', 'mw:collegiate': 'Merriam-Webster Collegiate', wiki: 'Wiktionary', pack: 'WordNet', note: 'your earlier note' };

/* ------------------------------------------------------------------ built-in Vocabulary tag */

/** The series' Vocabulary tag; made if it doesn't exist yet. */
export async function vocabTag(seriesId) {
  const tags = (await db.getAllTags()).filter(t => t.seriesId === seriesId);
  let t = tags.find(x => x.builtin === 'vocab');
  if (t) return t;
  t = tags.find(x => /^vocab/i.test(x.name));
  if (t) {
    await db.updateTag(t.id, { builtin: 'vocab', order: -1, name: 'Vocabulary' });
    return { ...t, builtin: 'vocab', order: -1, name: 'Vocabulary' };
  }
  const made = await db.addTag('Vocabulary', 'blue', seriesId);
  await db.updateTag(made.id, { builtin: 'vocab', order: -1 });
  return { ...made, builtin: 'vocab', order: -1 };
}

/** Startup: every series gets its Vocabulary tag, and old vocabulary notes become words. */
export async function migrate() {
  for (const s of await db.getAllSeries()) await vocabTag(s.id);
  const vocabIds = new Set((await db.getAllTags()).filter(t => t.builtin === 'vocab').map(t => t.id));
  const todo = (await db.getAllNotes()).filter(n => !n.wordId && n.quote && (n.tagIds || []).some(id => vocabIds.has(id)));
  if (!todo.length) return 0;
  const words = await db.getAllWords();
  for (const n of todo.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))) {
    const base = cleanQuote(n.quote);
    if (!base) continue;
    const parsed = parseNoteText(n.text || '');
    let w = words.find(x => allForms(x).includes(base));
    if (w) {
      w = mergeInto(w, { meanings: parsed.meanings, mine: parsed.mine });
      w = await db.putWord(w);
      words[words.findIndex(x => x.id === w.id)] = w;
    } else {
      w = await db.putWord({ word: base, forms: [], meanings: parsed.meanings, mine: parsed.mine, keys: [base], createdAt: n.createdAt || Date.now() });
      words.push(w);
    }
    await db.putNote({ ...n, wordId: w.id });
  }
  return todo.length;
}

/** "verb — to look at closely" lines (with optional “example” lines under them) → meanings;
 *  everything else → your own notes. */
export function parseNoteText(text) {
  const meanings = [];
  const mine = [];
  for (const line of String(text).split('\n')) {
    const m = /^\s*([a-z][a-z .-]{0,24}?)\s+[—–-]\s+(.+?)(?:\s+\((Wiktionary|WordNet|Webster)\))?\s*$/i.exec(line);
    const ex = /^\s+[“"](.+)[”"]\s*$/.exec(line);
    if (m && /noun|verb|adj|adv|pron|prep|conj|interj|phrase|idiom|abbr/i.test(m[1])) {
      meanings.push({ pos: m[1].toLowerCase(), text: m[2], example: '', src: m[3] === 'Wiktionary' ? 'wiki' : m[3] === 'WordNet' ? 'pack' : 'note' });
    } else if (ex && meanings.length) meanings[meanings.length - 1].example = ex[1];
    else if (line.trim()) mine.push(line);
  }
  return { meanings, mine: mine.join('\n').trim() };
}

/** Add meanings / forms / notes to a word (no duplicates). */
function mergeInto(w, { forms = [], meanings = [], mine = '', keys = [], audio = '' }) {
  const out = { ...w, forms: [...(w.forms || [])], meanings: [...(w.meanings || [])], keys: [...(w.keys || [])] };
  for (const f of forms.map(norm)) if (f && f !== norm(out.word) && !out.forms.includes(f)) out.forms.push(f);
  for (const m of meanings) if (!out.meanings.some(x => norm(x.text) === norm(m.text))) out.meanings.push(m);
  for (const k of keys.map(norm)) if (k && !out.keys.includes(k)) out.keys.push(k);
  if (mine && !(out.mine || '').includes(mine)) out.mine = [out.mine, mine].filter(Boolean).join('\n\n');
  if (audio && !out.audio) out.audio = audio;
  return out;
}

/** A saved word that is the same as this one: same dictionary headword, or the text is one of its forms. */
export function sameWord(words, { headword, quote }, exceptId = null) {
  const h = norm(headword), q = cleanQuote(quote);
  return words.find(w => w.id !== exceptId && ((h && (allForms(w).includes(h) || (w.keys || []).includes(h))) || (q && allForms(w).includes(q)))) || null;
}

/* ------------------------------------------------------------------ saving from Define */

const groupHtml = meanings => {
  const groups = [];
  for (const m of meanings) {
    let g = groups.find(x => x.pos === m.pos);
    if (!g) { g = { pos: m.pos, list: [] }; groups.push(g); }
    g.list.push(m);
  }
  groups.sort((a, b) => (POS_ORDER.indexOf(a.pos) + 1 || 9) - (POS_ORDER.indexOf(b.pos) + 1 || 9));
  return groups.map(g => `<section class="wd-group"><span class="def-pos">${esc(g.pos)}</span>
    <ol>${g.list.map(m => `<li><span>${esc(m.text)}</span>${m.example ? `<em>“${esc(m.example)}”</em>` : ''}</li>`).join('')}</ol></section>`).join('');
};

/**
 * Save the selected word (from Define → Save).
 *  note: the draft note (quote, chapter, positions), where: label
 *  found: { headword, meanings, audio, text } from the dictionary
 *  onSaved(savedNote, isNew)
 */
export async function openSaveWord({ note, where, found, onSaved }) {
  const words = await db.getAllWords();
  const quote = cleanQuote(note.quote);
  const headword = norm(found.headword || quote);
  const match = sameWord(words, { headword, quote });
  const tag = await vocabTag(note.seriesId);

  const save = async target => {
    const base = norm(document.querySelector('#wd-base')?.value || headword) || quote;
    const mine = (document.querySelector('#wd-mine')?.value || '').trim();
    let w;
    if (target) {
      w = mergeInto(target, { forms: [quote, headword], meanings: found.meanings, mine, keys: [headword], audio: found.audio });
    } else {
      w = mergeInto({ word: base, forms: [], meanings: [], keys: [] }, { forms: [quote, headword], meanings: found.meanings, mine, keys: [headword, base], audio: found.audio });
    }
    w = await db.putWord(w);
    const n = { ...note, text: found.text || '', tagIds: [...new Set([...(note.tagIds || []), tag.id])], wordId: w.id };
    const id = await db.putNote(n);
    closeOverlay();
    const msg = await onSaved?.({ ...n, id }, true);
    toast(typeof msg === 'string' ? msg : target ? `Added to “${w.word}”` : `“${w.word}” saved`);
  };

  openSheet(`<div class="wd-save">
    <h2>Save “${esc(short(note.quote.trim(), 40))}”</h2>
    ${match ? `<div class="wd-match">
      <p class="wd-match-h">${svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>', 18)}<b>Same word as “${esc(match.word)}”</b></p>
      <p class="wd-match-why">${norm(headword) && allForms(match).includes(headword) && headword !== quote
        ? `The dictionary gives the same entry, <b>${esc(headword)}</b>, and you’ve saved “${esc(match.word)}” before.`
        : `“${esc(quote)}” is already one of the forms of “${esc(match.word)}”.`}</p>
      <div class="two-btns"><button type="button" class="btn" data-wd="new">Save as new word</button>
        <button type="button" class="btn btn-accent" data-wd="add">Add to “${esc(match.word)}”</button></div>
      <p class="hint tip" style="margin:0">Adds this spot to its places${quote !== norm(match.word) ? ` and “${esc(quote)}” to its forms` : ''}; meanings it doesn’t have yet come along.</p>
    </div>` : `<label class="field"><span class="label" style="padding:0">Word (base form)</span>
      <input class="text-input" id="wd-base" value="${esc(headword)}" autocomplete="off"></label>`}
    ${found.meanings.length ? `<p class="label" style="padding:0;margin:0">Dictionary</p><div class="wd-dict">${groupHtml(found.meanings)}</div>` : ''}
    <label class="field"><span class="label" style="padding:0">My notes <small>(optional)</small></span>
      <textarea class="text-area" id="wd-mine" rows="2" placeholder="Your own words, a memory hook…"></textarea></label>
    ${match ? '' : `<div class="two-btns"><button type="button" class="btn" data-wd="cancel">Cancel</button>
      <button type="button" class="btn btn-accent" data-wd="new">Save</button></div>`}
  </div>`, sheet => {
    sheet.addEventListener('click', e => {
      const b = e.target.closest('[data-wd]');
      if (!b) return;
      b.disabled = true;
      if (b.dataset.wd === 'cancel') closeOverlay();
      else save(b.dataset.wd === 'add' ? match : null);
    });
  });
}

/** A vocabulary note saved some other way (Note → Vocabulary tag): give it a word. */
export async function linkNote(note) {
  if (note.wordId || !note.quote) return note;
  const words = await db.getAllWords();
  const quote = cleanQuote(note.quote);
  if (!quote) return note;
  const parsed = parseNoteText(note.text || '');
  let w = sameWord(words, { headword: quote, quote });
  w = await db.putWord(w ? mergeInto(w, { meanings: parsed.meanings, mine: parsed.mine })
    : { word: quote, forms: [], meanings: parsed.meanings, mine: parsed.mine, keys: [quote] });
  const n = { ...note, wordId: w.id };
  await db.putNote(n);
  return n;
}

/* ------------------------------------------------------------------ word card */

const TAB_KEY = 'reader-word-tab';
const abbr = name => (/^\S+$/.test(name) ? name : name.split(/\s+/).map(x => x[0]).join('').toUpperCase().slice(0, 4));

async function placesOf(wordId) {
  const list = (await db.getAllNotes()).filter(n => n.wordId === wordId);
  const series = new Map((await db.getAllSeries()).map(s => [s.id, s]));
  const out = [];
  for (const n of list) {
    const ch = await db.getChapter(n.chapterId);
    out.push({ note: n, series: series.get(n.seriesId), num: ch?.number ?? 0 });
  }
  return out.sort((a, b) => (a.series?.name || '').localeCompare(b.series?.name || '') || a.num - b.num);
}

/**
 * The word card: forms, Dictionary / My notes, and every place you met it.
 *  fromNote: the note you tapped (gives "Remove this spot"), onChanged: redraw the page behind
 */
export async function openWordCard(wordId, { fromNote = null, onChanged } = {}) {
  let w = await db.getWord(wordId);
  if (!w) { toast('That word is no longer saved'); return; }
  let tab = 'dict';
  try { tab = localStorage.getItem(TAB_KEY) || 'dict'; } catch { /* default */ }
  const places = await placesOf(wordId);

  const html = () => `<div class="wd-card">
    <div class="wd-head"><div class="txt"><h2>${esc(w.word)}</h2><small>Vocabulary · all series</small></div>
      ${w.audio ? `<button type="button" class="icon-btn wd-say" data-wc="say" aria-label="Pronounce">${I.speaker || svg('<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16.5 9a4 4 0 0 1 0 6"/>', 20, 1.8)}</button>` : ''}</div>
    ${w.forms?.length ? `<div class="wd-forms"><small>Forms</small>${w.forms.map(f => `<span class="chip">${esc(f)}</span>`).join('')}</div>` : ''}
    <div class="vis-tabs wd-tabs" role="tablist">
      <button type="button" role="tab" aria-selected="${tab === 'dict'}" data-wtab="dict">Dictionary</button>
      <button type="button" role="tab" aria-selected="${tab === 'mine'}" data-wtab="mine">My notes${w.mine ? '<i></i>' : ''}</button></div>
    ${tab === 'dict'
      ? (w.meanings?.length ? `<div class="wd-dict">${groupHtml(w.meanings)}</div>
          <small class="wd-src">${esc([...new Set(w.meanings.map(m => SRC_NAME[m.src] || ''))].filter(Boolean).join(' · '))}</small>`
        : `<p class="hint" style="margin:0">No dictionary meanings saved yet.</p>`)
      : `<textarea class="text-area wd-mine" rows="5" placeholder="Your own words, a memory hook, how the story uses it…">${esc(w.mine || '')}</textarea>
         <p class="hint tip" style="margin:0">Saved as you type. Kept apart from the dictionary text.</p>`}
    <section class="wd-places"><p class="label" style="padding:0;margin:0">Where you met it · ${places.length}</p>
      <div class="wd-place-list">${places.map(p => `<a class="wd-place${fromNote?.id === p.note.id ? ' is-here' : ''}" href="#/read/${p.note.chapterId}/note/${p.note.id}">
        <span>${esc(short(p.note.quote || '', 70))}</span><small>${esc(p.series ? abbr(p.series.name) : '?')} · Ch. ${fmtNum(p.num)}</small></a>`).join('')
        || '<p class="hint" style="margin:0">No places yet.</p>'}</div></section>
    <div class="wd-actions">
      <button type="button" class="btn" data-wc="edit">${I.pencilSm} Edit</button>
      <button type="button" class="btn" data-wc="define">${I.book || ''} Define</button>
      <button type="button" class="btn" data-wc="attach">Attach…</button>
    </div>
    ${fromNote ? `<button type="button" class="btn wd-remove" data-wc="remove">${I.trashSm} Remove this spot</button>` : ''}
  </div>`;

  openSheet('<div class="wd-box"></div>', sheet => {
    const box = sheet.querySelector('.wd-box');
    const draw = () => { box.innerHTML = html(); };
    draw();
    let saveTimer = null;
    box.addEventListener('input', e => {
      if (!e.target.matches('.wd-mine')) return;
      w.mine = e.target.value;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => { w = await db.putWord(w); }, 400);
    });
    box.addEventListener('click', async e => {
      const t = e.target.closest('[data-wtab]');
      if (t) {
        if (saveTimer) { clearTimeout(saveTimer); w = await db.putWord(w); }
        tab = t.dataset.wtab;
        try { localStorage.setItem(TAB_KEY, tab); } catch { /* fine */ }
        draw();
        return;
      }
      const a = e.target.closest('a.wd-place');
      if (a) { e.preventDefault(); closeOverlay({ navTo: a.getAttribute('href') }); return; }
      const b = e.target.closest('[data-wc]');
      if (!b) return;
      const act = b.dataset.wc;
      if (act === 'say') new Audio(w.audio).play().catch(() => toast('Couldn’t play the sound'));
      if (act === 'edit') openEditWord(w.id, { onChanged });
      if (act === 'attach') openAttach(w.id, { onChanged });
      if (act === 'define') openDefine({ text: w.word, onNote: (t, found) => found && addMeanings(wordId, found).then(() => onChanged?.()) });
      if (act === 'remove') {
        closeOverlay();
        const { trashNotes } = await import('./trash.js');
        await trashNotes([fromNote], { onUndone: onChanged });
        onChanged?.();
      }
    });
  });
}

/** Add dictionary meanings to an existing word (Define from the word card). */
export async function addMeanings(wordId, found) {
  const w = await db.getWord(wordId);
  if (!w) return;
  await db.putWord(mergeInto(w, { meanings: found.meanings, keys: [found.headword], audio: found.audio }));
  toast(`Meanings added to “${w.word}”`);
}

/* ------------------------------------------------------------------ edit: base form, forms, detach */

export async function openEditWord(wordId, { onChanged } = {}) {
  const w = await db.getWord(wordId);
  if (!w) return;
  const forms = [...(w.forms || [])];
  const mine = (await db.getAllNotes()).filter(n => n.wordId === wordId);
  const quotes = [...new Set(mine.map(n => cleanQuote(n.quote)))];
  const merged = w.mergedFrom || [];
  const suggest = () => quotes.filter(q => q && q !== norm(w.word) && !forms.includes(q));

  const html = () => `<h2>Edit “${esc(w.word)}”</h2>
    <label class="field"><span class="label" style="padding:0">Word (base form)</span>
      <input class="text-input" id="we-base" value="${esc(w.word)}" autocomplete="off"></label>
    <div class="field"><span class="label" style="padding:0">Other forms</span>
      <div class="we-forms">${forms.map((f, i) => `<button type="button" class="chip" data-we-del="${i}" aria-label="Remove ${esc(f)}">${esc(f)} ✕</button>`).join('')}
        <input id="we-new" placeholder="type a form, then Enter" autocomplete="off" enterkeyhint="done"></div>
      ${suggest().length ? `<div class="we-suggest"><small>From the places you saved:</small>${suggest().map(q => `<button type="button" class="chip is-dashed" data-we-add="${esc(q)}">+ ${esc(q)}</button>`).join('')}</div>` : ''}
      <p class="hint tip" style="margin:0">Like “Also called” on Codex entries: every form is found and marked in the text, in every series.</p></div>
    ${merged.length ? `<div class="field"><span class="label" style="padding:0">Attached words</span>
      ${merged.map((m, i) => `<div class="we-merged"><span>“${esc(m.word.word)}”</span><button type="button" class="btn" data-we-detach="${i}">Detach</button></div>`).join('')}</div>` : ''}
    <div class="two-btns"><button type="button" class="btn" data-we="cancel">Cancel</button>
      <button type="button" class="btn btn-accent" data-we="save">Save</button></div>
    <button type="button" class="btn wd-remove" data-we="delete">${I.trashSm} Delete word${mine.length ? ` (and its ${plural(mine.length, 'place')})` : ''}</button>`;

  openSheet('<div class="we-box"></div>', sheet => {
    const box = sheet.querySelector('.we-box');
    let base = w.word;
    const draw = (focus = false) => {
      box.innerHTML = html();
      box.querySelector('#we-base').value = base;
      if (focus) box.querySelector('#we-new').focus();
    };
    draw();
    const addForm = v => {
      const f = norm(v);
      if (f && f !== norm(base) && !forms.includes(f)) forms.push(f);
    };
    box.addEventListener('input', e => { if (e.target.id === 'we-base') base = e.target.value; });
    box.addEventListener('keydown', async e => {
      if (e.target.id === 'we-new' && (e.key === 'Enter' || e.key === ',')) {
        e.preventDefault();
        addForm(e.target.value);
        draw(true);
      }
    });
    box.addEventListener('click', async e => {
      const del = e.target.closest('[data-we-del]');
      if (del) { forms.splice(Number(del.dataset.weDel), 1); draw(); return; }
      const add = e.target.closest('[data-we-add]');
      if (add) { addForm(add.dataset.weAdd); draw(); return; }
      const det = e.target.closest('[data-we-detach]');
      if (det) {
        closeOverlay();
        await detach(w.id, Number(det.dataset.weDetach));
        onChanged?.();
        return;
      }
      const b = e.target.closest('[data-we]');
      if (!b) return;
      if (b.dataset.we === 'cancel') { closeOverlay(); return; }
      if (b.dataset.we === 'delete') {
        closeOverlay();
        const { trashWord } = await import('./trash.js');
        await trashWord(w, { onUndone: onChanged });
        onChanged?.();
        return;
      }
      const pending = box.querySelector('#we-new')?.value;
      if (pending) addForm(pending);
      const nb = norm(base);
      if (!nb) { toast('The word can’t be empty'); return; }
      const others = (await db.getAllWords()).filter(x => x.id !== w.id);
      const clash = others.find(x => allForms(x).includes(nb));
      if (clash) { toast(`“${nb}” is already saved as “${clash.word}” — use Attach to join them`); return; }
      await db.putWord({ ...w, word: nb, forms: forms.filter(f => f !== nb) });
      closeOverlay();
      toast('Word saved');
      onChanged?.();
    });
  });
}

/* ------------------------------------------------------------------ attach / detach */

export async function openAttach(wordId, { onChanged } = {}) {
  const w = await db.getWord(wordId);
  if (!w) return;
  const others = (await db.getAllWords()).filter(x => x.id !== wordId);
  const likely = x => {
    const a = norm(w.word), b = norm(x.word);
    const n = Math.min(a.length, b.length, 4);
    return n >= 3 && a.slice(0, n) === b.slice(0, n);
  };
  let q = '';
  const list = () => others
    .filter(x => !q || allForms(x).some(f => f.includes(norm(q))))
    .sort((a, b) => likely(b) - likely(a) || a.word.localeCompare(b.word))
    .slice(0, 30);
  const rows = () => list().map(x => `<button type="button" class="wd-pick${likely(x) ? ' is-likely' : ''}" data-at="${x.id}">
      <span class="txt"><b>${esc(x.word)}</b><small>${esc([...new Set((x.meanings || []).map(m => m.pos))].join(', ') || 'no meanings yet')}${x.forms?.length ? ` · ${esc(x.forms.join(', '))}` : ''}</small></span>
      ${likely(x) ? '<em>likely match</em>' : ''}</button>`).join('') || '<p class="hint" style="margin:0;padding:12px">No other saved words match.</p>';
  openSheet(`<h2>Attach “${esc(w.word)}” to…</h2>
    <label class="search-box">${I.search}<input id="at-q" type="search" placeholder="Search your words" autocomplete="off"></label>
    <div class="wd-pick-list">${rows()}</div>
    <p class="hint tip" style="margin:0">For words the dictionary didn’t connect. Attaching joins them: places, forms and meanings come together, and “${esc(w.word)}” becomes a form. You can detach it again from Edit.</p>`, sheet => {
    sheet.querySelector('#at-q').addEventListener('input', e => { q = e.target.value; sheet.querySelector('.wd-pick-list').innerHTML = rows(); });
    sheet.addEventListener('click', async e => {
      const b = e.target.closest('[data-at]');
      if (!b) return;
      const target = await merge(wordId, Number(b.dataset.at));
      closeOverlay();
      toast(`Attached to “${target.word}”`);
      onChanged?.();
    });
  });
}

/** Join word `fromId` into word `toId`. Remembers enough to detach it again. */
export async function merge(fromId, toId) {
  const [from, to] = [await db.getWord(fromId), await db.getWord(toId)];
  const noteIds = (await db.getAllNotes()).filter(n => n.wordId === fromId).map(n => n.id);
  const before = { forms: [...(to.forms || [])], meanings: (to.meanings || []).length };
  let next = mergeInto(to, { forms: [from.word, ...(from.forms || [])], meanings: from.meanings || [], mine: from.mine || '', keys: from.keys || [], audio: from.audio });
  next.mergedFrom = [...(to.mergedFrom || []), {
    word: from, noteIds,
    addedForms: next.forms.filter(f => !before.forms.includes(f)),
    addedMeanings: next.meanings.slice(before.meanings).map(m => m.text),
  }];
  next = await db.putWord(next);
  for (const id of noteIds) {
    const n = await db.getNote(id);
    if (n) await db.putNote({ ...n, wordId: toId });
  }
  await db.deleteWord(fromId);
  return next;
}

/** Undo an attach: the word comes back with its places, forms and meanings. */
export async function detach(toId, index) {
  const to = await db.getWord(toId);
  const rec = to?.mergedFrom?.[index];
  if (!rec) return;
  await db.putWord(rec.word);
  for (const id of rec.noteIds) {
    const n = await db.getNote(id);
    if (n && n.wordId === toId) await db.putNote({ ...n, wordId: rec.word.id });
  }
  await db.putWord({
    ...to,
    forms: (to.forms || []).filter(f => !rec.addedForms.includes(f)),
    meanings: (to.meanings || []).filter(m => !rec.addedMeanings.includes(m.text)),
    mergedFrom: to.mergedFrom.filter((_, i) => i !== index),
  });
  toast(`“${rec.word.word}” detached`);
}

/* ------------------------------------------------------------------ reader: saved words met again */

/** Every form of every saved word → word id, longest first. */
function formTable(words) {
  const map = new Map();
  for (const w of words) for (const f of allForms(w)) if (!map.has(f)) map.set(f, w.id);
  return map;
}
export function clearWords(root) {
  root.querySelectorAll('span.wd-met').forEach(sp => {
    const parent = sp.parentNode;
    while (sp.firstChild) parent.insertBefore(sp.firstChild, sp);
    sp.remove();
    parent.normalize();
  });
}
/** Dotted line under saved words (any form) — except at the spots where you saved them. */
export function applyWords(paras, words) {
  const table = formTable(words);
  if (!table.size) return 0;
  const alts = [...table.keys()].sort((a, b) => b.length - a.length).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’]").replace(/ /g, '\\s+'));
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  let count = 0;
  for (const p of paras) {
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
      const el = node.parentElement;
      if (el.closest('.wd-met, .cx-name, mark.note-mark[data-word]')) continue;
      nodes.push(node);
    }
    for (const textNode of nodes) {
      const hits = [...textNode.data.matchAll(re)];
      for (let i = hits.length - 1; i >= 0; i--) {
        const m = hits[i];
        const id = table.get(norm(m[0]));
        if (!id) continue;
        const t = textNode.splitText(m.index);
        t.splitText(m[0].length);
        const sp = document.createElement('span');
        sp.className = 'wd-met';
        sp.dataset.word = id;
        t.parentNode.insertBefore(sp, t);
        sp.appendChild(t);
        count++;
      }
    }
  }
  return count;
}

/* "Saved words met again" switch, per series (on by default). */
const MET_KEY = 'reader-words-met-off';
export function metHidden(seriesId) {
  try { return (JSON.parse(localStorage.getItem(MET_KEY)) || []).includes(seriesId); } catch { return false; }
}
export function setMetHidden(seriesId, off) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(MET_KEY)) || []; } catch { /* fresh */ }
  list = list.filter(x => x !== seriesId);
  if (off) list.push(seriesId);
  try { localStorage.setItem(MET_KEY, JSON.stringify(list)); } catch { /* private mode */ }
}
/** Colour of the "met again" dots (set on the Vocabulary tag; teal by default). */
export const metColor = tag => tagColor(tag?.metColor || 'teal');

/* ------------------------------------------------------------------ Vocabulary words list (#/words) */

const LIST_KEY = 'reader-words-view';
function listView() {
  try { return { series: 'all', sort: 'az', ...JSON.parse(localStorage.getItem(LIST_KEY)) }; } catch { return { series: 'all', sort: 'az' }; }
}
function saveListView(v) { try { localStorage.setItem(LIST_KEY, JSON.stringify(v)); } catch { /* fine */ } }
/** Show only the words of one series next time the list opens. */
export function showSeriesWords(seriesId) { saveListView({ ...listView(), series: seriesId }); }

let wordQuery = '';
export async function renderWordsPage(app) {
  const [words, notes, allSeries] = await Promise.all([db.getAllWords(), db.getAllNotes(), db.getAllSeries()]);
  const view = listView();
  if (view.series !== 'all' && !allSeries.some(s => s.id === view.series)) view.series = 'all';
  const bySeries = new Map(); // word id → Map(series id → count)
  for (const n of notes) {
    if (!n.wordId) continue;
    if (!bySeries.has(n.wordId)) bySeries.set(n.wordId, new Map());
    const m = bySeries.get(n.wordId);
    m.set(n.seriesId, (m.get(n.seriesId) || 0) + 1);
  }
  const seriesName = new Map(allSeries.map(s => [s.id, s.name]));
  const current = view.series === 'all' ? null : allSeries.find(s => s.id === view.series);
  const inView = words.filter(w => !current || bySeries.get(w.id)?.has(current.id));
  const places = w => [...(bySeries.get(w.id)?.values() || [])].reduce((a, b) => a + b, 0);

  app.innerHTML = `<main class="page words-page">
    <div class="row-head">
      <a class="icon-btn notes-back" href="#/notes" data-back aria-label="Back">${I.back}</a>
      <div class="txt"><h1 class="page-title">Vocabulary</h1><small>${plural(words.length, 'word')} · shared by all series</small></div>
      <button type="button" class="chip words-series" data-wl="series">${esc(current ? current.name : 'All series')} ▾</button>
    </div>
    <label class="search-box">${I.search}<input id="wl-q" type="search" placeholder="Search words and forms" value="${esc(wordQuery)}" autocomplete="off"></label>
    <div class="chip-row words-sort">${[['az', 'A–Z'], ['recent', 'Recently saved'], ['met', 'Most met']].map(([k, l]) => `<button type="button" class="chip${view.sort === k ? ' is-on' : ''}" data-ws="${k}" aria-pressed="${view.sort === k}">${l}</button>`).join('')}</div>
    <div class="list-meta"><span id="wl-count"></span></div>
    <div class="words-list"></div>
  </main>`;

  const listEl = app.querySelector('.words-list');
  const drawList = () => {
    const q = norm(wordQuery);
    const shown = inView.filter(w => !q || allForms(w).some(f => f.includes(q)));
    const cmp = { az: (a, b) => a.word.localeCompare(b.word), recent: (a, b) => (b.createdAt || 0) - (a.createdAt || 0), met: (a, b) => places(b) - places(a) || a.word.localeCompare(b.word) }[view.sort];
    shown.sort(cmp);
    app.querySelector('#wl-count').textContent = current ? `${plural(shown.length, 'word')} met in ${current.name}` : plural(shown.length, 'word');
    listEl.innerHTML = shown.map(w => {
      const where = [...(bySeries.get(w.id) || new Map())].map(([sid, c]) => `${abbr(seriesName.get(sid) || '?')} · ${c}`).join(' · ');
      const first = (w.meanings || []).slice(0, 2).map(m => `${m.pos} — ${m.text}`).join(' · ');
      return `<button type="button" class="word-row" data-word="${w.id}">
        <span class="wr-top"><b>${esc(w.word)}</b>${w.forms?.length ? `<small>${esc(w.forms.join(' · '))}</small>` : ''}<em>${esc(where)}</em></span>
        ${first || w.mine ? `<span class="wr-mean">${esc(short(first || w.mine, 140))}</span>` : ''}</button>`;
    }).join('') || `<div class="empty" style="padding:30px 12px"><strong>${q ? 'No matches' : 'No words yet'}</strong>
      <span>${q ? 'Try another spelling.' : 'Select a word while reading → Define → Save.'}</span></div>`;
  };
  drawList();
  app.querySelector('#wl-q').addEventListener('input', e => { wordQuery = e.target.value; drawList(); });
  app.querySelector('main').addEventListener('click', e => {
    const s = e.target.closest('[data-ws]');
    if (s) { view.sort = s.dataset.ws; saveListView(view); renderWordsPage(app); return; }
    const r = e.target.closest('[data-word]');
    if (r) { openWordCard(Number(r.dataset.word), { onChanged: () => renderWordsPage(app) }); return; }
    if (e.target.closest('[data-wl="series"]')) {
      openSheet(`<h2>Show words from</h2><div class="option-list">
        ${[{ id: 'all', name: 'All series' }, ...allSeries].map(s => {
          const n = s.id === 'all' ? words.length : words.filter(w => bySeries.get(w.id)?.has(s.id)).length;
          return `<button type="button" class="option-row${view.series === s.id ? ' is-on' : ''}" data-pick-series="${s.id}"><span class="txt">${esc(s.name)}<small>${plural(n, 'word')}</small></span>${view.series === s.id ? I.check : ''}</button>`;
        }).join('')}</div>`, sheet => {
        sheet.addEventListener('click', ev => {
          const b = ev.target.closest('[data-pick-series]');
          if (!b) return;
          view.series = b.dataset.pickSeries === 'all' ? 'all' : Number(b.dataset.pickSeries);
          saveListView(view);
          closeOverlay();
          renderWordsPage(app);
        });
      });
    }
  });
}
