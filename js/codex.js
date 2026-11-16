// codex.js — the Codex: a small wiki for each series, which you fill in yourself while reading.
//
// Structure ("rooms and walls"): each series has its own list of entry types (Character,
// Sect, Concept…), each with its own fields. Fields are text, longer text, or links to other
// entries. The structure comes from a Codex file (.codex.json, usually written by an AI agent
// from the chapters — see codex-guide.js) or from a ready-made one. It never contains entries.
//
// Chapter-aware: every entry has the chapter you learned about it ("Known from"), and every
// field value and connection has the chapter it became true. While reading, the Codex only
// shows what was known by that chapter, so re-reading Ch. 5 doesn't show what you learned in Ch. 9.
//
// Data
//   series.codex = { types, description, file, importedAt, hideLater }
//   codex entry  = { id, seriesId, type, name, aliases, since, fields, about, createdAt, updatedAt }
//     fields[textField] = [{ v, since }]                       (history; older entries: a string)
//     fields[linkField] = [{ id, label?, since }]              (older entries: ids or { id, label })

import * as db from './db.js';
import { esc, I, svg, plural, fmtNum, toast, openSheet, closeOverlay } from './ui.js';
import { tagColor, TAG_COLORS } from './notes.js';
import { openFind } from './find.js';
import { downloadBlob } from './backup.js';
import { CODEX_PROMPT } from './codex-guide.js';

/* ------------------------------------------------------------------ icons and ready-made structures */

export const ICONS = {
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>',
  people: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c0-3.3 2.5-6 5.5-6s5.5 2.7 5.5 6"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M15.5 13.2c2.9-.3 5 2 5 5.3"/>',
  place: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  building: '<path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-6h6v6M4 20h16"/>',
  flag: '<path d="M5 21V4M5 4h12l-2.5 4L17 12H5"/>',
  crown: '<path d="M4 18h16l1-10-5 4-4-7-4 7-5-4z"/>',
  sword: '<path d="M14.5 4H20v5.5L9 20.5 3.5 15z"/><path d="M6 12.5l5.5 5.5M4 20l2.5-2.5"/>',
  spark: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>',
  gem: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  scroll: '<path d="M7 4h11a2 2 0 0 1 2 2v1h-4M7 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7M7 4a2 2 0 0 1 2 2v12M11 9h4M11 13h4"/>',
  book: '<path d="M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  beast: '<path d="M5 11c0-4 3-7 7-7s7 3 7 7c0 3-1.5 5-3 6l-1 3H9l-1-3c-1.5-1-3-3-3-6z"/><circle cx="9.5" cy="11" r="1"/><circle cx="14.5" cy="11" r="1"/><path d="M5.5 7L3 4.5M18.5 7L21 4.5"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z"/><path d="M5 19l8-8"/>',
  star: '<path d="M12 3.6l2.5 5.3 5.8.7-4.3 4 1.1 5.7L12 16.5l-5.1 2.8 1.1-5.7-4.3-4 5.8-.7z"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z"/>',
  mask: '<path d="M4 6c2.5-1 5.3-1.5 8-1.5s5.5.5 8 1.5v5c0 5-3.6 8.5-8 8.5S4 16 4 11z"/><path d="M8 10.5h2.5M13.5 10.5H16M10 15c1.3.8 2.7.8 4 0"/>',
  ship: '<path d="M3 16l2 4h14l2-4zM12 3v13M12 4l6 9h-6M12 7l-5 6h5"/>',
};
export const CODEX_ICON = svg('<path d="M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/><circle cx="12" cy="8.5" r="2"/>', 22);
const CLOCK = svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>', 13, 2);
const LOCK = svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', 18);
const X = svg('<path d="M6 6l12 12M18 6L6 18"/>', 12, 2.4);
const MINUS = svg('<path d="M5 12h14"/>', 16, 2.2);
const PLUS = svg('<path d="M12 5v14M5 12h14"/>', 16, 2.2);

const link = (id, label, to, more = {}) => ({ id, label, kind: 'link', to: [].concat(to), multiple: true, ...more });
const text = (id, label, more = {}) => ({ id, label, kind: 'text', ...more });

export const PRESETS = {
  murim: {
    name: 'Murim / cultivation',
    description: 'Characters, factions, martial skills, places and items.',
    types: [
      { id: 'character', name: 'Character', plural: 'Characters', color: 'purple', icon: 'person', hint: 'People who appear in the story',
        fields: [text('title', 'Title', { hint: 'e.g. a rank or nickname' }), link('livesIn', 'Lives in', 'place'), link('faction', 'Faction', 'faction'),
          link('skills', 'Skills', 'skill'), link('relations', 'Relations', 'character', { withLabel: true, labelHint: 'e.g. brother, master, rival' })] },
      { id: 'place', name: 'Place', plural: 'Places', color: 'teal', icon: 'place', hint: 'Cities, mountains, estates…',
        fields: [link('region', 'Located in', 'place'), link('faction', 'Controlled by', 'faction')] },
      { id: 'faction', name: 'Faction', plural: 'Factions', color: 'orange', icon: 'flag', hint: 'Sects, clans, alliances',
        fields: [link('base', 'Based in', 'place'), link('leader', 'Led by', 'character')] },
      { id: 'skill', name: 'Skill', plural: 'Skills', color: 'red', icon: 'spark', hint: 'Martial arts and techniques',
        fields: [link('faction', 'From', 'faction')] },
      { id: 'item', name: 'Item', plural: 'Items', color: 'sky', icon: 'gem', hint: 'Weapons, treasures, elixirs',
        fields: [link('owner', 'Owner', 'character')] },
    ],
  },
  novel: {
    name: 'Classic novel',
    description: 'Characters, places, organizations, concepts and events.',
    types: [
      { id: 'character', name: 'Character', plural: 'Characters', color: 'purple', icon: 'person', hint: 'People who appear in the story',
        fields: [text('role', 'Role'), link('memberOf', 'Member of', 'organization'), link('livesIn', 'Lives in', 'place'),
          link('relations', 'Relations', 'character', { withLabel: true, labelHint: 'e.g. friend, mother, rival' })] },
      { id: 'place', name: 'Place', plural: 'Places', color: 'teal', icon: 'place', hint: 'Where things happen',
        fields: [text('description', 'Description', { kind: 'longtext' }), link('partOf', 'Part of', 'place')] },
      { id: 'organization', name: 'Organization', plural: 'Organizations', color: 'orange', icon: 'building', hint: 'Groups, institutions, companies',
        fields: [text('purpose', 'Purpose'), link('locatedIn', 'Located in', 'place', { multiple: false }), link('leader', 'Led by', 'character', { multiple: false })] },
      { id: 'concept', name: 'Concept', plural: 'Concepts', color: 'sky', icon: 'bulb', hint: 'Ideas and terms the story uses',
        fields: [text('meaning', 'Meaning', { kind: 'longtext' })] },
      { id: 'event', name: 'Event', plural: 'Events', color: 'red', icon: 'calendar', hint: 'Things that happen',
        fields: [text('what', 'What happened', { kind: 'longtext' }), link('involves', 'Involves', 'character', { withLabel: true, labelHint: 'e.g. witness, victim' }), link('where', 'Where', 'place', { multiple: false })] },
    ],
  },
};

