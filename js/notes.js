// notes.js — notes, highlights and tags.
//
//  • Reader: text selection bar (Note · Highlight · Copy), colored marks in the
//    text, note cards, the chapter's notes list.
//  • Notes tab: every note grouped by series and chapter, tag filters, search.
//  • Tag manager: add, rename, recolor and delete tags.

import * as db from './db.js';
import { TAG_PALETTE, OLD_TAG_COLORS } from './settings.js';
import { esc, fmtNum, plural, short, I, toast, openSheet, closeOverlay } from './ui.js';
import { openFind } from './find.js';

export const TAG_COLORS = Object.keys(TAG_PALETTE); // 12 colors

/** A color for a new tag: the first one no tag uses yet, otherwise the least used. */
export function nextTagColor(tags) {
  const used = new Map(TAG_COLORS.map(c => [c, 0]));
  for (const t of tags) if (used.has(t.color)) used.set(t.color, used.get(t.color) + 1);
  return [...used.entries()].sort((a, b) => a[1] - b[1])[0][0];
}

/** The 12-color picker. `extra` adds attributes to each button (e.g. which tag it's for). */
function paletteHtml(selected, extra = '') {
  return `<div class="palette" role="group" aria-label="Tag color">
    ${TAG_COLORS.map(c => `<button type="button" data-color="${c}" ${extra} aria-label="${TAG_PALETTE[c].label}" aria-pressed="${c === selected}">
      <span style="background:${tagColor(c)}"></span></button>`).join('')}
  </div>`;
}

const isPaper = () => document.documentElement.dataset.light === 'true';
const accentOf = c => TAG_PALETTE[c] || TAG_PALETTE[OLD_TAG_COLORS[c]] || TAG_PALETTE.silver;
export const tagColor = c => (isPaper() ? accentOf(c).paper : accentOf(c).dark);
export const tagBg = c => (isPaper() ? accentOf(c).selPaper : accentOf(c).selDark);


/** Update 4: tags that still use one of the old 19 colors move to the new 12.
 *  Each tag gets its own color while there are free ones: the closest new color,
 *  or the nearest free one around the color wheel if that's taken. */
const RING = ['red', 'orange', 'yellow', 'green', 'teal', 'sky', 'blue', 'purple', 'magenta', 'pink'];
export async function migrateTagColors() {
  const tags = (await db.getAllTags()).sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id));
  if (tags.every(t => TAG_PALETTE[t.color])) return 0;
  const used = new Set(tags.filter(t => TAG_PALETTE[t.color]).map(t => t.color));
  let changed = 0;
  for (const t of tags) {
    if (TAG_PALETTE[t.color]) continue;
    const want = OLD_TAG_COLORS[t.color] || 'silver';
    let pick = want;
    if (used.has(want)) {
      const i = RING.indexOf(want);
      const near = i < 0 ? [] : RING.map((c, j) => [c, Math.min(Math.abs(j - i), RING.length - Math.abs(j - i))])
        .filter(([c]) => !used.has(c)).sort((a, b) => a[1] - b[1]).map(([c]) => c);
      pick = near[0] || TAG_COLORS.find(c => !used.has(c)) || want;
    }
    used.add(pick);
    await db.updateTag(t.id, { color: pick });
    changed++;
  }
  return changed;
}

const byId = list => new Map(list.map(x => [x.id, x]));

/** A note's tags, in the order they appear in your tag list. */
const tagsOf = (note, tagsById) => (note.tagIds || [])
  .map(id => tagsById.get(id)).filter(Boolean)
  .sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id));

/* ------------------------------------------------------------------ marks in the text */

/** Take every note mark out of the text (before drawing them again). */
export function clearMarks(root) {
  root.querySelectorAll('mark.note-mark').forEach(m => {
    const parent = m.parentNode;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    m.remove();
  });
  root.querySelectorAll('p[data-p]').forEach(p => p.normalize());
}

/** Text of a note's range, built the same way as when it was selected. */
function rangeText(paras, sp, so, ep, eo) {
  const parts = [];
  for (let i = sp; i <= ep; i++) {
    const t = paras[i].textContent;
    parts.push(t.slice(i === sp ? so : 0, i === ep ? eo : t.length));
  }
  return parts.join('\n');
}

/**
 * Find where a note belongs in the current text. Normally its saved position;
 * if the chapter was re-imported and the text moved, look for the quote instead.
 */
