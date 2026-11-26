// readaloud.js — read the chapter aloud (Update 19).
//
//  • Listen (reader panel) starts at the sentence on the reading line. "Read from here"
//    (the selection bar) starts at the sentence you touched.
//  • The sentence being read is lit, and the page follows it.
//  • The bar under the reader's top bar: previous / pause / next / stop, and the settings.
//  • Settings: speed, the English voice from the phone, and when to stop (end of chapter,
//    keep going into the next chapter, or 15 / 30 / 60 minutes).
//  • Uses the phone's own text-to-speech, so it works offline once the voice is installed.
//    Some phones stop speaking when the screen goes off; the reader keeps the screen on
//    while the Keep screen on setting is on.

import { esc, svg, toast, openSheet } from './ui.js';

const K_VOICE = 'reader-ra-voice', K_RATE = 'reader-ra-rate', K_STOP = 'reader-ra-stop';
const RATES = [0.7, 1, 1.25, 1.5, 2];
const STOPS = [['chapter', 'End of this chapter'], ['next', 'Keep going into next chapters'], ['15', '15 min'], ['30', '30 min'], ['60', '60 min']];
const HANDOVER_MS = 6000; // a chapter change counts as "keep going" only this soon after the last sentence

export const LISTEN_ICON = svg('<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>', 22);
const PAUSE = svg('<path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor"/>', 20);
const PLAY = svg('<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>', 20);
const PREV = svg('<path d="M6 5v14M19 6l-9 6 9 6z"/>', 20);
const NEXT = svg('<path d="M18 5v14M5 6l9 6-9 6z"/>', 20);
const STOP = svg('<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>', 18);
const GEAR = svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>', 20);
const CHECK = svg('<path d="M5 12l5 5 9-10"/>', 16, 2.2);

const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const canSpeak = () => 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

const st = {
  attached: null,      // { paras, chapterId, nextId, onNextChapter }
  on: false, paused: false,
  list: [],            // sentences: { p, pi, start, end, text }
  i: 0,
  token: 0,            // bumped on every change, so stale callbacks do nothing
  stopTimer: null,
  handover: null, handoverAt: 0,
  bar: null,
};

/* ------------------------------------------------------------------ sentences */

/** The sentences of one paragraph, with their offsets in the paragraph's text. */
function sentencesOf(p, pi) {
  const t = p.textContent;
  const out = [];
  const re = /[^.!?…]+(?:[.!?…]+["”’)\]]*|$)|[.!?…]+["”’)\]]*/g;
  let m;
  while ((m = re.exec(t))) {
    const raw = m[0];
    const text = raw.trim();
    if (!text || !/[\p{L}\p{N}]/u.test(text)) continue;
    const start = m.index + (raw.length - raw.trimStart().length);
    out.push({ p, pi, start, end: start + text.length, text });
  }
  return out;
}

function buildList() {
  st.list = (st.attached?.paras || []).flatMap((p, pi) => sentencesOf(p, pi));
}

/** A DOM range over text offsets [start, end) of paragraph el. */
function rangeFor(el, start, end) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let pos = 0, s = null, e = null, n;
  while ((n = w.nextNode())) {
    const len = n.data.length;
    if (s === null && start < pos + len) s = { n, o: start - pos };
    if (s && end <= pos + len) { e = { n, o: end - pos }; break; }
    pos += len;
  }
  if (!s || !e) return null;
  const r = document.createRange();
  r.setStart(s.n, s.o);
  r.setEnd(e.n, e.o);
  return r;
}

function clearLight() {
  if (window.CSS?.highlights) CSS.highlights.delete('ra-lit');
  document.querySelectorAll('.ra-lit-p').forEach(x => x.classList.remove('ra-lit-p'));
}

/** Light the sentence being read and keep it on screen. */
function lightCurrent() {
  clearLight();
  const s = st.list[st.i];
  if (!s) return;
  const r = rangeFor(s.p, s.start, s.end);
  if (!r) return;
  if (window.CSS?.highlights && window.Highlight) CSS.highlights.set('ra-lit', new Highlight(r));
  else s.p.classList.add('ra-lit-p');
  const rect = r.getBoundingClientRect();
  const top = 170, bottom = window.innerHeight - 170;   // clear of the bar at the top
  if (rect.top < top || rect.bottom > bottom) {
    window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - window.innerHeight * 0.38), behavior: 'smooth' });
  }
}

