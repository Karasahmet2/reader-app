// codex.js — the Codex: a small wiki for each series.
//
// Entries have a type (Character, Place, Faction, Skill, Item), a name, other names,
// a few fields and free text. Some fields link to other entries ("lives in" → a Place),
// and every entry shows what links back to it. Names of entries are underlined in the
// reader; tapping one shows a quick card.

import * as db from './db.js';
import { esc, I, svg, plural, fmtNum, toast, openSheet, closeOverlay } from './ui.js';
import { tagColor } from './notes.js';
import { openFind } from './find.js';

const ic = d => d;
export const TYPES = {
  character: {
    label: 'Character', plural: 'Characters', color: 'purple',
    icon: ic('<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>'),
    fields: [
      { key: 'title', label: 'Title', kind: 'text', placeholder: 'e.g. Master of the Ghost Gate' },
      { key: 'livesIn', label: 'Lives in', kind: 'link', to: 'place' },
      { key: 'faction', label: 'Faction', kind: 'link', to: 'faction' },
      { key: 'skills', label: 'Skills', kind: 'link', to: 'skill' },
      { key: 'relations', label: 'Relations', kind: 'link', to: 'character', withLabel: true },
    ],
  },
  place: {
    label: 'Place', plural: 'Places', color: 'teal',
    icon: ic('<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'),
    fields: [
      { key: 'region', label: 'Located in', kind: 'link', to: 'place' },
      { key: 'faction', label: 'Controlled by', kind: 'link', to: 'faction' },
    ],
  },
  faction: {
    label: 'Faction', plural: 'Factions', color: 'orange',
    icon: ic('<path d="M5 21V4M5 4h12l-2.5 4L17 12H5"/>'),
    fields: [
      { key: 'base', label: 'Based in', kind: 'link', to: 'place' },
      { key: 'leader', label: 'Led by', kind: 'link', to: 'character' },
    ],
  },
  skill: {
    label: 'Skill', plural: 'Skills', color: 'red',
    icon: ic('<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>'),
    fields: [
      { key: 'faction', label: 'From', kind: 'link', to: 'faction' },
    ],
  },
  item: {
    label: 'Item', plural: 'Items', color: 'sky',
    icon: ic('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>'),
    fields: [
      { key: 'owner', label: 'Owner', kind: 'link', to: 'character' },
    ],
  },
};
const TYPE_KEYS = Object.keys(TYPES);
export const CODEX_ICON = svg('<path d="M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/><circle cx="12" cy="8.5" r="2"/>', 22);

const typeOf = e => TYPES[e?.type] || TYPES.character;
const colorOf = e => tagColor(typeOf(e).color);
const linkIds = v => (Array.isArray(v) ? v.map(x => (typeof x === 'object' ? x.id : x)) : []);
const byId = list => new Map(list.map(x => [x.id, x]));
const sortByName = list => [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));

export function avatar(e, size = 40) {
  const t = typeOf(e);
  return `<span class="cx-avatar" aria-hidden="true" style="--cx:${colorOf(e)};width:${size}px;height:${size}px">${svg(t.icon, Math.round(size / 2), 1.9)}</span>`;
}

function linkChip(e, label = '') {
  if (!e) return '';
  return `<a class="cx-link" href="#/codex/${e.id}" style="--cx:${colorOf(e)}">${svg(typeOf(e).icon, 15, 2)}${esc(e.name)}</a>${label ? `<span class="cx-rel">${esc(label)}</span>` : ''}`;
}

/** One-line summary for lists: title or first linked things. */
function summary(e, all) {
  const map = byId(all);
  if (e.fields?.title) return e.fields.title;
  for (const f of typeOf(e).fields) {
    if (f.kind !== 'link') continue;
    const names = linkIds(e.fields?.[f.key]).map(id => map.get(id)?.name).filter(Boolean);
    if (names.length) return `${f.label} ${names.slice(0, 2).join(', ')}`;
  }
  return (e.about || '').split('\n')[0] || typeOf(e).label;
}

