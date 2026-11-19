// trash.js — everything deleted goes here first (notes, tags, Codex entries, Codex values and
// connections), so a mistake can be undone right away (toast) or later (Settings → Trash).
// Items are emptied automatically after `settings.trashDays` days (0 = keep).

import * as db from './db.js';
import { esc, I, plural, fmtNum, toast, toastAction } from './ui.js';

const DAY = 86400000;

/* ------------------------------------------------------------------ helpers */

async function seriesName(id) { return (await db.getSeries(id))?.name || 'Unknown series'; }
async function chapterSpan(notes) {
  const nums = [];
  for (const id of new Set(notes.map(n => n.chapterId))) {
    const c = await db.getChapter(id);
    if (c) nums.push(c.number);
  }
  if (!nums.length) return '';
  const a = Math.min(...nums), b = Math.max(...nums);
  return a === b ? `Ch. ${fmtNum(a)}` : `Ch. ${fmtNum(a)}–${fmtNum(b)}`;
}
const quoteOf = n => (n.quote ? `“${n.quote.slice(0, 60)}${n.quote.length > 60 ? '…' : ''}”` : 'Chapter note');

/** Show "… moved to Trash · Undo". onUndone runs after a successful undo (redraw). */
function offerUndo(message, trashId, onUndone) {
  toastAction(message, 'Undo', async () => {
    const ok = await restore(trashId);
    if (!ok) return;
    toast('Restored');
    if (onUndone) onUndone();
    else window.dispatchEvent(new HashChangeEvent('hashchange')); // redraw the page you're on
  });
}

/* ------------------------------------------------------------------ deleting */

/** Delete notes (one or many) into the Trash. */
export async function trashNotes(notes, { onUndone } = {}) {
  if (!notes.length) return;
  const sid = notes[0].seriesId;
  const multi = new Set(notes.map(n => n.seriesId)).size > 1;
  const id = await db.addTrash({
    kind: 'notes', cat: 'notes', seriesId: multi ? null : sid,
    title: notes.length === 1 ? quoteOf(notes[0]) : plural(notes.length, 'note'),
    sub: multi ? 'Several series' : [await seriesName(sid), await chapterSpan(notes)].filter(Boolean).join(' · '),
    payload: { notes },
  });
  await db.deleteNotes(notes.map(n => n.id));
  offerUndo(`${notes.length === 1 ? 'Note' : plural(notes.length, 'note')} moved to Trash`, id, onUndone);
}

/** Delete a tag (it comes off its notes) into the Trash. */
export async function trashTag(tag, { onUndone } = {}) {
  if (tag.builtin) { toast('Vocabulary is built in and can’t be deleted'); return; }
  const noteIds = (await db.getAllNotes()).filter(n => n.tagIds?.includes(tag.id)).map(n => n.id);
  const id = await db.addTrash({
    kind: 'tag', cat: 'tags', seriesId: tag.seriesId ?? null,
    title: `Tag “${tag.name}”`,
    sub: [tag.seriesId != null ? await seriesName(tag.seriesId) : '', noteIds.length ? `was on ${plural(noteIds.length, 'note')}` : 'on no notes'].filter(Boolean).join(' · '),
    payload: { tag, noteIds },
  });
  await db.deleteTag(tag.id);
  offerUndo(`Tag “${tag.name}” moved to Trash`, id, onUndone);
}

/** Delete a vocabulary word and all the places you saved it into the Trash. */
export async function trashWord(word, { onUndone } = {}) {
  const notes = (await db.getAllNotes()).filter(n => n.wordId === word.id);
  const id = await db.addTrash({
    kind: 'word', cat: 'notes', seriesId: null,
    title: `“${word.word}”`,
    sub: `Vocabulary word · ${plural(notes.length, 'place')}`,
    payload: { word, notes },
  });
  await db.deleteNotes(notes.map(n => n.id));
  await db.deleteWord(word.id);
  offerUndo(`“${word.word}” moved to Trash`, id, onUndone);
}

/** Delete a Codex entry (and the links to it) into the Trash. */
export async function trashEntry(entry, typeName = 'Entry', { onUndone } = {}) {
  const backLinks = await db.deleteCodexEntry(entry.id);
  const id = await db.addTrash({
    kind: 'entry', cat: 'codex', seriesId: entry.seriesId,
    title: entry.name,
    sub: [`Codex · ${typeName}`, backLinks.length ? plural(backLinks.length, 'connection') : '', await seriesName(entry.seriesId)].filter(Boolean).join(' · '),
    payload: { entry, backLinks },
  });
  offerUndo(`“${entry.name}” moved to Trash`, id, onUndone);
}

/**
 * Record values / connections removed from an entry (the entry is already saved without them).
 * before: the entry as it was. items: [{ fid, label, kind: 'text'|'link', value, text }]
 *   text: how to show it, e.g. “First-rate” or Ghost Sect.
 */
