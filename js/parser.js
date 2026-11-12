// parser.js — turns a raw .txt chapter file into structured data.
//
// Expected header (from your files):
//   Novel: Absolute Regression
//   Chapter 1: Send Me Back to the Past
// If the header is missing, the file name is used as a fallback.

const NOVEL_RE = /^(?:novel|series|title)\s*:\s*(.+)$/i;
const CHAPTER_RE = /^(?:chapter|ch\.?|bölüm)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:[:.\-–—]\s*(.*))?$/i;

/** Decode file bytes: UTF-8 first, then the Turkish Windows encoding as a fallback. */
export function decodeBytes(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1254').decode(buffer);
  }
}

/** "absolute regression" -> "Absolute Regression" (only when the name is all lowercase). */
function tidyName(name) {
  const clean = name.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean && clean === clean.toLowerCase()) {
    return clean.replace(/(^|\s)(\p{L})/gu, (m, sp, ch) => sp + ch.toUpperCase());
  }
  return clean;
}

/** Guess series name and chapter number from a file name like
 *  "1794427298256_absolute regression:chapter1.txt". */
export function parseFileName(fileName) {
  let base = fileName.replace(/\.txt$/i, '').replace(/^\d{10,}_/, '');
  let number = null;
  const numMatch = base.match(/(?:chapter|ch|bölüm)[\s._-]*([0-9]+(?:\.[0-9]+)?)/i)
    || base.match(/([0-9]+(?:\.[0-9]+)?)\s*$/);
  if (numMatch) number = parseFloat(numMatch[1]);

  let series = base
    .split(/:|\s-\s|(?:[\s._-]*(?:chapter|ch|bölüm)[\s._-]*[0-9])/i)[0]
    .replace(/[0-9]+(?:\.[0-9]+)?\s*$/, '');
  series = tidyName(series.replace(/[._-]+$/, ''));
  return { seriesName: series || null, number };
}

/** Split body text into paragraphs. Blank lines separate paragraphs;
 *  if a file has no blank lines at all, every line is its own paragraph. */
function splitParagraphs(body) {
  let parts = body.split(/\n\s*\n+/);
  const lineCount = body.split('\n').length;
  if (parts.length <= 2 && lineCount > 6) parts = body.split('\n');
  return parts
    .map(p => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
}

/** Main entry: text + file name -> { seriesName, number, title, paragraphs, words } */
export function parseChapter(text, fileName = '') {
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');

  let seriesName = null;
  let number = null;
  let title = '';
  let i = 0;

  // Read up to two header lines at the top of the file.
  while (i < lines.length && !lines[i].trim()) i++;
  for (let n = 0; n < 2 && i < lines.length; n++) {
    const line = lines[i].trim();
    const novel = line.match(NOVEL_RE);
    const chapter = line.match(CHAPTER_RE);
    if (novel && !seriesName) {
      seriesName = novel[1].trim();
    } else if (chapter && number === null) {
      number = parseFloat(chapter[1]);
      title = (chapter[2] || '').trim();
    } else {
      break;
    }
    i++;
    while (i < lines.length && !lines[i].trim()) i++;
  }

  const fromName = parseFileName(fileName);
  if (!seriesName) seriesName = fromName.seriesName;
  if (number === null) number = fromName.number;

  const paragraphs = splitParagraphs(lines.slice(i).join('\n'));
  const words = paragraphs.reduce((sum, p) => sum + p.split(/\s+/).length, 0);

  return {
    seriesName: seriesName ? seriesName.trim() : 'Untitled series',
    number,
    title,
    paragraphs,
    words,
  };
}

/** Lowercased, space-collapsed key so "Absolute Regression" matches "absolute  regression". */
export function nameKey(name) {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}
