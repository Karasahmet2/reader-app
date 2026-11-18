// notes.js — notes, highlights and tags.
//
//  • Reader: text selection bar (Note · Highlight · Copy), colored marks in the
//    text, note cards, the chapter's notes list.
//  • Notes tab: every note grouped by series and chapter, tag filters, search.
//  • Tag manager: add, rename, recolor and delete tags.

import * as db from './db.js';
import { TAG_PALETTE, OLD_TAG_COLORS } from './settings.js';
import { esc, fmtNum, plural, short, I, svg, toast, openSheet, closeOverlay, replaceHash, enterPageMode, exitPageMode, inPageMode, onLongPress } from './ui.js';
import { openFind } from './find.js';
import { trashNotes, trashTag } from './trash.js';
import { isSingleWord } from './dictionary.js';

const CODEX_SM = svg('<path d="M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/><circle cx="12" cy="8.5" r="2"/>', 18);

export const TAG_COLORS = Object.keys(TAG_PALETTE); // 12 colors

/** A color for a new tag: the first one no tag uses yet, otherwise the least used. */
export function nextTagColor(tags) {
  const used = new Map(TAG_COLORS.map(c => [c, 0]));
  for (const t of tags) if (used.has(t.color)) used.set(t.color, used.get(t.color) + 1);
  return [...used.entries()].sort((a, b) => a[1] - b[1])[0][0];
}

/** The 12-color picker. `extra` adds attributes to each button (e.g. which tag it's for). */
function paletteHtml(selected, extra = '', used = new Set()) {
  return `<div class="palette" role="group" aria-label="Tag color">
    ${TAG_COLORS.map(c => `<button type="button" data-color="${c}" ${extra} aria-label="${TAG_PALETTE[c].label}${used.has(c) ? ' (in use)' : ''}" aria-pressed="${c === selected}"${used.has(c) ? ' class="is-used"' : ''}>
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


/** Update 5: tags belong to one series, or are shared by all (seriesId null).
 *  Existing tags: words like Vocabulary, Sayings, Likes become shared; a tag used in
 *  only one series goes to that series; anything else stays shared so nothing is lost. */
const SHARED_NAMES = /^(vocab|saying|like|quote|word|idiom|phrase|expression)/i;
export async function migrateTagScopes() {
  const tags = await db.getAllTags();
  const todo = tags.filter(t => t.seriesId === undefined);
  if (!todo.length) return 0;
  const users = new Map();
  for (const note of await db.getAllNotes()) {
    for (const id of note.tagIds || []) {
      if (!users.has(id)) users.set(id, new Set());
      users.get(id).add(note.seriesId);
    }
  }
  for (const t of todo) {
    const used = users.get(t.id);
    const seriesId = !SHARED_NAMES.test(t.name) && used?.size === 1 ? [...used][0] : null;
    await db.updateTag(t.id, { seriesId });
  }
  return todo.length;
}

/** This series' own Vocabulary tag, if it has one ("Save as vocabulary note" picks it). */
export async function vocabularyTag(seriesId) {
  const tags = await db.getAllTags();
  return tags.find(t => t.seriesId === seriesId && /^vocab/i.test(t.name)) || null;
}

/** Update 10: no shared tags any more. Each shared tag is copied into every series whose
 *  notes use it (so no note loses a tag); shared tags nobody uses are removed. */
export async function migrateNoShared() {
  const shared = (await db.getAllTags()).filter(t => t.seriesId == null);
  if (!shared.length) return 0;
  const notes = await db.getAllNotes();
  for (const t of shared) {
    const users = [...new Set(notes.filter(n => n.tagIds?.includes(t.id)).map(n => n.seriesId))];
    if (users.length) await db.moveTag(t.id, users[0]); // leaves a copy in every other series that uses it
    else await db.deleteTag(t.id);
  }
  return shared.length;
}

/** The tags a note in this series can use (every tag belongs to one series). */
export const tagsFor = (tags, seriesId) => ({
  own: tags.filter(t => t.seriesId === seriesId && seriesId != null),
  shared: [],
});

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
  // Longest first, so a word note inside a sentence note is drawn inside it (and gets the lower line).
  const placed = noteList.map(note => ({ note, loc: locate(note, paras) })).filter(x => x.loc)
    .sort((a, b) => ((b.loc.ep - b.loc.sp) - (a.loc.ep - a.loc.sp)) || ((b.loc.eo - b.loc.so) - (a.loc.eo - a.loc.so)));
  for (const { note, loc } of placed) {
    const firstTag = tagsOf(note, tagsById)[0];
    const color = firstTag ? tagColor(firstTag.color) : 'var(--accent)';
    const kind = note.text || firstTag ? 'is-note' : 'is-highlight';
    for (let i = loc.sp; i <= loc.ep; i++) {
      const len = paras[i].textContent.length;
      wrap(paras[i], i === loc.sp ? loc.so : 0, i === loc.ep ? loc.eo : len, note, color, kind);
    }
  }
  // Notes inside notes: each underline sits a little lower than the one around it.
  for (const p of paras) {
    p.querySelectorAll('mark.note-mark.is-note').forEach(m => {
      let depth = 0;
      for (let a = m.parentElement; a && a !== p; a = a.parentElement) if (a.matches('mark.note-mark.is-note')) depth++;
      if (depth) m.dataset.depth = String(Math.min(depth, 2));
    });
  }
}

