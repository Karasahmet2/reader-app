// sounds.js — background sounds while reading.
//
//  • 6 built-in sounds made by the app itself (no downloads, work offline):
//    ocean waves, rain, river, wind, fireplace, night crickets.
//    Each is generated once as a 30-second clip whose end blends into its start,
//    so it loops without a seam.
//  • Your own sounds: any audio file from the phone, kept in the app's storage.
//  • Several sounds at once, each with its own volume, and a sleep timer that fades out.
//  • Plays through normal <audio> elements, so it keeps going with the screen off
//    and shows play/pause controls on the lock screen.

import * as db from './db.js';
import { esc, I, svg, toast, openSheet } from './ui.js';

/* ------------------------------------------------------------------ built-in sounds */

const SR = 32000;          // sample rate (Hz)
const LOOP = 30;           // seconds in one loop
const FADE = 2;            // seconds of the end blended into the start

export const BUILT_IN = [
  { id: 'waves', name: 'Ocean waves', icon: 'M3 9c2 0 2.5-2 4.5-2S10 9 12 9s2.5-2 4.5-2S19 9 21 9M3 14c2 0 2.5-2 4.5-2s2.5 2 4.5 2 2.5-2 4.5-2 2.5 2 4.5 2M3 19c2 0 2.5-2 4.5-2s2.5 2 4.5 2 2.5-2 4.5-2 2.5 2 4.5 2' },
  { id: 'rain', name: 'Rain', icon: 'M7 14a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 6.5a3.75 3.75 0 0 1 .5 7.5zM8 17l-1 3M12.5 17l-1 3M17 17l-1 3' },
  { id: 'river', name: 'River', icon: 'M4 5c4 0 4 4 8 4s4-4 8-4M4 12c4 0 4 4 8 4s4-4 8-4M4 19c3 0 3-2 6-2' },
  { id: 'wind', name: 'Wind', icon: 'M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7' },
  { id: 'fire', name: 'Fireplace', icon: 'M12 3c.8 3.5 5.5 5.5 5.5 10.5a5.5 5.5 0 0 1-11 0c0-2.8 1.6-4 2.6-5.6.8 1.6 1.6 2.6 2.6 2.6C11.7 7.7 11 5.6 12 3z' },
  { id: 'night', name: 'Night crickets', icon: 'M19 14.5A7.5 7.5 0 1 1 9.5 5a6 6 0 0 0 9.5 9.5zM17 3v3M15.5 4.5h3' },
];

// Small random-number helpers (a seeded generator, so each sound is the same every time).
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Noise sources: white (hiss), pink (softer, like rain), brown (deep rumble). */
function noises(rand) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  return {
    white: () => rand() * 2 - 1,
    pink() {
      const w = rand() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      const out = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
      return out;
    },
    brown() {
      br = (br + 0.02 * (rand() * 2 - 1)) / 1.02;
      return br * 3.5;
    },
  };
}

/** A slow, smooth random curve (values 0–1), changing every `step` seconds on average. */
function smoothCurve(rand, seconds, step) {
  const n = Math.ceil(seconds / step) + 2;
  const pts = Array.from({ length: n }, () => rand());
  return t => {
    const x = t / step;
    const i = Math.floor(x);
    const f = x - i;
    const k = f * f * (3 - 2 * f);
    return pts[i] + (pts[i + 1] - pts[i]) * k;
  };
}

/** One-pole low-pass filter; `a` between 0 (dark) and 1 (no filtering). */
const lowpass = () => { let y = 0; return (x, a) => (y += a * (x - y)); };

