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
import { esc, I, svg, plural, fmtNum, toast, openSheet, closeOverlay, goBack, pushOverlayStep, popOverlayStep, trailInfo, enterPageMode, exitPageMode, inPageMode, onLongPress } from './ui.js';
import { tagColor, TAG_COLORS } from './notes.js';
import { openFind } from './find.js';
import { trashEntry, trashValues, recordValues } from './trash.js';
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
/** A room's icon as svg markup. */
export const roomIcon = (t, size = 16) => svg(iconOf(t), size, 2);

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
  return v.map(x => (typeof x === 'object'
    ? { id: x.id, label: x.label || '', since: sinceOf(x), until: Number.isFinite(x?.until) ? x.until : null }
    : { id: x, label: '', since: 0, until: null }));
}
/** A connection as of a chapter: 'later' (not learned yet), 'now', or 'past' (ended before). */
export function linkState(x, asOf) {
  if (x.since > asOf) return 'later';
  return x.until != null && asOf > x.until ? 'past' : 'now';
}
const spanText = (a, b) => (b == null ? `Ch. ${fmtNum(a || 1)}` : `Ch. ${fmtNum(a || 1)}–${fmtNum(b)}`);
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

/* "Viewing as of" is one choice per series: it stays while you move between entries. */
const VIEW_KEY = 'reader-codex-asof';
function readViewAs() { try { return JSON.parse(sessionStorage.getItem(VIEW_KEY)) || {}; } catch { return {}; } }
export function getViewAs(seriesId) { const v = readViewAs()[seriesId]; return Number.isFinite(v) ? v : null; }
export function setViewAs(seriesId, chapter) {
  const all = readViewAs();
  if (chapter == null) delete all[seriesId]; else all[seriesId] = chapter;
  try { sessionStorage.setItem(VIEW_KEY, JSON.stringify(all)); } catch { /* private mode */ }
}
/** The chapter the Codex pages show things as of. */
async function codexAsOf(seriesId, schema) {
  if (!schema?.hideLater) return Infinity;
  return getViewAs(seriesId) ?? await progressOf(seriesId);
}