/* ------------------------------------------------------------------ finding names in text */

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every name and other name of the entries, longest first, mapped to its entry. */
function nameTable(entries) {
  const names = new Map();
  for (const e of entries) {
    for (const n of [e.name, ...(e.aliases || [])]) {
      const t = (n || '').trim();
      if (t.length >= 2 && !names.has(t)) names.set(t, e);
    }
  }
  return names;
}

function namePattern(names) {
  if (!names.size) return null;
  const alts = [...names.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`, 'gu');
}

/** How often each entry is named in some text. Returns Map(entryId → count). */
export function countMentions(text, entries) {
  const names = nameTable(entries);
  const re = namePattern(names);
  const out = new Map();
  if (!re) return out;
  for (const m of text.matchAll(re)) {
    const e = names.get(m[0]);
    if (e) out.set(e.id, (out.get(e.id) || 0) + 1);
  }
  return out;
}

/** Remove the dotted name underlines from the reader. */
export function clearNames(root) {
  root.querySelectorAll('span.cx-name').forEach(sp => {
    const parent = sp.parentNode;
    while (sp.firstChild) parent.insertBefore(sp.firstChild, sp);
    sp.remove();
    parent.normalize();
  });
}

/** Underline every Codex name in the reader's paragraphs. */
export function applyNames(paras, entries) {
  const names = nameTable(entries);
  const re = namePattern(names);
  if (!re) return;
  for (const p of paras) {
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
      if (!node.parentElement.closest('.cx-name')) nodes.push(node);
    }
    for (const textNode of nodes) {
      const hits = [...textNode.data.matchAll(re)];
      for (let i = hits.length - 1; i >= 0; i--) {   // from the end, so offsets stay valid
        const m = hits[i];
        const e = names.get(m[0]);
        let t = textNode.splitText(m.index);
        t.splitText(m[0].length);
        const sp = document.createElement('span');
        sp.className = 'cx-name';
        sp.dataset.entry = e.id;
        sp.style.setProperty('--cx', colorOf(e));
        t.parentNode.insertBefore(sp, t);
        sp.appendChild(t);
      }
    }
  }
}

/** The entry whose name (or other name) is exactly this text, if any. */
export function entryNamed(entries, text) {
  const t = String(text || '').trim().toLowerCase();
  return entries.find(e => [e.name, ...(e.aliases || [])].some(n => n && n.toLowerCase() === t));
}

/* ------------------------------------------------------------------ series page: Codex tab */

const tabFilter = new Map(); // seriesId → type filter

export async function renderCodexTab(root, seriesId) {
  const entries = await db.getCodexOfSeries(seriesId);
  const filter = tabFilter.get(seriesId) || 'all';
  const counts = Object.fromEntries(TYPE_KEYS.map(k => [k, entries.filter(e => e.type === k).length]));
  const shown = sortByName(entries.filter(e => filter === 'all' || e.type === filter))
    .sort((a, b) => TYPE_KEYS.indexOf(a.type) - TYPE_KEYS.indexOf(b.type));

  root.innerHTML = `<div class="codex-tab">
    ${entries.length ? `<nav class="filter-chips" aria-label="Filter by type">
      <button type="button" data-cxf="all" aria-pressed="${filter === 'all'}">All <span class="count">${entries.length}</span></button>
      ${TYPE_KEYS.filter(k => counts[k]).map(k => `<button type="button" data-cxf="${k}" aria-pressed="${filter === k}">
        <i class="chip-dot" style="background:${tagColor(TYPES[k].color)}"></i>${TYPES[k].plural} <span class="count">${counts[k]}</span></button>`).join('')}
    </nav>` : ''}
    <div class="cx-list">
      ${shown.map(e => `<a class="cx-row" href="#/codex/${e.id}">${avatar(e)}
        <span class="txt"><b>${esc(e.name)}</b><small>${esc(summary(e, entries))}</small></span>${I.chevron}</a>`).join('')
      || `<div class="empty" style="padding:32px 12px">
        <span class="empty-ico">${CODEX_ICON}</span><strong>No Codex entries yet</strong>
        <span>Keep track of characters, places, factions, skills and items. While reading, select a name and tap <b>Codex</b>, or tap below.</span></div>`}
    </div>
    <button type="button" class="cx-fab" data-cx-new>${I.plus} New entry</button>
  </div>`;

  root.querySelector('.codex-tab').addEventListener('click', e => {
    const f = e.target.closest('[data-cxf]');
    if (f) { tabFilter.set(seriesId, f.dataset.cxf); renderCodexTab(root, seriesId); return; }
    if (e.target.closest('[data-cx-new]')) {
      openEntryEditor({ seriesId, type: filter !== 'all' ? filter : 'character', onSaved: () => renderCodexTab(root, seriesId) });
    }
  });
}

/* ------------------------------------------------------------------ entry page (#/codex/ID) */

export async function renderEntryPage(app, id) {
  const entry = await db.getCodexEntry(id);
  if (!entry) {
    app.innerHTML = `<main class="page"><div class="empty"><strong>This entry no longer exists</strong>
      <a class="btn" href="#/">Back to library</a></div></main>`;
    return;
  }
  const [all, series, notesOf] = await Promise.all([
    db.getCodexOfSeries(entry.seriesId), db.getSeries(entry.seriesId), db.getAllNotes(),
  ]);
  const map = byId(all);
  const t = typeOf(entry);
  const names = [entry.name, ...(entry.aliases || [])].filter(Boolean).map(n => n.toLowerCase());

  const fieldsHtml = t.fields.map(f => {
    const v = entry.fields?.[f.key];
    if (f.kind === 'text') return v ? fieldBlock(f.label, `<span>${esc(v)}</span>`) : '';
    const items = (Array.isArray(v) ? v : []).map(x => (typeof x === 'object' ? x : { id: x }))
      .filter(x => map.has(x.id));
    return items.length ? fieldBlock(f.label, items.map(x => linkChip(map.get(x.id), x.label)).join('')) : '';
  }).join('');

  // Other entries that link here ("Ghost Adept · Skills").
  const back = [];
  for (const other of all) {
    if (other.id === entry.id) continue;
    for (const f of typeOf(other).fields) {
      const hit = (other.fields?.[f.key] || []);
      if (!Array.isArray(hit)) continue;
      const x = hit.find(y => (typeof y === 'object' ? y.id : y) === entry.id);
      if (x) back.push({ other, label: typeof x === 'object' && x.label ? x.label : f.label });
    }
  }

  const linkedNotes = notesOf.filter(n => n.seriesId === entry.seriesId
    && names.some(nm => `${n.quote} ${n.text}`.toLowerCase().includes(nm)));

  app.innerHTML = `<main class="page cx-page" style="--cx:${colorOf(entry)}">
    <div class="cx-wash" aria-hidden="true"></div>
    <div class="row-head">
      <a class="icon-btn" href="#/series/${entry.seriesId}/codex" aria-label="Back to ${esc(series?.name || 'series')}">${I.back}</a>
      <button type="button" class="chip" data-cxa="edit">${I.pencilSm} Edit</button>
    </div>
    <div class="cx-hero">${avatar(entry, 64)}
      <div class="txt"><h1>${esc(entry.name)}</h1>
        <small>${t.label} · <span id="cx-seen">${esc(series?.name || '')}</span></small></div>
    </div>
    ${entry.aliases?.length ? fieldBlock('Also called', entry.aliases.map(a => `<span>${esc(a)}</span>`).join('<span class="cx-dot">·</span>')) : ''}
    ${fieldsHtml}
    ${entry.about ? fieldBlock('About', `<p class="cx-about">${esc(entry.about)}</p>`) : ''}
    ${back.length ? fieldBlock('Linked from', back.map(b => linkChip(b.other, b.label)).join('')) : ''}
    ${linkedNotes.length ? `<section class="cx-field"><h3>Notes that mention ${esc(entry.name)} · ${linkedNotes.length}</h3>
      <div class="cx-notes">${linkedNotes.slice(0, 20).map(n => `
        <a class="cx-note" href="${n.quote ? `#/read/${n.chapterId}/note/${n.id}` : `#/read/${n.chapterId}`}">
          ${n.quote ? `<b>${esc(n.quote.slice(0, 120))}</b>` : '<b>Chapter note</b>'}
          ${n.text ? `<span>${esc(n.text.slice(0, 160))}</span>` : ''}</a>`).join('')}</div></section>` : ''}
    <button type="button" class="btn cx-find" data-cxa="find">${I.searchSm} Find every mention</button>
  </main>`;

  app.querySelector('main').addEventListener('click', e => {
    const b = e.target.closest('[data-cxa]');
    if (!b) return;
    if (b.dataset.cxa === 'edit') {
      openEntryEditor({
        seriesId: entry.seriesId, entry,
        onSaved: () => renderEntryPage(app, id),
        onDeleted: () => { location.hash = `#/series/${entry.seriesId}/codex`; },
      });
    }
    if (b.dataset.cxa === 'find') openFind({ term: entry.name, chapterId: null, seriesId: entry.seriesId });
  });

  // First chapter that names it, and in how many chapters (counted in the background).
  firstSeen(entry).then(info => {
    const el = app.querySelector('#cx-seen');
    if (el && info) el.textContent = info;
  });
}