function locate(note, paras) {
  if (note.sp == null || !note.quote) return null;
  if (paras[note.sp] && paras[note.ep] && rangeText(paras, note.sp, note.so, note.ep, note.eo) === note.quote) {
    return note;
  }
  let best = null;
  const closer = cand => !best || Math.abs(cand.sp - note.sp) < Math.abs(best.sp - note.sp);
  const parts = note.quote.split('\n');

  if (parts.length === 1) {
    paras.forEach((p, i) => {
      const at = p.textContent.indexOf(note.quote);
      const cand = { sp: i, so: at, ep: i, eo: at + note.quote.length };
      if (at >= 0 && closer(cand)) best = cand;
    });
    return best;
  }

  // A passage over several paragraphs: the end of one paragraph, whole paragraphs, the start of another.
  const last = parts.length - 1;
  for (let i = 0; i + last < paras.length; i++) {
    const first = paras[i].textContent;
    if (!first.endsWith(parts[0])) continue;
    let ok = true;
    for (let k = 1; k < last && ok; k++) ok = paras[i + k].textContent === parts[k];
    if (!ok || !paras[i + last].textContent.startsWith(parts[last])) continue;
    const cand = { sp: i, so: first.length - parts[0].length, ep: i + last, eo: parts[last].length };
    if (closer(cand)) best = cand;
  }
  return best;
}

function wrap(p, from, to, note, color, kind) {
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  const parts = [];
  let pos = 0;
  let node;
  while ((node = walker.nextNode())) {
    const len = node.data.length;
    const a = Math.max(from, pos);
    const b = Math.min(to, pos + len);
    if (a < b) parts.push([node, a - pos, b - pos]);
    pos += len;
    if (pos >= to) break;
  }
  for (const [textNode, a, b] of parts) {
    let t = textNode;
    if (a > 0) t = t.splitText(a);
    if (b - a < t.data.length) t.splitText(b - a);
    const m = document.createElement('mark');
    m.className = `note-mark ${kind}`;
    m.dataset.note = note.id;
    m.style.setProperty('--mc', color);
    t.parentNode.insertBefore(m, t);
    m.appendChild(t);
  }
}

/** Draw all notes of a chapter into its paragraphs. */
export function applyMarks(paras, noteList, tags) {
  const tagsById = byId(tags);
  for (const note of noteList) {
    const loc = locate(note, paras);
    if (!loc) continue;
    const firstTag = tagsOf(note, tagsById)[0];
    const color = firstTag ? tagColor(firstTag.color) : 'var(--accent)';
    const kind = note.text || firstTag ? 'is-note' : 'is-highlight';
    for (let i = loc.sp; i <= loc.ep; i++) {
      const len = paras[i].textContent.length;
      wrap(paras[i], i === loc.sp ? loc.so : 0, i === loc.ep ? loc.eo : len, note, color, kind);
    }
  }
}

/* ------------------------------------------------------------------ selection bar */

/** Character offset of (node, offset) inside paragraph p. */
function offsetIn(p, node, offset) {
  const r = document.createRange();
  r.setStart(p, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}

/** Turn the current text selection into { sp, so, ep, eo, quote }, or null. */
function readSelection(textEl, paras) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  if (!textEl.contains(r.commonAncestorContainer) && !r.intersectsNode(textEl)) return null;
  const hit = paras.filter(p => r.intersectsNode(p));
  if (!hit.length) return null;

  let sp = Number(hit[0].dataset.p);
  let ep = Number(hit[hit.length - 1].dataset.p);
  let so = paras[sp].contains(r.startContainer) ? offsetIn(paras[sp], r.startContainer, r.startOffset) : 0;
  let eo = paras[ep].contains(r.endContainer)
    ? offsetIn(paras[ep], r.endContainer, r.endOffset) : paras[ep].textContent.length;

  // A selection that ends right at the start of a paragraph really ends in the one before.
  while (ep > sp && eo === 0) { ep -= 1; eo = paras[ep].textContent.length; }
  // Skip spaces at either end.
  const st = paras[sp].textContent;
  while (so < st.length && /\s/.test(st[so])) so += 1;
  const et = paras[ep].textContent;
  while (eo > 0 && /\s/.test(et[eo - 1])) eo -= 1;
  if (sp === ep && eo <= so) return null;

  const quote = rangeText(paras, sp, so, ep, eo);
  return quote.trim() ? { sp, so, ep, eo, quote } : null;
}

