// ui.js — small helpers shared by every screen: text escaping, icons,
// toast messages and bottom sheets.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtNum = n => (n == null ? '?' : String(Math.round(n * 100) / 100));
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Shorten long text for previews. */
export const short = (s, n = 280) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export const svg = (paths, size = 22, sw = 1.8) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const I = {
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  next: svg('<path d="M9 5l7 7-7 7"/>', 20, 2),
  chevron: svg('<path d="M9 5l7 7-7 7"/>', 16),
  down: svg('<path d="M6 9l6 6 6-6"/>', 14, 2),
  list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="0.8"/><circle cx="4.5" cy="12" r="0.8"/><circle cx="4.5" cy="18" r="0.8"/>'),
  library: svg('<path d="M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.8 1-3.6 14.5-3.8-1z"/>'),
  import: svg('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14"/>'),
  notes: svg('<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4M9 9h6M9 13h4"/>'),
  note: svg('<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4M9 9h6M9 13h4"/>', 18, 2),
  highlight: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>', 18),
  settings: svg('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 20, 2),
  plusSm: svg('<path d="M12 5v14M5 12h14"/>', 14, 2),
  play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  dots: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/></svg>',
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 18, 2),
  checkSm: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 14, 2.4),
  checks: svg('<path d="M3 12.5l4 4L15 8M10 16.5l1 .5L21 7"/>', 20),
  sort: svg('<path d="M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5"/>', 16),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>', 21),
  searchSm: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>', 17),
  tag: svg('<path d="M4 4h7l9 9-7 7-9-9z"/><circle cx="8.5" cy="8.5" r="1.3"/>', 21),
  hash: svg('<path d="M5 9h14M5 15h14M10 4l-2 16M16 4l-2 16"/>', 19),
  text: svg('<path d="M4 19L10 5l6 14M6.5 14h7"/><path d="M17 19v-5.5a2.5 2.5 0 0 1 5 0V19M17 16.5h5"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>', 18),
  folder: svg('<path d="M3.5 7.5V18a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5V9a1.5 1.5 0 0 0-1.5-1.5h-7L10 5H5a1.5 1.5 0 0 0-1.5 1.5z"/>', 20, 2),
  fileSm: svg('<path d="M7 3.5h7l4.5 4.5v12.5H7z"/><path d="M14 3.5V8h4.5"/>', 20),
  file: svg('<path d="M7 3.5h7l4.5 4.5v12.5H7z"/><path d="M14 3.5V8h4.5M10 13h6M10 16.5h4"/>', 30, 1.6),
  camera: svg('<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>', 18),
  image: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5-5 4 4 3-3 4 4"/>', 18),
  shuffle: svg('<path d="M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6M18 3v4h-4M6 21v-4h4"/>', 18),
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>', 20),
  pencilSm: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>', 17),
  status: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/>', 20),
  trash: svg('<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>', 20),
  trashSm: svg('<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>', 17),
  lines: gap => svg(`<path d="M4 ${12 - gap}h16M4 12h16M4 ${12 + gap}h16"/>`, 18),
  margin: w => svg(`<path d="M3 4v16M21 4v16M${12 - w} 9h${w * 2}M${12 - w} 15h${w * 2}"/>`, 18),
  alignLeft: svg('<path d="M4 6h16M4 10h11M4 14h16M4 18h9"/>', 18),
  alignJustify: svg('<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>', 18),
  shield: svg('<path d="M12 3.5l7 3v5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9v-5z"/><path d="M12 8.5v4.5M12 16h.01"/>', 22),
  shieldOk: svg('<path d="M12 3.5l7 3v5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9v-5z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>', 22),
  upload: svg('<path d="M12 20V9M7.5 13.5L12 9l4.5 4.5M5 5h14"/>', 20),
  download: svg('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14"/>', 20, 2),
};

/* ---------- toast ---------- */

let toastTimer;
export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---------- overlays (bottom sheets, full-screen panels) ----------
   Each overlay adds one history entry, so the phone's back button closes it.
   Opening a sheet from another sheet swaps them without adding another entry. */

let overlay = null;

export const isOverlayOpen = () => !!overlay;

export function openOverlay(elements) {
  if (overlay) {
    overlay.elements.forEach(el => el.remove());
  } else {
    history.pushState({ overlay: true }, '');
  }
  document.body.append(...elements);
  overlay = { elements };
}

/** Close the overlay. navTo: a hash to go to instead of going back. */
export function closeOverlay({ fromPop = false, navTo = null } = {}) {
  if (!overlay) return;
  overlay.elements.forEach(el => el.remove());
  overlay = null;
  if (navTo) {
    if (location.hash === navTo || (navTo === '#/' && !location.hash)) history.back();
    else location.replace(navTo); // replaces the overlay's history entry
  } else if (!fromPop) {
    history.back();
  }
}

window.addEventListener('popstate', () => { if (overlay) closeOverlay({ fromPop: true }); });

export function openSheet(html, onMount) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.addEventListener('click', () => closeOverlay());
  const sheet = document.createElement('section');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.innerHTML = `<div class="grabber" aria-hidden="true"></div>${html}`;
  openOverlay([backdrop, sheet]);
  onMount?.(sheet);
  return sheet;
}