export async function recordValues(before, items, { onUndone, undo = true } = {}) {
  if (!items.length) return null;
  const desc = items.slice(0, 2).map(x => `${x.label}: ${x.text}`).join(', ') + (items.length > 2 ? ` +${items.length - 2} more` : '');
  const id = await db.addTrash({
    kind: 'values', cat: 'codex', seriesId: before.seriesId,
    title: desc,
    sub: `${items.length === 1 ? (items[0].kind === 'link' ? 'Connection' : 'Value') : plural(items.length, 'item')} of ${before.name} · ${await seriesName(before.seriesId)}`,
    payload: { entryId: before.id, snapshot: before, items },
  });
  if (undo) offerUndo(items.length === 1 ? `${items[0].label}: ${items[0].text} moved to Trash` : `${plural(items.length, 'item')} moved to Trash`, id, onUndone);
  return id;
}

/** Remove values / connections from a saved entry, into the Trash. */
export async function trashValues(entry, items, { onUndone } = {}) {
  const before = structuredClone(entry);
  const after = structuredClone(entry);
  for (const it of items) {
    const list = Array.isArray(after.fields?.[it.fid]) ? after.fields[it.fid] : null;
    if (it.fid === '_about') { after.about = ''; continue; }
    if (it.fid === '_alias') { after.aliases = (after.aliases || []).filter(a => a !== it.value); continue; }
    if (!list) { if (after.fields?.[it.fid] != null && it.kind === 'text') after.fields[it.fid] = []; continue; }
    after.fields[it.fid] = list.filter(x => !sameValue(x, it));
  }
  await db.putCodexEntry(after);
  return recordValues(before, items, { onUndone });
}

function sameValue(x, it) {
  if (it.kind === 'link') return (typeof x === 'object' ? x.id : x) === it.value.id && (typeof x !== 'object' || (x.since || 0) === (it.value.since || 0));
  return typeof x === 'object' && x && x.v === it.value.v && (x.since || 0) === (it.value.since || 0);
}

/* ------------------------------------------------------------------ restoring */

/** Put a Trash item back. Returns true when done. */
export async function restore(trashId) {
  const item = await db.getTrash(trashId);
  if (!item) return false;
  const p = item.payload;
  if (item.kind === 'word') {
    await db.putWord(p.word);
    for (const n of p.notes) await db.putNote(n);
  } else if (item.kind === 'notes') {
    for (const n of p.notes) await db.putNote(n);
  } else if (item.kind === 'tag') {
    await db.putTag(p.tag);
    for (const nid of p.noteIds) {
      const n = await db.getNote(nid);
      if (n && !n.tagIds?.includes(p.tag.id)) await db.putNote({ ...n, tagIds: [...(n.tagIds || []), p.tag.id] });
    }
  } else if (item.kind === 'entry') {
    await db.putCodexEntry(p.entry);
    for (const b of p.backLinks || []) {
      const e = await db.getCodexEntry(b.entryId);
      if (!e) continue;
      const list = Array.isArray(e.fields?.[b.fid]) ? e.fields[b.fid] : [];
      const lid = typeof b.link === 'object' ? b.link.id : b.link;
      if (list.some(x => (typeof x === 'object' ? x.id : x) === lid)) continue;
      e.fields = { ...e.fields, [b.fid]: [...list, b.link] };
      await db.putCodexEntry(e);
    }
  } else if (item.kind === 'values') {
    const e = await db.getCodexEntry(p.entryId);
    if (!e) {
      await db.putCodexEntry(p.snapshot); // the entry itself was deleted since: bring it back as it was
    } else {
      e.fields ||= {};
      for (const it of p.items) {
        if (it.fid === '_about') { if (!e.about) e.about = it.value; continue; }
        if (it.fid === '_alias') { e.aliases = [...new Set([...(e.aliases || []), it.value])]; continue; }
        const list = Array.isArray(e.fields[it.fid]) ? e.fields[it.fid] : [];
        if (list.some(x => sameValue(x, it))) continue;
        if (it.kind === 'link' && list.some(x => (typeof x === 'object' ? x.id : x) === it.value.id)) continue;
        e.fields[it.fid] = [...list, it.value].sort((a, b) => (a.since || 0) - (b.since || 0));
      }
      await db.putCodexEntry(e);
    }
  }
  await db.deleteTrash(trashId);
  return true;
}

/** Empty items older than `days` days (0 = never). */
export async function purge(days) {
  if (!days) return;
  const cut = Date.now() - days * DAY;
  for (const t of await db.getAllTrash()) if (t.at < cut) await db.deleteTrash(t.id);
}

/* ------------------------------------------------------------------ Settings → Trash page */

const ICON = {
  notes: '<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4"/>',
  word: '<path d="M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  tag: '<path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  entry: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>',
  values: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};