/* ------------------------------------------------------------------ reading a Codex file */

const RESERVED = new Set(['name', 'aliases', 'since', 'about', 'knownFrom']);
const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
const camel = s => String(s || '').normalize('NFKD').replace(/[^\w\s]/g, ' ').trim().split(/[\s_]+/)
  .map((w, i) => (i ? w[0]?.toUpperCase() + w.slice(1) : w.toLowerCase())).join('');

/** True if this parsed JSON looks like a Codex file. */
export const isCodexData = d => d && typeof d === 'object' && d.format === 'reader-codex';

/**
 * Check a Codex file and turn it into a clean structure.
 * Returns { ok: true, structure: { series, description, types }, warnings }
 *      or { ok: false, errors }.
 */
export function readCodexFile(data, fileName = '') {
  const errors = [];
  const warnings = [];
  if (!isCodexData(data)) return { ok: false, errors: ['This isn’t a Codex file (“format” should be “reader-codex”).'] };
  if (data.version !== 1) warnings.push(`Unknown version ${data.version}; read as version 1.`);
  let series = typeof data.series === 'string' ? data.series.replace(/\s+/g, ' ').trim() : '';
  if (!series) {
    series = fileName.replace(/\.codex\.json$|\.json$/i, '').trim();
    if (series) warnings.push(`No "series" in the file — using the file name “${series}”.`);
    else errors.push('The file doesn’t say which series it’s for ("series").');
  }
  if (!Array.isArray(data.types) || !data.types.length) errors.push('The file has no "types" (rooms).');
  if (errors.length) return { ok: false, errors };
  if (Array.isArray(data.entries) && data.entries.length) warnings.push('The file lists entries; they were ignored (you fill the Codex yourself).');

  const types = [];
  const usedColors = new Set();
  for (const [i, raw] of data.types.slice(0, 12).entries()) {
    const name = String(raw?.name || '').trim().slice(0, 30);
    if (!name) { warnings.push(`Room ${i + 1} has no name — skipped.`); continue; }
    let id = /^[a-z0-9-]+$/.test(raw.id || '') ? raw.id : slug(raw.id || name);
    if (!id || types.some(t => t.id === id)) { id = `${slug(name) || 'type'}-${i + 1}`; warnings.push(`“${name}” got the id “${id}”.`); }
    let color = TAG_COLORS.includes(raw.color) ? raw.color : null;
    if (!color || usedColors.has(color)) {
      const free = TAG_COLORS.find(c => !usedColors.has(c)) || 'silver';
      if (raw.color && raw.color !== free) warnings.push(`“${name}”: color “${raw.color}” ${TAG_COLORS.includes(raw.color) ? 'is already used' : 'isn’t available'} — using ${free}.`);
      color = free;
    }
    usedColors.add(color);
    let icon = ICONS[raw.icon] ? raw.icon : 'star';
    if (raw.icon && !ICONS[raw.icon]) warnings.push(`“${name}”: icon “${raw.icon}” isn’t available — using a star.`);
    types.push({
      id, name,
      plural: String(raw.plural || `${name}s`).trim().slice(0, 32),
      color, icon,
      hint: String(raw.hint || '').trim().slice(0, 120),
      rawFields: Array.isArray(raw.fields) ? raw.fields : [],
    });
  }
  if (!types.length) return { ok: false, errors: ['None of the rooms in the file could be read.'] };

  const ids = new Set(types.map(t => t.id));
  for (const t of types) {
    const fields = [];
    for (const [j, f] of t.rawFields.slice(0, 12).entries()) {
      const label = String(f?.label || '').trim().slice(0, 30);
      if (!label) { warnings.push(`${t.name}: field ${j + 1} has no label — skipped.`); continue; }
      let id = /^[A-Za-z][A-Za-z0-9]*$/.test(f.id || '') ? f.id : camel(f.id || label);
      if (!id || RESERVED.has(id) || fields.some(x => x.id === id)) {
        if (RESERVED.has(id)) { warnings.push(`${t.name}: “${label}” is added automatically — skipped.`); continue; }
        id = `${camel(label) || 'field'}${j + 1}`;
      }
      let kind = ['text', 'longtext', 'link'].includes(f.kind) ? f.kind : 'text';
      if (f.kind && kind !== f.kind) warnings.push(`${t.name} · ${label}: unknown kind “${f.kind}” — using text.`);
      const field = { id, label, kind, hint: String(f.hint || '').trim().slice(0, 120) };
      if (kind === 'link') {
        const to = [].concat(f.to || []).map(String).filter(x => ids.has(x));
        const bad = [].concat(f.to || []).filter(x => !ids.has(String(x)));
        if (bad.length) warnings.push(`${t.name} · ${label}: links to unknown room ${bad.map(b => `“${b}”`).join(', ')}.`);
        if (!to.length) { field.kind = 'text'; warnings.push(`${t.name} · ${label}: no valid room to link to — made it a text field.`); }
        else {
          field.to = to;
          field.multiple = !!f.multiple;
          if (f.withLabel) { field.withLabel = true; field.labelHint = String(f.labelHint || '').trim().slice(0, 80); }
        }
      }
      fields.push(field);
    }
    t.fields = fields;
    delete t.rawFields;
  }
  return {
    ok: true,
    structure: { series, description: String(data.description || '').trim().slice(0, 300), types },
    warnings,
  };
}

/** Small summary of a structure's rooms, used in the import review and the confirm sheet. */
export function structureSummaryHtml(structure) {
  const byIdT = new Map(structure.types.map(t => [t.id, t]));
  return `<div class="cx-rooms">${structure.types.map(t => `
    <div class="cx-room" style="--cx:${tagColor(t.color)}">
      <span class="cx-avatar" style="width:34px;height:34px">${svg(ICONS[t.icon] || ICONS.star, 17, 1.9)}</span>
      <div><b>${esc(t.name)}</b>
        ${t.fields.map(f => `<small>${esc(f.label)}${f.kind === 'link'
          ? ` <span>→ ${f.to.map(id => esc(byIdT.get(id)?.name || id)).join(' / ')}</span>${f.withLabel ? ' <i>(with a label)</i>' : ''}`
          : ''}</small>`).join('') || '<small>No extra fields</small>'}
      </div></div>`).join('')}</div>`;
}

/** Give a series a Codex structure (from a file or a ready-made one). Entries stay. */
export async function applyStructure(seriesId, structure, file = '') {
  const series = await db.getSeries(seriesId);
  const prev = series?.codex;
  await db.updateSeries(seriesId, {
    codex: {
      types: structure.types,
      description: structure.description || '',
      file,
      importedAt: Date.now(),
      hideLater: prev?.hideLater ?? true,
    },
  });
}