function fieldBlock(label, inner) {
  return `<section class="cx-field"><h3>${esc(label)}</h3><div class="cx-vals">${inner}</div></section>`;
}

async function firstSeen(entry) {
  const chapters = await db.getChaptersOfSeries(entry.seriesId);
  const wanted = new Map(chapters.map(c => [c.id, c]));
  const names = [entry.name, ...(entry.aliases || [])].filter(n => n && n.length >= 2);
  if (!names.length) return '';
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'u');
  let first = null;
  let count = 0;
  await db.forEachText((cid, paragraphs) => {
    const c = wanted.get(cid);
    if (!c) return;
    if (paragraphs.some(p => re.test(p))) {
      count++;
      if (!first || c.number < first.number) first = c;
    }
  });
  return first ? `first seen Ch. ${fmtNum(first.number)} · in ${plural(count, 'chapter')}` : 'not named in any chapter yet';
}

/* ------------------------------------------------------------------ add / edit */

/**
 * Open the entry editor.
 *  seriesId, entry (to edit), name/type (for a new one), onSaved(entry), onDeleted()
 */
export async function openEntryEditor({ seriesId, entry = null, name = '', type = 'character', onSaved, onDeleted }) {
  let all = await db.getCodexOfSeries(seriesId);
  const draft = entry
    ? structuredClone(entry)
    : { seriesId, type, name, aliases: [], fields: {}, about: '' };
  draft.fields ||= {};
  let picker = null; // { key, q, label } while choosing a link
  let confirmDelete = false;

  const linkField = f => {
    const items = (draft.fields[f.key] || []).map(x => (typeof x === 'object' ? x : { id: x }));
    const map = byId(all);
    const chips = items.filter(x => map.has(x.id)).map(x => `
      <span class="cx-pill" style="--cx:${colorOf(map.get(x.id))}">${svg(typeOf(map.get(x.id)).icon, 14, 2)}${esc(map.get(x.id).name)}${x.label ? `<i>${esc(x.label)}</i>` : ''}
        <button type="button" data-unlink="${f.key}:${x.id}" aria-label="Remove ${esc(map.get(x.id).name)}">${svg('<path d="M6 6l12 12M18 6L6 18"/>', 12, 2.4)}</button></span>`).join('');
    const open = picker?.key === f.key;
    let pickHtml = '';
    if (open) {
      const q = picker.q.trim().toLowerCase();
      const taken = new Set(items.map(x => x.id));
      const options = sortByName(all.filter(e => e.type === f.to && e.id !== draft.id && !taken.has(e.id)
        && (!q || [e.name, ...(e.aliases || [])].some(n => n.toLowerCase().includes(q))))).slice(0, 6);
      const exact = all.some(e => e.type === f.to && e.name.toLowerCase() === q);
      pickHtml = `<div class="cx-picker">
        <input class="text-input" data-pick-q value="${esc(picker.q)}" placeholder="Search or name a new ${TYPES[f.to].label.toLowerCase()}" autocomplete="off">
        ${f.withLabel ? `<input class="text-input" data-pick-label value="${esc(picker.label)}" placeholder="Relation (e.g. sister, master)" autocomplete="off">` : ''}
        <div class="cx-options">
          ${options.map(e => `<button type="button" data-pick="${e.id}">${avatar(e, 28)}${esc(e.name)}</button>`).join('')}
          ${q && !exact ? `<button type="button" data-pick-new>${I.plusSm} New ${TYPES[f.to].label.toLowerCase()} “${esc(picker.q.trim())}”</button>` : ''}
          ${!options.length && !q ? `<span class="hint">No ${TYPES[f.to].plural.toLowerCase()} yet — type a name to add one.</span>` : ''}
        </div></div>`;
    }
    return `<div class="cx-efield"><span class="label">${esc(f.label)}</span>
      <div class="cx-pills">${chips}<button type="button" class="cx-add" data-linkadd="${f.key}" aria-expanded="${open}">${I.plusSm} ${open ? 'Close' : 'Link'}</button></div>
      ${pickHtml}</div>`;
  };

  const formHtml = () => {
    const t = TYPES[draft.type];
    return `
      <h2>${entry ? 'Edit entry' : 'Add to Codex'}</h2>
      <div class="cx-types" role="radiogroup" aria-label="Type">
        ${TYPE_KEYS.map(k => `<button type="button" role="radio" aria-checked="${draft.type === k}" data-type="${k}" style="--cx:${tagColor(TYPES[k].color)}">
          ${svg(TYPES[k].icon, 20, 1.9)}<span>${TYPES[k].label}</span></button>`).join('')}
      </div>
      <label class="cx-efield"><span class="label">Name</span>
        <input class="text-input" data-f="name" value="${esc(draft.name)}" maxlength="80" autocomplete="off"></label>
      <label class="cx-efield"><span class="label">Also called</span>
        <input class="text-input" data-f="aliases" value="${esc((draft.aliases || []).join(', '))}" placeholder="Other names, separated by commas" autocomplete="off"></label>
      ${t.fields.map(f => (f.kind === 'text'
        ? `<label class="cx-efield"><span class="label">${esc(f.label)}</span>
            <input class="text-input" data-field="${f.key}" value="${esc(draft.fields[f.key] || '')}" placeholder="${esc(f.placeholder || '')}" autocomplete="off"></label>`
        : linkField(f))).join('')}
      <label class="cx-efield"><span class="label">About</span>
        <textarea class="text-area" data-f="about" rows="3" placeholder="Anything worth remembering…">${esc(draft.about || '')}</textarea></label>
      <p class="hint" style="margin:0">Everything except the name is optional — add more as you read.</p>
      <div class="two-btns">
        <button type="button" class="btn" data-ed="cancel">Cancel</button>
        <button type="button" class="btn btn-accent" data-ed="save">${entry ? 'Save' : 'Add entry'}</button>
      </div>
      ${entry ? `<button type="button" class="btn cx-delete${confirmDelete ? ' is-confirm' : ''}" data-ed="delete">${I.trashSm} ${confirmDelete ? 'Tap again to delete' : 'Delete entry'}</button>` : ''}`;
  };

  const sheet = openSheet('<div class="cx-editor"></div>', s => s.classList.add('cx-sheet'));
  const box = sheet.querySelector('.cx-editor');
  const draw = (focusPicker = false) => {
    const scroll = sheet.scrollTop;
    box.innerHTML = formHtml();
    sheet.scrollTop = scroll;
    if (focusPicker) box.querySelector('[data-pick-q]')?.focus();
  };
  draw();
  if (!draft.name) box.querySelector('[data-f="name"]').focus();

  const addLink = (key, id) => {
    const f = TYPES[draft.type].fields.find(x => x.key === key);
    const list = draft.fields[key] || [];
    list.push(f.withLabel ? { id, label: (picker?.label || '').trim() } : id);
    draft.fields[key] = list;
    picker = null;
    draw();
  };

  box.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.f === 'name') draft.name = el.value;
    else if (el.dataset.f === 'aliases') draft.aliases = el.value.split(',').map(s => s.trim()).filter(Boolean);
    else if (el.dataset.f === 'about') draft.about = el.value;
    else if (el.dataset.field) draft.fields[el.dataset.field] = el.value;
    else if (el.dataset.pickLabel != null) picker.label = el.value;
    else if (el.dataset.pickQ != null) {
      picker.q = el.value;
      const pos = el.selectionStart;
      draw(true);
      const q = box.querySelector('[data-pick-q]');
      q?.setSelectionRange(pos, pos);
    }
  });

  box.addEventListener('click', async e => {
    const ty = e.target.closest('[data-type]');
    if (ty) { draft.type = ty.dataset.type; picker = null; draw(); return; }
    const add = e.target.closest('[data-linkadd]');
    if (add) {
      picker = picker?.key === add.dataset.linkadd ? null : { key: add.dataset.linkadd, q: '', label: '' };
      draw(!!picker);
      return;
    }
    const un = e.target.closest('[data-unlink]');
    if (un) {
      const [key, id] = un.dataset.unlink.split(':');
      draft.fields[key] = (draft.fields[key] || []).filter(x => (typeof x === 'object' ? x.id : x) !== Number(id));
      draw();
      return;
    }
    const pick = e.target.closest('[data-pick]');
    if (pick) { addLink(picker.key, Number(pick.dataset.pick)); return; }
    if (e.target.closest('[data-pick-new]')) {
      const f = TYPES[draft.type].fields.find(x => x.key === picker.key);
      const made = await db.putCodexEntry({ seriesId, type: f.to, name: picker.q.trim(), aliases: [], fields: {}, about: '' });
      all = [...all, made];
      toast(`${TYPES[f.to].label} “${made.name}” added`);
      addLink(picker.key, made.id);
      return;
    }
    const act = e.target.closest('[data-ed]');
    if (!act) return;
    if (act.dataset.ed === 'cancel') { closeOverlay(); return; }
    if (act.dataset.ed === 'delete') {
      if (!confirmDelete) { confirmDelete = true; draw(); return; }
      await db.deleteCodexEntry(entry.id);
      toast('Entry deleted');
      closeOverlay();
      onDeleted?.();
      return;
    }
    if (act.dataset.ed === 'save') {
      const nm = draft.name.replace(/\s+/g, ' ').trim();
      if (!nm) { toast('Give it a name first'); box.querySelector('[data-f="name"]').focus(); return; }
      const clash = all.find(x => x.id !== draft.id && x.name.toLowerCase() === nm.toLowerCase());
      if (clash && !entry) { toast(`“${clash.name}” is already in the Codex`); return; }
      // Keep only the fields that belong to the chosen type.
      const keys = new Set(TYPES[draft.type].fields.map(f => f.key));
      const fields = Object.fromEntries(Object.entries(draft.fields).filter(([k]) => keys.has(k)));
      const saved = await db.putCodexEntry({ ...draft, name: nm, fields });
      toast(entry ? 'Entry saved' : `Added to the Codex`);
      closeOverlay();
      onSaved?.(saved);
    }
  });
}

