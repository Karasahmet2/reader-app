// settings.js — reading preferences (theme, accent, font, text) saved on the phone.

// bg/fg are only used to draw the little theme previews; the real colors live in style.css.
export const THEMES = [
  { id: 'night', label: 'Night', bg: '#1b1a18', fg: '#c9c3b8' },
  { id: 'dusk', label: 'Dusk', bg: '#2a2622', fg: '#d2cabd' },
  { id: 'black', label: 'Black', bg: '#000000', fg: '#bdb7ad' },
  { id: 'midnight', label: 'Midnight', bg: '#171c24', fg: '#c3cad6' },
  { id: 'forest', label: 'Forest', bg: '#18201b', fg: '#c2cdbf' },
  { id: 'paper', label: 'Dim Paper', bg: '#d6d0c4', fg: '#2a2723', light: true },
  { id: 'sepia', label: 'Sepia', bg: '#eadcc2', fg: '#3b2f22', light: true },
  { id: 'day', label: 'Day', bg: '#f7f5f0', fg: '#1f1e1c', light: true },
];
export const themeById = id => THEMES.find(t => t.id === id) || THEMES[0];
export const isLightTheme = id => !!themeById(id).light;

// Each accent has a soft version for dark themes and a deeper one for light themes,
// plus matching text-selection colors.
export const ACCENTS = {
  amber:  { label: 'Amber',  dark: '#c9a46a', paper: '#7f5720', selDark: '#4a3f2c', selPaper: '#e6d2ae' },
  orange: { label: 'Orange', dark: '#dc9560', paper: '#8a4f1f', selDark: '#4a3526', selPaper: '#ebcfb5' },
  red:    { label: 'Red',    dark: '#e5675a', paper: '#a3352a', selDark: '#4d2723', selPaper: '#efc4bd' },
  rose:   { label: 'Rose',   dark: '#dc8f87', paper: '#9a3f37', selDark: '#4a302d', selPaper: '#ebc9c3' },
  pink:   { label: 'Pink',   dark: '#e391b8', paper: '#97336a', selDark: '#4a2e3c', selPaper: '#efc6da' },
  purple: { label: 'Purple', dark: '#b79fd9', paper: '#684894', selDark: '#3b3149', selPaper: '#d8cbe9' },
  indigo: { label: 'Indigo', dark: '#9aa3e6', paper: '#3f4aa3', selDark: '#2f3250', selPaper: '#cfd2f0' },
  blue:   { label: 'Blue',   dark: '#86a9d8', paper: '#2f5d8f', selDark: '#2f3b4c', selPaper: '#c3d3e8' },
  sky:    { label: 'Sky',    dark: '#74bfdc', paper: '#1f6a8a', selDark: '#24404b', selPaper: '#bfe0ec' },
  teal:   { label: 'Teal',   dark: '#72b8b0', paper: '#2c6a64', selDark: '#28403d', selPaper: '#c1dcd8' },
  green:  { label: 'Green',  dark: '#8dba8b', paper: '#3d6a3c', selDark: '#2f3f2e', selPaper: '#c8dcc4' },
  lime:   { label: 'Lime',   dark: '#b5c46f', paper: '#5a6a14', selDark: '#3a4026', selPaper: '#dbe2b3' },
};

// Tag colors: 12 colors picked to stay easy to tell apart, even as thin underlines.
// (Update 4 replaced the earlier 19, several of which looked alike.)
export const TAG_PALETTE = {
  red:     { label: 'Red',     dark: '#f0645a', paper: '#c8352a', selDark: '#5b302c', selPaper: '#edcbc4' },
  orange:  { label: 'Orange',  dark: '#f59a3e', paper: '#c86410', selDark: '#5c4023', selPaper: '#edd5bf' },
  yellow:  { label: 'Yellow',  dark: '#ecd84f', paper: '#9a8200', selDark: '#5a5328', selPaper: '#e3dcbb' },
  green:   { label: 'Green',   dark: '#8fd14f', paper: '#4d8f15', selDark: '#3e5128', selPaper: '#d2dfc0' },
  teal:    { label: 'Teal',    dark: '#2fcaa8', paper: '#008c74', selDark: '#214f43', selPaper: '#c1ded5' },
  sky:     { label: 'Sky',     dark: '#4fc8f5', paper: '#0f86c0', selDark: '#2b4e5a', selPaper: '#c4dde5' },
  blue:    { label: 'Blue',    dark: '#5a8cff', paper: '#2f5fe0', selDark: '#2e3c5d', selPaper: '#cbd4ec' },
  purple:  { label: 'Purple',  dark: '#a77bf5', paper: '#7a3fd6', selDark: '#45375a', selPaper: '#dccdea' },
  magenta: { label: 'Magenta', dark: '#ea5fd0', paper: '#b5179f', selDark: '#592f4f', selPaper: '#e8c4de' },
  pink:    { label: 'Pink',    dark: '#ffa3c4', paper: '#e0507f', selDark: '#5f434c', selPaper: '#f2d1d7' },
  brown:   { label: 'Brown',   dark: '#a87650', paper: '#7a4a26', selDark: '#453629', selPaper: '#dccfc4' },
  silver:  { label: 'Silver',  dark: '#bfc3ca', paper: '#6b7280', selDark: '#4c4d4d', selPaper: '#d8d8d7' },
};