// Each generator fills left/right channels for `len` samples.
const GENERATORS = {
  waves(L, R, len, rand) {
    const secs = len / SR;
    // A row of waves: each swells up and drains away over 6–11 seconds.
    const waves = [];
    for (let t = -4; t < secs; t += 5.5 + rand() * 4) waves.push({ t, d: 6 + rand() * 5, a: 0.55 + rand() * 0.45 });
    const env = new Float32Array(len);
    for (const w of waves) {
      const s = Math.max(0, Math.floor(w.t * SR));
      const e = Math.min(len, Math.floor((w.t + w.d) * SR));
      for (let i = s; i < e; i++) {
        const p = (i / SR - w.t) / w.d;
        const shape = p < 0.35 ? Math.sin((p / 0.35) * Math.PI / 2) ** 2 : Math.cos(((p - 0.35) / 0.65) * Math.PI / 2) ** 1.6;
        env[i] = Math.max(env[i], shape * w.a);
      }
    }
    for (const [out, seed] of [[L, 1], [R, 2]]) {
      const n = noises(rng(seed * 977 + rand() * 1e6));
      const lp1 = lowpass(), lp2 = lowpass();
      for (let i = 0; i < len; i++) {
        const e = env[i];
        const x = n.pink() * 0.7 + n.brown() * 0.3;
        const y = lp2(lp1(x, 0.05 + 0.35 * e), 0.08 + 0.4 * e);
        out[i] = y * (0.12 + e);
      }
    }
  },

  rain(L, R, len, rand) {
    const drops = [];
    for (let i = 0; i < len / SR * 90; i++) {
      drops.push({ at: Math.floor(rand() * len), f: 1800 + rand() * 4500, a: 0.04 + rand() ** 3 * 0.35, d: 0.002 + rand() * 0.006, ch: rand() });
    }
    for (const [out, seed, side] of [[L, 3, 0], [R, 4, 1]]) {
      const n = noises(rng(seed * 1337));
      const lp = lowpass(), lo = lowpass();
      for (let i = 0; i < len; i++) {
        const x = n.pink();
        const hiss = x - lo(x, 0.04);           // remove the rumble
        out[i] = lp(hiss, 0.55) * 0.9 + n.brown() * 0.05;
      }
      for (const d of drops) {
        if ((d.ch < 0.5) !== (side === 0) && d.ch > 0.2 && d.ch < 0.8) continue; // most drops land on one side
        const n2 = Math.floor(d.d * SR * 5);
        for (let k = 0; k < n2 && d.at + k < len; k++) {
          const t = k / SR;
          out[d.at + k] += Math.sin(2 * Math.PI * d.f * t) * Math.exp(-t / d.d) * d.a;
        }
      }
    }
  },

  river(L, R, len, rand) {
    const secs = len / SR;
    const gurgles = [];
    for (let i = 0; i < secs * 7; i++) gurgles.push({ at: Math.floor(rand() * len), f: 260 + rand() * 520, d: 0.02 + rand() * 0.05, a: 0.05 + rand() * 0.12, ch: rand() < 0.5 });
    for (const [out, seed, side] of [[L, 5, true], [R, 6, false]]) {
      const n = noises(rng(seed * 4241));
      const lfo = [smoothCurve(rand, secs + 2, 0.35), smoothCurve(rand, secs + 2, 0.9), smoothCurve(rand, secs + 2, 3)];
      const lp = lowpass(), lo = lowpass();
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        const x = n.pink();
        const band = lp(x - lo(x, 0.03), 0.3);
        const m = 0.55 + 0.25 * lfo[0](t) + 0.2 * lfo[1](t);
        out[i] = band * m * (0.8 + 0.4 * lfo[2](t)) + n.brown() * 0.12;
      }
      for (const g of gurgles) {
        if (g.ch !== side) continue;
        const n2 = Math.floor(g.d * SR);
        for (let k = 0; k < n2 && g.at + k < len; k++) {
          const p = k / n2;
          const f = g.f * (1 + p * 0.8);  // a little bubble: pitch rises
          out[g.at + k] += Math.sin(2 * Math.PI * f * (k / SR)) * Math.sin(Math.PI * p) * g.a;
        }
      }
    }
  },

  wind(L, R, len, rand) {
    const secs = len / SR;
    const gust = smoothCurve(rand, secs + 2, 3.5);
    const whistle = smoothCurve(rand, secs + 2, 5);
    for (const [out, seed] of [[L, 7], [R, 8]]) {
      const n = noises(rng(seed * 733));
      const lp1 = lowpass(), lp2 = lowpass(), lo = lowpass(), rumble = lowpass();
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        const g = gust(t);
        const x = n.pink();
        const dark = lp2(lp1(x, 0.05 + 0.28 * g), 0.06 + 0.3 * g);
        const body = dark - rumble(dark, 0.035); // drop the deepest rumble a phone speaker can't play
        const air = (x - lo(x, 0.2)) * 0.04 * whistle(t) * g;
        out[i] = body * (0.25 + 1.2 * g * g) * 2 + air * 3 + n.brown() * 0.03;
      }
    }
  },

  fire(L, R, len, rand) {
    const secs = len / SR;
    const pops = [];
    for (let t = 0; t < secs; t += rand() ** 2 * 0.35) {
      const cluster = rand() < 0.15 ? 2 + Math.floor(rand() * 4) : 1;
      for (let c = 0; c < cluster; c++) {
        pops.push({ at: Math.floor((t + c * (0.01 + rand() * 0.04)) * SR), a: 0.08 + rand() ** 4 * 0.9, d: 0.0006 + rand() * 0.004, ch: rand() });
      }
    }
    const flicker = smoothCurve(rand, secs + 2, 0.6);
    for (const [out, seed, side] of [[L, 9, 0], [R, 10, 1]]) {
      const n = noises(rng(seed * 2027));
      const lp = lowpass(), lp2 = lowpass();
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        // the soft roar of the flames
        out[i] = lp2(lp(n.brown(), 0.08), 0.1) * (0.45 + 0.3 * flicker(t)) * 1.6 + n.pink() * 0.01;
      }
      const wn = noises(rng(seed * 99));
      for (const p of pops) {
        const pan = side === 0 ? 1 - p.ch * 0.7 : 0.3 + p.ch * 0.7;
        const n2 = Math.floor(p.d * SR * 6);
        const hp = lowpass();
        for (let k = 0; k < n2 && p.at + k < len; k++) {
          const x = wn.white();
          out[p.at + k] += (x - hp(x, 0.3)) * Math.exp(-(k / SR) / p.d) * p.a * pan;
        }
      }
    }
  },

  night(L, R, len, rand) {
    const secs = len / SR;
    for (const [out, seed] of [[L, 11], [R, 12]]) {
      const n = noises(rng(seed * 313));
      const lp = lowpass();
      const air = smoothCurve(rand, secs + 2, 4);
      for (let i = 0; i < len; i++) out[i] = lp(n.pink(), 0.06) * (0.35 + 0.2 * air(i / SR)) * 0.6;
    }
  },
};