/* ------------------------------------------------------------------ reader: quick card and Codex tool */

/** Quick card for a name tapped in the reader. */
export async function openPeek(id, { onNote, noteLabel = 'Add a note' } = {}) {
  const entry = await db.getCodexEntry(id);
  if (!entry) return;
  const all = await db.getCodexOfSeries(entry.seriesId);
  const map = byId(all);
  const rows = [];
  for (const f of typeOf(entry).fields) {
    const v = entry.fields?.[f.key];
    if (f.kind === 'text' || !Array.isArray(v)) continue;
    for (const x of v) {
      const o = typeof x === 'object' ? x : { id: x };
      const target = map.get(o.id);
      if (target && rows.length < 4) rows.push(`<div class="cx-peek-row"><span>${esc(o.label || f.label)}</span>${linkChip(target)}</div>`);
    }
  }
  openSheet(`
    <div class="cx-peek-head">${avatar(entry, 48)}
      <div class="txt"><b>${esc(entry.name)}</b><small>${typeOf(entry).label}${entry.fields?.title ? ` · ${esc(entry.fields.title)}` : ''}</small></div></div>
    ${rows.join('')}
    ${entry.about ? `<p class="cx-about">${esc(entry.about.slice(0, 240))}</p>` : ''}
    <div class="two-btns">
      <button type="button" class="btn btn-accent" data-pk="open">Open entry</button>
      ${onNote ? `<button type="button" class="btn" data-pk="note">${I.note} ${esc(noteLabel)}</button>` : ''}
    </div>`, sheet => {
    sheet.addEventListener('click', e => {
      const a = e.target.closest('a.cx-link');
      if (a) { e.preventDefault(); closeOverlay({ navTo: a.getAttribute('href') }); return; }
      const b = e.target.closest('[data-pk]');
      if (b?.dataset.pk === 'open') closeOverlay({ navTo: `#/codex/${entry.id}` });
      if (b?.dataset.pk === 'note') onNote(entry);
    });
  });
}