/* Rooms whose names are switched off in the reader ("Show in text" → Codex), per series. */
const ROOMS_KEY = 'reader-hidden-rooms';
export function hiddenRooms(seriesId) {
  try { return new Set(JSON.parse(localStorage.getItem(ROOMS_KEY))?.[seriesId] || []); } catch { return new Set(); }
}
export function setHiddenRooms(seriesId, set) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(ROOMS_KEY)) || {}; } catch { /* fresh */ }
  if (set.size) all[seriesId] = [...set]; else delete all[seriesId];
  try { localStorage.setItem(ROOMS_KEY, JSON.stringify(all)); } catch { /* private mode */ }
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
    const names = linkValues(e, f.id).filter(x => linkState(x, asOf) === 'now').map(x => map.get(x.id))
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
    <p class="hint tip" style="margin:0">The rooms start empty. Entries you already have stay.</p>
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
    <p class="hint tip" style="margin:0">You can import a file made for this book later; your entries stay.</p>`, sheet => {
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

/* Codex tab: rooms picked and sort, remembered per series; search per visit. */
const CX_SORTS = {
  az: { short: 'A–Z', name: 'A–Z', hint: 'By name' },
  added: { short: 'Added', name: 'Recently added', hint: 'The ones you added last come first' },
  appear: { short: 'Appearance', name: 'Order of appearance', hint: 'By “Known from” chapter, earliest first' },
  changed: { short: 'Changed', name: 'Recently changed', hint: 'Entries you edited last come first' },
};
const VIEW_STORE = 'reader-codex-view';
const codexQuery = new Map();
function codexView(seriesId) {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(VIEW_STORE))?.[seriesId]; } catch { /* none */ }
  return { rooms: Array.isArray(v?.rooms) ? v.rooms : [], sort: CX_SORTS[v?.sort] ? v.sort : 'az' };
}
function saveCodexView(seriesId, v) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(VIEW_STORE)) || {}; } catch { /* fresh */ }
  all[seriesId] = { rooms: v.rooms, sort: v.sort };
  try { localStorage.setItem(VIEW_STORE, JSON.stringify(all)); } catch { /* private mode */ }
}
function sortEntries(list, sort) {
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  const cmp = {
    az: byName,
    added: (a, b) => (b.createdAt || b.id) - (a.createdAt || a.id),
    appear: (a, b) => (a.since || 0) - (b.since || 0) || byName(a, b),
    changed: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
  }[sort] || byName;
  return [...list].sort(cmp);
}
function openCodexSort(seriesId, onChanged) {
  const v = codexView(seriesId);
  openSheet(`<h2>Sort entries</h2>
    <div class="option-list" role="radiogroup" aria-label="Sort entries">
      ${Object.entries(CX_SORTS).map(([k, o]) => `<label class="option-row${v.sort === k ? ' is-on' : ''}">
        <span class="txt">${o.name}<small>${o.hint}</small></span>
        <input type="radio" name="cxsort" value="${k}" ${v.sort === k ? 'checked' : ''}></label>`).join('')}
    </div>
    <p class="hint tip">Remembered for this series, together with the rooms you picked.</p>`, sheet => {
    sheet.addEventListener('change', e => {
      v.sort = e.target.value;
      saveCodexView(seriesId, v);
      closeOverlay();
      onChanged();
    });
  });
}

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
    const progress = await progressOf(seriesId);
    const asOf = await codexAsOf(seriesId, schema);
    const shown = knownAt(entries, schema, asOf);
    const hidden = entries.length - shown.length;
    const view = codexView(seriesId);
    view.rooms = view.rooms.filter(r => schema.map.has(r) || r === '_other');
    const others = shown.filter(e => !schema.map.has(e.type));
    const rooms = [...schema.types, ...(others.length ? [OTHER] : [])];
    const countIn = id => shown.filter(e => (id === '_other' ? !schema.map.has(e.type) : e.type === id)).length;
    root.innerHTML = `<div class="codex-tab">
      <label class="search-box cx-search">${I.search}<span class="visually-hidden">Search the Codex</span>
        <input type="search" id="cx-q" placeholder="Search names and other names" value="${esc(codexQuery.get(seriesId) || '')}" autocomplete="off"></label>
      <nav class="filter-chips cx-chips" aria-label="Rooms">
        <button type="button" class="range-chip sort-chip" data-cx="sort">${svg('<path d="M7 4v16M3 16l4 4 4-4M14 5h7M14 10h5M14 15h3"/>', 16, 2)}${CX_SORTS[view.sort].short}${svg('<path d="M6 9l6 6 6-6"/>', 14, 2)}</button>
        <span class="chip-sep" aria-hidden="true"></span>
        <button type="button" data-room="all" aria-pressed="${!view.rooms.length}">All <span class="count">${shown.length}</span></button>
        ${rooms.map(t => `<button type="button" data-room="${esc(t.id)}" aria-pressed="${view.rooms.includes(t.id)}" style="--cx:${tagColor(t.color)}">
          ${svg(iconOf(t), 14, 2.2)}${esc(t.plural)} <span class="count">${countIn(t.id)}</span></button>`).join('')}
      </nav>
      <div class="list-meta">
        <span id="cx-count"></span>
        <button type="button" class="icon-btn" data-cx="menu" aria-label="Codex options">${I.dots}</button>
      </div>
      <div class="cx-results"></div>
      ${hidden ? `<div class="cx-hidden">${LOCK}<span>${plural(hidden, 'entry', 'entries')} you learn about later ${hidden === 1 ? 'is' : 'are'} hidden.</span></div>` : ''}
    </div>`;

    const results = root.querySelector('.cx-results');
    const rowHtml = e => `<a class="cx-row" href="#/codex/${e.id}">${avatarIn(schema, e)}
      <span class="txt"><b>${esc(e.name)}</b><small>${esc(summary(schema, e, entries, asOf))}</small></span>${chTag(e.since)}</a>`;
    const drawList = () => {
      const q = (codexQuery.get(seriesId) || '').trim().toLowerCase();
      const inRoom = e => !view.rooms.length || view.rooms.includes(schema.map.has(e.type) ? e.type : '_other');
      const match = e => !q || [e.name, ...(e.aliases || [])].some(n => n.toLowerCase().includes(q));
      const list = sortEntries(shown.filter(e => inRoom(e) && match(e)), view.sort);
      const what = view.rooms.length === 1 ? (rooms.find(t => t.id === view.rooms[0])?.plural || 'entries').toLowerCase() : 'entries';
      root.querySelector('#cx-count').innerHTML = `${list.length} ${list.length === 1 && view.rooms.length === 1 ? (rooms.find(t => t.id === view.rooms[0])?.name || 'entry').toLowerCase() : what}${schema.hideLater ? ` · as of Ch. ${fmtNum(asOf)}` : ''}${schema.hideLater && asOf !== progress
        ? ` · <button type="button" class="link-btn" data-cx="progress">My progress</button>` : ''}`;
      if (!view.rooms.length && !q) {
        // Everything, grouped by room (each room sorted the chosen way), with Add buttons.
        results.innerHTML = rooms.map(t => {
          const inT = list.filter(e => (t.id === '_other' ? !schema.map.has(e.type) : e.type === t.id));
          if (t.id === '_other' && !inT.length) return '';
          return `<section class="cx-sec" style="--cx:${tagColor(t.color)}">
            <div class="cx-sec-head">${svg(iconOf(t), 16, 2)}<b>${esc(t.plural)}</b>
              ${inT.length ? `<span class="cx-count">${inT.length}</span>` : ''}
              ${t.id !== '_other' ? `<button type="button" class="chip" data-cx-add="${esc(t.id)}">${I.plusSm} Add</button>` : ''}</div>
            ${inT.length ? `<div class="cx-list">${inT.map(rowHtml).join('')}</div>`
              : `<div class="cx-empty-room">${esc(t.hint || `No ${t.plural.toLowerCase()} yet`)}</div>`}
          </section>`;
        }).join('');
        return;
      }
      const addable = view.rooms.filter(r => r !== '_other').map(r => schema.map.get(r)).filter(Boolean);
      results.innerHTML = `${addable.length ? `<div class="cx-addrow">${addable.map(t => `<button type="button" class="chip" data-cx-add="${esc(t.id)}">${I.plusSm} Add ${esc(t.name.toLowerCase())}</button>`).join('')}</div>` : ''}
        ${list.length ? `<div class="cx-list cx-flat">${list.map(rowHtml).join('')}</div>`
          : `<div class="empty" style="padding:30px 16px"><span>${q ? `Nothing matches “${esc(codexQuery.get(seriesId))}”.` : 'Nothing here yet.'}</span></div>`}`;
    };
    drawList();
    root.querySelector('#cx-q').addEventListener('input', e => { codexQuery.set(seriesId, e.target.value); drawList(); });
    root.querySelector('.cx-chips').addEventListener('click', e => {
      const r = e.target.closest('[data-room]');
      if (!r) return;
      const id = r.dataset.room;
      if (id === 'all') view.rooms = [];
      else view.rooms = view.rooms.includes(id) ? view.rooms.filter(x => x !== id) : [...view.rooms, id];
      saveCodexView(seriesId, view);
      root.querySelectorAll('[data-room]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.room === 'all' ? !view.rooms.length : view.rooms.includes(b.dataset.room))));
      drawList();
    });
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
    if (b.dataset.cx === 'progress') { setViewAs(seriesId, null); redraw(); }
    if (b.dataset.cx === 'sort') openCodexSort(seriesId, redraw);
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

const openDrawers = new Set(); // "entryId:fieldId:targetId" rows whose ▾ is open
const CHEV = svg('<path d="M6 9l6 6 6-6"/>', 18, 2);
const PEN = svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>', 15, 1.9);

/** One connection row: the name goes to that entry, the ▾ opens its details. */
function linkRow(schema, target, x, key, { past = false, detail = '', editable = null, item = null } = {}) {
  const open = openDrawers.has(key);
  const desc = x.label ? `<div class="cx-dw-desc"><small>Description</small><span>${esc(x.label)}</span></div>` : '';
  const when = x.until != null
    ? `${x.since ? `True from Ch. ${fmtNum(x.since)}` : 'From the start'} · last true in Ch. ${fmtNum(x.until)}`
    : `${x.since ? `True from Ch. ${fmtNum(x.since)}` : 'From the start'} · still true`;
  return `<div class="cx-lrow${past ? ' is-past' : ''}${open ? ' is-open' : ''}"${item ? ` data-key="${item}"` : ''}>
    <div class="cx-lhead">
      <a class="cx-lname" href="#/codex/${target.id}">${avatarIn(schema, target, 30)}<span>${esc(target.name)}</span>
        ${past ? `<em>${spanText(x.since, x.until)}</em>` : ''}</a>
      <button type="button" class="cx-chev" data-drawer="${key}" aria-expanded="${open}" aria-label="${open ? 'Hide' : 'Show'} details">${CHEV}</button>
    </div>
    ${open ? `<div class="cx-drawer">${detail}${desc}
      <div class="cx-dw-when">${CLOCK}<span>${when}</span></div>
      ${editable ? `<div class="cx-dw-btns">
        <button type="button" class="btn" data-cxa="edit-link" data-f="${esc(editable.fid)}" data-i="${editable.i}">${PEN} Edit</button>
        <button type="button" class="btn cx-dw-del" data-cxa="del" data-key="${item}">${I.trashSm} Delete</button></div>` : ''}
    </div>` : ''}
  </div>`;
}

let sel = null; // entry page select mode: { entryId, keys: Set }

/** Return bar: "↩ Ch. 41 · Seo Jin › Ghost Adept › (this)" — where you came into the Codex from. */
async function returnBarHtml(entry, map) {
  const { depth, trail } = trailInfo();
  const crumbs = [];
  let i = depth - 1;
  for (; i >= 0; i--) {
    const m = /^#\/codex\/(\d+)$/.exec(trail[i]?.h || '');
    if (!m) break;
    crumbs.unshift({ id: Number(m[1]), steps: depth - i });
  }
  const origin = i >= 0 ? trail[i] : null;
  let label = null;
  const read = /^#\/read\/(\d+)/.exec(origin?.h || '');
  if (read) {
    const ch = await db.getChapter(Number(read[1]));
    label = ch ? `Ch. ${fmtNum(ch.number)}` : 'Reading';
  } else if (/^#\/series\//.test(origin?.h || '')) label = 'Series';
  else if (/^#\/notes/.test(origin?.h || '')) label = 'Notes';
  const named = crumbs.filter(c => map.has(c.id) && c.id !== entry.id);
  if (!label && !named.length) return '';
  if (!read && !named.length) return ''; // one step from the series page: the back arrow already does it
  const shown = named.slice(-3);
  return `<nav class="cx-return" aria-label="Where you came from">
    ${label ? `<button type="button" class="cx-ret-origin" data-steps="${depth - i}">${svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', 15, 2.2)}${esc(label)}</button>` : ''}
    <span class="cx-crumbs">${named.length > shown.length ? '<span class="sep">…</span>' : ''}${shown.map(c => `<button type="button" data-steps="${c.steps}">${esc(map.get(c.id).name)}</button><span class="sep" aria-hidden="true">›</span>`).join('')}<b aria-current="page">${esc(entry.name)}</b></span>
  </nav>`;
}

export async function renderEntryPage(app, id) {
  const entry = await db.getCodexEntry(id);
  if (!entry) {
    app.innerHTML = `<main class="page"><div class="empty"><strong>This entry no longer exists</strong>
      <span>It may be in the Trash (Settings → Trash).</span>
      <a class="btn" href="#/" data-back>Back</a></div></main>`;
    return;
  }
  const [all, notesOf, chapters, progress] = await Promise.all([
    db.getCodexOfSeries(entry.seriesId), db.getAllNotes(), db.getChaptersOfSeries(entry.seriesId), progressOf(entry.seriesId),
  ]);
  const schema = await schemaOf(entry.seriesId, all);
  const asOf = await codexAsOf(entry.seriesId, schema);
  const map = byId(all);
  const t = typeIn(schema, entry);
  const names = [entry.name, ...(entry.aliases || [])].filter(Boolean).map(n => n.toLowerCase());
  const seen = e => !schema?.hideLater || visible(e, asOf);
  if (sel && (sel.entryId !== entry.id || !inPageMode())) sel = null;
  const selecting = !!sel;
  let hiddenCount = 0;

  // Every value / connection of this entry that can be selected or deleted, by key.
  const items = new Map();
  const fieldKeys = new Map(); // field id → keys shown
  const check = key => `<span class="sel-box${sel?.keys.has(key) ? ' is-on' : ''}" aria-hidden="true">${sel?.keys.has(key) ? svg('<path d="M5 12l5 5 9-10"/>', 13, 3) : ''}</span>`;
  const selRow = (key, inner, cls = '') => `<button type="button" class="cx-srow ${cls}" data-pick-key="${esc(key)}" aria-pressed="${!!sel?.keys.has(key)}">${check(key)}${inner}</button>`;
  const head = (label, fid) => (selecting && (fieldKeys.get(fid)?.length || 0) > 0
    ? `<div class="cx-fhead"><h3>${esc(label)}</h3><button type="button" class="link-btn" data-selall="${esc(fid)}">${fieldKeys.get(fid).every(k => sel.keys.has(k)) ? 'Clear' : 'Select all'}</button></div>`
    : `<h3>${esc(label)}</h3>`);
  const block = (label, fid, inner) => `<section class="cx-field">${head(label, fid)}<div class="cx-card">${inner}</div></section>`;

  const fieldsHtml = t.fields.map(f => {
    const keys = [];
    fieldKeys.set(f.id, keys);
    if (f.kind !== 'link') {
      const vals = textValues(entry, f.id);
      const known = vals.filter(x => x.since <= asOf);
      hiddenCount += vals.length - known.length;
      if (!known.length || (known.length === 1 && !known[0].v)) return '';
      const rows = [...known].reverse().map((h, i) => {
        if (!h.v) return '';
        const key = `t:${f.id}:${h.since}`;
        keys.push(key);
        items.set(key, itemFor(f, h, map));
        const old = i > 0;
        const next = old ? known[known.length - i] : null;
        const tagHtml = old ? `<em>${spanText(h.since, next ? next.since - 1 : null)}</em>` : chTag(h.since);
        if (selecting) return selRow(key, `<span class="txt${f.kind === 'longtext' ? ' cx-about' : ''}">${esc(h.v)}</span>${tagHtml}`, old ? 'is-old' : '');
        const open = openDrawers.has(`${entry.id}:${key}`);
        return `<div class="cx-vrow${old ? ' is-old' : ''}${open ? ' is-open' : ''}" data-key="${esc(key)}">
          <div class="cx-vhead"><span class="${f.kind === 'longtext' ? 'cx-about' : ''}">${esc(h.v)}</span>${tagHtml}
            <button type="button" class="cx-chev" data-drawer="${entry.id}:${esc(key)}" aria-expanded="${open}" aria-label="${open ? 'Hide' : 'Show'} details">${CHEV}</button></div>
          ${open ? `<div class="cx-drawer"><div class="cx-dw-when">${CLOCK}<span>${old ? `True in ${spanText(h.since, next ? next.since - 1 : null)}` : `True from Ch. ${fmtNum(h.since || 1)}`}</span></div>
            <div class="cx-dw-btns"><button type="button" class="btn" data-cxa="edit-val" data-f="${esc(f.id)}" data-since="${h.since}">${PEN} Edit</button>
              <button type="button" class="btn cx-dw-del" data-cxa="del" data-key="${esc(key)}">${I.trashSm} Delete</button></div></div>` : ''}
        </div>`;
      }).join('');
      return rows ? block(f.label, f.id, rows) : '';
    }
    const list = linkValues(entry, f.id).map((x, i) => ({ ...x, i })).filter(x => map.has(x.id));
    const ok = list.filter(x => seen(map.get(x.id)) || !schema?.hideLater);
    const now = ok.filter(x => linkState(x, asOf) === 'now');
    const past = ok.filter(x => linkState(x, asOf) === 'past');
    hiddenCount += list.length - now.length - past.length;
    if (!now.length && !past.length) return '';
    const row = (x, isPast) => {
      const key = `l:${f.id}:${x.i}`;
      keys.push(key);
      items.set(key, itemFor(f, x, map));
      const target = map.get(x.id);
      if (selecting) {
        return selRow(key, `${avatarIn(schema, target, 30)}<span class="txt"><b>${esc(target.name)}</b>
          <small>${esc([x.label, isPast ? spanText(x.since, x.until) : `Ch. ${fmtNum(x.since || 1)} →`].filter(Boolean).join(' · '))}</small></span>`, isPast ? 'is-old' : '');
      }
      return linkRow(schema, target, x, `${entry.id}:${f.id}:${x.id}`, { past: isPast, editable: { fid: f.id, i: x.i }, item: key });
    };
    return block(f.label, f.id, `${now.map(x => row(x, false)).join('')}
      ${past.length ? `<div class="cx-past-h">Past</div>${past.map(x => row(x, true)).join('')}` : ''}`);
  }).join('');

  // "Also called" and "About" can be selected too.
  const aliasKeys = (entry.aliases || []).map(a => {
    const key = `a:${a}`;
    items.set(key, { fid: '_alias', label: 'Also called', kind: 'text', value: a, text: `“${a}”` });
    return key;
  });
  fieldKeys.set('_alias', aliasKeys);
  const aliasesHtml = entry.aliases?.length ? block('Also called', '_alias', entry.aliases.map((a, i) => (selecting
    ? selRow(aliasKeys[i], `<span class="txt">${esc(a)}</span>`)
    : `<div class="cx-vrow" data-key="${esc(aliasKeys[i])}"><div class="cx-vhead"><span>${esc(a)}</span></div></div>`)).join('')) : '';
  if (entry.about) items.set('ab', { fid: '_about', label: 'About', kind: 'text', value: entry.about, text: `“${entry.about.slice(0, 40)}”` });
  fieldKeys.set('_about', entry.about ? ['ab'] : []);
  const aboutHtml = entry.about ? (selecting
    ? `<section class="cx-field"><h3>About</h3>${selRow('ab', `<span class="txt cx-about">${esc(entry.about)}</span>`, 'is-card')}</section>`
    : `<section class="cx-field"><h3>About</h3><div class="cx-card"><p class="cx-about cx-pad" data-key="ab">${esc(entry.about)}</p></div></section>`) : '';

  // Other entries that link here, as of the chosen chapter.
  const back = [];
  for (const other of all) {
    if (other.id === entry.id || !seen(other)) continue;
    for (const f of typeIn(schema, other).fields) {
      if (f.kind !== 'link') continue;
      const x = linkValues(other, f.id).find(y => y.id === entry.id && linkState(y, asOf) === 'now');
      if (x) back.push({ other, f, x });
    }
  }
  const linkedNotes = notesOf.filter(n => n.seriesId === entry.seriesId
    && names.some(nm => `${n.quote} ${n.text}`.toLowerCase().includes(nm)));
  const known = visible(entry, asOf);
  // The chapter it first appeared in ("Known from"); the earliest chapter when that's not set.
  const sorted = [...chapters].sort((a, b) => a.number - b.number);
  const firstCh = sorted.find(c => c.number === entry.since) || sorted.find(c => c.number >= (entry.since || 0)) || null;
  const ret = selecting ? '' : await returnBarHtml(entry, map);
  const n = sel?.keys.size || 0;

  app.innerHTML = `<main class="page cx-page${selecting ? ' is-selecting' : ''}" style="--cx:${colorIn(schema, entry)}">
    <div class="cx-wash" aria-hidden="true"></div>
    ${selecting ? `<div class="pick-bar">
      <button type="button" class="icon-btn" data-sel="exit" aria-label="Stop selecting">${svg('<path d="M6 6l12 12M18 6L6 18"/>', 20, 2)}</button>
      <span class="txt"><b>${n ? `${n} selected` : 'Select items'}</b><small>${esc(entry.name)}</small></span>
    </div>` : `<div class="row-head">
      <a class="icon-btn" href="#/series/${entry.seriesId}/codex" data-back aria-label="Back">${I.back}</a>
      <button type="button" class="chip" data-cxa="edit">${I.pencilSm} Edit</button>
    </div>
    ${ret}`}
    <div class="cx-hero">${avatarIn(schema, entry, 64)}
      <div class="txt"><h1>${esc(entry.name)}</h1>
        <small class="cx-sub">${esc(t.name)} <span aria-hidden="true">·</span> ${firstCh
          ? `<a class="cx-chlink" href="#/read/${firstCh.id}">${svg('<path d="M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/>', 13, 2)}Ch. ${fmtNum(firstCh.number)}</a>`
          : `Ch. ${fmtNum(entry.since || 1)}`}</small></div>
    </div>
    ${schema?.hideLater && !selecting ? `<div class="cx-viewas">
      <div class="cx-va-row">${svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', 18)}
        <span>Viewing as of</span>
        <button type="button" class="cx-chbtn" data-cxa="viewas">Ch. ${fmtNum(asOf)}${asOf === progress ? ' · your progress' : ''}${CHEV}</button></div>
      <div class="cx-va-sub"><span>Same for every entry you open</span>${asOf !== progress ? '<button type="button" class="link-btn" data-cxa="progress">Back to my progress</button>' : ''}</div>
    </div>` : ''}
    ${!known ? `<div class="cx-hidden">${LOCK}<span>You learn about ${esc(entry.name)} in Ch. ${fmtNum(entry.since)}.</span></div>` : ''}
    ${aliasesHtml}
    ${fieldsHtml}
    ${aboutHtml}
    ${!selecting && back.length ? card('Linked from', back.map(b => linkRow(schema, b.other, b.x, `${entry.id}:from:${b.other.id}:${b.f.id}`,
      { detail: `<div class="cx-dw-desc"><small>As</small><span>${esc(b.other.name)}’s ${esc(b.f.label.toLowerCase())}</span></div>` })).join('')) : ''}
    ${hiddenCount ? `<div class="cx-hidden">${LOCK}<span>${plural(hiddenCount, 'detail')} from later chapters ${hiddenCount === 1 ? 'is' : 'are'} hidden.</span></div>` : ''}
    ${!selecting && linkedNotes.length ? `<section class="cx-field"><h3>Notes that mention ${esc(entry.name)} · ${linkedNotes.length}</h3>
      <div class="cx-notes">${linkedNotes.slice(0, 20).map(nt => `
        <a class="cx-note" href="${nt.quote ? `#/read/${nt.chapterId}/note/${nt.id}` : `#/read/${nt.chapterId}`}">
          ${nt.quote ? `<b>${esc(nt.quote.slice(0, 120))}</b>` : '<b>Chapter note</b>'}
          ${nt.text ? `<span>${esc(nt.text.slice(0, 160))}</span>` : ''}</a>`).join('')}</div></section>` : ''}
    ${selecting ? `<div class="sel-actions">
        <button type="button" class="btn" data-sel="exit">Cancel</button>
        <button type="button" class="btn sel-del" data-sel="delete"${n ? '' : ' disabled'}>${I.trashSm} Delete${n ? ` ${n}` : ''}</button></div>`
      : `<button type="button" class="btn cx-find" data-cxa="find">${I.searchSm} Find every mention</button>
         <p class="hint tip cx-tip">Tip: long-press a value or connection to select several and delete them together.</p>`}
  </main>`;

  const main = app.querySelector('main');
  const redraw = () => { const y = window.scrollY; renderEntryPage(app, id).then(() => window.scrollTo(0, y)); };
  const startSelect = key => {
    sel = { entryId: entry.id, keys: new Set(key && items.has(key) ? [key] : []) };
    enterPageMode(() => { sel = null; redraw(); });
    redraw();
  };
  if (!selecting) onLongPress(main, '[data-key]', el => startSelect(el.dataset.key));

  main.addEventListener('click', async e => {
    if (selecting) {
      const pk = e.target.closest('[data-pick-key]');
      if (pk) {
        const k = pk.dataset.pickKey;
        if (sel.keys.has(k)) sel.keys.delete(k); else sel.keys.add(k);
        redraw();
        return;
      }
      const sa = e.target.closest('[data-selall]');
      if (sa) {
        const keys = fieldKeys.get(sa.dataset.selall) || [];
        const allOn = keys.every(k => sel.keys.has(k));
        keys.forEach(k => (allOn ? sel.keys.delete(k) : sel.keys.add(k)));
        redraw();
        return;
      }
      const sb = e.target.closest('[data-sel]');
      if (sb?.dataset.sel === 'exit') { exitPageMode(); return; }
      if (sb?.dataset.sel === 'delete' && sel.keys.size) {
        const chosen = [...sel.keys].map(k => items.get(k)).filter(Boolean);
        await trashValues(entry, chosen, { onUndone: redraw });
        exitPageMode();
      }
      return;
    }
    const st = e.target.closest('[data-steps]');
    if (st) { history.go(-Number(st.dataset.steps)); return; }
    const dw = e.target.closest('[data-drawer]');
    if (dw) {
      const k = dw.dataset.drawer;
      if (openDrawers.has(k)) openDrawers.delete(k); else openDrawers.add(k);
      redraw();
      return;
    }
    const b = e.target.closest('[data-cxa]');
    if (!b) return;
    const editor = extra => openEntryEditor({
      seriesId: entry.seriesId, entry, ctx: Number.isFinite(asOf) ? asOf : progress,
      onSaved: redraw,
      onDeleted: () => goBack(`#/series/${entry.seriesId}/codex`),
      ...extra,
    });
    if (b.dataset.cxa === 'edit') editor();
    if (b.dataset.cxa === 'edit-link') editor({ start: { kind: 'link', fid: b.dataset.f, i: Number(b.dataset.i) } });
    if (b.dataset.cxa === 'edit-val') editor({ start: { kind: 'value', fid: b.dataset.f, since: Number(b.dataset.since) } });
    if (b.dataset.cxa === 'del') {
      const it = items.get(b.dataset.key);
      if (it) { await trashValues(entry, [it], { onUndone: redraw }); redraw(); }
    }
    if (b.dataset.cxa === 'find') openFind({ term: entry.name, chapterId: null, seriesId: entry.seriesId });
    if (b.dataset.cxa === 'progress') { setViewAs(entry.seriesId, null); redraw(); }
    if (b.dataset.cxa === 'viewas') {
      openChapterPicker({
        title: 'Viewing as of', chapters, value: asOf,
        sub: `${schema?.series?.name || ''} · things you learned later stay hidden`,
        quick: [{ label: 'My progress', n: progress }],
        onPick: nn => { setViewAs(entry.seriesId, nn === progress ? null : nn); redraw(); },
      });
    }
  });

}

