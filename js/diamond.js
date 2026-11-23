// diamond.js — the rating square (Update 17.1).
//
//                 E (easy)
//   F (forgot)  ────┼────  R (remembered)
//                 H (hard)
//
// 49 points on a dotted grid (7 × 7): x = forgot −3 … remembered +3, y = hard −3 … easy +3.
// The two left columns (x ≤ −2) count as forgotten. The tough zone is the lower-left area
// (−3,0) · (0,0) · (1.5,−1.5) · (1.5,−3) · (−3,−3): forgot or hard.
// (The file keeps its first name; the shape started as a diamond.)

const G = '#8dba8b', Y = '#e0bd85', R = '#f0645a';

export const N = 3;            // points on each side of the centre lines
export const isLapse = (x, y) => x <= -2;
export const ZONE = [[-3, 0], [0, 0], [1.5, -1.5], [1.5, -3], [-3, -3]];

/** Inside (or on the edge of) the tough zone. The zone is convex. */
export function inZone(x, y) {
  let sign = 0;
  for (let i = 0; i < ZONE.length; i++) {
    const [x1, y1] = ZONE[i], [x2, y2] = ZONE[(i + 1) % ZONE.length];
    const c = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1);
    if (Math.abs(c) < 1e-9) continue;
    if (!sign) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

/** A review log entry as a point {x, y}. Older entries (the 5 × 5 square, the diamond, or
 *  Forgot / Hard / Knew it) are moved to the matching spot. */
export function logPoint(l) {
  const up = v => Math.max(-3, Math.min(3, Math.round(v * 1.5)));
  if (l?.x != null) return l.s === 3 ? { x: l.x, y: l.y } : { x: up(l.x), y: up(l.y) };
  if (l?.a != null) return { x: up((l.a + l.b) / 2 - 2), y: up((l.a - l.b) / 2) };
  return { f: { x: -3, y: 0 }, h: { x: 0, y: -2 }, k: { x: 2, y: 1 } }[l?.g] || null;
}

/** Plain words for a point. */
const REM = { '-3': 'Forgot', '-2': 'Mostly forgot', '-1': 'Barely remembered', 0: 'Half remembered', 1: 'Mostly remembered', 2: 'Remembered', 3: 'Remembered well' };
const EASE = { '-3': 'very hard', '-2': 'hard', '-1': 'a bit hard', 0: '', 1: 'fairly easy', 2: 'easy', 3: 'very easy' };
export function describe(x, y) {
  if (x <= -3) return y > 0 ? 'Forgot, but it felt easy' : y <= -2 ? 'Forgot, and hard' : 'Forgot';
  if (x === 0 && y === 0) return 'In the middle';
  const e = EASE[y];
  return e ? `${REM[x]}, ${e}` : REM[x];
}
export const colorOf = (x, y) => (isLapse(x, y) ? R : inZone(x, y) ? Y : G);

export const daysLabel = d => (d <= 0 ? 'later today' : d === 1 ? 'tomorrow' : d < 14 ? `${d} days` : d < 60 ? `${Math.round(d / 7)} weeks` : `${Math.round(d / 30)} months`);

/** Where a point sits in an svg of size S with margin m. */
export function pos(x, y, S, m) {
  const w = S - 2 * m;
  return [m + ((x + N) / (2 * N)) * w, m + ((N - y) / (2 * N)) * w];
}
/** The nearest grid point to svg coordinates. */
export function nearest(px, py, S, m) {
  const w = S - 2 * m;
  const clamp = v => Math.max(-N, Math.min(N, Math.round(v)));
  return { x: clamp(((px - m) / w) * 2 * N - N), y: clamp(N - ((py - m) / w) * 2 * N) };
}
const key = p => `${p.x}_${p.y}`;

let gid = 0;
/**
 * The square as svg.
 *  sel {x,y}: the white dot · ghost {x,y}: last time (dashed ring) · trail [{x,y}]: numbered, joined
 *  dots [{x,y}]: plain dots (a session) · zone: draw the tough zone · letters: E R H F on the sides
 *  pick: points are buttons (data-pt="x_y")
 */
export function diamondSvg({ size = 280, margin = 22, sel = null, ghost = null, trail = null, dots = null, zone = false, letters = true, pick = false, label = '' } = {}) {
  const S = size, m = margin, id = `dg${++gid}`, w = S - 2 * m;
  const P = (x, y) => pos(x, y, S, m);
  const small = S < 160;
  let s = `<svg class="dia" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" ${label ? `role="group" aria-label="${label}"` : 'aria-hidden="true"'}>
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${R}" stop-opacity=".26"/><stop offset=".5" stop-color="${Y}" stop-opacity=".12"/><stop offset="1" stop-color="${G}" stop-opacity=".26"/></linearGradient>
    <linearGradient id="${id}v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient></defs>
    <rect x="${m}" y="${m}" width="${w}" height="${w}" rx="${small ? 6 : 12}" fill="url(#${id})"/>
    <rect x="${m}" y="${m}" width="${w}" height="${w}" rx="${small ? 6 : 12}" fill="url(#${id}v)" stroke="var(--surface-3)" stroke-width="1.5"/>`;
  for (let v = -N + 1; v < N; v++) {
    if (!v) continue;
    const [x1] = P(v, 0), [, y1] = P(0, v);
    s += `<line x1="${x1}" y1="${m}" x2="${x1}" y2="${S - m}" class="dia-grid"/><line x1="${m}" y1="${y1}" x2="${S - m}" y2="${y1}" class="dia-grid"/>`;
  }
  const [cx, cy] = P(0, 0);
  s += `<line x1="${cx}" y1="${m}" x2="${cx}" y2="${S - m}" class="dia-axis"/><line x1="${m}" y1="${cy}" x2="${S - m}" y2="${cy}" class="dia-axis"/>`;
  if (zone) s += `<polygon points="${ZONE.map(([x, y]) => P(x, y).join(',')).join(' ')}" fill="${Y}" fill-opacity=".10" stroke="${Y}" stroke-opacity=".6" stroke-width="1.2" stroke-dasharray="4 4"/>`;
  for (let x = -N; x <= N; x++) for (let y = -N; y <= N; y++) {
    const [px, py] = P(x, y);
    s += `<circle cx="${px}" cy="${py}" r="${small ? 1.5 : 2.6}" class="dia-pt"/>`;
  }
  if (dots) dots.forEach((p, i) => {
    const [x, y] = P(p.x, p.y);
    s += `<circle cx="${x + ((i % 3) - 1) * 3}" cy="${y + ((i % 2) * 2 - 1) * 2}" r="${small ? 4 : 6}" fill="var(--bright)" fill-opacity=".85" stroke="var(--bg)" stroke-width="1.5"/>`;
  });
  if (trail?.length) {
    const pts = trail.map(p => P(p.x, p.y));
    s += `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-opacity=".55"/>`;
    pts.forEach(([x, y], i) => {
      const last = i === pts.length - 1;
      const op = 0.35 + 0.65 * i / Math.max(1, pts.length - 1);
      s += `<circle cx="${x}" cy="${y}" r="${small ? (last ? 6 : 5) : (last ? 9 : 7)}" fill="${last ? 'var(--bright)' : 'var(--accent)'}" fill-opacity="${last ? 1 : op}" stroke="var(--bg)" stroke-width="1.5"/>`;
      if (!small) s += `<text x="${x}" y="${y + 3.5}" text-anchor="middle" font-size="9" font-weight="700" fill="var(--bg)">${i + 1}</text>`;
    });
  }
  if (ghost) {
    const [x, y] = P(ghost.x, ghost.y);
    s += `<circle cx="${x}" cy="${y}" r="11" fill="none" stroke="var(--text)" stroke-width="2" stroke-dasharray="3 3" class="dia-ghost"/>`;
  }
  if (letters) {
    const r = small ? 9 : 15;
    const L = ([x, y], t, col) => `<circle cx="${x}" cy="${y}" r="${r}" fill="var(--surface-2)" stroke="${col}" stroke-width="1.5"/><text x="${x}" y="${y + (small ? 3.5 : 5)}" text-anchor="middle" font-size="${small ? 9 : 13}" font-weight="700" fill="${col}">${t}</text>`;
    s += L([cx, m], 'E', G) + L([S - m, cy], 'R', G) + L([cx, S - m], 'H', Y) + L([m, cy], 'F', R);
  }
  if (sel) {
    const [x, y] = P(sel.x, sel.y);
    s += `<circle cx="${x}" cy="${y}" r="12" fill="var(--bright)" stroke="var(--bg)" stroke-width="3" class="dia-sel"/>`;
  }
  if (pick) for (let x = -N; x <= N; x++) for (let y = -N; y <= N; y++) {
    const [px, py] = P(x, y);
    s += `<circle cx="${px}" cy="${py}" r="${Math.min(16, w / (4 * N))}" fill="transparent" data-pt="${key({ x, y })}" role="button" tabindex="0" aria-label="${describe(x, y)}"/>`;
  }
  return `${s}</svg>`;
}

/** Let the square be dragged / tapped; onPick({x, y}) on every change. */
export function attachPicker(holder, { size, margin }, onPick) {
  const svgEl = () => holder.querySelector('svg.dia');
  const at = e => {
    const r = svgEl().getBoundingClientRect();
    const k = size / r.width;
    return nearest((e.clientX - r.left) * k, (e.clientY - r.top) * k, size, margin);
  };
  let down = false, last = '';
  const fire = p => {
    if (key(p) === last) return;
    last = key(p);
    onPick(p);
  };
  holder.addEventListener('pointerdown', e => {
    if (!e.target.closest('svg.dia')) return;
    down = true;
    last = '';
    holder.setPointerCapture?.(e.pointerId);
    fire(at(e));
  });
  holder.addEventListener('pointermove', e => { if (down) fire(at(e)); });
  const up = () => { down = false; };
  holder.addEventListener('pointerup', up);
  holder.addEventListener('pointercancel', up);
  holder.addEventListener('keydown', e => {
    const t = e.target.closest('[data-pt]');
    if (t && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      const [x, y] = t.dataset.pt.split('_').map(Number);
      last = '';
      fire({ x, y });
    }
  });
}
