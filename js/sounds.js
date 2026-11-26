// sounds.js — background sounds while reading (Update 18).
//
//  • Only the sounds you add from the phone. The app no longer ships built-in sounds.
//    Each one plays on a loop, through a normal <audio> element, so it keeps going with the
//    screen off and shows play/pause controls on the lock screen.
//  • Several sounds at once, each with its own volume.
//  • Pause keeps your place; Stop starts the sound from the beginning next time.
//  • A sleep timer (at the top of the page) that fades out and stops everything.
//  • You can rename a sound. The name is only for this app.

import * as db from './db.js';
import { esc, I, svg, toast, openSheet } from './ui.js';

/* ------------------------------------------------------------------ playback */

const PREFS_KEY = 'reader-sounds';
const prefs = (() => {
  try { return { vol: {}, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return { vol: {} }; }
})();
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ } };

const urls = new Map();     // key -> object URL of the sound file
const players = new Map();  // key -> { audio, name, paused }
let timer = { minutes: 0, endAt: 0, tick: null };
let fadeLevel = 1;
const listeners = new Set();

const keyOf = id => `my-${id}`;
const volOf = key => prefs.vol[key] ?? 0.6;

export const isPlaying = () => [...players.values()].some(p => !p.paused);
const allPaused = () => players.size > 0 && [...players.values()].every(p => p.paused);
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => { listeners.forEach(fn => fn()); updateMediaSession(); };

async function urlFor(key) {
  if (urls.has(key)) return urls.get(key);
  const blob = (await db.getSound(Number(key.slice(3))))?.blob;
  if (!blob) throw new Error('Sound not found');
  const url = URL.createObjectURL(blob);
  urls.set(key, url);
  return url;
}

async function start(key, name) {
  const url = await urlFor(key);
  const audio = new Audio(url);
  audio.loop = true;
  audio.volume = volOf(key) * fadeLevel;
  players.set(key, { audio, name, paused: false });
  try {
    await audio.play();
  } catch (err) {
    stop(key);
    throw err;
  }
}

function pauseOne(key) {
  const p = players.get(key);
  if (!p) return;
  p.audio.pause();   // paused, not closed: the place is kept
  p.paused = true;
  changed();
}

function resumeOne(key) {
  const p = players.get(key);
  if (!p) return;
  p.paused = false;
  p.audio.play().catch(() => {});
  changed();
}

function stop(key) {
  const p = players.get(key);
  if (!p) return;
  p.audio.pause();
  p.audio.removeAttribute('src');
  players.delete(key);
  if (!players.size) setTimer(0);
}

export function stopAll() {
  [...players.keys()].forEach(stop);
  changed();
}

function pauseAll() {
  players.forEach(p => { p.audio.pause(); p.paused = true; });
  changed();
}

function resumeAll() {
  players.forEach(p => { p.paused = false; p.audio.play().catch(() => {}); });
  changed();
}

function setVolume(key, v) {
  prefs.vol[key] = v;
  savePrefs();
  const p = players.get(key);
  if (p) p.audio.volume = v * fadeLevel;
}

/* ---- sleep timer: the last 30 seconds fade out, then everything stops ---- */

const FADE_OUT = 30;
function setTimer(minutes) {
  clearInterval(timer.tick);
  fadeLevel = 1;
  players.forEach((p, key) => { p.audio.volume = volOf(key); });
  timer = { minutes, endAt: 0, tick: null };
  if (!minutes || !players.size) return; // with no sound playing, it waits for the first one
  timer.endAt = Date.now() + minutes * 60000;
  timer.tick = setInterval(() => {
    const left = (timer.endAt - Date.now()) / 1000;
    if (left <= 0) {
      clearInterval(timer.tick);
      timer = { minutes: 0, endAt: 0, tick: null };
      fadeLevel = 1;
      stopAll();
      return;
    }
    if (left < FADE_OUT) {
      fadeLevel = left / FADE_OUT;
      players.forEach((p, key) => { p.audio.volume = volOf(key) * fadeLevel; });
    }
  }, 500);
}
// A timer chosen before any sound starts counts from the first one.
onChange(() => {
  if (timer.minutes && players.size && !timer.tick) setTimer(timer.minutes);
});

/* ---- lock screen controls ---- */

function updateMediaSession() {
  const ms = navigator.mediaSession;
  if (!ms) return;
  if (!players.size) {
    ms.playbackState = 'none';
    return;
  }
  const names = [...players.values()].map(p => p.name).join(' + ');
  if (typeof MediaMetadata !== 'undefined') {
    ms.metadata = new MediaMetadata({
      title: names,
      artist: 'Reader · background sounds',
      artwork: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
  }
  ms.playbackState = allPaused() ? 'paused' : 'playing';
  try {
    ms.setActionHandler('play', resumeAll);
    ms.setActionHandler('pause', pauseAll);
    ms.setActionHandler('stop', stopAll);
  } catch { /* some actions aren't supported everywhere */ }
}

/* ------------------------------------------------------------------ your own sounds */

const audioInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'audio/*', multiple: true, hidden: true });
document.body.append(audioInput);

