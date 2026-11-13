// find.js — "Find uses": every place a word, name or phrase appears,
// in this chapter, this series or all series, with the sentence around it.

import * as db from './db.js';
import { esc, fmtNum, plural, I, openSheet, closeOverlay } from './ui.js';

const MAX_SHOWN = 300; // results listed per scope (counts are always complete)

/** Same text the reader shows: _inner thoughts_ lose their underscores. */
export const plainText = p => p.replace(/(^|[^\w])_([^_\n]+?)_(?!\w)/g, '$1$2');

/** A case-insensitive pattern; "whole word" won't match inside longer words. */
export function makePattern(term, wholeWord) {
  const body = term.trim().replace(/\s+/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
  if (!body) return null;
  return wholeWord
    ? new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu')
    : new RegExp(body, 'giu');
}

/** The sentence around a match, trimmed to a readable length, with the match marked. */
function snippet(text, start, end) {
  let a = start;
  while (a > 0 && !/[.!?…]["”’)]?\s$/.test(text.slice(Math.max(0, a - 3), a))) a -= 1;
  let b = end;
  while (b < text.length && !/[.!?…]/.test(text[b])) b += 1;
  b = Math.min(text.length, b + 1);
  if (text[b] && /["”’]/.test(text[b])) b += 1;
  const MAX = 90; // characters kept on each side of the match
  let pre = text.slice(a, start);
  let post = text.slice(end, b);
  if (pre.length > MAX) pre = `…${pre.slice(-MAX).replace(/^\S*\s/, '')}`;
  if (post.length > MAX) post = `${post.slice(0, MAX).replace(/\s\S*$/, '')}…`;
  return `${esc(pre)}<mark>${esc(text.slice(start, end))}</mark>${esc(post)}`;
}

/**
 * Open the Find panel.
 *  term:      starting search text
 *  chapterId, seriesId: where you are (for the "This chapter" / "This series" tabs)
 *  onJumpHere(para, nth, term, wholeWord): jump inside the open chapter (reader only)
 */
export async function openFind({ term, chapterId, seriesId, onJumpHere = null }) {
  const [chapters, seriesList] = await Promise.all([db.getAllChapters(), db.getAllSeries()]);
  const chapterById = new Map(chapters.map(c => [c.id, c]));
  const seriesById = new Map(seriesList.map(s => [s.id, s]));

  const state = {
    term: term.trim().slice(0, 80),
    whole: true,
    scope: 'chapter',
    hits: { chapter: [], series: [], all: [] },
    counts: { chapter: 0, series: 0, all: 0 },
    searching: false,
  };
  let runId = 0;

  const sheet = openSheet(`
    <h2>Find uses</h2>
    <label class="search-box" style="margin-top:0">${I.search}
      <span class="visually-hidden">Find</span>
      <input id="find-term" type="search" value="${esc(state.term)}" autocomplete="off" placeholder="Word, name or phrase">
    </label>
    <div class="find-opts">
      <div class="segmented find-scopes" role="tablist" aria-label="Where to look"></div>
      <button type="button" class="find-whole" aria-pressed="true">Whole word</button>
    </div>
    <div class="find-results" aria-live="polite"></div>`, s => s.classList.add('find-sheet'));

  const input = sheet.querySelector('#find-term');
  const scopesEl = sheet.querySelector('.find-scopes');
  const results = sheet.querySelector('.find-results');
  const wholeBtn = sheet.querySelector('.find-whole');

  function drawScopes() {
    const tab = (k, label) => `<button type="button" role="tab" data-scope="${k}" aria-selected="${state.scope === k}" aria-pressed="${state.scope === k}">
      ${label}<small>${state.searching ? '…' : state.counts[k]}</small></button>`;
    scopesEl.innerHTML = tab('chapter', 'Chapter') + tab('series', 'Series') + tab('all', 'All series');
  }

  function drawResults() {
    if (!state.term.trim()) { results.innerHTML = '<p class="hint">Type a word or name to find.</p>'; return; }
    if (state.searching) { results.innerHTML = '<p class="hint">Searching…</p>'; return; }
    const hits = state.hits[state.scope];
    const total = state.counts[state.scope];
    if (!total) {
      results.innerHTML = `<p class="hint">No uses of “${esc(state.term)}” ${
        { chapter: 'in this chapter', series: 'in this series', all: 'in your library' }[state.scope]}.${
        state.whole ? ' Try turning off “Whole word” to catch other forms.' : ''}</p>`;
      return;
    }
    // Group by chapter, in series and chapter order.
    const groups = new Map();
    for (const h of hits) {
      if (!groups.has(h.chapterId)) groups.set(h.chapterId, []);
      groups.get(h.chapterId).push(h);
    }
    const showSeries = state.scope === 'all';
    results.innerHTML = `
      <p class="hint" style="padding:0 2px">${plural(total, 'use')}${hits.length < total ? ` · showing the first ${hits.length}` : ''}</p>
      ${[...groups.entries()].map(([cid, list]) => {
        const c = chapterById.get(cid);
        const s = seriesById.get(c?.seriesId);
        return `<section class="find-group">
          <h3>${showSeries ? `${esc(s?.name || '')} · ` : ''}Ch. ${fmtNum(c?.number)}${c?.title ? ` · ${esc(c.title)}` : ''}
            <span>${list.length}</span></h3>
          ${list.map(h => `<button type="button" class="find-hit" data-hit="${h.i}">${h.html}</button>`).join('')}
        </section>`;
      }).join('')}`;
  }

  async function search() {
    const id = ++runId;
    const pattern = makePattern(state.term, state.whole);
    state.hits = { chapter: [], series: [], all: [] };
    state.counts = { chapter: 0, series: 0, all: 0 };
    if (!pattern) { state.searching = false; drawScopes(); drawResults(); return; }
    state.searching = true;
    drawScopes();
    drawResults();

    const found = [];
    await db.forEachText((cid, paragraphs) => {
      const c = chapterById.get(cid);
      if (!c) return;
      paragraphs.forEach((raw, para) => {
        const text = plainText(raw);
        pattern.lastIndex = 0;
        let m;
        let nth = 0;
        while ((m = pattern.exec(text))) {
          found.push({ chapterId: cid, seriesId: c.seriesId, number: c.number, para, nth, text, start: m.index, end: m.index + m[0].length });
          nth += 1;
          if (!m[0].length) pattern.lastIndex += 1;
        }
      });
    });
    if (id !== runId) return; // a newer search started meanwhile

    const seriesName = sid => seriesById.get(sid)?.name || '';
    found.sort((a, b) => seriesName(a.seriesId).localeCompare(seriesName(b.seriesId))
      || a.number - b.number || a.para - b.para || a.start - b.start);
    found.forEach((h, i) => { h.i = i; });
    const inScope = {
      chapter: found.filter(h => h.chapterId === chapterId),
      series: found.filter(h => h.seriesId === seriesId),
      all: found,
    };
    for (const k of Object.keys(inScope)) {
      state.counts[k] = inScope[k].length;
      state.hits[k] = inScope[k].slice(0, MAX_SHOWN).map(h => ({ ...h, html: snippet(h.text, h.start, h.end) }));
    }
    state.all = found;
    // Nothing in this chapter? Show the series (or everything) instead.
    if (!state.counts.chapter && state.scope === 'chapter') state.scope = state.counts.series ? 'series' : 'all';
    state.searching = false;
    drawScopes();
    drawResults();
  }

  let typing;
  input.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => { state.term = input.value; search(); }, 350);
  });
  wholeBtn.addEventListener('click', () => {
    state.whole = !state.whole;
    wholeBtn.setAttribute('aria-pressed', String(state.whole));
    search();
  });
  sheet.addEventListener('click', e => {
    const tab = e.target.closest('[data-scope]');
    if (tab) { state.scope = tab.dataset.scope; drawScopes(); drawResults(); return; }
    const hitBtn = e.target.closest('[data-hit]');
    if (!hitBtn) return;
    const h = state.all[Number(hitBtn.dataset.hit)];
    if (!h) return;
    if (h.chapterId === chapterId && onJumpHere) {
      closeOverlay();
      onJumpHere(h.para, h.nth, state.term, state.whole);
    } else {
      const t = encodeURIComponent(state.term);
      closeOverlay({ navTo: `#/read/${h.chapterId}/find/${h.para}/${h.nth}/${state.whole ? 1 : 0}/${t}` });
    }
  });

  drawScopes();
  search();
}

/**
 * Briefly mark the nth match of a search inside paragraph `p` and scroll to it.
 * Returns true if it was found.
 */
export function flashMatch(p, nth, term, wholeWord) {
  const pattern = makePattern(term, wholeWord);
  if (!p || !pattern) return false;
  const text = p.textContent;
  let m;
  let i = 0;
  while ((m = pattern.exec(text))) {
    if (i === nth) break;
    i += 1;
    if (!m[0].length) pattern.lastIndex += 1;
  }
  if (!m) return false;

  // Wrap the matched characters (they may span several text nodes) in <mark>.
  const from = m.index;
  const to = from + m[0].length;
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  const parts = [];
  let pos = 0;
  let node;
  while ((node = walker.nextNode())) {
    const a = Math.max(from, pos);
    const b = Math.min(to, pos + node.data.length);
    if (a < b) parts.push([node, a - pos, b - pos]);
    pos += node.data.length;
    if (pos >= to) break;
  }
  const marks = parts.map(([textNode, a, b]) => {
    let t = textNode;
    if (a > 0) t = t.splitText(a);
    if (b - a < t.data.length) t.splitText(b - a);
    const mk = document.createElement('mark');
    mk.className = 'find-mark';
    t.parentNode.insertBefore(mk, t);
    mk.appendChild(t);
    return mk;
  });
  if (!marks.length) return false;
  const y = marks[0].getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.35;
  window.scrollTo(0, Math.max(0, y));
  setTimeout(() => {
    marks.forEach(mk => {
      const parent = mk.parentNode;
      if (!parent) return;
      while (mk.firstChild) parent.insertBefore(mk.firstChild, mk);
      mk.remove();
    });
    p.normalize();
  }, 2600);
  return true;
}