/**
 * Show the Note · Highlight · Copy bar while text is selected in the reader.
 * onAction(action, selection) is called when a button is tapped. Returns a cleanup function.
 */
export function setupSelectionBar(textEl, paras, onAction) {
  const bar = document.createElement('div');
  bar.className = 'sel-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Selected text');
  bar.innerHTML = `
    <button type="button" class="sel-main" data-sel="note">${I.note}Note</button>
    <button type="button" data-sel="highlight">${I.highlight}Highlight</button>
    <button type="button" data-sel="find">${I.searchSm}Find</button>
    <button type="button" data-sel="copy" aria-label="Copy">${I.copy}</button>`;
  document.body.append(bar);

  let last = null;
  let pressing = false;
  let hideTimer = null;

  const hide = () => bar.classList.remove('show');

  /**
   * Put the bar just under the selection. Android shows its own Copy/Share menu above
   * the selection, so below is free. Near the bottom of the screen the bar goes above
   * (leaving room for Android's menu), and if that doesn't fit either, to the top.
   */
  function place() {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const rects = [...sel.getRangeAt(0).getClientRects()].filter(r => r.width || r.height);
    if (!rects.length) return;
    const top = Math.min(...rects.map(r => r.top));
    const bottom = Math.max(...rects.map(r => r.bottom));
    const left = Math.min(...rects.map(r => r.left));
    const right = Math.max(...rects.map(r => r.right));
    const w = bar.offsetWidth;
    const h = bar.offsetHeight;
    const gap = 14;
    const bottomRoom = 24;   // keep clear of the gesture bar
    const androidMenu = 64;  // space Android's own menu takes above a selection

    let y;
    if (bottom + gap + h < window.innerHeight - bottomRoom) y = bottom + gap;
    else if (top - androidMenu - h > 8) y = top - androidMenu - h;
    else y = 12;
    y = Math.min(window.innerHeight - h - bottomRoom, Math.max(8, y)); // always on screen
    const x = Math.min(window.innerWidth - w - 8, Math.max(8, (left + right) / 2 - w / 2));
    bar.style.top = `${Math.round(y)}px`;
    bar.style.left = `${Math.round(x)}px`;
  }

  let ticking = false;
  const onScroll = () => {
    if (ticking || !bar.classList.contains('show')) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; place(); });
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  const onChange = () => {
    clearTimeout(hideTimer);
    const info = readSelection(textEl, paras);
    if (info) {
      last = info;
      place();
      bar.classList.add('show');
      document.body.classList.remove('controls-open');
    } else if (!pressing) {
      hideTimer = setTimeout(() => { hide(); last = null; }, 250);
    }
  };

  // Keep the selection alive while a bar button is being pressed.
  bar.addEventListener('pointerdown', e => { pressing = true; e.preventDefault(); });
  const release = () => { setTimeout(() => { pressing = false; }, 400); };
  bar.addEventListener('pointerup', release);
  bar.addEventListener('pointercancel', release);
  bar.addEventListener('click', e => {
    const b = e.target.closest('[data-sel]');
    if (!b || !last) return;
    const info = last;
    last = null;
    hide();
    window.getSelection()?.removeAllRanges();
    onAction(b.dataset.sel, info);
  });

  document.addEventListener('selectionchange', onChange);
  return () => {
    clearTimeout(hideTimer);
    document.removeEventListener('selectionchange', onChange);
    window.removeEventListener('scroll', onScroll);
    bar.remove();
  };
}

/* ------------------------------------------------------------------ note editor */

/**
 * Add or edit a note.
 *  note: an existing note, or a new draft { seriesId, chapterId, sp, so, ep, eo, quote }
 *  where: "Series · Ch. N" shown under the quote
 *  onSaved: called after saving
 */