/* ------------------------------------------------------------------ speaking */

function voiceFor() {
  const uri = get(K_VOICE, '');
  const vs = speechSynthesis.getVoices();
  return vs.find(v => v.voiceURI === uri) || vs.find(v => /^en[-_]US/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || null;
}

function speakAt(i) {
  const my = ++st.token;
  if (i >= st.list.length) { finished(); return; }
  st.i = i;
  lightCurrent();
  drawBar();
  const u = new SpeechSynthesisUtterance(st.list[i].text);
  const v = voiceFor();
  u.lang = v?.lang || 'en-US';
  if (v) u.voice = v;
  u.rate = get(K_RATE, 1);
  u.onend = () => { if (my === st.token && st.on && !st.paused) speakAt(i + 1); };
  u.onerror = e => {
    if (my !== st.token || e.error === 'interrupted' || e.error === 'canceled') return;
    stop();
    toast('The phone stopped reading. Try Listen again.');
  };
  speechSynthesis.speak(u);
}

/** The last sentence has been read. Carry on into the next chapter, or stop. */
function finished() {
  const stopMode = get(K_STOP, 'chapter');
  if (stopMode === 'next' && st.attached?.nextId && st.attached.onNextChapter) {
    st.handover = st.attached.nextId;
    st.handoverAt = Date.now();
    clearLight();
    st.attached.onNextChapter(st.attached.nextId);
    return;
  }
  stop();
  toast('Finished reading this chapter');
}

function armTimer() {
  clearTimeout(st.stopTimer);
  st.stopTimer = null;
  const mode = get(K_STOP, 'chapter');
  if (/^\d+$/.test(mode)) st.stopTimer = setTimeout(() => { stop(); toast('Stopped reading — your sleep time is up'); }, Number(mode) * 60000);
}

/** Start reading at a paragraph (and character offset in it). */
export function listen(fromPara = 0, fromOffset = 0) {
  if (!st.attached) return;
  if (!canSpeak()) { toast('This phone can’t read text aloud'); return; }
  st.token++;
  speechSynthesis.cancel();
  buildList();
  if (!st.list.length) { toast('Nothing to read in this chapter'); return; }
  let idx = st.list.findIndex(s => s.pi > fromPara || (s.pi === fromPara && s.end > fromOffset));
  if (idx < 0) idx = 0;
  st.on = true;
  st.paused = false;
  armTimer();
  speakAt(idx);
}

/** The Listen button: start from the reading line, or pause / carry on. */
export function toggleListen(anchor) {
  if (st.on) { togglePause(); return; }
  listen(anchor?.para ?? 0, 0);
}

export function togglePause() {
  if (!st.on) return;
  if (!st.paused) {
    st.paused = true;
    st.token++;
    speechSynthesis.cancel();
    drawBar();
  } else {
    st.paused = false;
    speakAt(st.i);
  }
}

function jump(d) {
  if (!st.on) return;
  const i = Math.max(0, Math.min(st.list.length - 1, st.i + d));
  if (st.paused) { st.i = i; lightCurrent(); drawBar(); return; }
  st.token++;
  speechSynthesis.cancel();
  speakAt(i);
}

export function stop() {
  const was = st.on;
  st.on = false;
  st.paused = false;
  st.token++;
  clearTimeout(st.stopTimer);
  st.stopTimer = null;
  if (canSpeak()) speechSynthesis.cancel();
  clearLight();
  drawBar();
  return was;
}

/* ------------------------------------------------------------------ attaching to a chapter */

/**
 * The reader calls this for each chapter it shows. Returns the clean-up for when it leaves.
 * Leaving the chapter stops reading, unless the reading carries on into the next chapter.
 */
export function attach({ paras, chapterId, nextId = null, onNextChapter = null }) {
  st.attached = { paras, chapterId, nextId, onNextChapter };
  const carry = st.handover === chapterId && Date.now() - st.handoverAt < HANDOVER_MS;
  st.handover = null;
  if (carry && st.on) { listen(0, 0); }
  else if (st.on) buildList();
  drawBar();
  return () => {
    if (st.handover == null) stop();
    else clearLight();
    st.attached = null;
  };
}

/* ------------------------------------------------------------------ the bar */

function ensureBar() {
  if (st.bar) return st.bar;
  const el = document.createElement('div');
  el.className = 'ra-bar';
  el.hidden = true;
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Reading aloud');
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-ra]');
    if (!b) return;
    const a = b.dataset.ra;
    if (a === 'prev') jump(-1);
    else if (a === 'next') jump(1);
    else if (a === 'pause') togglePause();
    else if (a === 'stop') stop();
    else if (a === 'settings') openSettings();
  });
  document.body.append(el);
  st.bar = el;
  return el;
}