export function exportStructure(series) {
  const s = series.codex;
  const data = {
    format: 'reader-codex',
    version: 1,
    series: series.name,
    description: s.description || '',
    types: s.types.map(t => ({ ...t, fields: t.fields.map(f => ({ ...f })) })),
  };
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${series.name}.codex.json`);
}

/* ------------------------------------------------------------------ the structure of a series */

/**
 * The Codex structure of a series, or null if it has none yet.
 * Series that had entries before Codex files existed use the Murim structure (their entries fit it).
 */
export async function schemaOf(seriesId, entries = null) {
  const series = await db.getSeries(seriesId);
  const list = entries || await db.getCodexOfSeries(seriesId);
  let types = series?.codex?.types;
  let legacy = false;
  if (!types?.length) {
    if (!list.length) return null;
    types = PRESETS.murim.types;
    legacy = true;
  }
  return {
    series,
    types,
    map: new Map(types.map(t => [t.id, t])),
    hideLater: series?.codex ? series.codex.hideLater !== false : true,
    legacy,
  };
}

const OTHER = { id: '_other', name: 'Other', plural: 'Other entries', color: 'silver', icon: 'star', fields: [] };
const typeIn = (schema, e) => schema?.map.get(e?.type) || OTHER;
const colorIn = (schema, e) => tagColor(typeIn(schema, e).color);
const iconOf = t => ICONS[t.icon] || ICONS.star;

/* ------------------------------------------------------------------ chapter-aware values */

const sinceOf = x => (typeof x === 'object' && x && Number.isFinite(x.since) ? x.since : 0);

/** Text values with their chapters, oldest first. */
export function textValues(entry, fid) {
  const v = entry.fields?.[fid];
  if (v == null || v === '') return [];
  if (typeof v === 'string') return [{ v, since: entry.since || 0 }];
  return [...v].filter(x => x && typeof x === 'object').sort((a, b) => a.since - b.since);
}
/** Connections with their chapters. */
export function linkValues(entry, fid) {
  const v = entry.fields?.[fid];
  if (!Array.isArray(v)) return [];
  return v.map(x => (typeof x === 'object' ? { id: x.id, label: x.label || '', since: sinceOf(x) } : { id: x, label: '', since: 0 }));
}
/** The text value true at a chapter (or ''), and how many later ones are hidden. */
function textAt(entry, fid, asOf) {
  const vals = textValues(entry, fid);
  const known = vals.filter(x => x.since <= asOf);
  return { value: known.length ? known[known.length - 1].v : '', history: known.slice(0, -1), later: vals.length - known.length };
}
const visible = (e, asOf) => (e.since || 0) <= asOf;

/** How far you've read a series: the furthest chapter read or opened. */
export async function progressOf(seriesId) {
  const [chapters, progress] = await Promise.all([db.getChaptersOfSeries(seriesId), db.getAllProgress()]);
  const ids = new Map(chapters.map(c => [c.id, c.number]));
  let max = 0;
  for (const c of chapters) if (c.read) max = Math.max(max, c.number);
  for (const p of progress) if (ids.has(p.chapterId)) max = Math.max(max, ids.get(p.chapterId));
  return max || chapters[0]?.number || 0;
}

/** Entries you know about at a chapter (all of them when hiding is off). */
export function knownAt(entries, schema, asOf) {
  if (!schema?.hideLater) return entries;
  return entries.filter(e => visible(e, asOf));
}

/* ------------------------------------------------------------------ small pieces */

const byId = list => new Map(list.map(x => [x.id, x]));
const sortByName = list => [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
const chTag = ch => (ch ? `<span class="cx-ch">${CLOCK}Ch. ${fmtNum(ch)}</span>` : '');

function avatarIn(schema, e, size = 40) {
  const t = typeIn(schema, e);
  return `<span class="cx-avatar" aria-hidden="true" style="--cx:${tagColor(t.color)};width:${size}px;height:${size}px">${svg(iconOf(t), Math.round(size / 2), 1.9)}</span>`;
}
function linkChip(schema, e, label = '') {
  if (!e) return '';
  return `<a class="cx-link" href="#/codex/${e.id}" style="--cx:${colorIn(schema, e)}">${svg(iconOf(typeIn(schema, e)), 15, 2)}${esc(e.name)}</a>${label ? `<span class="cx-rel">${esc(label)}</span>` : ''}`;
}
/** One line for lists: the first text value, else the first connections, else About. */
function summary(schema, e, all, asOf) {
  const t = typeIn(schema, e);
  const map = byId(all);
  for (const f of t.fields) {
    if (f.kind === 'link') continue;
    const { value } = textAt(e, f.id, asOf);
    if (value) return value;
  }
  for (const f of t.fields) {
    if (f.kind !== 'link') continue;
    const names = linkValues(e, f.id).filter(x => x.since <= asOf).map(x => map.get(x.id))
      .filter(x => x && (!schema.hideLater || visible(x, asOf))).map(x => x.name);
    if (names.length) return `${f.label} ${names.slice(0, 2).join(', ')}`;
  }
  return (e.about || '').split('\n')[0] || t.name;
}

/* ------------------------------------------------------------------ finding names in the text */

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

/** How often each entry is named in some text. Map(entryId → count). */
export function countMentions(textValue, entries) {
  const names = nameTable(entries);
  const re = namePattern(names);
  const out = new Map();
  if (!re) return out;
  for (const m of textValue.matchAll(re)) {
    const e = names.get(m[0]);
    if (e) out.set(e.id, (out.get(e.id) || 0) + 1);
  }
  return out;
}

export function clearNames(root) {
  root.querySelectorAll('span.cx-name').forEach(sp => {
    const parent = sp.parentNode;
    while (sp.firstChild) parent.insertBefore(sp.firstChild, sp);
    sp.remove();
    parent.normalize();
  });
}

/** Dotted underline under the names of these entries in the reader's paragraphs. */
export function applyNames(paras, entries, schema) {
  const names = nameTable(entries);
  const re = namePattern(names);
  if (!re) return;
  for (const p of paras) {
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) if (!node.parentElement.closest('.cx-name')) nodes.push(node);
    for (const textNode of nodes) {
      const hits = [...textNode.data.matchAll(re)];
      for (let i = hits.length - 1; i >= 0; i--) {
        const m = hits[i];
        const e = names.get(m[0]);
        const t = textNode.splitText(m.index);
        t.splitText(m[0].length);
        const sp = document.createElement('span');
        sp.className = 'cx-name';
        sp.dataset.entry = e.id;
        sp.style.setProperty('--cx', colorIn(schema, e));
        t.parentNode.insertBefore(sp, t);
        sp.appendChild(t);
      }
    }
  }
}

export function entryNamed(entries, textValue) {
  const t = String(textValue || '').trim().toLowerCase();
  return entries.find(e => [e.name, ...(e.aliases || [])].some(n => n && n.toLowerCase() === t));
}

/* ------------------------------------------------------------------ choosing a file */

function pickJson(onFile) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch {
      toast('That file isn’t valid JSON');
      return;
    }
    onFile(data, file.name);
  });
  input.click();
}

/** Confirm sheet when importing a structure straight into one series. */
function confirmStructure(seriesId, data, fileName, onDone) {
  const r = readCodexFile(data, fileName);
  if (!r.ok) {
    openSheet(`<h2>Can’t use this file</h2><ul class="cx-issues">${r.errors.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <p class="hint">Check the file with the Codex format guide, or ask the agent to fix it.</p>`);
    return;
  }
  openSheet(`
    <h2>Set up this Codex?</h2>
    <p class="hint" style="margin:0">${esc(fileName)} · ${plural(r.structure.types.length, 'room')}${r.structure.series ? ` · made for “${esc(r.structure.series)}”` : ''}</p>
    ${structureSummaryHtml(r.structure)}
    ${r.warnings.length ? `<details class="cx-warn"><summary>${plural(r.warnings.length, 'small fix', 'small fixes')} made</summary><ul>${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}
    <p class="hint" style="margin:0">The rooms start empty. Entries you already have stay.</p>
    <div class="two-btns"><button type="button" class="btn" data-cs="no">Cancel</button>
      <button type="button" class="btn btn-accent" data-cs="yes">Set up the Codex</button></div>`, sheet => {
    sheet.addEventListener('click', async e => {
      const b = e.target.closest('[data-cs]');
      if (!b) return;
      if (b.dataset.cs === 'yes') {
        await applyStructure(seriesId, r.structure, fileName);
        toast('Codex ready');
      }
      closeOverlay();
      if (b.dataset.cs === 'yes') onDone?.();
    });
  });
}

function openPresets(seriesId, onDone) {
  openSheet(`
    <h2>Ready-made structures</h2>
    <div class="cx-presets">${Object.entries(PRESETS).map(([k, p]) => `
      <button type="button" data-preset="${k}"><b>${esc(p.name)}</b><small>${esc(p.description)}</small></button>`).join('')}</div>
    <p class="hint" style="margin:0">You can import a file made for this book later; your entries stay.</p>`, sheet => {
    sheet.addEventListener('click', async e => {
      const b = e.target.closest('[data-preset]');
      if (!b) return;
      const p = PRESETS[b.dataset.preset];
      await applyStructure(seriesId, { types: p.types, description: p.description }, p.name);
      toast('Codex ready');
      closeOverlay();
      onDone?.();
    });
  });
}

export function openGuide() {
  openSheet(`
    <h2>Codex format guide</h2>
    <p class="cx-about">A Codex file describes the <b>rooms</b> of a series’ Codex (kinds of things: characters, sects, concepts…)
      and their <b>walls</b> (the fields of each room, and which rooms they connect to). It never contains entries — you add those while reading.</p>
    <p class="cx-about">The easiest way: give an AI agent the chapters and this prompt. It writes a file called
      <b>Series name.codex.json</b>. Import it in the Import tab (with or without chapters) or from the Codex tab.</p>
    <div class="cx-guide"><pre>${esc(CODEX_PROMPT.slice(0, 900))}…</pre></div>
    <button type="button" class="btn btn-accent" data-guide="copy">${I.copy} Copy the full prompt</button>`, sheet => {
    sheet.addEventListener('click', async e => {
      if (!e.target.closest('[data-guide="copy"]')) return;
      try { await navigator.clipboard.writeText(CODEX_PROMPT); toast('Prompt copied'); } catch { toast('Couldn’t copy'); }
    });
  });
}

/** When a series has no Codex yet and you try to add something. */
export function openNoCodex(seriesId, onDone) {
  openSheet(`
    <h2>No Codex for this series yet</h2>
    <p class="cx-about">A Codex needs its rooms first — the kinds of things this book has. Import a Codex file made for it, or start from a ready-made structure.</p>
    <div class="cx-actions">
      <button type="button" class="btn btn-accent" data-nc="import">${I.upload} Import a Codex file</button>
      <button type="button" class="btn" data-nc="preset">${CODEX_ICON} Use a ready-made structure</button>
      <button type="button" class="btn" data-nc="guide">${I.fileSm} Codex format guide</button>
    </div>`, sheet => {
    sheet.addEventListener('click', e => {
      const b = e.target.closest('[data-nc]');
      if (!b) return;
      if (b.dataset.nc === 'import') pickJson((data, name) => confirmStructure(seriesId, data, name, onDone));
      if (b.dataset.nc === 'preset') openPresets(seriesId, onDone);
      if (b.dataset.nc === 'guide') openGuide();
    });
  });
}

/* ------------------------------------------------------------------ series page: Codex tab */

export async function renderCodexTab(root, seriesId) {
  const entries = await db.getCodexOfSeries(seriesId);
  const schema = await schemaOf(seriesId, entries);
  const redraw = () => renderCodexTab(root, seriesId);

  if (!schema) {
    root.innerHTML = `<div class="codex-tab"><div class="empty cx-empty">
      <span class="empty-ico">${CODEX_ICON}</span>
      <strong>No Codex for this series</strong>
      <span>A Codex is a small wiki for this book: its own kinds of entries (characters, organizations, concepts…) and how they connect. You fill it yourself while reading.</span>
      <button type="button" class="btn btn-accent" data-cx="import">${I.upload} Import a Codex file</button>
      <button type="button" class="btn" data-cx="preset">${CODEX_ICON} Use a ready-made structure</button>
      <button type="button" class="btn" data-cx="guide">${I.fileSm} Codex format guide (for an agent)</button>
    </div></div>`;
  } else {
    const asOf = await progressOf(seriesId);
    const shown = knownAt(entries, schema, asOf);
    const hidden = entries.length - shown.length;
    const rooms = [...schema.types];
    const others = shown.filter(e => !schema.map.has(e.type));
    const section = (t, list) => `
      <section class="cx-sec" style="--cx:${tagColor(t.color)}">
        <div class="cx-sec-head">${svg(iconOf(t), 16, 2)}<b>${esc(t.plural)}</b>
          ${list.length ? `<span class="cx-count">${list.length}</span>` : ''}
          ${t.id !== '_other' ? `<button type="button" class="chip" data-cx-add="${esc(t.id)}">${I.plusSm} Add</button>` : ''}</div>
        ${list.length ? `<div class="cx-list">${sortByName(list).map(e => `
          <a class="cx-row" href="#/codex/${e.id}">${avatarIn(schema, e)}
            <span class="txt"><b>${esc(e.name)}</b><small>${esc(summary(schema, e, entries, asOf))}</small></span>${chTag(e.since)}</a>`).join('')}</div>`
        : `<div class="cx-empty-room">${esc(t.hint || `No ${t.plural.toLowerCase()} yet`)}</div>`}
      </section>`;
    root.innerHTML = `<div class="codex-tab">
      <div class="list-meta">
        <span>${plural(shown.length, 'entry', 'entries')}${schema.hideLater ? ` · as of Ch. ${fmtNum(asOf)}` : ''}</span>
        <button type="button" class="icon-btn" data-cx="menu" aria-label="Codex options">${I.dots}</button>
      </div>
      ${rooms.map(t => section(t, shown.filter(e => e.type === t.id))).join('')}
      ${others.length ? section(OTHER, others) : ''}
      ${hidden ? `<div class="cx-hidden">${LOCK}<span>${plural(hidden, 'entry', 'entries')} you learn about later ${hidden === 1 ? 'is' : 'are'} hidden.</span></div>` : ''}
    </div>`;
  }

  root.querySelector('.codex-tab').addEventListener('click', async e => {
    const add = e.target.closest('[data-cx-add]');
    if (add) {
      openEntryEditor({ seriesId, type: add.dataset.cxAdd, ctx: await progressOf(seriesId), onSaved: redraw });
      return;
    }
    const b = e.target.closest('[data-cx]');
    if (!b) return;
    if (b.dataset.cx === 'import') pickJson((data, name) => confirmStructure(seriesId, data, name, redraw));
    if (b.dataset.cx === 'preset') openPresets(seriesId, redraw);
    if (b.dataset.cx === 'guide') openGuide();
    if (b.dataset.cx === 'menu') openCodexMenu(seriesId, schema, entries, redraw);
  });
}

async function openCodexMenu(seriesId, schema, entries, redraw) {
  const series = schema.series;
  let confirmRemove = false;
  const row = (key, icon, label, sub, right = '') => `
    <button type="button" class="cx-menu-row${key === 'remove' ? ' is-danger' : ''}" data-cm="${key}">${icon}
      <span class="txt"><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span>${right}</button>`;
  const html = () => `
    <h2>${esc(series?.name || 'Series')} · Codex</h2>
    <div class="cx-menu">
      <label class="cx-menu-row">${LOCK}<span class="txt"><b>Hide what comes later</b>
        <small>While reading, show only what was known by that chapter</small></span>
        <input type="checkbox" role="switch" data-cm-hide ${schema.hideLater ? 'checked' : ''}></label>
      ${row('import', I.upload, schema.legacy ? 'Import a Codex file' : 'Import a new structure', 'Changes the rooms; your entries stay')}
      ${row('preset', CODEX_ICON, 'Ready-made structures', 'Murim / cultivation, Classic novel')}
      ${schema.legacy ? '' : row('export', I.download, 'Export the structure', `${esc(series?.name || 'series')}.codex.json · reuse it or give it to an agent`)}
      ${row('guide', I.fileSm, 'Codex format guide', 'The file format, with a prompt for an agent')}
      ${row('remove', I.trashSm, confirmRemove ? 'Tap again to remove' : 'Remove this Codex', entries.length ? `Also deletes its ${plural(entries.length, 'entry', 'entries')}` : '')}
    </div>`;
  openSheet('<div class="cx-menu-box"></div>', sheet => {
    const box = sheet.querySelector('.cx-menu-box');
    box.innerHTML = html();
    box.addEventListener('change', async e => {
      if (!e.target.matches('[data-cm-hide]')) return;
      const codex = series.codex || { types: schema.types, description: '', file: 'Murim / cultivation', importedAt: Date.now() };
      await db.updateSeries(seriesId, { codex: { ...codex, hideLater: e.target.checked } });
      schema.hideLater = e.target.checked;
      redraw();
    });
    box.addEventListener('click', async e => {
      const b = e.target.closest('[data-cm]');
      if (!b) return;
      const k = b.dataset.cm;
      if (k === 'import') pickJson((data, name) => confirmStructure(seriesId, data, name, redraw));
      if (k === 'preset') openPresets(seriesId, redraw);
      if (k === 'export') exportStructure(series);
      if (k === 'guide') openGuide();
      if (k === 'remove') {
        if (!confirmRemove) { confirmRemove = true; box.innerHTML = html(); return; }
        for (const en of entries) await db.deleteCodexEntry(en.id);
        await db.updateSeries(seriesId, { codex: null });
        toast('Codex removed');
        closeOverlay();
        redraw();
      }
    });
  });
}

/* ------------------------------------------------------------------ entry page (#/codex/ID) */

const viewAs = new Map(); // entry id → chapter chosen in "Viewing as of"

export async function renderEntryPage(app, id) {
  const entry = await db.getCodexEntry(id);
  if (!entry) {
    app.innerHTML = `<main class="page"><div class="empty"><strong>This entry no longer exists</strong>
      <a class="btn" href="#/">Back to library</a></div></main>`;
    return;
  }
  const [all, notesOf, chapters, progress] = await Promise.all([
    db.getCodexOfSeries(entry.seriesId), db.getAllNotes(), db.getChaptersOfSeries(entry.seriesId), progressOf(entry.seriesId),
  ]);
  const schema = await schemaOf(entry.seriesId, all);
  const series = schema?.series;
  const asOf = schema?.hideLater ? (viewAs.get(id) ?? progress) : Infinity;
  const map = byId(all);
  const t = typeIn(schema, entry);
  const names = [entry.name, ...(entry.aliases || [])].filter(Boolean).map(n => n.toLowerCase());
  const seen = e => !schema?.hideLater || visible(e, asOf);
  let hiddenCount = 0;

  const fieldsHtml = t.fields.map(f => {
    if (f.kind !== 'link') {
      const { value, history, later } = textAt(entry, f.id, asOf);
      hiddenCount += later;
      if (!value && !history.length) return '';
      return fieldBlock(f.label, `<div class="cx-history">
        ${history.map(h => `<div class="is-old">${chTag(h.since)}<span>${esc(h.v)}</span></div>`).join('')}
        ${value ? `<div>${chTag(textValues(entry, f.id).filter(x => x.since <= asOf).pop()?.since)}<span class="${f.kind === 'longtext' ? 'cx-about' : ''}">${esc(value)}</span></div>` : ''}
      </div>`);
    }
    const items = linkValues(entry, f.id).filter(x => map.has(x.id));
    const now = items.filter(x => x.since <= asOf && seen(map.get(x.id)));
    hiddenCount += items.length - now.length;
    return now.length ? fieldBlock(f.label, now.map(x => `<span class="cx-linkrow">${linkChip(schema, map.get(x.id), x.label)}${chTag(x.since)}</span>`).join('')) : '';
  }).join('');

  // Other entries that link here, as of the chosen chapter.
  const back = [];
  for (const other of all) {
    if (other.id === entry.id || !seen(other)) continue;
    for (const f of typeIn(schema, other).fields) {
      if (f.kind !== 'link') continue;
      const x = linkValues(other, f.id).find(y => y.id === entry.id && y.since <= asOf);
      if (x) back.push({ other, label: x.label || f.label });
    }
  }
  const linkedNotes = notesOf.filter(n => n.seriesId === entry.seriesId
    && names.some(nm => `${n.quote} ${n.text}`.toLowerCase().includes(nm)));
  const known = visible(entry, asOf);

  app.innerHTML = `<main class="page cx-page" style="--cx:${colorIn(schema, entry)}">
    <div class="cx-wash" aria-hidden="true"></div>
    <div class="row-head">
      <a class="icon-btn" href="#/series/${entry.seriesId}/codex" aria-label="Back to ${esc(series?.name || 'series')}">${I.back}</a>
      <button type="button" class="chip" data-cxa="edit">${I.pencilSm} Edit</button>
    </div>
    <div class="cx-hero">${avatarIn(schema, entry, 64)}
      <div class="txt"><h1>${esc(entry.name)}</h1>
        <small>${esc(t.name)}${entry.since ? ` · known from Ch. ${fmtNum(entry.since)}` : ''} · <span id="cx-seen"></span></small></div>
    </div>
    ${schema?.hideLater ? `<label class="cx-viewas">${svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', 18)}
      <span>Viewing as of</span>
      <select data-viewas>${chapters.map(c => `<option value="${c.number}"${c.number === asOf ? ' selected' : ''}>Ch. ${fmtNum(c.number)}${c.number === progress ? ' · your progress' : ''}</option>`).join('')}</select></label>` : ''}
    ${!known ? `<div class="cx-hidden">${LOCK}<span>You learn about ${esc(entry.name)} in Ch. ${fmtNum(entry.since)}.</span></div>` : ''}
    ${entry.aliases?.length ? fieldBlock('Also called', entry.aliases.map(a => `<span>${esc(a)}</span>`).join('<span class="cx-dot">·</span>')) : ''}
    ${fieldsHtml}
    ${entry.about ? fieldBlock('About', `<p class="cx-about">${esc(entry.about)}</p>`) : ''}
    ${back.length ? fieldBlock('Linked from', back.map(b => linkChip(schema, b.other, b.label)).join('')) : ''}
    ${hiddenCount ? `<div class="cx-hidden">${LOCK}<span>${plural(hiddenCount, 'detail')} from later chapters ${hiddenCount === 1 ? 'is' : 'are'} hidden.</span></div>` : ''}
    ${linkedNotes.length ? `<section class="cx-field"><h3>Notes that mention ${esc(entry.name)} · ${linkedNotes.length}</h3>
      <div class="cx-notes">${linkedNotes.slice(0, 20).map(n => `
        <a class="cx-note" href="${n.quote ? `#/read/${n.chapterId}/note/${n.id}` : `#/read/${n.chapterId}`}">
          ${n.quote ? `<b>${esc(n.quote.slice(0, 120))}</b>` : '<b>Chapter note</b>'}
          ${n.text ? `<span>${esc(n.text.slice(0, 160))}</span>` : ''}</a>`).join('')}</div></section>` : ''}
    <button type="button" class="btn cx-find" data-cxa="find">${I.searchSm} Find every mention</button>
  </main>`;

  const main = app.querySelector('main');
  main.querySelector('[data-viewas]')?.addEventListener('change', e => {
    viewAs.set(id, Number(e.target.value));
    renderEntryPage(app, id);
  });
  main.addEventListener('click', e => {
    const b = e.target.closest('[data-cxa]');
    if (!b) return;
    if (b.dataset.cxa === 'edit') {
      openEntryEditor({
        seriesId: entry.seriesId, entry, ctx: Number.isFinite(asOf) ? asOf : progress,
        onSaved: () => renderEntryPage(app, id),
        onDeleted: () => { location.hash = `#/series/${entry.seriesId}/codex`; },
      });
    }
    if (b.dataset.cxa === 'find') openFind({ term: entry.name, chapterId: null, seriesId: entry.seriesId });
  });

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
  return first ? `named first in Ch. ${fmtNum(first.number)} · in ${plural(count, 'chapter')}` : 'not named in any chapter yet';
}

