// diamond.js — the rating diamond (Update 17.1).
//
//            E (easy)
//   F (forgot)    R (remembered)
//            H (hard)
//
// 25 points on a dotted grid. A point is (a, b): a = steps from F towards E (0–4),
// b = steps from F towards H (0–4). So F = (0,0), E = (4,0), R = (4,4), H = (0,4).
// As x/y: x = forgot −2 … remembered +2, y = hard −2 … easy +2.
// The 6 points nearest F count as forgotten. The tough zone is the area
// (−2,0) · (0,0) · (1,−1) · (0,−2): forgot or hard.

const G = '#8dba8b', Y = '#e0bd85', R = '#f0645a';

export const toXY = (a, b) => ({ x: (a + b) / 2 - 2, y: (a - b) / 2 });
export const isLapse = (a, b) => a + b <= 2;
export const ZONE = [[-2, 0], [0, 0], [1, -1], [0, -2]];

/** Inside (or on the edge of) the tough zone. */
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

/** A review log entry as a point. Older entries saved Forgot / Hard / Knew it. */
export function logPoint(l) {
  if (l?.a != null) return { a: l.a, b: l.b };
  return { f: { a: 0, b: 0 }, h: { a: 1, b: 3 }, k: { a: 3, b: 2 } }[l?.g] || null;
}

/** Plain words for a point. */
export function describe(a, b) {
  const { x, y } = toXY(a, b);
  if (isLapse(a, b)) return y > 0 ? 'Forgot, but it felt easy' : 'Forgot';
  if (x >= 1.5) return y >= 0.5 ? 'Remembered easily' : y <= -0.5 ? 'Remembered, with effort' : 'Remembered';
  if (x >= 0.5) return y >= 0.5 ? 'Remembered, fairly easy' : y <= -0.5 ? 'Remembered, with effort' : 'Mostly remembered';
  return y >= 0.5 ? 'Half remembered, easy' : y <= -0.5 ? 'Half remembered, hard' : 'In the middle';
}
export const colorOf = (a, b) => {
  const { x, y } = toXY(a, b);
  return isLapse(a, b) ? R : inZone(x, y) ? Y : G;
};

export const daysLabel = d => (d <= 0 ? 'later today' : d === 1 ? 'tomorrow' : d < 14 ? `${d} days` : d < 60 ? `${Math.round(d / 7)} weeks` : `${Math.round(d / 30)} months`);

/** Where a point sits in an svg of size S with margin m. */
export function pos(a, b, S, m) {
  const c = S / 2, r = c - m;
  const { x, y } = toXY(a, b);
  return [c + (x / 2) * r, c - (y / 2) * r];
}
/** The nearest point to svg coordinates. */
export function nearest(px, py, S, m) {
  const c = S / 2, r = c - m;
  const x = ((px - c) / r) * 2, y = ((c - py) / r) * 2;
  const clamp = v => Math.max(0, Math.min(4, Math.round(v)));
  return { a: clamp(x + 2 + y), b: clamp(x + 2 - y) };
}

let gid = 0;
/**
 * The diamond as svg.
 *  sel {a,b}: the white dot · ghost {a,b}: last time (dashed ring) · trail [{a,b}]: numbered, joined
 *  dots [{a,b}]: plain dots (a session) · zone: draw the tough zone · letters: E R H F
 *  pick: points are buttons (data-pt="a-b")
 */