function audioDuration(blob) {
  return new Promise(resolve => {
    const a = new Audio();
    const url = URL.createObjectURL(blob);
    const done = d => { URL.revokeObjectURL(url); resolve(d); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(null);
    a.src = url;
  });
}

async function addOwnSounds(files) {
  let added = 0;
  for (const file of files) {
    const duration = await audioDuration(file);
    if (duration === null) { toast(`Can’t play “${file.name}” here`); continue; }
    const name = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'My sound';
    await db.addSound({ name, blob: file, duration, addedAt: Date.now() });
    added++;
  }
  if (added) toast(added === 1 ? 'Sound added' : `${added} sounds added`);
}

/* ------------------------------------------------------------------ the panel */

const fmtTime = s => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');
const clock = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const NOTE_ICON = svg('<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>', 20);
const PEN = svg('<path d="M4 20l4-1 11-11-3-3L5 16z"/>', 16);
const PAUSE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
const PLAY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
export const HEADPHONES = svg('<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><path d="M4 15h3v5H5a1 1 0 0 1-1-1zM20 15h-3v5h2a1 1 0 0 0 1-1z"/>');

export async function openSoundsPanel() {
  const sheet = openSheet('<div class="sounds" id="sounds"></div>', s => s.classList.add('sounds-sheet'));
  await mountSounds(sheet.querySelector('#sounds'), { page: false });
}

/** The Sounds tab (bottom navigation): the same controls as a full page. */
export async function renderSoundsPage(app, navHtml) {
  app.innerHTML = `<main class="page sounds-page"><div class="sounds" id="sounds"></div></main>${navHtml}`;
  await mountSounds(app.querySelector('#sounds'), { page: true });
}

async function mountSounds(root, { page }) {
  let mine = await db.getAllSounds();
  let confirmDelete = null;
  let renaming = null;

  const sliderRow = (key, name) => `
    <label class="snd-vol">
      <span class="snd-vol-name">${esc(name)}</span>
      <input type="range" min="0" max="100" value="${Math.round(volOf(key) * 100)}" data-vol="${key}" aria-label="${esc(name)} volume">
      <span class="snd-vol-val" data-vol-val="${key}">${Math.round(volOf(key) * 100)}%</span>
    </label>`;

  const soundRow = m => {
    const key = keyOf(m.id);
    const p = players.get(key);
    if (renaming === m.id) {
      return `<div class="snd-mine is-renaming">
        <input class="text-input snd-rename" data-rename-input="${m.id}" value="${esc(m.name)}" aria-label="New name" maxlength="60">
        <button type="button" class="chip is-on" data-rename-save="${m.id}">Save</button>
        <button type="button" class="chip" data-rename-cancel="${m.id}">Cancel</button></div>`;
    }
    return `<div class="snd-mine${p ? ' is-on' : ''}">
      ${NOTE_ICON}
      <span class="snd-mine-info"><b>${esc(m.name)}</b><span>${p ? (p.paused ? 'Paused · keeps your place · ' : 'Playing · ') : ''}${fmtTime(m.duration)} loop</span></span>
      <button type="button" class="snd-ico" data-snd-rename="${m.id}" aria-label="Rename ${esc(m.name)}">${PEN}</button>
      <button type="button" class="snd-del${confirmDelete === m.id ? ' confirm' : ''}" data-snd-del="${m.id}" aria-label="Remove ${esc(m.name)}">${confirmDelete === m.id ? 'Remove?' : I.trashSm}</button>
      <button type="button" class="snd-play${p && !p.paused ? ' is-on' : ''}" data-snd-toggle="${key}" aria-label="${!p ? 'Play' : p.paused ? 'Resume' : 'Pause'} ${esc(m.name)}">${p && !p.paused ? PAUSE : PLAY}</button>
    </div>`;
  };

  function draw() {
    const list = [...players.entries()];
    root.innerHTML = `
      <div class="snd-head">
        ${page ? '<h1 class="page-title">Sounds</h1>' : '<h2>Sounds</h2>'}
        ${players.size ? `<span class="snd-head-btns">${allPaused()
          ? '<button type="button" class="chip" data-snd="resume-all">Resume all</button>'
          : '<button type="button" class="chip" data-snd="pause-all">Pause all</button>'}
          <button type="button" class="chip" data-snd="stop-all">Stop all</button></span>` : ''}
      </div>
      <section class="snd-section snd-timer">
        <h3>Sleep timer</h3>
        <div class="snd-timers" role="radiogroup" aria-label="Sleep timer">
          ${[0, 15, 30, 60].map(m => `<button type="button" class="chip" role="radio" aria-checked="${timer.minutes === m}" data-snd-timer="${m}">${m ? `${m} min` : 'Off'}</button>`).join('')}
        </div>
        <p class="hint">${timer.minutes && players.size ? `Fades out at ${clock(timer.endAt)}. ` : ''}Stops playback after the time; your place is kept.
          Sounds loop without a gap and keep playing with the screen off. Your sounds stay on this phone and aren’t part of backups.</p>
      </section>
      ${list.length ? `
        <section class="snd-section">
          <h3>Now playing · volume</h3>
          ${list.map(([key, p]) => `<div class="snd-now">
            <div class="snd-now-top"><b>${esc(p.name)}</b><span>${p.paused ? 'Paused' : 'Playing'}</span></div>
            <div class="snd-now-btns">
              <button type="button" class="chip" data-snd-pause="${key}">${p.paused ? 'Resume' : 'Pause'}</button>
              <button type="button" class="chip" data-snd-stop="${key}">Stop</button>
            </div>
            ${sliderRow(key, p.name)}
          </div>`).join('')}
        </section>` : ''}
      <section class="snd-section">
        <h3>Your sounds · ${mine.length}</h3>
        ${mine.length ? mine.map(soundRow).join('') : '<p class="hint">No sounds yet. Add one from your phone — it stays on this phone.</p>'}
        <button type="button" class="snd-add" data-snd="add">${I.plusSm} Add a sound from your phone</button>
      </section>`;
  }

  async function toggle(key) {
    const p = players.get(key);
    if (p) { if (p.paused) resumeOne(key); else pauseOne(key); draw(); return; }
    const name = mine.find(m => keyOf(m.id) === key)?.name || 'My sound';
    try {
      await start(key, name);
    } catch (err) {
      console.warn(err);
      toast('Couldn’t play this sound');
    }
    changed();
    if (root.isConnected) draw();
  }

  async function commitRename(id) {
    const name = root.querySelector(`[data-rename-input="${id}"]`)?.value.trim();
    renaming = null;
    if (name) {
      await db.updateSound(id, { name });
      const p = players.get(keyOf(id));
      if (p) p.name = name;
      mine = await db.getAllSounds();
      changed();
    }
    draw();
  }

  root.addEventListener('click', async e => {
    const t = e.target.closest('[data-snd-toggle]');
    if (t) { toggle(t.dataset.sndToggle); return; }
    const pz = e.target.closest('[data-snd-pause]');
    if (pz) { const k = pz.dataset.sndPause; if (players.get(k)?.paused) resumeOne(k); else pauseOne(k); draw(); return; }
    const sp = e.target.closest('[data-snd-stop]');
    if (sp) { stop(sp.dataset.sndStop); changed(); draw(); return; }
    const tm = e.target.closest('[data-snd-timer]');
    if (tm) {
      const m = Number(tm.dataset.sndTimer);
      setTimer(m);
      if (m && !players.size) toast('The timer starts with the next sound');
      draw();
      return;
    }
    const rn = e.target.closest('[data-snd-rename]');
    if (rn) {
      renaming = Number(rn.dataset.sndRename);
      confirmDelete = null;
      draw();
      const input = root.querySelector(`[data-rename-input="${renaming}"]`);
      input?.focus();
      input?.select();
      return;
    }
    if (e.target.closest('[data-rename-cancel]')) { renaming = null; draw(); return; }
    const rs = e.target.closest('[data-rename-save]');
    if (rs) { commitRename(Number(rs.dataset.renameSave)); return; }
    const del = e.target.closest('[data-snd-del]');
    if (del) {
      const id = Number(del.dataset.sndDel);
      if (confirmDelete !== id) { confirmDelete = id; draw(); return; }
      stop(keyOf(id));
      const url = urls.get(keyOf(id));
      if (url) { URL.revokeObjectURL(url); urls.delete(keyOf(id)); }
      await db.deleteSound(id);
      mine = await db.getAllSounds();
      confirmDelete = null;
      changed();
      draw();
      return;
    }
    const b = e.target.closest('[data-snd]');
    if (!b) return;
    if (b.dataset.snd === 'stop-all') { stopAll(); draw(); }
    if (b.dataset.snd === 'pause-all') { pauseAll(); draw(); }
    if (b.dataset.snd === 'resume-all') { resumeAll(); draw(); }
    if (b.dataset.snd === 'add') {
      audioInput.value = '';
      audioInput.onchange = async () => {
        await addOwnSounds([...audioInput.files]);
        mine = await db.getAllSounds();
        if (root.isConnected) draw();
      };
      audioInput.click();
    }
  });

  root.addEventListener('keydown', e => {
    const input = e.target.closest?.('[data-rename-input]');
    if (!input) return;
    if (e.key === 'Enter') { e.preventDefault(); commitRename(Number(input.dataset.renameInput)); }
    if (e.key === 'Escape') { renaming = null; draw(); }
  });

  root.addEventListener('input', e => {
    const s = e.target.closest('[data-vol]');
    if (!s) return;
    setVolume(s.dataset.vol, Number(s.value) / 100);
    const out = root.querySelector(`[data-vol-val="${s.dataset.vol}"]`);
    if (out) out.textContent = `${s.value}%`;
  });

  draw();
  const off = onChange(() => {
    if (!root.isConnected) { off(); return; }
    if (!root.contains(document.activeElement) || !document.activeElement?.matches?.('input')) draw();
  });
}