const ico = k => `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k] || ICON.notes}</svg>`;

let trashFilter = 'all';

/** Render the Trash page. getDays/setDays: the auto-empty setting. */
export async function renderTrashPage(app, { days, onDays }) {
  const items = (await db.getAllTrash()).sort((a, b) => b.at - a.at);
  const cats = { notes: 0, codex: 0, tags: 0 };
  for (const t of items) cats[t.cat] = (cats[t.cat] || 0) + 1;
  if (trashFilter !== 'all' && !cats[trashFilter]) trashFilter = 'all';
  const shown = items.filter(t => trashFilter === 'all' || t.cat === trashFilter);
  const now = Date.now();
  const startOf = d => new Date(new Date(d).toDateString()).getTime();
  const group = t => {
    const diff = (startOf(now) - startOf(t.at)) / DAY;
    return diff < 1 ? 'Today' : diff < 2 ? 'Yesterday' : diff < 7 ? 'This week' : diff < 31 ? 'This month' : 'Older';
  };
  const left = t => (days ? Math.max(0, Math.ceil((t.at + days * DAY - now) / DAY)) : null);
  const time = t => new Date(t.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const groups = [];
  for (const t of shown) {
    const g = group(t);
    if (groups[groups.length - 1]?.name !== g) groups.push({ name: g, list: [] });
    groups[groups.length - 1].list.push(t);
  }
  const color = t => ({ notes: 'var(--accent)', tags: '#8fd14f', codex: '#a77bf5' }[t.cat]);
  const chip = (k, label, n) => `<button type="button" class="chip${trashFilter === k ? ' is-on' : ''}" data-tf="${k}" aria-pressed="${trashFilter === k}">${label} <span class="n">${n}</span></button>`;

  app.innerHTML = `<main class="page trash-page">
    <div class="row-head">
      <a class="icon-btn notes-back" href="#/settings" data-back aria-label="Back">${I.back}</a>
      <h1 class="page-title">Trash</h1>
    </div>
    <p class="hint" style="margin:0">Deleted notes, tags, Codex entries, values and connections. ${days ? `Emptied automatically after ${plural(days, 'day')}.` : 'Kept until you empty it.'}</p>
    ${items.length ? `<div class="chip-row trash-chips">${chip('all', 'All', items.length)}${cats.notes ? chip('notes', 'Notes', cats.notes) : ''}${cats.codex ? chip('codex', 'Codex', cats.codex) : ''}${cats.tags ? chip('tags', 'Tags', cats.tags) : ''}</div>` : ''}
    ${groups.map(g => `<h2 class="trash-h">${g.name}</h2><div class="trash-list">${g.list.map(t => `
      <div class="trash-row">
        <span class="trash-ico" style="color:${color(t)}">${ico(t.kind)}</span>
        <span class="txt"><b>${esc(t.title)}</b><small>${esc(t.sub || '')} · ${g.name === 'Today' ? time(t) : `${left(t) != null ? `${plural(left(t), 'day')} left` : new Date(t.at).toLocaleDateString()}`}</small></span>
        <button type="button" class="btn trash-restore" data-restore="${t.id}">Restore</button>
      </div>`).join('')}</div>`).join('')}
    ${!items.length ? `<div class="empty"><span class="empty-ico">${I.trash || ''}</span><strong>Trash is empty</strong><span>Things you delete show up here for a while, so you can put them back.</span></div>` : ''}
    <div class="trash-setting"><span>Empty automatically after</span>
      <select class="trash-days" aria-label="Empty automatically after">
        ${[7, 30, 90, 0].map(d => `<option value="${d}"${d === days ? ' selected' : ''}>${d ? `${d} days` : 'Never'}</option>`).join('')}
      </select></div>
    ${items.length ? `<button type="button" class="btn trash-empty" data-empty>${I.trashSm} Empty Trash now</button>` : ''}
  </main>`;

  const main = app.querySelector('main');
  const redraw = () => renderTrashPage(app, { days, onDays });
  let confirmEmpty = false;
  main.addEventListener('click', async e => {
    const f = e.target.closest('[data-tf]');
    if (f) { trashFilter = f.dataset.tf; redraw(); return; }
    const r = e.target.closest('[data-restore]');
    if (r) {
      if (await restore(Number(r.dataset.restore))) toast('Restored');
      redraw();
      return;
    }
    const em = e.target.closest('[data-empty]');
    if (em) {
      if (!confirmEmpty) { confirmEmpty = true; em.classList.add('is-confirm'); em.innerHTML = `${I.trashSm} Tap again — this can’t be undone`; return; }
      await db.clearTrash();
      toast('Trash emptied');
      redraw();
    }
  });
  main.querySelector('.trash-days').addEventListener('change', e => {
    days = Number(e.target.value);
    onDays(days);
    redraw();
  });
}