export function diamondSvg({ size = 280, margin = 20, sel = null, ghost = null, trail = null, dots = null, zone = false, letters = true, pick = false, label = '' } = {}) {
  const S = size, m = margin, id = `dg${++gid}`;
  const P = (a, b) => pos(a, b, S, m);
  const [Fx, Fy] = P(0, 0), [Ex, Ey] = P(4, 0), [Rx, Ry] = P(4, 4), [Hx, Hy] = P(0, 4);
  const small = S < 160;
  let s = `<svg class="dia" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" ${label ? `role="group" aria-label="${label}"` : 'aria-hidden="true"'}>
    <defs><linearGradient id="${id}" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${G}" stop-opacity=".28"/><stop offset=".5" stop-color="${Y}" stop-opacity=".14"/><stop offset="1" stop-color="${R}" stop-opacity=".28"/></linearGradient></defs>
    <polygon points="${Ex},${Ey} ${Rx},${Ry} ${Hx},${Hy} ${Fx},${Fy}" fill="url(#${id})" stroke="var(--surface-3)" stroke-width="1.5"/>`;
  for (let k = 1; k < 4; k++) {
    const [x1, y1] = P(k, 0), [x2, y2] = P(k, 4), [x3, y3] = P(0, k), [x4, y4] = P(4, k);
    s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="dia-grid"/><line x1="${x3}" y1="${y3}" x2="${x4}" y2="${y4}" class="dia-grid"/>`;
  }
  if (zone) {
    const c = S / 2, r = c - m;
    s += `<polygon points="${ZONE.map(([x, y]) => `${c + (x / 2) * r},${c - (y / 2) * r}`).join(' ')}" fill="${Y}" fill-opacity=".10" stroke="${Y}" stroke-opacity=".6" stroke-width="1.2" stroke-dasharray="4 4"/>`;
  }
  for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) {
    const [x, y] = P(a, b);
    s += `<circle cx="${x}" cy="${y}" r="${small ? 1.8 : 3}" class="dia-pt"/>`;
  }
  if (dots) dots.forEach((p, i) => {
    const [x, y] = P(p.a, p.b);
    s += `<circle cx="${x + ((i % 3) - 1) * 3}" cy="${y + ((i % 2) * 2 - 1) * 2}" r="${small ? 4 : 6}" fill="var(--bright)" fill-opacity=".85" stroke="var(--bg)" stroke-width="1.5"/>`;
  });
  if (trail?.length) {
    const pts = trail.map(p => P(p.a, p.b));
    s += `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-opacity=".55"/>`;
    pts.forEach(([x, y], i) => {
      const last = i === pts.length - 1;
      const op = 0.35 + 0.65 * i / Math.max(1, pts.length - 1);
      s += `<circle cx="${x}" cy="${y}" r="${small ? (last ? 6 : 5) : (last ? 9 : 7)}" fill="${last ? 'var(--bright)' : 'var(--accent)'}" fill-opacity="${last ? 1 : op}" stroke="var(--bg)" stroke-width="1.5"/>`;
      if (!small) s += `<text x="${x}" y="${y + 3.5}" text-anchor="middle" font-size="9" font-weight="700" fill="var(--bg)">${i + 1}</text>`;
    });
  }
  if (ghost) {
    const [x, y] = P(ghost.a, ghost.b);
    s += `<circle cx="${x}" cy="${y}" r="11" fill="none" stroke="var(--text)" stroke-width="2" stroke-dasharray="3 3" class="dia-ghost"/>`;
  }
  if (letters) {
    const L = (x, y, t, col) => `<circle cx="${x}" cy="${y}" r="${small ? 9 : 16}" fill="var(--surface-2)" stroke="${col}" stroke-width="1.5"/><text x="${x}" y="${y + (small ? 3.5 : 5)}" text-anchor="middle" font-size="${small ? 9 : 14}" font-weight="700" fill="${col}">${t}</text>`;
    s += L(Ex, Ey, 'E', G) + L(Rx, Ry, 'R', G) + L(Hx, Hy, 'H', Y) + L(Fx, Fy, 'F', R);
  }
  if (sel) {
    const [x, y] = P(sel.a, sel.b);
    s += `<circle cx="${x}" cy="${y}" r="14" fill="var(--bright)" stroke="var(--bg)" stroke-width="3" class="dia-sel"/>`;
  }
  if (pick) for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) {
    const [x, y] = P(a, b);
    s += `<circle cx="${x}" cy="${y}" r="16" fill="transparent" data-pt="${a}-${b}" role="button" tabindex="0" aria-label="${describe(a, b)}"/>`;
  }
  return `${s}</svg>`;
}

/** Let a diamond be dragged / tapped; onPick({a, b}) on every change. */
export function attachPicker(holder, { size, margin }, onPick) {
  const svgEl = () => holder.querySelector('svg.dia');
  const at = e => {
    const r = svgEl().getBoundingClientRect();
    const k = size / r.width;
    return nearest((e.clientX - r.left) * k, (e.clientY - r.top) * k, size, margin);
  };
  let down = false, last = '';
  const fire = p => {
    const key = `${p.a}-${p.b}`;
    if (key === last) return;
    last = key;
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
      const [a, b] = t.dataset.pt.split('-').map(Number);
      last = '';
      fire({ a, b });
    }
  });
}