export async function openNoteEditor({ note, where, onSaved }) {
  let tags = await db.getAllTags();
  const selected = new Set(note.tagIds || []);
  let newColor = nextTagColor(tags);
  const isNew = note.id == null;

  const chipsHtml = () => `
    ${tags.map(t => `<button type="button" class="tag-chip" data-tag="${t.id}" aria-pressed="${selected.has(t.id)}"
        style="--tc:${tagColor(t.color)};--tb:${tagBg(t.color)}">
        <span class="tick">${I.checkSm}</span><i></i>${esc(t.name)}</button>`).join('')}
    <button type="button" class="tag-chip tag-new" data-newtag>${I.plusSm}New tag</button>`;

  const newTagHtml = () => `
    <div class="new-tag" hidden>
      <input class="text-input" id="new-tag-name" type="text" placeholder="Tag name" maxlength="30" autocomplete="off">
      ${paletteHtml(newColor)}
      <button type="button" class="btn btn-accent" data-addtag>Add tag</button>
    </div>`;

  const quoteHtml = note.quote
    ? `<figure class="quote"><blockquote>${esc(short(note.quote, 400))}</blockquote><figcaption>${esc(where)}</figcaption></figure>`
    : `<figure class="quote is-chapter"><figcaption>Chapter note · ${esc(where)}</figcaption></figure>`;

  openSheet(`
    <h2>${isNew ? (note.quote ? 'Add note' : 'Add chapter note') : 'Edit note'}</h2>
    ${quoteHtml}
    <div class="field">
      <p class="label" style="padding:0">Tags</p>
      <div class="tag-chips">${chipsHtml()}</div>
      ${newTagHtml()}
    </div>
    <label class="field">
      <span class="label" style="padding:0">Note</span>
      <textarea id="note-text" class="text-area" rows="3" placeholder="${note.quote ? 'Meaning, thoughts, anything…' : 'What happened, what to remember…'}">${esc(note.text || '')}</textarea>
    </label>
    <div class="two-btns">
      <button type="button" class="btn" data-ne="cancel">Cancel</button>
      <button type="button" class="btn btn-accent" data-ne="save">Save note</button>
    </div>`, sheet => {
    const chips = sheet.querySelector('.tag-chips');
    const newRow = sheet.querySelector('.new-tag');
    const nameInput = sheet.querySelector('#new-tag-name');
    if (!note.quote) sheet.querySelector('#note-text').focus();

    const addTag = async () => {
      const name = nameInput.value.replace(/\s+/g, ' ').trim();
      if (!name) { nameInput.focus(); return; }
      const existing = tags.find(t => t.name.toLowerCase() === name.toLowerCase());
      const tag = existing || await db.addTag(name, newColor);
      if (!existing) tags = [...tags, tag];
      selected.add(tag.id);
      chips.innerHTML = chipsHtml();
      nameInput.value = '';
      newRow.hidden = true;
    };

    sheet.addEventListener('click', async e => {
      const chip = e.target.closest('[data-tag]');
      if (chip) {
        const id = Number(chip.dataset.tag);
        if (selected.has(id)) selected.delete(id); else selected.add(id);
        chip.setAttribute('aria-pressed', String(selected.has(id)));
        return;
      }
      if (e.target.closest('[data-newtag]')) {
        newRow.hidden = !newRow.hidden;
        if (!newRow.hidden) nameInput.focus();
        return;
      }
      const sw = e.target.closest('[data-color]');
      if (sw) {
        newColor = sw.dataset.color;
        newRow.querySelectorAll('[data-color]').forEach(b =>
          b.setAttribute('aria-pressed', String(b.dataset.color === newColor)));
        return;
      }
      if (e.target.closest('[data-addtag]')) { addTag(); return; }
      const act = e.target.closest('[data-ne]');
      if (!act) return;
      if (act.dataset.ne === 'cancel') { closeOverlay(); return; }
      const text = sheet.querySelector('#note-text').value.trim();
      if (!note.quote && !text) { toast('Write something first'); return; }
      await db.putNote({ ...note, text, tagIds: [...selected] });
      toast(isNew ? 'Note saved' : 'Note updated');
      closeOverlay();
      onSaved?.();
    });
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') addTag(); });
  });
}

/** Save a plain highlight (no tags, no text). */
export async function saveHighlight(draft) {
  await db.putNote({ ...draft, text: '', tagIds: [] });
  toast('Highlighted');
}

/* ------------------------------------------------------------------ note card */

/**
 * A note card: a bar in its tags' colors on the left, the quote and note text,
 * and a small line with chapter, kind and tag names.
 */