/* ------------------------------------------------------------------ add / edit */

/** Chapter numbers of a series, for the − / + chapter controls. */
async function chapterNumbers(seriesId) {
  const list = (await db.getChaptersOfSeries(seriesId)).map(c => c.number).sort((a, b) => a - b);
  return list.length ? list : [1];
}
function step(nums, value, dir) {
  const i = nums.findIndex(n => n >= value);
  const at = i < 0 ? nums.length - 1 : (nums[i] === value ? i : (dir > 0 ? i - 1 : i));
  return nums[Math.min(nums.length - 1, Math.max(0, at + dir))];
}
const stepper = (key, label, value) => `
  <div class="cx-step"><span class="cx-step-ico">${CLOCK}</span><span class="cx-step-label">${label}</span>
    <button type="button" data-step="${key}:-1" aria-label="Earlier chapter">${MINUS}</button>
    <b>Ch. ${fmtNum(value)}</b>
    <button type="button" data-step="${key}:1" aria-label="Later chapter">${PLUS}</button></div>`;

/**
 * Open the entry editor.
 *  seriesId, entry (to edit) or name/type (new), ctx: the chapter you're at (reader chapter or progress),
 *  onSaved(entry), onDeleted()
 */
export async function openEntryEditor({ seriesId, entry = null, name = '', type = null, ctx = null, onSaved, onDeleted }) {
  let all = await db.getCodexOfSeries(seriesId);
  const schema = await schemaOf(seriesId, all);
  if (!schema) { openNoCodex(seriesId, () => openEntryEditor({ seriesId, entry, name, type, ctx, onSaved, onDeleted })); return; }
  const nums = await chapterNumbers(seriesId);
  const here = ctx ?? await progressOf(seriesId);
  const draft = entry ? structuredClone(entry) : {
    seriesId, type: schema.map.has(type) ? type : schema.types[0].id, name, aliases: [], since: here, fields: {}, about: '',
  };
  draft.fields ||= {};
  draft.since ??= 0;
  let changeAt = entry ? here : draft.since; // chapter for new values and connections
  // Text values typed in this session: field id → string (saved as a value from `changeAt`).
  const typed = {};
  let picker = null; // { field, q, label, since }
  let confirmDelete = false;

  const tdef = () => schema.map.get(draft.type) || schema.types[0];
  const map = () => byId(all);

  const textField = f => {
    const vals = textValues(draft, f.id);
    const shownNow = vals.filter(v => v.since <= changeAt).pop(); // the value the box shows
    const cur = typed[f.id] ?? (shownNow?.v || '');
    const older = vals.filter(v => v !== shownNow);
    const input = f.kind === 'longtext'
      ? `<textarea class="text-area" rows="3" data-tf="${esc(f.id)}" placeholder="${esc(f.hint || '')}">${esc(cur)}</textarea>`
      : `<input class="text-input" data-tf="${esc(f.id)}" value="${esc(cur)}" placeholder="${esc(f.hint || '')}" autocomplete="off">`;
    return `<label class="cx-efield"><span class="label">${esc(f.label)}</span>${input}
      ${entry && older.length ? `<div class="cx-hist">${older.map(v => `<span>${chTag(v.since)}${esc(v.v || '(cleared)')}
        <button type="button" data-hist="${esc(f.id)}:${v.since}" aria-label="Remove this value">${X}</button></span>`).join('')}</div>` : ''}</label>`;
  };

  const linkField = f => {
    const m = map();
    const items = linkValues(draft, f.id).filter(x => m.has(x.id));
    const chips = items.map(x => {
      const e = m.get(x.id);
      return `<span class="cx-pill" style="--cx:${colorIn(schema, e)}">${svg(iconOf(typeIn(schema, e)), 14, 2)}${esc(e.name)}${x.label ? `<i>${esc(x.label)}</i>` : ''}${x.since ? `<em>Ch. ${fmtNum(x.since)}</em>` : ''}
        <button type="button" data-unlink="${esc(f.id)}:${x.id}" aria-label="Remove ${esc(e.name)}">${X}</button></span>`;
    }).join('');
    const open = picker?.field === f.id;
    let pickHtml = '';
    if (open) {
      const q = picker.q.trim().toLowerCase();
      const taken = new Set(items.map(x => x.id));
      const options = sortByName(all.filter(e => f.to.includes(e.type) && e.id !== draft.id && !taken.has(e.id)
        && (!q || [e.name, ...(e.aliases || [])].some(n => n.toLowerCase().includes(q))))).slice(0, 6);
      const exact = all.some(e => f.to.includes(e.type) && e.name.toLowerCase() === q);
      const targets = f.to.map(id => schema.map.get(id)).filter(Boolean);
      pickHtml = `<div class="cx-picker">
        <input class="text-input" data-pick-q value="${esc(picker.q)}" placeholder="Search or name a new ${esc(targets.map(x => x.name.toLowerCase()).join(' / '))}" autocomplete="off">
        <div class="cx-options">
          ${options.map(e => `<button type="button" data-pick="${e.id}">${avatarIn(schema, e, 28)}${esc(e.name)}</button>`).join('')}
          ${q && !exact ? targets.map(x => `<button type="button" data-pick-new="${esc(x.id)}">${I.plusSm} New ${esc(x.name.toLowerCase())} “${esc(picker.q.trim())}”</button>`).join('') : ''}
          ${!options.length && !q ? `<span class="hint">Nothing to link yet — type a name to add one.</span>` : ''}
        </div>
        ${f.withLabel ? `<input class="text-input" data-pick-label value="${esc(picker.label)}" placeholder="${esc(f.labelHint || 'Relation, e.g. brother')}" autocomplete="off">` : ''}
        ${stepper('link', 'True from', picker.since)}
      </div>`;
    }
    const full = !f.multiple && items.length >= 1;
    return `<div class="cx-efield"><span class="label">${esc(f.label)}</span>
      <div class="cx-pills">${chips}<button type="button" class="cx-add" data-linkadd="${esc(f.id)}" aria-expanded="${open}">${I.plusSm} ${open ? 'Close' : full ? 'Change' : 'Link'}</button></div>
      ${pickHtml}</div>`;
  };

  const formHtml = () => {
    const t = tdef();
    return `
      <div class="cx-ed-head">${avatarIn(schema, draft, 44)}<div class="txt"><h2>${entry ? 'Edit' : 'New'} ${esc(t.name.toLowerCase())}</h2>
        <small>${esc(schema.series?.name || '')}</small></div></div>
      ${schema.types.length > 1 ? `<div class="cx-types" role="radiogroup" aria-label="Room">
        ${schema.types.map(x => `<button type="button" role="radio" aria-checked="${draft.type === x.id}" data-type="${esc(x.id)}" style="--cx:${tagColor(x.color)}">
          ${svg(iconOf(x), 18, 1.9)}<span>${esc(x.name)}</span></button>`).join('')}</div>` : ''}
      <label class="cx-efield"><span class="label">Name</span>
        <input class="text-input" data-f="name" value="${esc(draft.name)}" maxlength="80" autocomplete="off"></label>
      ${stepper('known', 'Known from', draft.since || nums[0])}
      <label class="cx-efield"><span class="label">Also called</span>
        <input class="text-input" data-f="aliases" value="${esc((draft.aliases || []).join(', '))}" placeholder="Other names, separated by commas" autocomplete="off"></label>
      ${entry ? `<div class="cx-change">${stepper('change', 'New details from', changeAt)}
        <small>Values you change and connections you add count from this chapter. The old ones stay as history.</small></div>` : ''}
      ${t.fields.map(f => (f.kind === 'link' ? linkField(f) : textField(f))).join('')}
      <label class="cx-efield"><span class="label">About</span>
        <textarea class="text-area" data-f="about" rows="3" placeholder="Anything worth remembering…">${esc(draft.about || '')}</textarea></label>
      <p class="hint" style="margin:0">Only the name is needed. When you re-read earlier chapters, things you learned later stay hidden.</p>
      <div class="two-btns">
        <button type="button" class="btn" data-ed="cancel">Cancel</button>
        <button type="button" class="btn btn-accent" data-ed="save">${entry ? 'Save' : 'Add'}</button>
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

  const addLink = id => {
    const f = tdef().fields.find(x => x.id === picker.field);
    let list = linkValues(draft, f.id);
    if (!f.multiple) list = [];
    list.push({ id, label: (picker.label || '').trim(), since: picker.since });
    draft.fields[f.id] = list;
    picker = null;
    draw();
  };

  box.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.f === 'name') draft.name = el.value;
    else if (el.dataset.f === 'aliases') draft.aliases = el.value.split(',').map(s => s.trim()).filter(Boolean);
    else if (el.dataset.f === 'about') draft.about = el.value;
    else if (el.dataset.tf) typed[el.dataset.tf] = el.value;
    else if (el.dataset.pickLabel != null) picker.label = el.value;
    else if (el.dataset.pickQ != null) {
      picker.q = el.value;
      const pos = el.selectionStart;
      draw(true);
      box.querySelector('[data-pick-q]')?.setSelectionRange(pos, pos);
    }
  });

  box.addEventListener('click', async e => {
    const st = e.target.closest('[data-step]');
    if (st) {
      const [key, dir] = st.dataset.step.split(':');
      const d = Number(dir);
      if (key === 'known') {
        draft.since = step(nums, draft.since || nums[0], d);
        if (!entry) changeAt = draft.since;
      } else if (key === 'change') changeAt = step(nums, changeAt, d);
      else if (key === 'link') picker.since = step(nums, picker.since, d);
      draw(key === 'link');
      return;
    }
    const ty = e.target.closest('[data-type]');
    if (ty) { draft.type = ty.dataset.type; picker = null; draw(); return; }
    const add = e.target.closest('[data-linkadd]');
    if (add) {
      picker = picker?.field === add.dataset.linkadd ? null : { field: add.dataset.linkadd, q: '', label: '', since: changeAt };
      draw(!!picker);
      return;
    }
    const un = e.target.closest('[data-unlink]');
    if (un) {
      const [fid, id] = un.dataset.unlink.split(':');
      draft.fields[fid] = linkValues(draft, fid).filter(x => x.id !== Number(id));
      draw();
      return;
    }
    const hist = e.target.closest('[data-hist]');
    if (hist) {
      const [fid, since] = hist.dataset.hist.split(':');
      draft.fields[fid] = textValues(draft, fid).filter(v => v.since !== Number(since));
      draw();
      return;
    }
    const pick = e.target.closest('[data-pick]');
    if (pick) { addLink(Number(pick.dataset.pick)); return; }
    const pickNew = e.target.closest('[data-pick-new]');
    if (pickNew) {
      const t = schema.map.get(pickNew.dataset.pickNew);
      const made = await db.putCodexEntry({ seriesId, type: t.id, name: picker.q.trim(), aliases: [], since: picker.since, fields: {}, about: '' });
      all = [...all, made];
      toast(`${t.name} “${made.name}” added`);
      addLink(made.id);
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
      if (clash) { toast(`“${clash.name}” is already in the Codex`); return; }
      // Typed text becomes the value from `changeAt` (replacing one from the same chapter).
      for (const [fid, v] of Object.entries(typed)) {
        const value = v.trim();
        const vals = textValues(draft, fid);
        if ((textAt(draft, fid, changeAt).value || '') === value) continue;
        const rest = vals.filter(x => x.since !== changeAt);
        if (value || rest.some(x => x.since < changeAt)) rest.push({ v: value, since: changeAt });
        draft.fields[fid] = rest.sort((a, b) => a.since - b.since);
      }
      const saved = await db.putCodexEntry({ ...draft, name: nm });
      toast(entry ? 'Entry saved' : 'Added to the Codex');
      closeOverlay();
      onSaved?.(saved);
    }
  });
}

/* ------------------------------------------------------------------ reader: quick card and Codex tool */

/** Quick card for a name tapped in the reader, as known at chapter `asOf`. */
export async function openPeek(id, { asOf = Infinity, onNote, noteLabel = 'Add a note' } = {}) {
  const entry = await db.getCodexEntry(id);
  if (!entry) return;
  const all = await db.getCodexOfSeries(entry.seriesId);
  const schema = await schemaOf(entry.seriesId, all);
  const map = byId(all);
  const t = typeIn(schema, entry);
  const limit = schema?.hideLater ? asOf : Infinity;

  const build = upTo => {
    const rows = [];
    let hidden = 0;
    let firstText = '';
    for (const f of t.fields) {
      if (f.kind !== 'link') {
        const r = textAt(entry, f.id, upTo);
        hidden += r.later;
        if (r.value && !firstText && f.kind === 'text') firstText = r.value;
        continue;
      }
      for (const x of linkValues(entry, f.id)) {
        const target = map.get(x.id);
        if (!target) continue;
        if (x.since > upTo || (target.since || 0) > upTo) { hidden++; continue; }
        if (rows.length < 4) rows.push(`<div class="cx-peek-row"><span>${esc(x.label || f.label)}</span>${linkChip(schema, target)}</div>`);
      }
    }
    return `
      <div class="cx-peek-head">${avatarIn(schema, entry, 48)}
        <div class="txt"><b>${esc(entry.name)}</b><small>${esc(t.name)}${firstText ? ` · ${esc(firstText)}` : ''}</small></div></div>
      ${rows.join('')}
      ${entry.about ? `<p class="cx-about">${esc(entry.about.slice(0, 240))}</p>` : ''}
      ${hidden ? `<div class="cx-hidden">${LOCK}<span>${plural(hidden, 'thing')} you learn later ${hidden === 1 ? 'is' : 'are'} hidden — you’re at Ch. ${fmtNum(asOf)}.</span>
        <button type="button" data-pk="show">Show</button></div>` : ''}
      <div class="two-btns">
        <button type="button" class="btn btn-accent" data-pk="open">Open entry</button>
        ${onNote ? `<button type="button" class="btn" data-pk="note">${I.note} ${esc(noteLabel)}</button>` : ''}
      </div>`;
  };
  openSheet(`<div class="cx-peek">${build(limit)}</div>`, sheet => {
    sheet.addEventListener('click', e => {
      const a = e.target.closest('a.cx-link');
      if (a) { e.preventDefault(); closeOverlay({ navTo: a.getAttribute('href') }); return; }
      const b = e.target.closest('[data-pk]');
      if (b?.dataset.pk === 'show') { sheet.querySelector('.cx-peek').innerHTML = build(Infinity); return; }
      if (b?.dataset.pk === 'open') closeOverlay({ navTo: `#/codex/${entry.id}` });
      if (b?.dataset.pk === 'note') onNote(entry);
    });
  });
}