/** Every note at a tapped spot (innermost first). */
export function notesAt(target) {
  const ids = [];
  for (let m = target.closest('mark.note-mark'); m; m = m.parentElement?.closest('mark.note-mark')) {
    const id = Number(m.dataset.note);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** "2 notes here": pick which of the overlapping notes to open. */
export async function openNotesHere(ids, onPick) {
  const all = await db.getAllNotes();
  const tagsById = byId(await db.getAllTags());
  const list = ids.map(id => all.find(n => n.id === id)).filter(Boolean);
  openSheet(`<h2>${plural(list.length, 'note')} here</h2>
    <div class="here-list">${list.map(n => {
      const t = tagsOf(n, tagsById)[0];
      return `<button type="button" class="here-row" data-here="${n.id}" style="--mc:${t ? tagColor(t.color) : 'var(--accent)'}">
        <span class="txt"><b>${esc(short(n.quote || 'Chapter note', 60))}</b>${n.text ? `<span>${esc(short(n.text.split('\n')[0], 90))}</span>` : ''}
          <small>${t ? esc(t.name) : 'Highlight'} · ${n.quote && n.quote.split(/\s+/).length <= 3 ? 'the word' : 'the passage'}</small></span>${I.chevron}</button>`;
    }).join('')}</div>`, sheet => {
    sheet.addEventListener('click', e => {
      const b = e.target.closest('[data-here]');
      if (!b) return;
      onPick(Number(b.dataset.here)); // the note card replaces this sheet (no extra back step)
    });
  });
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
 * Show the Note · Define · Codex · Mark · Find · Copy bar while text is selected in the reader.
 * onAction(action, selection) is called when a button is tapped. Returns a cleanup function.
 */
export function setupSelectionBar(textEl, paras, onAction) {
  const bar = document.createElement('div');
  bar.className = 'sel-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Selected text');
  bar.innerHTML = `
    <button type="button" class="sel-main" data-sel="note">${I.note}<span>Note</span></button>
    <button type="button" class="sel-define" data-sel="define">${I.book}<span>Define</span></button>
    <button type="button" class="sel-codex" data-sel="codex">${CODEX_SM}<span>Codex</span></button>
    <button type="button" data-sel="highlight" aria-label="Highlight">${I.highlight}<span>Mark</span></button>
    <button type="button" data-sel="find" aria-label="Find uses">${I.searchSm}<span>Find</span></button>
    <button type="button" data-sel="copy" aria-label="Copy">${I.copy}<span>Copy</span></button>`;
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
      bar.classList.toggle('is-word', isSingleWord(info.quote)); // Define: single words only
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
  const series = await db.getSeries(note.seriesId);
  const selected = new Set(note.tagIds || []);
  const isNew = note.id == null;

  // Colors already taken in this series (fainter in the picker).
  const usedColors = () => new Set(tagsFor(tags, note.seriesId).own.map(t => t.color));
  const freshColor = () => {
    const used = usedColors();
    return TAG_COLORS.find(c => !used.has(c)) || nextTagColor(tags);
  };
  let newColor = freshColor();

  const chip = t => `<button type="button" class="tag-chip" data-tag="${t.id}" aria-pressed="${selected.has(t.id)}"
      style="--tc:${tagColor(t.color)};--tb:${tagBg(t.color)}">
      <span class="tick">${I.checkSm}</span><i></i>${esc(t.name)}</button>`;
  const chipsHtml = () => {
    const { own } = tagsFor(tags, note.seriesId);
    return `
      <div class="tag-group">
        <p class="tag-group-head"><b>Tags</b><span>${esc(series?.name || 'This series')}</span></p>
        <div class="tag-chips">${own.map(chip).join('')}
          <button type="button" class="tag-chip tag-new" data-newtag>${I.plusSm}New tag</button></div>
      </div>`;
  };

  const newTagHtml = () => `
    <div class="new-tag" hidden>
      <input class="text-input" id="new-tag-name" type="text" placeholder="Tag name" maxlength="30" autocomplete="off">
      <div class="new-tag-palette">${paletteHtml(newColor, '', usedColors())}</div>
      <button type="button" class="btn btn-accent" data-addtag>Add tag</button>
    </div>`;

  const quoteHtml = note.quote
    ? `<figure class="quote"><blockquote>${esc(short(note.quote, 400))}</blockquote><figcaption>${esc(where)}</figcaption></figure>`
    : `<figure class="quote is-chapter"><figcaption>Chapter note · ${esc(where)}</figcaption></figure>`;

  openSheet(`
    <h2>${isNew ? (note.quote ? 'Add note' : 'Add chapter note') : 'Edit note'}</h2>
    ${quoteHtml}
    <div class="field">
      <div class="tag-groups">${chipsHtml()}</div>
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
    const groups = sheet.querySelector('.tag-groups');
    const newRow = sheet.querySelector('.new-tag');
    const nameInput = sheet.querySelector('#new-tag-name');
    const drawPalette = () => {
      sheet.querySelector('.new-tag-palette').innerHTML = paletteHtml(newColor, '', usedColors());
    };
    if (!note.quote) sheet.querySelector('#note-text').focus();

    const addTag = async () => {
      const name = nameInput.value.replace(/\s+/g, ' ').trim();
      if (!name) { nameInput.focus(); return; }
      const { own } = tagsFor(tags, note.seriesId);
      const existing = own.find(t => t.name.toLowerCase() === name.toLowerCase());
      const tag = existing || await db.addTag(name, newColor, note.seriesId);
      if (!existing) tags = [...tags, tag];
      selected.add(tag.id);
      groups.innerHTML = chipsHtml();
      nameInput.value = '';
      newRow.hidden = true;
      newColor = freshColor();
      drawPalette();
    };

    sheet.addEventListener('click', async e => {
      const c = e.target.closest('[data-tag]');
      if (c) {
        const id = Number(c.dataset.tag);
        if (selected.has(id)) selected.delete(id); else selected.add(id);
        c.setAttribute('aria-pressed', String(selected.has(id)));
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
        drawPalette();
        return;
      }
      if (e.target.closest('[data-addtag]')) { addTag(); return; }
      const act = e.target.closest('[data-ne]');
      if (!act) return;
      if (act.dataset.ne === 'cancel') { closeOverlay(); return; }
      const text = sheet.querySelector('#note-text').value.trim();
      if (!note.quote && !text) { toast('Write something first'); return; }
      const savedId = await db.putNote({ ...note, text, tagIds: [...selected] });
      closeOverlay();
      // onSaved may return a message to show instead (e.g. "this note stays visible…").
      const msg = await onSaved?.({ ...note, id: savedId, text, tagIds: [...selected] }, isNew);
      toast(typeof msg === 'string' ? msg : (isNew ? 'Note saved' : 'Note updated'));
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
        closeOverlay();
        await trashNotes([note], { onUndone: ctx.onChanged });
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
const SERIES_KEY = 'reader-notes-series';
const savedSort = () => { try { return localStorage.getItem(SORT_KEY); } catch { return null; } };
const savedSeries = () => {
  try { const v = localStorage.getItem(SERIES_KEY); return v && v !== 'all' ? Number(v) : 'all'; } catch { return 'all'; }
};
const saveSeriesChoice = v => { try { localStorage.setItem(SERIES_KEY, String(v)); } catch { /* ignore */ } };

const seriesTabs = new Map();
/** Filter state for the Notes tab on a series page (one per series, kept while the app is open). */
function seriesTabState(seriesId) {
  if (!seriesTabs.has(seriesId)) seriesTabs.set(seriesId, { filter: 'all', query: '', searchOpen: false, sort: 'recent' });
  return seriesTabs.get(seriesId);
}

export const notesState = {
  filter: 'all',
  query: '',
  searchOpen: false,
  sort: NOTE_SORTS[savedSort()] ? savedSort() : 'recent',
  seriesId: savedSeries(), // 'all' or one series' id
};

/**
 * Draw the Notes tab into `app`: one series (with its own tags and the shared ones),
 * or all series (shared tags only), in reading order inside each series.
 * navHtml: the bottom navigation. coverHtml(series): a tiny cover for headers.
 * openSeriesId: from #/notes/ID — start on that series.
 */
export async function renderNotes(app, navHtml, coverHtml = () => '', openSeriesId = null, fixed = null) {
  if (nsel && !inPageMode()) nsel = null; // left the page while selecting
  // fixed = { seriesId, root }: draw just this series' notes inside the series page.
  const st = fixed ? seriesTabState(fixed.seriesId) : notesState;
  const [everyNote, tags, chapters, series] = await Promise.all([
    db.getAllNotes(), db.getAllTags(), db.getAllChapters(), db.getAllSeries(),
  ]);
  const tagsById = byId(tags);
  const chapterById = byId(chapters);
  const seriesById = byId(series);
  if (openSeriesId != null && seriesById.has(openSeriesId)) {
    notesState.seriesId = openSeriesId;
    saveSeriesChoice(openSeriesId);
  }
  if (notesState.seriesId !== 'all' && !seriesById.has(notesState.seriesId)) notesState.seriesId = 'all';
  const one = fixed ? seriesById.get(fixed.seriesId)
    : notesState.seriesId !== 'all' ? seriesById.get(notesState.seriesId) : null;
  const allNotes = one ? everyNote.filter(n => n.seriesId === one.id) : everyNote;
  const { own } = tagsFor(tags, one?.id ?? null);
  // All series: one chip per tag name ("Vocabulary" gathers every series' Vocabulary notes).
  const byName = new Map();
  if (!one) {
    for (const t of tags) {
      const k = `n:${t.name.toLowerCase()}`;
      const g = byName.get(k) || { id: k, name: t.name, color: t.color, ids: new Set() };
      g.ids.add(t.id);
      byName.set(k, g);
    }
  }
  const chipTags = one ? own : [...byName.values()];
  if (st.filter !== 'all' && !chipTags.some(t => t.id === st.filter)) st.filter = 'all';
  const filterIdsNow = () => st.filter === 'all' ? null
    : typeof st.filter === 'string' ? byName.get(st.filter)?.ids : new Set([st.filter]);

  // Chapter range (series page): all, up to where you are, from–to, or one chapter.
  const seriesChapters = one ? chapters.filter(c => c.seriesId === one.id).map(c => c.number).sort((a, b) => a - b) : [];
  let progressAt = Infinity;
  if (fixed) {
    const ids = new Map(chapters.filter(c => c.seriesId === one.id).map(c => [c.id, c.number]));
    let max = 0;
    for (const c of chapters) if (c.seriesId === one.id && c.read) max = Math.max(max, c.number);
    for (const p of await db.getAllProgress()) if (ids.has(p.chapterId)) max = Math.max(max, ids.get(p.chapterId));
    progressAt = max || Infinity;
  }
  const range = fixed ? (st.range ||= { mode: 'all' }) : { mode: 'all' };
  const inRange = num => {
    if (range.mode === 'upto') return num <= progressAt;
    if (range.mode === 'range') return num >= range.from && num <= range.to;
    if (range.mode === 'one') return num === range.at;
    return true;
  };
  const rangeLabel = () => ({
    all: 'All chapters',
    upto: `Up to Ch. ${fmtNum(progressAt)}`,
    range: `Ch. ${fmtNum(range.from)}–${fmtNum(range.to)}`,
    one: `Ch. ${fmtNum(range.at)}`,
  }[range.mode]);
  const scoped = fixed ? allNotes.filter(n => inRange(chapterById.get(n.chapterId)?.number ?? Infinity)) : allNotes;

  const counts = new Map();
  for (const n of scoped) {
    for (const id of n.tagIds || []) {
      counts.set(id, (counts.get(id) || 0) + 1);
      const t = tagsById.get(id);
      if (!one && t) { const k = `n:${t.name.toLowerCase()}`; counts.set(k, (counts.get(k) || 0) + 1); }
    }
  }
  const chipHtml = t => `<button type="button" data-ntag="${esc(String(t.id))}" aria-pressed="${st.filter === t.id}">
    <i class="chip-dot" style="background:${tagColor(t.color)}"></i>${esc(t.name)}${counts.get(t.id) ? ` <span class="count">${counts.get(t.id)}</span>` : ''}</button>`;

  const chipsHtml = `    <nav class="filter-chips" aria-label="Filter by tag">
      ${fixed ? `<button type="button" class="range-chip${range.mode === 'all' ? '' : ' is-on'}" data-nt="range">${I.sort}${rangeLabel()}${I.down}</button>
        <span class="chip-sep" aria-hidden="true"></span>` : ''}
      <button type="button" data-ntag="all" aria-pressed="${st.filter === 'all'}">All${scoped.length ? ` <span class="count">${scoped.length}</span>` : ''}</button>
      ${chipTags.map(chipHtml).join('')}
    </nav>
    <div class="pick-bar notes-selbar" hidden>
      <button type="button" class="icon-btn" data-nsel="exit" aria-label="Stop selecting">${svg('<path d="M6 6l12 12M18 6L6 18"/>', 20, 2)}</button>
      <span class="txt"><b id="nsel-count">Select notes</b></span>
      <button type="button" class="chip" data-nsel="all">Select all</button>
    </div>
    <div class="list-meta">
      <span id="notes-count"></span>
      <button type="button" class="sort-btn nsel-start" data-nsel="start">${svg('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12l2.5 2.5 4.5-5"/>', 16, 2)} Select</button>
      ${fixed ? `<button type="button" class="sort-btn" data-nt="tags">${I.tag} Tags</button>`
        : one ? '<span>Reading order</span>' : `<button type="button" class="sort-btn" data-nt="sort">${I.sort}${NOTE_SORTS[st.sort]}</button>`}
    </div>
    <div id="notes-list" class="notes-groups"></div>
    <div class="sel-actions is-floating notes-selacts" hidden>
      <button type="button" class="btn" data-nsel="tag">${I.tag} Tag</button>
      <button type="button" class="btn sel-del" data-nsel="delete">${I.trashSm} Delete</button>
    </div>
`;
  if (fixed) {
    fixed.root.innerHTML = `<div class="series-notes">${chipsHtml}</div>`;
  } else {
    app.innerHTML = `<main class="page">
    <div class="row-head">
      <a class="icon-btn notes-back" href="#/" data-back aria-label="Back">${I.back}</a>
      <h1 class="page-title">Notes</h1>
      <button type="button" class="icon-btn" data-nt="search" aria-label="Search notes" aria-expanded="${st.searchOpen}">${I.search}</button>
      <button type="button" class="icon-btn" data-nt="tags" aria-label="Manage tags">${I.tag}</button>
    </div>
    ${st.searchOpen ? `<label class="search-box">${I.search}
      <span class="visually-hidden">Search notes</span>
      <input id="notes-search" type="search" placeholder="Search words, notes, tags" value="${esc(st.query)}" autocomplete="off">
    </label>` : ''}
    <button type="button" class="series-pick" data-nt="series">
      ${one ? coverHtml(one) : `<span class="series-pick-ico">${I.notes}</span>`}
      <span class="txt"><b>${one ? esc(one.name) : 'All series'}</b>
        <small>${plural(allNotes.length, 'note')}${one ? ` · ${plural(own.length, 'series tag')}` : ` · ${plural(new Set(everyNote.map(n => n.seriesId)).size, 'series', 'series')}`}</small></span>
      ${I.down}
    </button>
    ${chipsHtml}
  </main>${navHtml}`;
  }
  const host = fixed ? fixed.root : app;

  const seriesName = id => seriesById.get(id)?.name || 'Unknown series';
  const chapterNum = n => chapterById.get(n.chapterId)?.number ?? Infinity;

  let lastShown = [];
  const draw = () => {
    const q = st.query.trim().toLowerCase();
    const filterIds = filterIdsNow();
    const shown = scoped.filter(n => {
      if (filterIds && !(n.tagIds || []).some(id => filterIds.has(id))) return false;
      if (!st.searchOpen || !q) return true;
      const hay = [n.quote, n.text, seriesName(n.seriesId),
        ...(n.tagIds || []).map(id => tagsById.get(id)?.name)].join(' ').toLowerCase();
      return hay.includes(q);
    });

    const list = host.querySelector('#notes-list');
    const groups = new Map();
    for (const n of shown) {
      const g = groups.get(n.seriesId) || { seriesId: n.seriesId, notes: [], latest: 0 };
      g.notes.push(n);
      g.latest = Math.max(g.latest, n.updatedAt || 0);
      groups.set(n.seriesId, g);
    }
    lastShown = shown;
    if (nsel) for (const id of [...nsel.ids]) if (!allNotes.some(n => n.id === id)) nsel.ids.delete(id);
    drawSelect();
    host.querySelector('#notes-count').textContent = one
      ? `${plural(shown.length, 'note')}${fixed && range.mode !== 'all' ? ` · ${rangeLabel()}` : ''}`
      : `${groups.size} series · ${plural(shown.length, 'note')}`;

    if (!shown.length) {
      list.innerHTML = `<div class="empty" style="padding:40px 16px">
        ${allNotes.length
          ? `<span>No notes match${q && st.searchOpen ? ` “${esc(st.query)}”` : ' this tag'}.</span>`
          : `<span class="empty-ico">${I.notes}</span><strong>No notes yet</strong>
             <span>${one ? `No notes in ${esc(one.name)} yet. ` : ''}While reading, long-press a word or drag across a passage, then tap Note. For a note about the whole chapter, tap the page → Notes.</span>`}
      </div>`;
      return;
    }

    const order = {
      recent: (a, b) => b.latest - a.latest,
      series: (a, b) => seriesName(a.seriesId).localeCompare(seriesName(b.seriesId), undefined, { sensitivity: 'base', numeric: true }),
      count: (a, b) => b.notes.length - a.notes.length || b.latest - a.latest,
    }[st.sort];

    list.innerHTML = [...groups.values()].sort(order).map(g => {
      const s = seriesById.get(g.seriesId);
      // Reading order: chapter, then chapter notes first, then position in the text.
      g.notes.sort((a, b) => chapterNum(a) - chapterNum(b)
        || (a.sp ?? -1) - (b.sp ?? -1) || (a.so ?? 0) - (b.so ?? 0));
      return `<section class="note-series" aria-label="${esc(seriesName(g.seriesId))}">
        <div class="note-series-head"${one ? ' hidden' : ''}>
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
  /* select mode (long-press a note, or "Select") */
  function drawSelect() {
    const on = !!nsel;
    const n = nsel?.ids.size || 0;
    host.querySelector('.notes-selbar').hidden = !on;
    host.querySelector('.notes-selacts').hidden = !on;
    host.querySelector('.nsel-start').hidden = on || !lastShown.length;
    (fixed ? host.querySelector('.series-notes') : host.querySelector('main')).classList.toggle('is-selecting', on);
    if (!on) return;
    host.querySelector('#nsel-count').textContent = n ? `${n} selected` : 'Select notes';
    const allOn = lastShown.length && lastShown.every(x => nsel.ids.has(x.id));
    host.querySelector('[data-nsel="all"]').textContent = allOn ? 'Select none' : `Select all ${lastShown.length}`;
    const del = host.querySelector('[data-nsel="delete"]');
    del.disabled = !n;
    del.innerHTML = `${I.trashSm} Delete${n ? ` ${n}` : ''}`;
    const picked = allNotes.filter(x => nsel.ids.has(x.id));
    host.querySelector('[data-nsel="tag"]').disabled = !n || new Set(picked.map(x => x.seriesId)).size > 1;
  }
  const markCards = () => {
    host.querySelectorAll('#notes-list [data-note-id]').forEach(el => {
      const on = !!nsel?.ids.has(Number(el.dataset.noteId));
      el.classList.toggle('is-picked', on);
      el.setAttribute('aria-pressed', nsel ? String(on) : 'false');
      el.querySelector('.sel-box')?.remove();
      if (nsel) el.insertAdjacentHTML('beforeend', `<span class="sel-box${on ? ' is-on' : ''}" aria-hidden="true">${on ? svg('<path d="M5 12l5 5 9-10"/>', 13, 3) : ''}</span>`);
    });
  };
  const startSelect = id => {
    if (!nsel) {
      nsel = { ids: new Set() };
      enterPageMode(() => { nsel = null; nselRedraw?.(); });
    }
    if (id != null) nsel.ids.add(id);
    drawSelect();
    markCards();
  };
  nselRedraw = () => { drawSelect(); markCards(); };
  draw();
  markCards();
  onLongPress(host.querySelector('#notes-list'), '[data-note-id]', el => startSelect(Number(el.dataset.noteId)));

  const rerender = () => renderNotes(app, navHtml, coverHtml, null, fixed);
  const pickSeries = () => {
    const noteCount = new Map();
    for (const n of everyNote) noteCount.set(n.seriesId, (noteCount.get(n.seriesId) || 0) + 1);
    const list = [...series].sort((a, b) => (noteCount.get(b.id) || 0) - (noteCount.get(a.id) || 0)
      || (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0));
    const row = (value, ico, name, sub) => `
      <button type="button" class="pick-row${notesState.seriesId === value ? ' is-on' : ''}" data-pick-series="${value}">
        ${ico}<span class="txt"><b>${esc(name)}</b><small>${sub}</small></span>${notesState.seriesId === value ? I.check : ''}
      </button>`;
    openSheet(`
      <h2>Show notes from</h2>
      <div class="pick-list">
        ${row('all', `<span class="series-pick-ico">${I.notes}</span>`, 'All series', `${plural(everyNote.length, 'note')}, grouped by series`)}
        ${list.map(s => row(s.id, coverHtml(s), s.name, plural(noteCount.get(s.id) || 0, 'note'))).join('')}
      </div>
      <p class="hint tip">A series page’s menu → Notes & tags opens straight to that series.</p>`, sheet => {
      sheet.addEventListener('click', e => {
        const b = e.target.closest('[data-pick-series]');
        if (!b) return;
        const v = b.dataset.pickSeries;
        notesState.seriesId = v === 'all' ? 'all' : Number(v);
        st.filter = 'all';
        saveSeriesChoice(notesState.seriesId);
        closeOverlay();
        rerender();
      });
    });
  };
  const search = host.querySelector('#notes-search');
  if (search) {
    search.addEventListener('input', () => { st.query = search.value; draw(); });
    if (!st.query) search.focus();
  }

  host.querySelector(fixed ? '.series-notes' : 'main').addEventListener('click', async e => {
    const ns = e.target.closest('[data-nsel]');
    if (ns) {
      const a = ns.dataset.nsel;
      if (a === 'start') startSelect(null);
      if (a === 'exit') exitPageMode();
      if (a === 'all') {
        const allOn = lastShown.every(x => nsel.ids.has(x.id));
        nsel.ids = allOn ? new Set() : new Set(lastShown.map(x => x.id));
        drawSelect(); markCards();
      }
      if (a === 'delete' && nsel?.ids.size) {
        const picked = allNotes.filter(x => nsel.ids.has(x.id));
        await trashNotes(picked, { onUndone: rerender });
        nsel = null;
        exitPageMode();
        rerender();
      }
      if (a === 'tag' && nsel?.ids.size) {
        const picked = allNotes.filter(x => nsel.ids.has(x.id));
        openBulkTags(picked, () => rerender());
      }
      return;
    }
    if (nsel) {
      const c = e.target.closest('[data-note-id]');
      if (c) {
        const id = Number(c.dataset.noteId);
        if (nsel.ids.has(id)) nsel.ids.delete(id); else nsel.ids.add(id);
        drawSelect(); markCards();
      }
      return;
    }
    const chip = e.target.closest('[data-ntag]');
    if (chip) {
      const v = chip.dataset.ntag;
      st.filter = v === 'all' ? 'all' : v.startsWith('n:') ? v : Number(v);
      host.querySelectorAll('[data-ntag]').forEach(b => b.setAttribute('aria-pressed', String(b === chip)));
      draw();
      return;
    }
    const act = e.target.closest('[data-nt]');
    if (act?.dataset.nt === 'search') {
      st.searchOpen = !st.searchOpen;
      if (!st.searchOpen) st.query = '';
      rerender();
      return;
    }
    if (act?.dataset.nt === 'tags') {
      if (fixed) replaceHash(`#/series/${fixed.seriesId}/tags`);
      else openTagManager(rerender, one?.id ?? null);
      return;
    }
    if (act?.dataset.nt === 'series') { pickSeries(); return; }
    if (act?.dataset.nt === 'range') {
      openRangeSheet({ range, chapters: seriesChapters, progressAt, notes: allNotes.map(x => chapterById.get(x.chapterId)?.number ?? Infinity),
        onApply: r => { st.range = r; rerender(); } });
      return;
    }
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

let nsel = null; // notes list select mode: { ids: Set }
let nselRedraw = null;

/** Add or remove a tag on several notes (all from one series). */
async function openBulkTags(notes, onDone) {
  const sid = notes[0].seriesId;
  const tags = tagsFor(await db.getAllTags(), sid).own;
  const state = t => {
    const n = notes.filter(x => x.tagIds?.includes(t.id)).length;
    return n === notes.length ? 'all' : n ? 'some' : 'none';
  };
  const html = () => `<h2>Tag ${plural(notes.length, 'note')}</h2>
    ${tags.length ? `<div class="pick-list">${tags.map(t => {
      const st = state(t);
      return `<button type="button" class="pick-row bulk-tag" data-bt="${t.id}" aria-pressed="${st === 'all'}">
        <i class="vis-dot" style="background:${tagColor(t.color)}"></i><span class="txt"><b>${esc(t.name)}</b>
        <small>${st === 'all' ? 'On all of them — tap to take it off' : st === 'some' ? `On ${notes.filter(x => x.tagIds?.includes(t.id)).length} of them — tap to add to all` : 'Tap to add to all'}</small></span>
        ${st === 'all' ? I.check : st === 'some' ? '<span class="bulk-some" aria-hidden="true">–</span>' : ''}</button>`;
    }).join('')}</div>` : '<p class="hint">This series has no tags yet. Add them on the series page → Tags.</p>'}
    <button type="button" class="btn btn-accent" data-bt-done>Done</button>`;
  openSheet('<div class="bulk-box"></div>', sheet => {
    const box = sheet.querySelector('.bulk-box');
    box.innerHTML = html();
    box.addEventListener('click', async e => {
      if (e.target.closest('[data-bt-done]')) { closeOverlay(); onDone?.(); return; }
      const b = e.target.closest('[data-bt]');
      if (!b) return;
      const t = tags.find(x => x.id === Number(b.dataset.bt));
      const remove = state(t) === 'all';
      for (const n of notes) {
        const ids = new Set(n.tagIds || []);
        if (remove) ids.delete(t.id); else ids.add(t.id);
        n.tagIds = [...ids];
        await db.putNote(n);
      }
      toast(remove ? `“${t.name}” taken off` : `“${t.name}” added`);
      box.innerHTML = html();
    });
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
    <p class="hint tip">Inside each series, notes are always in reading order.</p>`, sheet => {
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

export async function openTagManager(onChanged, focusSeriesId = null) {
  let tags = await db.getAllTags();
  const [allNotes, series] = await Promise.all([db.getAllNotes(), db.getAllSeries()]);
  const seriesById = byId(series);
  let counts = new Map();
  const recount = notes => {
    counts = new Map();
    for (const n of notes) for (const id of n.tagIds || []) counts.set(id, (counts.get(id) || 0) + 1);
  };
  recount(allNotes);
  let openId = null;  // tag whose color palette is open
  let menuId = null;  // tag whose ⋯ actions are open
  let confirmId = null;

  // Groups: Shared, then the series you came from, then every other series that has tags.
  const groupIds = () => {
    const withTags = [...new Set(tags.filter(t => t.seriesId != null).map(t => t.seriesId))]
      .filter(id => seriesById.has(id))
      .sort((x, y) => seriesById.get(x).name.localeCompare(seriesById.get(y).name, undefined, { sensitivity: 'base', numeric: true }));
    const ids = focusSeriesId != null && seriesById.has(focusSeriesId) ? [focusSeriesId] : [];
    return [...ids, ...withTags.filter(id => id !== focusSeriesId)];
  };
  const inGroup = sid => tags.filter(t => (t.seriesId ?? null) === sid);

  const rowHtml = t => `
    <div class="tag-item">
      <div class="tag-row" data-row="${t.id}">
        <button type="button" class="tag-color" data-pick="${t.id}" aria-expanded="${openId === t.id}"
          aria-label="Change color of ${esc(t.name)}" style="background:${tagColor(t.color)}"></button>
        <label class="tag-name"><span class="visually-hidden">Tag name</span>
          <input type="text" value="${esc(t.name)}" data-rename="${t.id}" maxlength="30" autocomplete="off"></label>
        <span class="tag-count">${counts.get(t.id) || 0}</span>
        <button type="button" class="icon-btn tag-more" data-more="${t.id}" aria-expanded="${menuId === t.id}" aria-label="More for ${esc(t.name)}">${I.dots}</button>
      </div>
      ${openId === t.id ? paletteHtml(t.color, `data-for="${t.id}"`,
        new Set(tags.filter(x => x.id !== t.id && ((x.seriesId ?? null) === (t.seriesId ?? null) || x.seriesId == null)).map(x => x.color))) : ''}
      ${menuId === t.id ? `<div class="tag-actions">
        <button type="button" class="btn${confirmId === t.id ? ' is-confirm' : ''}" data-del="${t.id}">${I.trashSm}${confirmId === t.id ? 'Tap again to delete' : 'Delete'}</button>
      </div>` : ''}
    </div>`;

  const groupHtml = sid => {
    const list = inGroup(sid);
    const name = sid == null ? 'Shared' : seriesById.get(sid)?.name || 'Series';
    return `<section class="tag-section" data-group="${sid ?? 'shared'}">
      <p class="tag-group-head"><b>${esc(name)}</b><span>${sid == null ? 'every series' : plural(list.length, 'tag')}</span></p>
      ${list.map(rowHtml).join('')}
      <div class="tag-row is-add">
        <span class="tag-color" style="background:var(--surface-3)"></span>
        <label class="tag-name"><span class="visually-hidden">New tag in ${esc(name)}</span>
          <input type="text" data-add-in="${sid ?? 'shared'}" placeholder="${sid == null ? 'New shared tag' : 'New tag'}" maxlength="30" autocomplete="off"></label>
        <button type="button" class="btn btn-accent" data-add="${sid ?? 'shared'}" style="height:40px;padding:0 14px;font-size:14px">Add</button>
      </div>
    </section>`;
  };

  const notesTag = '<p class="hint tip">Every series has its own tags (also on each series page → Tags). Colors only need to differ within one series. ⋯ on a tag: delete it (its notes stay).</p>';

  openSheet(`<h2>Tags</h2>${notesTag}<div class="tag-sections"></div>`, sheet => {
    const box = sheet.querySelector('.tag-sections');
    const redraw = () => { box.innerHTML = groupIds().map(groupHtml).join(''); };
    redraw();
    const changed = async () => {
      tags = await db.getAllTags();
      recount(await db.getAllNotes());
      redraw();
      onChanged?.();
    };

    const add = async key => {
      const input = box.querySelector(`[data-add-in="${key}"]`);
      const sid = key === 'shared' ? null : Number(key);
      const name = input.value.replace(/\s+/g, ' ').trim();
      if (!name) { input.focus(); return; }
      const scope = sid == null ? inGroup(null) : [...inGroup(sid), ...inGroup(null)];
      if (scope.some(t => t.name.toLowerCase() === name.toLowerCase())) { toast('That tag already exists here'); return; }
      const used = new Set(scope.map(t => t.color));
      await db.addTag(name, TAG_COLORS.find(c => !used.has(c)) || nextTagColor(scope), sid);
      await changed();
      box.querySelector(`[data-add-in="${key}"]`)?.focus();
    };

    sheet.addEventListener('click', async e => {
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        const id = Number(pick.dataset.pick);
        openId = openId === id ? null : id;
        menuId = null;
        redraw();
        return;
      }
      const more = e.target.closest('[data-more]');
      if (more) {
        const id = Number(more.dataset.more);
        menuId = menuId === id ? null : id;
        openId = null;
        confirmId = null;
        redraw();
        return;
      }
      const sw = e.target.closest('[data-color][data-for]');
      if (sw) {
        await db.updateTag(Number(sw.dataset.for), { color: sw.dataset.color });
        openId = null;
        await changed();
        return;
      }
      const share = e.target.closest('[data-share]');
      if (share) {
        await db.moveTag(Number(share.dataset.share), null);
        menuId = null;
        toast('Now shared by every series');
        await changed();
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del) {
        const id = Number(del.dataset.del);
        const t = (await db.getAllTags()).find(x => x.id === id);
        if (t) await trashTag(t, { onUndone: changed });
        menuId = null;
        confirmId = null;
        await changed();
        return;
      }
      const addBtn = e.target.closest('[data-add]');
      if (addBtn) add(addBtn.dataset.add);
    });
    sheet.addEventListener('change', async e => {
      if (e.target.dataset.move) {
        const to = Number(e.target.value);
        if (!to) return;
        await db.moveTag(Number(e.target.dataset.move), to);
        menuId = null;
        toast(`Moved to ${seriesById.get(to)?.name || 'series'}`);
        await changed();
        return;
      }
      const id = e.target.dataset.rename;
      if (id == null) return;
      const name = e.target.value.replace(/\s+/g, ' ').trim();
      const t = tags.find(x => x.id === Number(id));
      if (!name) { e.target.value = t.name; return; }
      t.name = name;
      await db.updateTag(t.id, { name });
      onChanged?.();
    });
    sheet.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.dataset.addIn) add(e.target.dataset.addIn);
    });
    if (focusSeriesId != null) {
      requestAnimationFrame(() => box.querySelector(`[data-group="${focusSeriesId}"]`)?.scrollIntoView({ block: 'start' }));
    }
  });
}

/* ------------------------------------------------------------------ series page: Tags tab */

/** The Tags tab on a series page: this series' tags, with new / edit / delete. */
export async function renderTagsTab(root, seriesId) {
  const [tags, allNotes] = await Promise.all([db.getAllTags(), db.getAllNotes()]);
  const own = tagsFor(tags, seriesId).own.sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id));
  const counts = new Map();
  for (const n of allNotes) if (n.seriesId === seriesId) for (const id of n.tagIds || []) counts.set(id, (counts.get(id) || 0) + 1);
  const free = TAG_COLORS.length - new Set(own.map(t => t.color)).size;
  const redraw = () => renderTagsTab(root, seriesId);

  root.innerHTML = `<div class="tags-tab">
    <div class="list-meta"><span>${plural(own.length, 'tag')} · only in this series</span><span>${plural(Math.max(0, free), 'color')} free</span></div>
    <div class="tags-list">
      ${own.map(t => `<button type="button" class="tags-row" data-tag-edit="${t.id}">
        <span class="dot" style="background:${tagColor(t.color)}"></span>
        <span class="txt"><b>${esc(t.name)}</b><small>${plural(counts.get(t.id) || 0, 'note')}</small></span>
        ${I.pencilSm}</button>`).join('') || '<div class="empty" style="padding:24px 8px"><span>No tags yet. Make the ones this series needs — e.g. Characters, Plot, Vocabulary.</span></div>'}
    </div>
    <button type="button" class="tags-new" data-tag-new>${I.plus} New tag</button>
  </div>`;

  root.querySelector('.tags-tab').addEventListener('click', e => {
    const ed = e.target.closest('[data-tag-edit]');
    if (ed) { openTagEditor(seriesId, own.find(t => t.id === Number(ed.dataset.tagEdit)), counts, redraw); return; }
    if (e.target.closest('[data-tag-new]')) openTagEditor(seriesId, null, counts, redraw);
  });
}

/** New or edit tag: name and color (colors used by other tags of this series are faded). */
async function openTagEditor(seriesId, tag, counts, onDone) {
  const tags = tagsFor(await db.getAllTags(), seriesId).own;
  const used = new Set(tags.filter(t => t.id !== tag?.id).map(t => t.color));
  let color = tag?.color || TAG_COLORS.find(c => !used.has(c)) || nextTagColor(tags);
  let confirmDelete = false;
  const series = await db.getSeries(seriesId);
  const n = tag ? counts.get(tag.id) || 0 : 0;

  const html = () => `
    <h2>${tag ? 'Edit tag' : 'New tag'}</h2>
    <label class="field"><span class="label" style="padding:0">Name</span>
      <input class="text-input" id="tag-name" type="text" maxlength="30" value="${esc(tag?.name || '')}" placeholder="e.g. Characters" autocomplete="off"></label>
    <div class="field"><p class="tag-group-head"><b>Color</b><span>faded = used by another tag here</span></p>
      ${paletteHtml(color, '', used)}</div>
    ${tag ? `<p class="hint" style="margin:0">Used by ${plural(n, 'note')} in ${esc(series?.name || 'this series')}.</p>` : ''}
    <div class="two-btns">
      <button type="button" class="btn" data-te="cancel">Cancel</button>
      <button type="button" class="btn btn-accent" data-te="save">${tag ? 'Save' : 'Add tag'}</button>
    </div>
    ${tag ? `<button type="button" class="btn tag-delete${confirmDelete ? ' is-confirm' : ''}" data-te="delete">${I.trashSm} ${confirmDelete
      ? `Tap again — ${n ? `${plural(n, 'note')} keep their text` : 'delete'}` : 'Delete tag (its notes stay, without this tag)'}</button>` : ''}`;

  openSheet('<div class="tag-editor"></div>', sheet => {
    const box = sheet.querySelector('.tag-editor');
    const draw = () => {
      const name = box.querySelector('#tag-name')?.value;
      box.innerHTML = html();
      if (name != null) box.querySelector('#tag-name').value = name;
    };
    draw();
    if (!tag) box.querySelector('#tag-name').focus();
    box.addEventListener('click', async e => {
      const sw = e.target.closest('[data-color]');
      if (sw) { color = sw.dataset.color; draw(); return; }
      const b = e.target.closest('[data-te]');
      if (!b) return;
      if (b.dataset.te === 'cancel') { closeOverlay(); return; }
      if (b.dataset.te === 'delete') {
        closeOverlay();
        await trashTag(tag, { onUndone: onDone });
        onDone?.();
        return;
      }
      const name = box.querySelector('#tag-name').value.replace(/\s+/g, ' ').trim();
      if (!name) { box.querySelector('#tag-name').focus(); return; }
      if (tags.some(t => t.id !== tag?.id && t.name.toLowerCase() === name.toLowerCase())) { toast('This series already has that tag'); return; }
      if (tag) await db.updateTag(tag.id, { name, color });
      else await db.addTag(name, color, seriesId);
      toast(tag ? 'Tag saved' : 'Tag added');
      closeOverlay();
      onDone?.();
    });
    box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'tag-name') box.querySelector('[data-te="save"]').click(); });
  });
}

/* ------------------------------------------------------------------ reader: show / hide notes by tag */

const VIS_KEY = 'reader-hidden-tags';
function loadVis() { try { return JSON.parse(localStorage.getItem(VIS_KEY) || '{}'); } catch { return {}; } }

/** Which tags are hidden in the text for a series: { tags: Set(ids), highlights: true if highlights hidden }. */
export function hiddenIn(seriesId) {
  const v = loadVis()[seriesId] || {};
  return { tags: new Set(v.tags || []), highlights: !!v.highlights };
}
function saveHidden(seriesId, h) {
  const all = loadVis();
  if (!h.tags.size && !h.highlights) delete all[seriesId];
  else all[seriesId] = { tags: [...h.tags], highlights: h.highlights };
  try { localStorage.setItem(VIS_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}
export const anyHidden = seriesId => { const h = hiddenIn(seriesId); return h.tags.size > 0 || h.highlights; };

// Notes added (or jumped to) while their tags are hidden stay visible until you switch
// one of their tags — or All — on or off again. Kept while the app is open.
const keepShown = new Map(); // note id → keys ('tag id' or 'hl')
const keysOf = n => (n.tagIds?.length ? n.tagIds.map(String) : ['hl']);
export function keepVisible(note) { keepShown.set(note.id, keysOf(note)); }

function hiddenByTags(n, h) {
  if (!n.tagIds?.length) return h.highlights;
  return n.tagIds.every(id => h.tags.has(id));
}
/** Notes to draw in the text right now. */
export function visibleNotes(list, seriesId) {
  const h = hiddenIn(seriesId);
  return list.filter(n => keepShown.has(n.id) || !hiddenByTags(n, h));
}
/** True if this note would be hidden by the current switches (ignoring "keep visible"). */
export function isHiddenByTags(note, seriesId) { return hiddenByTags(note, hiddenIn(seriesId)); }

function forget(key) {
  for (const [id, keys] of keepShown) if (key === '*' || keys.includes(key)) keepShown.delete(id);
}

let visTab = 'notes';
/**
 * The reader's "Show in text" panel. noteList: this chapter's notes. onChange: redraw the text.
 * codex (optional): { rooms: [{ id, name, color, icon (svg), count }], hidden: () => Set, setHidden(Set), off: bool }
 *   — a second tab with one switch per Codex room.
 */
export async function openVisibility({ seriesId, noteList, onChange, codex = null }) {
  const tags = tagsFor(await db.getAllTags(), seriesId).own.sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id));
  const inText = noteList.filter(n => n.sp != null);
  const count = id => inText.filter(n => (id === 'hl' ? !n.tagIds?.length : n.tagIds?.includes(id))).length;
  if (!codex) visTab = 'notes';
  const row = (attr, key, dot, name, sub, on) => `
    <label class="vis-row${on ? '' : ' is-off'}">${dot}
      <span class="txt"><b>${esc(name)}</b><small>${sub}</small></span>
      <input type="checkbox" role="switch" ${attr}="${key}" ${on ? 'checked' : ''}></label>`;
  const notesHtml = () => {
    const h = hiddenIn(seriesId);
    const sub = key => `${plural(count(key === 'hl' ? 'hl' : Number(key)), 'note')} in this chapter`;
    return `<div class="vis-list">
        ${tags.map(t => row('data-vis', String(t.id), `<i class="vis-dot" style="background:${tagColor(t.color)}"></i>`, t.name, sub(String(t.id)), !h.tags.has(t.id))).join('')}
        ${row('data-vis', 'hl', '<i class="vis-dot is-hl"></i>', tags.length ? 'Highlights & untagged' : 'All notes and highlights', sub('hl'), !h.highlights)}
      </div>
      <p class="hint tip" style="margin:0">Remembered for this series. Hidden notes are still there — this only clears the text. A note you add under a hidden tag stays visible until you switch that tag again.</p>`;
  };
  const codexHtml = () => {
    const h = codex.hidden();
    return `<div class="vis-list">
        ${codex.rooms.map(r => row('data-room', r.id, `<span class="vis-room" style="--cx:${tagColor(r.color)}">${r.icon}</span>`, r.name,
          r.count ? `${plural(r.count, 'name')} in this chapter` : 'none in this chapter', !h.has(r.id))).join('')}
      </div>
      <p class="hint tip" style="margin:0">A room that’s off stops marking its names in the text. Entries stay in the Codex. Remembered for this series.</p>`;
  };
  const html = () => `
    <div class="snd-head"><h2>Show in text</h2>
      <span class="vis-all"><button type="button" class="chip" data-vis-all="on">All on</button><button type="button" class="chip" data-vis-all="off">All off</button></span></div>
    ${codex ? `<div class="vis-tabs" role="tablist">
      <button type="button" role="tab" aria-selected="${visTab === 'notes'}" data-vis-tab="notes">Notes${anyHidden(seriesId) ? '<i></i>' : ''}</button>
      <button type="button" role="tab" aria-selected="${visTab === 'codex'}" data-vis-tab="codex">Codex${codex.hidden().size ? '<i></i>' : ''}</button></div>` : ''}
    ${visTab === 'codex' && codex ? codexHtml() : notesHtml()}`;
  openSheet('<div class="vis-box"></div>', sheet => {
    const box = sheet.querySelector('.vis-box');
    box.innerHTML = html();
    box.addEventListener('change', e => {
      const room = e.target.dataset.room;
      if (room != null) {
        const h = codex.hidden();
        if (e.target.checked) h.delete(room); else h.add(room);
        codex.setHidden(h);
        box.innerHTML = html();
        onChange?.();
        return;
      }
      const key = e.target.dataset.vis;
      if (key == null) return;
      const h = hiddenIn(seriesId);
      if (key === 'hl') h.highlights = !e.target.checked;
      else if (e.target.checked) h.tags.delete(Number(key)); else h.tags.add(Number(key));
      forget(key);
      saveHidden(seriesId, h);
      box.innerHTML = html();
      onChange?.();
    });
    box.addEventListener('click', e => {
      const tab = e.target.closest('[data-vis-tab]');
      if (tab) { visTab = tab.dataset.visTab; box.innerHTML = html(); return; }
      const b = e.target.closest('[data-vis-all]');
      if (!b) return;
      const off = b.dataset.visAll === 'off';
      if (visTab === 'codex' && codex) {
        codex.setHidden(new Set(off ? codex.rooms.map(r => r.id) : []));
      } else {
        saveHidden(seriesId, { tags: new Set(off ? tags.map(t => t.id) : []), highlights: off });
        forget('*');
      }
      box.innerHTML = html();
      onChange?.();
    });
  });
}

/** Choose which chapters' notes to show on a series' Notes tab. */
function openRangeSheet({ range, chapters, progressAt, notes: nums, onApply }) {
  const r = { mode: range.mode, from: range.from ?? chapters[0] ?? 1, to: range.to ?? chapters[chapters.length - 1] ?? 1, at: range.at ?? chapters[0] ?? 1 };
  const count = () => nums.filter(n => (r.mode === 'upto' ? n <= progressAt
    : r.mode === 'range' ? n >= Math.min(r.from, r.to) && n <= Math.max(r.from, r.to)
      : r.mode === 'one' ? n === r.at : true)).length;
  const select = (key, value) => `<select data-rs="${key}">${chapters.map(c => `<option value="${c}"${c === value ? ' selected' : ''}>Ch. ${fmtNum(c)}</option>`).join('')}</select>`;
  const opt = (mode, label, sub, extra = '') => `
    <label class="range-opt"><input type="radio" name="rmode" value="${mode}" ${r.mode === mode ? 'checked' : ''}>
      <span class="txt"><b>${label}</b><small>${sub}</small></span></label>${r.mode === mode ? extra : ''}`;
  const html = () => `
    <h2>Show notes from</h2>
    <div class="range-list">
      ${opt('all', 'All chapters', plural(nums.length, 'note'))}
      ${Number.isFinite(progressAt) ? opt('upto', 'Up to where I am', `Ch. ${fmtNum(chapters[0] ?? 1)}–${fmtNum(progressAt)}`) : ''}
      ${opt('range', 'Chapters', 'From one chapter to another', `<div class="range-pick">${select('from', r.from)}<span>to</span>${select('to', r.to)}</div>`)}
      ${opt('one', 'Only one chapter', 'e.g. just Ch. 23', `<div class="range-pick">${select('at', r.at)}</div>`)}
    </div>
    <button type="button" class="btn btn-accent" data-rs-apply>Show ${plural(count(), 'note')}</button>`;
  openSheet('<div class="range-box"></div>', sheet => {
    const box = sheet.querySelector('.range-box');
    box.innerHTML = html();
    box.addEventListener('change', e => {
      if (e.target.name === 'rmode') r.mode = e.target.value;
      if (e.target.dataset.rs) r[e.target.dataset.rs] = Number(e.target.value);
      box.innerHTML = html();
    });
    box.addEventListener('click', e => {
      if (!e.target.closest('[data-rs-apply]')) return;
      if (r.mode === 'range' && r.from > r.to) [r.from, r.to] = [r.to, r.from];
      closeOverlay();
      onApply({ ...r });
    });
  });
}