/** Crickets: added after blending, placed so the pattern repeats exactly every loop. */
function addCrickets(L, R, len, rand) {
  const crickets = [
    { f: 4300, every: LOOP / 34, pan: 0.25, a: 0.05 },
    { f: 4750, every: LOOP / 40, pan: 0.8, a: 0.035 },
    { f: 3900, every: LOOP / 23, pan: 0.55, a: 0.028 },
  ];
  const pulse = Math.floor(0.016 * SR);
  const gap = Math.floor(0.012 * SR);
  for (const c of crickets) {
    const count = Math.round(LOOP / c.every);
    for (let k = 0; k < count; k++) {
      const start = Math.floor(k * c.every * SR + rand() * 0.04 * SR);
      const level = c.a * (0.7 + rand() * 0.3);
      for (let p = 0; p < 3; p++) {
        const s0 = start + p * (pulse + gap);
        for (let j = 0; j < pulse; j++) {
          const i = (s0 + j) % len;
          const env = Math.sin(Math.PI * j / pulse) ** 2;
          const v = Math.sin(2 * Math.PI * c.f * (j / SR)) * env * level;
          L[i] += v * (1 - c.pan);
          R[i] += v * c.pan;
        }
      }
    }
  }
}

/** Make one built-in sound as a loopable WAV file. */
export function makeBuiltIn(id) {
  const len = LOOP * SR;
  const full = len + FADE * SR;
  const L = new Float32Array(full);
  const R = new Float32Array(full);
  const rand = rng([...id].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7));
  GENERATORS[id](L, R, full, rand);

  // Blend the extra tail into the start, so the end flows straight back into the beginning.
  const fade = FADE * SR;
  const outL = L.subarray(0, len);
  const outR = R.subarray(0, len);
  for (let i = 0; i < fade; i++) {
    const p = i / fade;
    const gin = Math.sin(p * Math.PI / 2);
    const gout = Math.cos(p * Math.PI / 2);
    outL[i] = L[i] * gin + L[len + i] * gout;
    outR[i] = R[i] * gin + R[len + i] * gout;
  }
  if (id === 'night') addCrickets(outL, outR, len, rand);

  // Even out loudness between sounds.
  let sum = 0;
  for (let i = 0; i < len; i += 4) sum += outL[i] * outL[i] + outR[i] * outR[i];
  const rms = Math.sqrt(sum / (len / 2));
  const target = id === 'night' ? 0.07 : 0.11;
  const gain = rms > 0 ? target / rms : 1;
  return wavBlob(outL, outR, gain);
}