/** The reader's Codex tool: entries named in this chapter, search, and New. */
export async function openReaderCodex({ seriesId, chapterText, onChanged }) {
  const all = await db.getCodexOfSeries(seriesId);
  const here = countMentions(chapterText, all);
  let q = '';
  const row = (e, meta) => `<a class="cx-row" href="#/codex/${e.id}">${avatar(e)}
    <span class="txt"><b>${esc(e.name)}</b><small>${esc(summary(e, all))}</small></span><span class="cx-meta">${meta}</span></a>`;
  const listHtml = () => {
    const s = q.trim().toLowerCase();
    if (s) {
      const found = sortByName(all.filter(e => [e.name, ...(e.aliases || [])].some(n => n.toLowerCase().includes(s))));
      return `<h3 class="cx-h">${plural(found.length, 'match', 'matches')}</h3>
        <div class="cx-list">${found.map(e => row(e, TYPES[e.type]?.label || '')).join('') || '<p class="hint">Nothing found.</p>'}</div>`;
    }
    const inChapter = all.filter(e => here.has(e.id)).sort((a, b) => here.get(b.id) - here.get(a.id));
    return `<h3 class="cx-h">In this chapter · ${inChapter.length}</h3>
      <div class="cx-list">${inChapter.map(e => row(e, `${here.get(e.id)}×`)).join('')
        || `<p class="hint">${all.length ? 'None of your Codex entries are named in this chapter.' : 'Your Codex is empty. Select a name while reading and tap Codex to add it.'}</p>`}</div>`;
  };
  openSheet(`
    <div class="snd-head"><h2>Codex</h2><button type="button" class="chip" data-rc="new">${I.plusSm} New</button></div>
    ${all.length ? `<label class="search-box">${I.search}<span class="visually-hidden">Search Codex</span>
      <input type="search" data-rc-q placeholder="Search ${plural(all.length, 'entry', 'entries')}" autocomplete="off"></label>` : ''}
    <div class="cx-results">${listHtml()}</div>
    <a class="hint cx-all" href="#/series/${seriesId}/codex">All entries are on the series page → Codex</a>`, sheet => {
    sheet.classList.add('cx-sheet');
    sheet.querySelector('[data-rc-q]')?.addEventListener('input', e => {
      q = e.target.value;
      sheet.querySelector('.cx-results').innerHTML = listHtml();
    });
    sheet.addEventListener('click', e => {
      const a = e.target.closest('a[href]');
      if (a) { e.preventDefault(); closeOverlay({ navTo: a.getAttribute('href') }); return; }
      if (e.target.closest('[data-rc="new"]')) openEntryEditor({ seriesId, onSaved: () => onChanged?.() });
    });
  });
}