// Old color names (before Update 4) and the new color each one becomes.
export const OLD_TAG_COLORS = {
  amber: 'orange', rose: 'red', lime: 'green', olive: 'green', mint: 'teal', indigo: 'blue', slate: 'silver',
};

export const SPACING = { tight: 1.55, normal: 1.75, relaxed: 1.95 };
export const MARGINS = { narrow: 16, medium: 26, wide: 38 };

// Reading fonts. Lexend and Inter load with the app; the others download the first
// time they're used (then work offline, saved by the service worker).
export const FONTS = {
  lexend:     { label: 'Lexend',       family: "'Lexend', system-ui, sans-serif",           hint: 'Calm, very readable' },
  literata:   { label: 'Literata',     family: "'Literata', Georgia, serif",                hint: 'Made for long reading', google: 'Literata:wght@300;400;500' },
  inter:      { label: 'Inter',        family: "'Inter', system-ui, sans-serif",            hint: 'Clean and modern' },
  atkinson:   { label: 'Atkinson',     family: "'Atkinson Hyperlegible', system-ui, sans-serif", hint: 'Easiest to tell letters apart', google: 'Atkinson+Hyperlegible:wght@400;700' },
  merriweather: { label: 'Merriweather', family: "'Merriweather', Georgia, serif",          hint: 'Classic book serif', google: 'Merriweather:wght@300;400' },
  sourceserif: { label: 'Source Serif', family: "'Source Serif 4', Georgia, serif",         hint: 'Light, elegant serif', google: 'Source+Serif+4:wght@300;400;500' },
  nunito:     { label: 'Nunito',       family: "'Nunito', system-ui, sans-serif",           hint: 'Soft and rounded', google: 'Nunito:wght@300;400;500' },
  notosans:   { label: 'Noto Sans',    family: "'Noto Sans', system-ui, sans-serif",        hint: 'Neutral, plain', google: 'Noto+Sans:wght@300;400;500' },
};

const loadedFonts = new Set();
/** Download a Google font the first time it's needed. */
export function ensureFont(id) {
  const f = FONTS[id];
  if (!f?.google || loadedFonts.has(id)) return;
  loadedFonts.add(id);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${f.google}&display=swap`;
  document.head.append(link);
}
/** Load every font (for the font pickers, so each name shows in its own font). */
export const ensureAllFonts = () => Object.keys(FONTS).forEach(ensureFont);

export const DEFAULTS = {
  trashDays: 30, // Settings → Trash: empty automatically after this many days (0 = never)
  theme: 'night',
  favThemes: ['night', 'dusk', 'paper'], // the reader's theme button cycles through these
  accent: 'amber',
  font: 'lexend',
  size: 17,
  spacing: 'normal',
  margin: 'medium',
  align: 'left',    // 'left' or 'justify'
  dim: 0,           // extra dim overlay, 0–60 (%)
  keepAwake: true,  // keep the screen on while reading
  // Library view
  libSort: 'opened',   // opened | updated | title | chapters | read | unread | added
  libReverse: false,
  libFilter: 'all',    // all | reading | waiting | finished
  // Reader
  showFooter: true,    // percent and time left at the bottom while reading
  showTips: true,      // how-to hints around the app (Settings → Reading → Show tips)
  mwLearnersKey: '',   // Merriam-Webster Learner's Dictionary key (Define)
  mwCollegiateKey: '', // Merriam-Webster Collegiate Dictionary key (Define)
  // Backup
  backupReminder: true,
  lastBackupAt: 0,
  backupSnoozeUntil: 0,
};

export const MIN_SIZE = 12;
export const MAX_SIZE = 24;

const KEY = 'reader-settings';

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable — settings still apply for this session */
  }
}

/** Push the settings into CSS variables on <html>. */
export function applySettings(s) {
  const root = document.documentElement;
  const accent = ACCENTS[s.accent] || ACCENTS.amber;
  const theme = themeById(s.theme);
  const light = !!theme.light;
  root.dataset.theme = theme.id;
  root.dataset.light = String(light);
  root.classList.toggle('no-tips', s.showTips === false); // Settings → Show tips
  root.style.setProperty('--accent', light ? accent.paper : accent.dark);
  root.style.setProperty('--on-accent', light ? '#f7f3ec' : '#1b1a18');
  root.style.setProperty('--selection', light ? accent.selPaper : accent.selDark);
  const font = FONTS[s.font] ? s.font : 'lexend';
  ensureFont(font);
  root.style.setProperty('--read-font', FONTS[font].family);
  root.style.setProperty('--read-size', `${s.size}px`);
  root.style.setProperty('--read-lh', String(SPACING[s.spacing] || SPACING.normal));
  root.style.setProperty('--read-margin', `${MARGINS[s.margin] ?? MARGINS.medium}px`);
  root.style.setProperty('--dim', String((s.dim || 0) / 100));
  // Justified text on a narrow phone screen needs hyphenation, or big gaps appear between words.
  const justify = s.align === 'justify';
  root.style.setProperty('--read-align', justify ? 'justify' : 'left');
  root.style.setProperty('--read-hyphens', justify ? 'auto' : 'manual');
  root.dataset.footer = s.showFooter === false ? 'off' : 'on';

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme.bg);
}