function card(label, inner) {
  return `<section class="cx-field"><h3>${esc(label)}</h3><div class="cx-card">${inner}</div></section>`;
}

/** Trash items for one value / connection of an entry (see trash.js). */
function itemFor(f, x, map) {
  if (f.kind === 'link') {
    const t = map.get(x.id);
    const value = { id: x.id, label: x.label || '', since: x.since || 0, ...(x.until != null ? { until: x.until } : {}) };
    return { fid: f.id, label: f.label, kind: 'link', value, text: `${t?.name || '?'}${x.label ? ` (${x.label})` : ''}` };
  }
  return { fid: f.id, label: f.label, kind: 'text', value: { v: x.v, since: x.since || 0 }, text: `“${String(x.v).slice(0, 40)}”` };
}
/** What the editor took away: text values whose chapter is gone, connections whose target is gone. */
function removedItems(before, after, t, map) {
  const out = [];
  for (const f of t.fields) {
    if (f.kind === 'link') {
      const keep = new Set(linkValues(after, f.id).map(x => x.id));
      for (const x of linkValues(before, f.id)) if (!keep.has(x.id)) out.push(itemFor(f, x, map));
    } else {
      const keep = new Set(textValues(after, f.id).map(x => x.since));
      for (const x of textValues(before, f.id)) if (x.v && !keep.has(x.since)) out.push(itemFor(f, x, map));
    }
  }
  return out;
}