/** The reader's Codex tool: entries named in this chapter, search, and New. */
export async function openReaderCodex({ seriesId, chapterText, asOf, onChanged }) {
  const every = await db.getCodexOfSeries(seriesId);
  const schema = await schemaOf(seriesId, every);
  if (!schema) { openNoCodex(seriesId, () => onChanged?.()); return; }
  const all = knownAt(every, schema, asOf);
  const here = countMentions(chapterText, all);
  let q = '';
  const row = (e, meta) => `<a class="cx-row" href="#/codex/${e.id}">${avatarIn(schema, e)}
    <span class="txt"><b>${esc(e.name)}</b><small>${esc(summary(schema, e, every, asOf))}</small></span><span class="cx-meta">${meta}</span></a>`;
  const listHtml = () => {
    const s = q.trim().toLowerCase();
    if (s) {
      const found = sortByName(all.filter(e => [e.name, ...(e.aliases || [])].some(n => n.toLowerCase().includes(s))));
      return `<h3 class="cx-h">${plural(found.length, 'match', 'matches')}</h3>
        <div class="cx-list">${found.map(e => row(e, esc(typeIn(schema, e).name))).join('') || '<p class="hint">Nothing found.</p>'}</div>`;
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
    <a class="hint cx-all" href="#/series/${seriesId}/codex">All rooms are on the series page → Codex</a>`, sheet => {
    sheet.classList.add('cx-sheet');
    sheet.querySelector('[data-rc-q]')?.addEventListener('input', e => {
      q = e.target.value;
      sheet.querySelector('.cx-results').innerHTML = listHtml();
    });
    sheet.addEventListener('click', e => {
      const a = e.target.closest('a[href]');
      if (a) { e.preventDefault(); closeOverlay({ navTo: a.getAttribute('href') }); return; }
      if (e.target.closest('[data-rc="new"]')) openEntryEditor({ seriesId, ctx: asOf, onSaved: () => onChanged?.() });
    });
  });
}