function noteCardHtml(note, tagsById, { link = null, where = '', chapter = '', isStatic = false } = {}) {
  const tags = tagsOf(note, tagsById);
  const isHighlight = note.quote && !note.text && !tags.length;
  const colors = tags.length
    ? tags.map(t => tagColor(t.color))
    : [isHighlight ? 'var(--surface-3)' : 'var(--accent)'];
  const meta = [
    chapter,
    !note.quote ? 'Chapter note' : '',
    isHighlight ? 'Highlight' : '',
    ...tags.map(t => t.name),
    where,
  ].filter(Boolean);

  const inner = `<span class="note-bar" aria-hidden="true">${colors.map(c => `<i style="background:${c}"></i>`).join('')}</span>
    <span class="note-body">
      ${note.quote ? `<span class="note-quote">${esc(short(note.quote))}</span>` : ''}
      ${note.text ? `<span class="note-text">${esc(note.text)}</span>` : ''}
      <span class="note-meta">${meta.map(esc).join(' · ')}</span>
    </span>`;
  if (isStatic) return `<div class="note-card is-static">${inner}</div>`;
  return link
    ? `<a class="note-card" href="${link}">${inner}</a>`
    : `<button type="button" class="note-card" data-note-id="${note.id}">${inner}</button>`;
}

/**
 * The card shown when you tap marked text in the reader.
 * ctx: { where, onChanged, onFindJump (reader only), inNotesTab }
 */
export async function openNoteCard(noteId, ctx) {
  const [note, tags] = await Promise.all([db.getNote(noteId), db.getAllTags()]);
  if (!note) return;
  const tagsById = byId(tags);
  // From the Notes tab there's a "Go to" button; in the reader you're already there.
  const goTo = ctx.inNotesTab
    ? `<button type="button" class="nc-big is-accent" data-nc="goto">${I.bookOpen}${note.quote ? 'Go to text' : 'Go to chapter'}</button>`
    : '';
  const big = [
    goTo,
    `<button type="button" class="nc-big" data-nc="edit">${I.pencil}Edit</button>`,
    note.quote ? `<button type="button" class="nc-big" data-nc="find">${I.search}Find uses</button>` : '',
  ].filter(Boolean);
  openSheet(`
    ${noteCardHtml(note, tagsById, { isStatic: true, where: ctx.where })}
    <div class="nc-grid" style="--n:${big.length}">${big.join('')}</div>
    <div class="card-actions">
      <button type="button" class="btn btn-outline" data-nc="copy">${I.copy} Copy</button>
      <button type="button" class="btn btn-outline is-danger" data-nc="delete">${I.trashSm} Delete</button>
    </div>`, sheet => {
    sheet.addEventListener('click', async e => {
      const b = e.target.closest('[data-nc]');
      if (!b) return;
      const act = b.dataset.nc;
      if (act === 'goto') {
        closeOverlay({ navTo: note.quote ? `#/read/${note.chapterId}/note/${note.id}` : `#/read/${note.chapterId}` });
      } else if (act === 'edit') {
        openNoteEditor({ note, where: ctx.where, onSaved: ctx.onChanged });
      } else if (act === 'find') {
        openFind({
          term: note.quote.split('\n')[0],
          chapterId: note.chapterId,
          seriesId: note.seriesId,
          onJumpHere: ctx.onFindJump || null,
        });
      } else if (act === 'copy') {
        const txt = [note.quote, note.text].filter(Boolean).join('\n\n');
        try {
          await navigator.clipboard.writeText(txt);
          toast('Copied');
        } catch {
          toast('Couldn’t copy here');
        }
      } else if (act === 'delete') {
        if (!b.classList.contains('confirm')) {
          b.classList.add('confirm');
          b.innerHTML = `${I.trashSm} Tap again to delete`;
          return;
        }
        await db.deleteNote(note.id);
        toast('Note deleted');
        closeOverlay();
        ctx.onChanged?.();
      }
    });
  });
}

/* ------------------------------------------------------------------ chapter notes (reader tool) */

/**
 * List of this chapter's notes, plus "Add chapter note".
 * ctx: { chapter, series, where, onChanged, onJump(noteId) }
 */