/* ------------------------------------------------------------------ chapter picker */

/** Picker HTML: type a number, quick buttons, or the list. chapters: [{number, title}]. */
function chapterPickHtml({ title, sub = '', value, chapters, quick = [] }) {
  return `<div class="cp">
    <div class="cp-head"><h2>${esc(title)}</h2><small>${esc(sub || `${plural(chapters.length, 'chapter')}`)}</small></div>
    <form class="cp-type" data-cp-form>
      <label for="cp-num">Chapter</label>
      <input id="cp-num" class="text-input" inputmode="decimal" enterkeyhint="go" value="${Number.isFinite(value) ? fmtNum(value) : ''}" autocomplete="off">
      <button type="submit" class="btn btn-accent">Use</button>
    </form>
    ${quick.length ? `<div class="cp-quick">${quick.map(q => `<button type="button" class="btn" data-cp="${q.n}"><b>${esc(q.label)}</b><small>Ch. ${fmtNum(q.n)}</small></button>`).join('')}</div>` : ''}
    <div class="cp-list">${chapters.map(c => `<button type="button" data-cp="${c.number}"${c.number === value ? ' aria-pressed="true"' : ''}>
      <b>Ch. ${fmtNum(c.number)}</b><span>${esc(c.title || '')}</span>${c.number === value ? svg('<path d="M5 12l5 5 9-10"/>', 18, 2.2) : ''}</button>`).join('')}</div>
  </div>`;
}
/** The chapter number that a click or the typed box chose, or null. */
function chapterPicked(e, root, chapters) {
  const b = e.target.closest('[data-cp]');
  if (b) return Number(b.dataset.cp);
  if (e.type === 'submit' && e.target.closest('[data-cp-form]')) {
    e.preventDefault();
    const n = Number(String(root.querySelector('#cp-num').value).replace(',', '.'));
    if (!Number.isFinite(n) || !chapters.length) { toast('Type a chapter number'); return null; }
    const exact = chapters.find(c => c.number === n);
    if (exact) return n;
    const near = chapters.reduce((a, c) => (Math.abs(c.number - n) < Math.abs(a.number - n) ? c : a));
    toast(`No Ch. ${fmtNum(n)} — using Ch. ${fmtNum(near.number)}`);
    return near.number;
  }
  return null;
}
function showPicked(root) {
  root.querySelector('.cp-list [aria-pressed="true"]')?.scrollIntoView({ block: 'center' });
}
/** Chapter picker as its own sheet. */
export function openChapterPicker({ title, sub, chapters, value, quick = [], onPick }) {
  const list = [...chapters].sort((a, b) => a.number - b.number);
  openSheet(chapterPickHtml({ title, sub, value, chapters: list, quick }), sheet => {
    sheet.classList.add('cp-sheet');
    const pick = e => {
      const n = chapterPicked(e, sheet, list);
      if (n == null) return;
      closeOverlay();
      onPick(n);
    };
    sheet.addEventListener('click', pick);
    sheet.addEventListener('submit', pick);
    showPicked(sheet);
  });
}

