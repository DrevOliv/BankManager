import ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';
import { UserError } from '../errors.js';

export type Table = string[][];

/** Reads an uploaded statement (xlsx, csv, or an HTML table saved as .xls) into rows of strings. */
export async function readTable(buf: Buffer, filename: string): Promise<Table> {
  if (buf.length === 0) throw new UserError(`${filename} is empty`);

  // xlsx files are zip archives.
  if (buf[0] === 0x50 && buf[1] === 0x4b) return readXlsx(buf);

  // Legacy binary .xls (OLE2) is not supported by any maintained JS reader.
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
    throw new UserError(`${filename} is an old binary .xls file. Please export it as .xlsx or .csv instead.`);
  }

  const text = decodeText(buf);
  if (/^\s*</.test(text)) return readHtmlTable(text);
  return readCsv(text);
}

function decodeText(buf: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // Older Swedish bank exports are often Windows-1252.
    text = new TextDecoder('windows-1252').decode(buf);
  }
  return text.replace(/^﻿/, '');
}

function readCsv(text: string): Table {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t']
    .map((d) => ({ d, n: firstLine.split(d).length }))
    .sort((a, b) => b.n - a.n)[0].d;
  const rows: string[][] = parseCsv(text, {
    delimiter,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: false,
  });
  return rows.map((r) => r.map((c) => String(c ?? '').trim()));
}

function readHtmlTable(html: string): Table {
  const rows: Table = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  for (const rowMatch of html.matchAll(rowRe)) {
    const cells = [...rowMatch[1].matchAll(cellRe)].map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim());
    rows.push(cells);
  }
  return rows;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

async function readXlsx(buf: Buffer): Promise<Table> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new UserError('Could not read the Excel file. Is it a valid .xlsx?');
  }
  const sheet = wb.worksheets[0];
  if (!sheet) return [];
  const rows: Table = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: string[] = [];
    const count = row.cellCount;
    for (let i = 1; i <= count; i++) cells.push(cellToString(row.getCell(i).value));
    rows[rowNumber - 1] = cells;
  });
  return Array.from(rows, (r) => r ?? []);
}

function cellToString(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
  }
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('').trim();
    if ('result' in v) return cellToString(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text).trim();
  }
  return String(v).trim();
}

/** Parses bank amounts like "-1300", "1 234,50", "−99.00" or "2,298.26". */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[\s  ]/g, '').replace(/−/g, '-').replace(/(SEK|kr)$/i, '');
  if (s === '' || s === '-') return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Whichever separator comes last is the decimal separator.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const decimals = s.length - lastComma - 1;
    s = decimals === 3 && s.indexOf(',') === lastComma ? s.replace(',', '') : s.replace(/,/g, '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Normalises "2026-10-24", "2026-10-24 13:23:00", "24/10/2026" etc. to YYYY-MM-DD (+ time). */
export function parseDateTime(raw: string): { date: string; time: string | null } | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const time = m[4] ? `${m[4].padStart(2, '0')}:${m[5]}:${m[6] ?? '00'}` : null;
    return { date: `${m[1]}-${m[2]}-${m[3]}`, time };
  }
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const time = m[4] ? `${m[4].padStart(2, '0')}:${m[5]}:${m[6] ?? '00'}` : null;
    return { date: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, time };
  }
  // Excel serial date numbers.
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const ms = Math.round((Number(s) - 25569) * 86400 * 1000);
    const iso = new Date(ms).toISOString();
    return { date: iso.slice(0, 10), time: iso.slice(11, 19) === '00:00:00' ? null : iso.slice(11, 19) };
  }
  return null;
}