export async function openChapterNotes(ctx) {
  const [list, tags] = await Promise.all([db.getNotesOfChapter(ctx.chapter.id), db.getAllTags()]);
  const tagsById = byId(tags);
  list.sort((a, b) => (a.sp ?? -1) - (b.sp ?? -1) || (a.so ?? 0) - (b.so ?? 0));
  openSheet(`
    <h2>Notes in this chapter</h2>
    ${list.length
      ? `<div class="note-list">${list.map(n => noteCardHtml(n, tagsById)).join('')}</div>`
      : '<p class="hint">No notes yet. Long-press a word or drag across a passage to add one.</p>'}
    <button type="button" class="btn btn-accent" data-cn="add">${I.plus} Add chapter note</button>`, sheet => {
    sheet.addEventListener('click', e => {
      if (e.target.closest('[data-cn="add"]')) {
        openNoteEditor({
          note: { seriesId: ctx.series.id, chapterId: ctx.chapter.id, sp: null, quote: '' },
          where: ctx.where,
          onSaved: ctx.onChanged,
        });
        return;
      }
      const card = e.target.closest('[data-note-id]');
      if (!card) return;
      const note = list.find(n => n.id === Number(card.dataset.noteId));
      if (note?.quote) {
        closeOverlay();
        ctx.onJump(note.id);
      } else if (note) {
        openNoteCard(note.id, ctx);
      }
    });
  });
}

/* ------------------------------------------------------------------ Notes tab */

const NOTE_SORTS = {
  recent: 'Recent notes',
  series: 'Series name',
  count: 'Most notes',
};
const SORT_KEY = 'reader-notes-sort';
const savedSort = () => { try { return localStorage.getItem(SORT_KEY); } catch { return null; } };

export const notesState = {
  filter: 'all',
  query: '',
  searchOpen: false,
  sort: NOTE_SORTS[savedSort()] ? savedSort() : 'recent',
};

/**
 * Draw the Notes tab into `app`: notes grouped by series, in reading order inside each.
 * navHtml: the bottom navigation. coverHtml(series): a tiny cover for group headers.
 */