/* ------------------------------------------------------------------ add / edit */

const chBtn = (key, label, value, icon = CLOCK) => `
  <div class="cx-step"><span class="cx-step-ico">${icon}</span><span class="cx-step-label">${label}</span>
    <button type="button" class="cx-chbtn" data-chpick="${key}">Ch. ${fmtNum(value || 1)}${svg('<path d="M6 9l6 6 6-6"/>', 14, 2)}</button></div>`;

/**
 * Open the entry editor.
 *  seriesId, entry (to edit) or name/type (new), ctx: the chapter you're at (reader chapter or progress),
 *  start: open straight on one connection { kind: 'link', fid, i } (Done then saves),
 *  onSaved(entry), onDeleted()
 */
export async function openEntryEditor({ seriesId, entry = null, name = '', type = null, ctx = null, start = null, onSaved, onDeleted }) {
  let all = await db.getCodexOfSeries(seriesId);
  const schema = await schemaOf(seriesId, all);
  if (!schema) { openNoCodex(seriesId, () => openEntryEditor({ seriesId, entry, name, type, ctx, onSaved, onDeleted })); return; }
  const chapters = (await db.getChaptersOfSeries(seriesId)).sort((a, b) => a.number - b.number);
  const nums = chapters.length ? chapters.map(c => c.number) : [1];
  const progress = await progressOf(seriesId);
  const here = ctx ?? progress;
  const draft = entry ? structuredClone(entry) : {
    seriesId, type: schema.map.has(type) ? type : schema.types[0].id, name, aliases: [], since: here, fields: {}, about: '',
  };
  draft.fields ||= {};
  draft.since ??= 0;
  let changeAt = entry ? here : draft.since; // chapter for new values and connections
  const typed = {};     // field id → text typed for a new value (saved from `changeAt`)
  const adding = new Set(); // text fields with the "New value" box open
  let picker = null;    // inline "Link" search: { field, q, label, since }
  let confirmDelete = false;
  const views = [];     // steps over the form: link / value / chapter
  const quick = [{ label: 'This chapter', n: here }, ...(progress !== here ? [{ label: 'My progress', n: progress }] : [])];

  const tdef = () => schema.map.get(draft.type) || schema.types[0];
  const map = () => byId(all);
  const fieldOf = fid => tdef().fields.find(f => f.id === fid);

  /* ---- the form ---- */
  const textField = f => {
    const vals = textValues(draft, f.id);
    const box = (v = '') => (f.kind === 'longtext'
      ? `<textarea class="text-area" rows="3" data-tf="${esc(f.id)}" placeholder="${esc(f.hint || '')}">${esc(v)}</textarea>`
      : `<input class="text-input" data-tf="${esc(f.id)}" value="${esc(v)}" placeholder="${esc(f.hint || '')}" autocomplete="off">`);
    if (!entry || !vals.length) {
      const shownNow = textValues(draft, f.id).filter(v => v.since <= changeAt).pop();
      return `<label class="cx-efield"><span class="label">${esc(f.label)}</span>${box(typed[f.id] ?? (shownNow?.v || ''))}</label>`;
    }
    return `<div class="cx-efield"><span class="label">${esc(f.label)}</span>
      <div class="cx-erows">
        ${[...vals].reverse().map((v, i) => `<button type="button" class="cx-erow${i ? ' is-old' : ''}" data-val="${esc(f.id)}:${v.since}">
          <span class="txt"><b>${esc(v.v || '(empty)')}</b></span><em>Ch. ${fmtNum(v.since || 1)}</em>${PEN}</button>`).join('')}
        ${adding.has(f.id) ? `<div class="cx-enew"><small>${vals.some(v => v.since === changeAt) ? `Replaces the Ch. ${fmtNum(changeAt)} value` : `New value from Ch. ${fmtNum(changeAt)}`}</small>${box(typed[f.id] ?? '')}</div>`
          : `<button type="button" class="cx-eadd" data-newval="${esc(f.id)}">${I.plusSm} New value from Ch. ${fmtNum(changeAt)}</button>`}
      </div></div>`;
  };

  const linkField = f => {
    const m = map();
    const items = linkValues(draft, f.id).map((x, i) => ({ ...x, i })).filter(x => m.has(x.id));
    const rows = items.map(x => {
      const e = m.get(x.id);
      const meta = [x.label, x.until != null ? `${spanText(x.since, x.until)} · ended` : `Ch. ${fmtNum(x.since || 1)} →`].filter(Boolean).join(' · ');
      return `<button type="button" class="cx-erow is-link${x.until != null ? ' is-past' : ''}" data-link="${esc(f.id)}:${x.i}">
        ${avatarIn(schema, e, 30)}<span class="txt"><b>${esc(e.name)}</b><small>${esc(meta)}</small></span>${PEN}</button>`;
    }).join('');
    const open = picker?.field === f.id;
    const targets = f.to.map(id => schema.map.get(id)).filter(Boolean);
    let pickHtml = '';
    if (open) {
      pickHtml = `<div class="cx-picker">
        ${searchHtml(f, picker.q, new Set(items.map(x => x.id)))}
        ${f.withLabel ? `<input class="text-input" data-pick-label value="${esc(picker.label)}" placeholder="${esc(f.labelHint || 'Description, e.g. brother')}" autocomplete="off">` : ''}
        ${chBtn('pick', 'True from', picker.since)}
      </div>`;
    }
    const full = !f.multiple && items.length >= 1;
    return `<div class="cx-efield"><span class="label">${esc(f.label)}</span>
      <div class="cx-erows">${rows}
        <button type="button" class="cx-eadd" data-linkadd="${esc(f.id)}" aria-expanded="${open}">${open ? `${X} Close`
          : `${I.plusSm} ${full ? 'Change' : `Link ${esc(targets.length === 1 ? `${/^[aeiou]/i.test(targets[0].name) ? 'an' : 'a'} ${targets[0].name.toLowerCase()}` : '')}`}`}</button>
        ${pickHtml}</div></div>`;
  };

  /** Search list for choosing what a connection points to. */
  const searchHtml = (f, q0, taken) => {
    const q = q0.trim().toLowerCase();
    const options = sortByName(all.filter(e => f.to.includes(e.type) && e.id !== draft.id && !taken.has(e.id)
      && (!q || [e.name, ...(e.aliases || [])].some(n => n.toLowerCase().includes(q))))).slice(0, 6);
    const exact = all.some(e => f.to.includes(e.type) && e.name.toLowerCase() === q);
    const targets = f.to.map(id => schema.map.get(id)).filter(Boolean);
    return `<input class="text-input" data-pick-q value="${esc(q0)}" placeholder="Search or name a new ${esc(targets.map(x => x.name.toLowerCase()).join(' / '))}" autocomplete="off">
      <div class="cx-options">
        ${options.map(e => `<button type="button" data-pick="${e.id}">${avatarIn(schema, e, 28)}${esc(e.name)}</button>`).join('')}
        ${q && !exact ? targets.map(x => `<button type="button" data-pick-new="${esc(x.id)}">${I.plusSm} New ${esc(x.name.toLowerCase())} “${esc(q0.trim())}”</button>`).join('') : ''}
        ${!options.length && !q ? `<span class="hint">Nothing to link yet — type a name to add one.</span>` : ''}
      </div>`;
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
      ${chBtn('known', 'Known from', draft.since || nums[0])}
      <label class="cx-efield"><span class="label">Also called</span>
        <input class="text-input" data-f="aliases" value="${esc((draft.aliases || []).join(', '))}" placeholder="Other names, separated by commas" autocomplete="off"></label>
      ${entry ? `<div class="cx-change">${chBtn('change', 'New details from', changeAt, PLUS)}
        <small class="tip">New values and new connections count from this chapter. Tap any row below to change it.</small></div>` : ''}
      ${t.fields.map(f => (f.kind === 'link' ? linkField(f) : textField(f))).join('')}
      <label class="cx-efield"><span class="label">About</span>
        <textarea class="text-area" data-f="about" rows="3" placeholder="Anything worth remembering…">${esc(draft.about || '')}</textarea></label>
      <p class="hint tip" style="margin:0">Only the name is needed. When you re-read earlier chapters, things you learned later stay hidden.</p>
      <div class="two-btns">
        <button type="button" class="btn" data-ed="cancel">Cancel</button>
        <button type="button" class="btn btn-accent" data-ed="save">${entry ? 'Save' : 'Add'}</button>
      </div>
      ${entry ? `<button type="button" class="btn cx-delete${confirmDelete ? ' is-confirm' : ''}" data-ed="delete">${I.trashSm} Delete entry</button>` : ''}`;
  };

  /* ---- step views ---- */
  const linkViewHtml = v => {
    const f = fieldOf(v.fid);
    const w = v.w;
    const target = map().get(w.id);
    return `
      <div class="cx-ed-head"><div class="txt"><h2>Edit connection</h2><small>${esc(draft.name || 'This entry')} · ${esc(f.label)}</small></div></div>
      <div class="cx-efield"><span class="label">Linked to</span>
        ${v.changing ? `<div class="cx-picker">${searchHtml(f, v.q || '', new Set(linkValues(draft, f.id).map(x => x.id).filter(id => id !== w.id)))}</div>`
          : `<div class="cx-linked">${target ? `${avatarIn(schema, target, 28)}<b>${esc(target.name)}</b>` : '<b>—</b>'}
            <button type="button" class="btn" data-lv="change">Change</button></div>`}</div>
      ${f.withLabel || w.label ? `<label class="cx-efield"><span class="label">Description</span>
        <input class="text-input" data-lv-label value="${esc(w.label || '')}" placeholder="${esc(f.labelHint || 'e.g. brother, master, rival')}" autocomplete="off"></label>` : ''}
      ${chBtn('since', 'True from', w.since || nums[0])}
      <div class="cx-step"><span class="cx-step-ico">${X}</span><span class="cx-step-label">Until</span>
        <span class="cx-seg" role="radiogroup" aria-label="Until">
          <button type="button" role="radio" aria-checked="${w.until == null}" data-lv="still">Still true</button>
          <button type="button" role="radio" aria-checked="${w.until != null}" data-lv="ended">Ended</button></span></div>
      ${w.until != null ? chBtn('until', 'Last true in', w.until, '') : ''}
      <p class="hint" style="margin:0">${w.until != null
        ? `Shows as a normal link from Ch. ${fmtNum(w.since || 1)} to Ch. ${fmtNum(w.until)}. After that it moves to “Past”, with its chapters.`
        : `Shows from Ch. ${fmtNum(w.since || 1)} on. If it stops being true (someone leaves, dies, breaks up), choose Ended.`}</p>
      <button type="button" class="btn cx-delete${v.confirm ? ' is-confirm' : ''}" data-lv="remove">${I.trashSm} Remove connection</button>
      <div class="two-btns"><button type="button" class="btn" data-lv="cancel">Cancel</button>
        <button type="button" class="btn btn-accent" data-lv="done">Done</button></div>`;
  };
  const valueViewHtml = v => {
    const f = fieldOf(v.fid);
    return `
      <div class="cx-ed-head"><div class="txt"><h2>Edit ${esc(f.label)}</h2><small>${esc(draft.name || 'This entry')}</small></div></div>
      <label class="cx-efield"><span class="label">Value</span>
        ${f.kind === 'longtext' ? `<textarea class="text-area" rows="4" data-vv>${esc(v.w.v)}</textarea>`
          : `<input class="text-input" data-vv value="${esc(v.w.v)}" autocomplete="off">`}</label>
      ${chBtn('vsince', 'True from', v.w.since || nums[0])}
      <button type="button" class="btn cx-delete${v.confirm ? ' is-confirm' : ''}" data-vw="remove">${I.trashSm} Remove this value</button>
      <div class="two-btns"><button type="button" class="btn" data-vw="cancel">Cancel</button>
        <button type="button" class="btn btn-accent" data-vw="done">Done</button></div>`;
  };

  const sheet = openSheet('<div class="cx-editor"></div>', s => s.classList.add('cx-sheet'));
  const box = sheet.querySelector('.cx-editor');
  const top = () => views[views.length - 1] || null;
  let lastView = null;   // the view drawn last time (keeps its scroll when redrawn)
  let formScroll = null; // where the form was scrolled when a step opened
  const draw = (focusSel = null) => {
    const v = top();
    const keep = sheet.scrollTop;
    box.innerHTML = !v ? formHtml() : v.kind === 'link' ? linkViewHtml(v) : v.kind === 'value' ? valueViewHtml(v)
      : chapterPickHtml({ title: v.title, value: v.value, chapters, quick, sub: v.sub });
    if (!v) { sheet.scrollTop = formScroll ?? keep; formScroll = null; }
    else sheet.scrollTop = v === lastView ? keep : 0;
    if (v?.kind === 'chapter' && v !== lastView) showPicked(box);
    lastView = v;
    if (focusSel) {
      const el = box.querySelector(focusSel);
      el?.focus();
      return el;
    }
    return null;
  };
  let savedForm = null;
  const pushView = v => {
    if (!top()) savedForm = sheet.scrollTop;
    views.push(v);
    pushOverlayStep(() => {
      views.pop();
      if (!top()) formScroll = savedForm;
      draw();
    });
    draw();
  };
  const popView = () => popOverlayStep();

  /** Save the whole entry (Save button, or Done when opened straight on a connection). */
  const saveEntry = async () => {
    const nm = draft.name.replace(/\s+/g, ' ').trim();
    if (!nm) { toast('Give it a name first'); return false; }
    const clash = all.find(x => x.id !== draft.id && x.name.toLowerCase() === nm.toLowerCase());
    if (clash) { toast(`“${clash.name}” is already in the Codex`); return false; }
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
    closeOverlay();
    // Values and connections removed in the editor go to the Trash.
    const gone = entry ? removedItems(entry, saved, tdef(), map()) : [];
    if (gone.length) await recordValues(entry, gone, { onUndone: () => onSaved?.(saved) });
    else toast(entry ? 'Entry saved' : 'Added to the Codex');
    onSaved?.(saved);
    return true;
  };

  /** Apply the "Edit connection" view to the draft. */
  const applyLink = v => {
    const list = linkValues(draft, v.fid);
    if (v.w.until != null && v.w.until < (v.w.since || 0)) { toast('“Last true in” can’t be before “True from”'); return false; }
    list[v.i] = { id: v.w.id, label: (v.w.label || '').trim(), since: v.w.since, ...(v.w.until != null ? { until: v.w.until } : {}) };
    draft.fields[v.fid] = list.map(x => (x.until == null ? { id: x.id, label: x.label, since: x.since } : x));
    return true;
  };

  draw();
  if (!draft.name) box.querySelector('[data-f="name"]')?.focus();
  if (start?.kind === 'link') {
    const x = linkValues(draft, start.fid)[start.i];
    if (x) pushView({ kind: 'link', fid: start.fid, i: start.i, w: { ...x }, direct: true });
  }
  if (start?.kind === 'value') {
    const x = textValues(draft, start.fid).find(y => y.since === start.since);
    if (x) pushView({ kind: 'value', fid: start.fid, orig: x.since, w: { ...x }, direct: true });
  }

  const addLink = id => {
    const f = fieldOf(picker.field);
    let list = linkValues(draft, f.id);
    if (!f.multiple) list = [];
    list.push({ id, label: (picker.label || '').trim(), since: picker.since });
    draft.fields[f.id] = list.map(x => (x.until == null ? { id: x.id, label: x.label, since: x.since } : x));
    picker = null;
    draw();
  };
  const newEntry = async (typeId, nm, since) => {
    const t = schema.map.get(typeId);
    const made = await db.putCodexEntry({ seriesId, type: t.id, name: nm, aliases: [], since, fields: {}, about: '' });
    all = [...all, made];
    toast(`${t.name} “${made.name}” added`);
    return made;
  };

  box.addEventListener('input', e => {
    const el = e.target;
    const v = top();
    if (v?.kind === 'link') {
      if (el.dataset.lvLabel != null) v.w.label = el.value;
      else if (el.dataset.pickQ != null) {
        v.q = el.value;
        const pos = el.selectionStart;
        draw('[data-pick-q]')?.setSelectionRange(pos, pos);
      }
      return;
    }
    if (v?.kind === 'value') { if (el.dataset.vv != null) v.w.v = el.value; return; }
    if (el.dataset.f === 'name') draft.name = el.value;
    else if (el.dataset.f === 'aliases') draft.aliases = el.value.split(',').map(s => s.trim()).filter(Boolean);
    else if (el.dataset.f === 'about') draft.about = el.value;
    else if (el.dataset.tf) typed[el.dataset.tf] = el.value;
    else if (el.dataset.pickLabel != null) picker.label = el.value;
    else if (el.dataset.pickQ != null) {
      picker.q = el.value;
      const pos = el.selectionStart;
      draw('[data-pick-q]')?.setSelectionRange(pos, pos);
    }
  });

  const onChapter = (title, value, onPick, sub = '') => pushView({ kind: 'chapter', title, value, onPick, sub });

  const handle = async e => {
    const v = top();
    /* chapter picker step */
    if (v?.kind === 'chapter') {
      const n = chapterPicked(e, box, chapters);
      if (n == null) return;
      v.onPick(n);
      popView();
      return;
    }
    if (e.type === 'submit') return;
    const cp = e.target.closest('[data-chpick]');
    if (cp) {
      const key = cp.dataset.chpick;
      if (key === 'known') onChapter('Known from', draft.since || nums[0], n => { draft.since = n; if (!entry) changeAt = n; }, 'The chapter where you first learn about it');
      else if (key === 'change') onChapter('New details from', changeAt, n => { changeAt = n; }, 'New values and connections count from here');
      else if (key === 'pick') onChapter('True from', picker.since, n => { picker.since = n; });
      else if (key === 'since') onChapter('True from', v.w.since || nums[0], n => { v.w.since = n; if (v.w.until != null && v.w.until < n) v.w.until = n; });
      else if (key === 'until') onChapter('Last true in', v.w.until, n => { v.w.until = n; }, 'The last chapter where this is still true');
      else if (key === 'vsince') onChapter('True from', v.w.since || nums[0], n => { v.w.since = n; });
      return;
    }
    /* edit-connection step */
    if (v?.kind === 'link') {
      const pick = e.target.closest('[data-pick]');
      if (pick) { v.w.id = Number(pick.dataset.pick); v.changing = false; draw(); return; }
      const pickNew = e.target.closest('[data-pick-new]');
      if (pickNew) { const made = await newEntry(pickNew.dataset.pickNew, (v.q || '').trim(), v.w.since); v.w.id = made.id; v.changing = false; draw(); return; }
      const b = e.target.closest('[data-lv]');
      if (!b) return;
      const act = b.dataset.lv;
      if (act === 'change') { v.changing = true; v.q = ''; draw('[data-pick-q]'); }
      if (act === 'still') { v.w.until = null; draw(); }
      if (act === 'ended') { v.w.until = v.w.until ?? Math.max(v.w.since || nums[0], changeAt); draw(); }
      if (act === 'cancel') { if (v.direct) closeOverlay(); else popView(); }
      if (act === 'remove') {
        draft.fields[v.fid] = linkValues(draft, v.fid).filter((_, i) => i !== v.i)
          .map(x => (x.until == null ? { id: x.id, label: x.label, since: x.since } : x));
        if (v.direct) await saveEntry(); else popView();
      }
      if (act === 'done') {
        if (!applyLink(v)) return;
        if (v.direct) await saveEntry(); else popView();
      }
      return;
    }
    /* edit-value step */
    if (v?.kind === 'value') {
      const b = e.target.closest('[data-vw]');
      if (!b) return;
      const act = b.dataset.vw;
      if (act === 'cancel') { if (v.direct) closeOverlay(); else popView(); }
      if (act === 'remove') {
        draft.fields[v.fid] = textValues(draft, v.fid).filter(x => x.since !== v.orig);
        if (v.direct) await saveEntry(); else popView();
      }
      if (act === 'done') {
        const rest = textValues(draft, v.fid).filter(x => x.since !== v.orig && x.since !== v.w.since);
        rest.push({ v: v.w.v.trim(), since: v.w.since });
        draft.fields[v.fid] = rest.sort((a, b) => a.since - b.since);
        if (v.direct) await saveEntry(); else popView();
      }
      return;
    }
    /* the form */
    const ty = e.target.closest('[data-type]');
    if (ty) { draft.type = ty.dataset.type; picker = null; draw(); return; }
    const lk = e.target.closest('[data-link]');
    if (lk) {
      const [fid, i] = lk.dataset.link.split(':');
      const x = linkValues(draft, fid)[Number(i)];
      if (x) pushView({ kind: 'link', fid, i: Number(i), w: { ...x } });
      return;
    }
    const vl = e.target.closest('[data-val]');
    if (vl) {
      const [fid, since] = vl.dataset.val.split(':');
      const x = textValues(draft, fid).find(y => y.since === Number(since));
      if (x) pushView({ kind: 'value', fid, orig: x.since, w: { ...x } });
      return;
    }
    const nv = e.target.closest('[data-newval]');
    if (nv) { adding.add(nv.dataset.newval); draw(`[data-tf="${nv.dataset.newval}"]`); return; }
    const add = e.target.closest('[data-linkadd]');
    if (add) {
      picker = picker?.field === add.dataset.linkadd ? null : { field: add.dataset.linkadd, q: '', label: '', since: changeAt };
      draw(picker ? '[data-pick-q]' : null);
      return;
    }
    const pick = e.target.closest('[data-pick]');
    if (pick) { addLink(Number(pick.dataset.pick)); return; }
    const pickNew = e.target.closest('[data-pick-new]');
    if (pickNew) {
      const made = await newEntry(pickNew.dataset.pickNew, picker.q.trim(), picker.since);
      addLink(made.id);
      return;
    }
    const act = e.target.closest('[data-ed]');
    if (!act) return;
    if (act.dataset.ed === 'cancel') { closeOverlay(); return; }
    if (act.dataset.ed === 'delete') {
      closeOverlay();
      await trashEntry(entry, typeIn(schema, entry).name);
      onDeleted?.();
      return;
    }
    if (act.dataset.ed === 'save') {
      if (!(await saveEntry())) box.querySelector('[data-f="name"]')?.focus();
    }
  };
  box.addEventListener('click', handle);
  box.addEventListener('submit', handle);
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
    for (const f of t.fields) {
      if (f.kind !== 'link') {
        const r = textAt(entry, f.id, upTo);
        hidden += r.later;
        if (r.value && f.kind === 'text' && rows.length < 4) rows.push(`<div class="cx-peek-row"><span>${esc(f.label)}</span><b>${esc(r.value)}</b></div>`);
        continue;
      }
      for (const x of linkValues(entry, f.id)) {
        const target = map.get(x.id);
        if (!target) continue;
        if (x.since > upTo || (target.since || 0) > upTo) { hidden++; continue; }
        if (linkState(x, upTo) === 'past') continue;
        if (rows.length < 4) rows.push(`<div class="cx-peek-row"><span>${esc(x.label || f.label)}</span>${linkChip(schema, target)}</div>`);
      }
    }
    return `
      <button type="button" class="cx-peek-head" data-pk="open" aria-label="Open ${esc(entry.name)}">${avatarIn(schema, entry, 48)}
        <span class="txt"><b>${esc(entry.name)}</b><small>${esc(t.name)} · Ch. ${fmtNum(entry.since || 1)}</small></span>${svg('<path d="M9 5l7 7-7 7"/>', 20, 2)}</button>
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
      const fromReader = () => { if (Number.isFinite(asOf)) setViewAs(entry.seriesId, asOf); };
      if (a) { e.preventDefault(); fromReader(); closeOverlay({ navTo: a.getAttribute('href') }); return; }
      const b = e.target.closest('[data-pk]');
      if (b?.dataset.pk === 'show') { sheet.querySelector('.cx-peek').innerHTML = build(Infinity); return; }
      if (b?.dataset.pk === 'open') { fromReader(); closeOverlay({ navTo: `#/codex/${entry.id}` }); return; }
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
      if (a) {
        e.preventDefault();
        if (Number.isFinite(asOf) && a.getAttribute('href').startsWith('#/codex/')) setViewAs(seriesId, asOf);
        closeOverlay({ navTo: a.getAttribute('href') });
        return;
      }
      if (e.target.closest('[data-rc="new"]')) openEntryEditor({ seriesId, ctx: asOf, onSaved: () => onChanged?.() });
    });
  });
}