function drawBar() {
  const el = ensureBar();
  el.hidden = !st.on;
  if (!st.on) return;
  el.innerHTML = `<div class="ra-info"><b>${st.paused ? 'Paused — keeps your place' : 'Reading aloud'}</b>
      <small>sentence ${st.i + 1} of ${st.list.length}</small></div>
    <button type="button" class="ra-btn" data-ra="prev" aria-label="Previous sentence">${PREV}</button>
    <button type="button" class="ra-btn ra-main" data-ra="pause" aria-label="${st.paused ? 'Resume' : 'Pause'}">${st.paused ? PLAY : PAUSE}</button>
    <button type="button" class="ra-btn" data-ra="next" aria-label="Next sentence">${NEXT}</button>
    <button type="button" class="ra-btn" data-ra="settings" aria-label="Read-aloud settings">${GEAR}</button>
    <button type="button" class="ra-btn" data-ra="stop" aria-label="Stop reading">${STOP}</button>`;
}

/* ------------------------------------------------------------------ settings */

export function openSettings() {
  const voices = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang));
  const cur = get(K_VOICE, '') || voices.find(v => /^en[-_]US/i.test(v.lang))?.voiceURI || voices[0]?.voiceURI || '';
  const rate = get(K_RATE, 1), stopMode = get(K_STOP, 'chapter');
  const sheet = openSheet(`<h2>Read aloud</h2>
    <section class="ra-set"><h3>Speed</h3><div class="ra-chips" data-group="rate">
      ${RATES.map(r => `<button type="button" class="chip${r === rate ? ' is-on' : ''}" data-set-rate="${r}" aria-pressed="${r === rate}">${r}×</button>`).join('')}</div></section>
    <section class="ra-set"><h3>Voice · from your phone</h3>
      ${voices.length ? `<div class="option-list" data-group="voice">${voices.map(v => `<button type="button" class="option-row${v.voiceURI === cur ? ' is-on' : ''}" data-set-voice="${esc(v.voiceURI)}">
        <span class="txt">${esc(v.name)}<small>${esc(v.lang)}</small></span>${v.voiceURI === cur ? CHECK : ''}</button>`).join('')}</div>`
        : '<p class="hint">No English voice on this phone yet. Phone Settings → Text-to-speech → install voice data.</p>'}</section>
    <section class="ra-set"><h3>Stop after</h3><div class="ra-chips" data-group="stop">
      ${STOPS.map(([k, t]) => `<button type="button" class="chip${k === stopMode ? ' is-on' : ''}" data-set-stop="${k}" aria-pressed="${k === stopMode}">${t}</button>`).join('')}</div>
      <p class="hint">Reading starts from the sentence on the reading line, or the one you touched with “Read here”. Pause keeps your place.</p></section>`, root => {
    root.addEventListener('click', e => {
      const r = e.target.closest('[data-set-rate]');
      if (r) { put(K_RATE, Number(r.dataset.setRate)); root.querySelectorAll('[data-set-rate]').forEach(b => { const on = b === r; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); }); return; }
      const v = e.target.closest('[data-set-voice]');
      if (v) { put(K_VOICE, v.dataset.setVoice); root.querySelectorAll('[data-set-voice]').forEach(b => { const on = b === v; b.classList.toggle('is-on', on); b.querySelector('svg')?.remove(); if (on) b.insertAdjacentHTML('beforeend', CHECK); }); return; }
      const s = e.target.closest('[data-set-stop]');
      if (s) {
        put(K_STOP, s.dataset.setStop);
        root.querySelectorAll('[data-set-stop]').forEach(b => { const on = b === s; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); });
        if (st.on) armTimer();
      }
    });
  });
  return sheet;
}