export async function renderNotes(app, navHtml, coverHtml = () => '') {
  const [allNotes, tags, chapters, series] = await Promise.all([
    db.getAllNotes(), db.getAllTags(), db.getAllChapters(), db.getAllSeries(),
  ]);
  const tagsById = byId(tags);
  const chapterById = byId(chapters);
  const seriesById = byId(series);
  if (notesState.filter !== 'all' && !tagsById.has(notesState.filter)) notesState.filter = 'all';

  const counts = new Map();
  for (const n of allNotes) for (const id of n.tagIds || []) counts.set(id, (counts.get(id) || 0) + 1);

  app.innerHTML = `<main class="page">
    <div class="row-head">
      <h1 class="page-title">Notes</h1>
      <button type="button" class="icon-btn" data-nt="search" aria-label="Search notes" aria-expanded="${notesState.searchOpen}">${I.search}</button>
      <button type="button" class="icon-btn" data-nt="tags" aria-label="Manage tags">${I.tag}</button>
    </div>
    ${notesState.searchOpen ? `<label class="search-box">${I.search}
      <span class="visually-hidden">Search notes</span>
      <input id="notes-search" type="search" placeholder="Search words, notes, tags" value="${esc(notesState.query)}" autocomplete="off">
    </label>` : ''}
    <nav class="filter-chips" aria-label="Filter by tag">
      <button type="button" data-ntag="all" aria-pressed="${notesState.filter === 'all'}">All${allNotes.length ? ` <span class="count">${allNotes.length}</span>` : ''}</button>
      ${tags.map(t => `<button type="button" data-ntag="${t.id}" aria-pressed="${notesState.filter === t.id}">
        <i class="chip-dot" style="background:${tagColor(t.color)}"></i>${esc(t.name)}${counts.get(t.id) ? ` <span class="count">${counts.get(t.id)}</span>` : ''}</button>`).join('')}
    </nav>
    <div class="list-meta">
      <span id="notes-count"></span>
      <button type="button" class="sort-btn" data-nt="sort">${I.sort}${NOTE_SORTS[notesState.sort]}</button>
    </div>
    <div id="notes-list" class="notes-groups"></div>
  </main>${navHtml}`;

  const seriesName = id => seriesById.get(id)?.name || 'Unknown series';
  const chapterNum = n => chapterById.get(n.chapterId)?.number ?? Infinity;

  const draw = () => {
    const q = notesState.query.trim().toLowerCase();
    const shown = allNotes.filter(n => {
      if (notesState.filter !== 'all' && !(n.tagIds || []).includes(notesState.filter)) return false;
      if (!notesState.searchOpen || !q) return true;
      const hay = [n.quote, n.text, seriesName(n.seriesId),
        ...(n.tagIds || []).map(id => tagsById.get(id)?.name)].join(' ').toLowerCase();
      return hay.includes(q);
    });

    const list = app.querySelector('#notes-list');
    const groups = new Map();
    for (const n of shown) {
      const g = groups.get(n.seriesId) || { seriesId: n.seriesId, notes: [], latest: 0 };
      g.notes.push(n);
      g.latest = Math.max(g.latest, n.updatedAt || 0);
      groups.set(n.seriesId, g);
    }
    app.querySelector('#notes-count').textContent =
      `${groups.size} series · ${plural(shown.length, 'note')}`;

    if (!shown.length) {
      list.innerHTML = `<div class="empty" style="padding:40px 16px">
        ${allNotes.length
          ? `<span>No notes match${q && notesState.searchOpen ? ` “${esc(notesState.query)}”` : ' this tag'}.</span>`
          : `<span class="empty-ico">${I.notes}</span><strong>No notes yet</strong>
             <span>While reading, long-press a word or drag across a passage, then tap Note. For a note about the whole chapter, tap the page → Notes.</span>`}
      </div>`;
      return;
    }

    const order = {
      recent: (a, b) => b.latest - a.latest,
      series: (a, b) => seriesName(a.seriesId).localeCompare(seriesName(b.seriesId), undefined, { sensitivity: 'base', numeric: true }),
      count: (a, b) => b.notes.length - a.notes.length || b.latest - a.latest,
    }[notesState.sort];

    list.innerHTML = [...groups.values()].sort(order).map(g => {
      const s = seriesById.get(g.seriesId);
      // Reading order: chapter, then chapter notes first, then position in the text.
      g.notes.sort((a, b) => chapterNum(a) - chapterNum(b)
        || (a.sp ?? -1) - (b.sp ?? -1) || (a.so ?? 0) - (b.so ?? 0));
      return `<section class="note-series" aria-label="${esc(seriesName(g.seriesId))}">
        <div class="note-series-head">
          ${s ? coverHtml(s) : ''}
          <h2>${esc(seriesName(g.seriesId))}</h2>
          <span>${plural(g.notes.length, 'note')}</span>
        </div>
        ${g.notes.map(n => noteCardHtml(n, tagsById, {
          chapter: `Ch. ${fmtNum(chapterById.get(n.chapterId)?.number)}`,
        })).join('')}
      </section>`;
    }).join('');
  };
  draw();

  const rerender = () => renderNotes(app, navHtml, coverHtml);
  const search = app.querySelector('#notes-search');
  if (search) {
    search.addEventListener('input', () => { notesState.query = search.value; draw(); });
    if (!notesState.query) search.focus();
  }

  app.querySelector('main').addEventListener('click', e => {
    const chip = e.target.closest('[data-ntag]');
    if (chip) {
      notesState.filter = chip.dataset.ntag === 'all' ? 'all' : Number(chip.dataset.ntag);
      app.querySelectorAll('[data-ntag]').forEach(b => b.setAttribute('aria-pressed', String(b === chip)));
      draw();
      return;
    }
    const act = e.target.closest('[data-nt]');
    if (act?.dataset.nt === 'search') {
      notesState.searchOpen = !notesState.searchOpen;
      if (!notesState.searchOpen) notesState.query = '';
      rerender();
      return;
    }
    if (act?.dataset.nt === 'tags') { openTagManager(rerender); return; }
    if (act?.dataset.nt === 'sort') { openNotesSort(rerender); return; }
    const card = e.target.closest('[data-note-id]');
    if (card) {
      const note = allNotes.find(n => n.id === Number(card.dataset.noteId));
      if (note) {
        openNoteCard(note.id, {
          where: `${seriesName(note.seriesId)} · Ch. ${fmtNum(chapterById.get(note.chapterId)?.number)}`,
          onChanged: rerender,
          inNotesTab: true,
        });
      }
    }
  });
}