function wavBlob(L, R, gain) {
  const n = L.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 4, true);
  const soft = x => Math.tanh(x * gain * 1.1) / 1.1; // gentle limit instead of harsh clipping
  for (let i = 0, o = 44; i < n; i++, o += 4) {
    v.setInt16(o, Math.max(-1, Math.min(1, soft(L[i]))) * 32767, true);
    v.setInt16(o + 2, Math.max(-1, Math.min(1, soft(R[i]))) * 32767, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/* ------------------------------------------------------------------ playback */

const PREFS_KEY = 'reader-sounds';
const prefs = (() => {
  try { return { vol: {}, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return { vol: {} }; }
})();
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ } };

const urls = new Map();     // key -> object URL of the sound file
const players = new Map();  // key -> { audio, name }
let paused = false;
let timer = { minutes: 0, endAt: 0, tick: null };
let fadeLevel = 1;
const listeners = new Set();

const keyOf = id => (typeof id === 'number' ? `my-${id}` : id);
const volOf = key => prefs.vol[key] ?? 0.6;

export const isPlaying = () => players.size > 0 && !paused;
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => { listeners.forEach(fn => fn()); updateMediaSession(); };

async function urlFor(key) {
  if (urls.has(key)) return urls.get(key);
  let blob;
  if (key.startsWith('my-')) {
    blob = (await db.getSound(Number(key.slice(3))))?.blob;
    if (!blob) throw new Error('Sound not found');
  } else {
    await new Promise(r => setTimeout(r, 30)); // let the "preparing" state show first
    blob = makeBuiltIn(key);
  }
  const url = URL.createObjectURL(blob);
  urls.set(key, url);
  return url;
}

async function start(key, name) {
  const url = await urlFor(key);
  const audio = new Audio(url);
  audio.loop = true;
  audio.volume = volOf(key) * fadeLevel;
  players.set(key, { audio, name });
  if (paused) {
    paused = false;
    players.forEach(p => p.audio.play().catch(() => {}));
  } else {
    await audio.play();
  }
}

function stop(key) {
  const p = players.get(key);
  if (!p) return;
  p.audio.pause();
  p.audio.removeAttribute('src');
  players.delete(key);
  if (!players.size) { paused = false; setTimer(0); }
}

export function stopAll() {
  [...players.keys()].forEach(stop);
  changed();
}

function pauseAll() {
  paused = true;
  players.forEach(p => p.audio.pause());
  changed();
}

function resumeAll() {
  paused = false;
  players.forEach(p => p.audio.play().catch(() => {}));
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
  ms.playbackState = paused ? 'paused' : 'playing';
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
const icon = d => svg(`<path d="${d}"/>`, 26, 1.7);
const NOTE_ICON = svg('<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>', 20);
const PAUSE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
const PLAY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';

export const HEADPHONES = svg('<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><path d="M4 15h3v5H5a1 1 0 0 1-1-1zM20 15h-3v5h2a1 1 0 0 0 1-1z"/>');

export async function openSoundsPanel() {
  let mine = await db.getAllSounds();
  const loading = new Set();
  let confirmDelete = null;

  const sheet = openSheet('<div class="sounds" id="sounds"></div>', s => s.classList.add('sounds-sheet'));
  const root = sheet.querySelector('#sounds');

  const sliderRow = (key, name) => `
    <label class="snd-vol">
      <span class="snd-vol-name">${esc(name)}</span>
      <input type="range" min="0" max="100" value="${Math.round(volOf(key) * 100)}" data-vol="${key}" aria-label="${esc(name)} volume">
      <span class="snd-vol-val" data-vol-val="${key}">${Math.round(volOf(key) * 100)}%</span>
    </label>`;

  function draw() {
    const on = key => players.has(key);
    const playingList = [...players.entries()];
    root.innerHTML = `
      <div class="snd-head">
        <h2>Sounds</h2>
        ${players.size ? `<button type="button" class="chip" data-snd="${paused ? 'resume' : 'stop'}">${paused ? 'Resume' : 'Stop all'}</button>` : ''}
      </div>
      <div class="snd-grid">
        ${BUILT_IN.map(b => `
          <button type="button" class="snd-tile${on(b.id) ? ' is-on' : ''}${loading.has(b.id) ? ' is-loading' : ''}" data-snd-toggle="${b.id}" aria-pressed="${on(b.id)}">
            ${icon(b.icon)}<span>${loading.has(b.id) ? 'Preparing…' : esc(b.name)}</span>
          </button>`).join('')}
      </div>
      ${playingList.length ? `
        <section class="snd-section">
          <h3>Playing now · volume</h3>
          ${playingList.map(([key, p]) => sliderRow(key, p.name)).join('')}
        </section>` : ''}
      <section class="snd-section">
        <h3>My sounds</h3>
        ${mine.map(m => {
          const key = keyOf(m.id);
          const isOn = on(key);
          return `<div class="snd-mine${isOn ? ' is-on' : ''}">
            ${NOTE_ICON}
            <span class="snd-mine-info"><b>${esc(m.name)}</b><span>${isOn ? (paused ? 'Paused' : 'Playing') + ' · ' : ''}${fmtTime(m.duration)} loop</span></span>
            <button type="button" class="snd-del${confirmDelete === m.id ? ' confirm' : ''}" data-snd-del="${m.id}" aria-label="Remove ${esc(m.name)}">${confirmDelete === m.id ? 'Remove?' : I.trashSm}</button>
            <button type="button" class="snd-play${isOn ? ' is-on' : ''}" data-snd-toggle="${key}" aria-label="${isOn ? 'Stop' : 'Play'} ${esc(m.name)}">${isOn ? PAUSE : PLAY}</button>
          </div>`;
        }).join('')}
        <button type="button" class="snd-add" data-snd="add">${I.plusSm} Add a sound from your phone</button>
      </section>
      <section class="snd-section">
        <h3>Sleep timer</h3>
        <div class="snd-timers" role="radiogroup" aria-label="Sleep timer">
          ${[0, 15, 30, 60].map(m => `<button type="button" class="chip" role="radio" aria-checked="${timer.minutes === m}" data-snd-timer="${m}">${m ? `${m} min` : 'Off'}</button>`).join('')}
        </div>
        <p class="hint">${timer.minutes && players.size ? `Fades out at ${clock(timer.endAt)}. ` : ''}Every sound loops without a gap and keeps playing with the screen off.
          Your own sounds stay on this phone and aren’t part of backups.</p>
      </section>`;
  }

  async function toggle(key) {
    if (players.has(key)) {
      stop(key);
      changed();
      draw();
      return;
    }
    const name = key.startsWith('my-')
      ? mine.find(m => keyOf(m.id) === key)?.name
      : BUILT_IN.find(b => b.id === key)?.name;
    loading.add(key);
    draw();
    try {
      await start(key, name);
    } catch (err) {
      console.warn(err);
      stop(key);
      toast('Couldn’t play this sound');
    }
    loading.delete(key);
    changed();
    if (root.isConnected) draw();
  }

  root.addEventListener('click', async e => {
    const t = e.target.closest('[data-snd-toggle]');
    if (t) { toggle(t.dataset.sndToggle); return; }
    const tm = e.target.closest('[data-snd-timer]');
    if (tm) {
      const m = Number(tm.dataset.sndTimer);
      setTimer(m);
      if (m && !players.size) toast('The timer starts with the next sound');
      draw();
      return;
    }
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
    if (b.dataset.snd === 'stop') { stopAll(); draw(); }
    if (b.dataset.snd === 'resume') { resumeAll(); draw(); }
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

  root.addEventListener('input', e => {
    const s = e.target.closest('[data-vol]');
    if (!s) return;
    setVolume(s.dataset.vol, Number(s.value) / 100);
    const out = root.querySelector(`[data-vol-val="${s.dataset.vol}"]`);
    if (out) out.textContent = `${s.value}%`;
  });

  draw();
}

// A timer chosen before any sound starts counting when the first one plays.
onChange(() => {
  if (timer.minutes && players.size && !timer.tick) setTimer(timer.minutes);
});