function openNotesSort(onChanged) {
  openSheet(`
    <h2>Sort series by</h2>
    <div class="option-list" role="radiogroup" aria-label="Sort notes">
      ${Object.entries(NOTE_SORTS).map(([k, label]) => `
        <label class="option-row${notesState.sort === k ? ' is-on' : ''}">
          <span class="txt">${label}</span>
          <input type="radio" name="nsort" value="${k}" ${notesState.sort === k ? 'checked' : ''}>
        </label>`).join('')}
    </div>
    <p class="hint">Inside each series, notes are always in reading order.</p>`, sheet => {
    sheet.addEventListener('change', e => {
      if (e.target.name !== 'nsort') return;
      notesState.sort = e.target.value;
      try { localStorage.setItem(SORT_KEY, notesState.sort); } catch { /* ignore */ }
      closeOverlay();
      onChanged();
    });
  });
}

/* ------------------------------------------------------------------ tag manager */

export async function openTagManager(onChanged) {
  let tags = await db.getAllTags();
  const allNotes = await db.getAllNotes();
  const counts = new Map();
  for (const n of allNotes) for (const id of n.tagIds || []) counts.set(id, (counts.get(id) || 0) + 1);
  let openId = null; // tag whose color palette is open

  const rowsHtml = () => tags.map(t => `
    <div class="tag-item">
      <div class="tag-row" data-row="${t.id}">
        <button type="button" class="tag-color" data-pick="${t.id}" aria-expanded="${openId === t.id}"
          aria-label="Change color of ${esc(t.name)}" style="background:${tagColor(t.color)}"></button>
        <label class="tag-name"><span class="visually-hidden">Tag name</span>
          <input type="text" value="${esc(t.name)}" data-rename="${t.id}" maxlength="30" autocomplete="off"></label>
        <span class="tag-count">${counts.get(t.id) || 0}</span>
        <button type="button" class="icon-btn tag-del" data-del="${t.id}" aria-label="Delete ${esc(t.name)}">${I.trashSm}</button>
      </div>
      ${openId === t.id ? paletteHtml(t.color, `data-for="${t.id}"`) : ''}
    </div>`).join('');

  openSheet(`
    <h2>Tags</h2>
    <p class="hint">Tap a color dot to choose from 12 colors. Deleting a tag keeps the notes; they just lose that tag.</p>
    <div class="tag-rows">${rowsHtml()}</div>
    <div class="tag-row is-add">
      <span class="tag-color" style="background:var(--surface-3)"></span>
      <label class="tag-name"><span class="visually-hidden">New tag name</span>
        <input type="text" id="add-tag" placeholder="New tag" maxlength="30" autocomplete="off"></label>
      <button type="button" class="btn btn-accent" data-add style="height:40px;padding:0 14px;font-size:14px">Add</button>
    </div>`, sheet => {
    const rows = sheet.querySelector('.tag-rows');
    const redraw = () => { rows.innerHTML = rowsHtml(); };

    const add = async () => {
      const input = sheet.querySelector('#add-tag');
      const name = input.value.replace(/\s+/g, ' ').trim();
      if (!name) { input.focus(); return; }
      if (tags.some(t => t.name.toLowerCase() === name.toLowerCase())) { toast('That tag already exists'); return; }
      const tag = await db.addTag(name, nextTagColor(tags));
      tags = [...tags, tag];
      input.value = '';
      redraw();
      onChanged?.();
    };

    sheet.addEventListener('click', async e => {
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        const id = Number(pick.dataset.pick);
        openId = openId === id ? null : id;
        redraw();
        return;
      }
      const sw = e.target.closest('[data-color][data-for]');
      if (sw) {
        const t = tags.find(x => x.id === Number(sw.dataset.for));
        t.color = sw.dataset.color;
        await db.updateTag(t.id, { color: t.color });
        openId = null;
        redraw();
        onChanged?.();
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del) {
        if (!del.classList.contains('confirm')) {
          del.classList.add('confirm');
          del.innerHTML = `${I.trashSm}<span>Delete?</span>`;
          return;
        }
        const id = Number(del.dataset.del);
        await db.deleteTag(id);
        tags = tags.filter(t => t.id !== id);
        redraw();
        onChanged?.();
        return;
      }
      if (e.target.closest('[data-add]')) add();
    });
    sheet.addEventListener('change', async e => {
      const id = e.target.dataset.rename;
      if (id == null) return;
      const name = e.target.value.replace(/\s+/g, ' ').trim();
      const t = tags.find(x => x.id === Number(id));
      if (!name) { e.target.value = t.name; return; }
      t.name = name;
      await db.updateTag(t.id, { name });
      onChanged?.();
    });
    sheet.querySelector('#add-tag').addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  });
}
