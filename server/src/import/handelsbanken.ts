import { cleanMerchant, handelsbankenChannel } from './normalize.js';
import { parseAmount, parseDateTime, type Table } from './readers.js';
import type { ParsedStatement, ParsedTransaction } from './types.js';
import { UserError } from '../errors.js';

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

function findHeaderRow(rows: Table): number {
  return rows.findIndex((r) => {
    const cells = r.map(norm);
    return cells.includes('belopp') && (cells.includes('reskontradatum') || cells.includes('transaktionsdatum'));
  });
}

export function isHandelsbanken(rows: Table): boolean {
  const head = rows.slice(0, 40);
  return findHeaderRow(head) >= 0 || head.some((r) => norm(r[0]) === 'handelsbanken');
}

/**
 * Handelsbanken "Kontoutdrag" export:
 *   Handelsbanken / 2026-10-24, 13:23 / Kortkonto 428 398 871 / Saldo: 5617.51 / Period: ...
 *   Reskontradatum | Transaktionsdatum | Text | Belopp | Saldo
 * Rows without a Reskontradatum (booking date) are preliminary ("Prel ...") and still pending.
 */
export function parseHandelsbanken(rows: Table): ParsedStatement {
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) throw new UserError('Could not find the transaction table in the Handelsbanken file.');

  const metaCells = rows.slice(0, headerIdx).flat().map((c) => c.trim()).filter(Boolean);

  let accountName = 'Handelsbanken';
  let accountNumber = 'default';
  for (const cell of metaCells) {
    const m = cell.match(/^(.*?konto.*?)\s+([\d][\d\s-]{5,}\d)$/i);
    if (m) {
      accountName = m[1].trim();
      accountNumber = m[2].replace(/\s+/g, ' ').trim();
      break;
    }
  }

  let headerBalance: number | null = null;
  let exportedAt: string | null = null;
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  for (const cell of metaCells) {
    const saldo = cell.match(/^saldo:\s*(.+)$/i);
    if (saldo) headerBalance = parseAmount(saldo[1]);
    const period = cell.match(/^period:\s*(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/i);
    if (period) [periodStart, periodEnd] = [period[1], period[2]];
    const stamp = parseDateTime(cell);
    if (!exportedAt && stamp?.time && /^\d{4}-\d{2}-\d{2},?\s+\d{1,2}:\d{2}$/.test(cell)) {
      exportedAt = `${stamp.date} ${stamp.time}`;
    }
  }

  const header = rows[headerIdx].map(norm);
  const col = {
    booked: header.indexOf('reskontradatum'),
    date: header.indexOf('transaktionsdatum'),
    text: header.findIndex((h) => h === 'text' || h === 'beskrivning' || h === 'mottagare'),
    amount: header.indexOf('belopp'),
    balance: header.indexOf('saldo'),
  };
  if (col.amount < 0 || col.text < 0) throw new UserError('The Handelsbanken file is missing the Text or Belopp column.');

  const transactions: ParsedTransaction[] = [];
  let skipped = 0;
  let latestBooked: { date: string; balance: number } | null = null;

  for (const row of rows.slice(headerIdx + 1)) {
    if (row.every((c) => !c || !c.trim())) continue;
    const booked = col.booked >= 0 ? parseDateTime(row[col.booked] ?? '')?.date ?? null : null;
    const txDate = col.date >= 0 ? parseDateTime(row[col.date] ?? '')?.date ?? null : null;
    const date = txDate ?? booked;
    const amount = parseAmount(row[col.amount] ?? '');
    const description = (row[col.text] ?? '').trim();
    if (!date || amount === null || !description) {
      skipped++;
      continue;
    }
    const balance = col.balance >= 0 ? parseAmount(row[col.balance] ?? '') : null;
    const status = booked ? 'booked' : 'pending';
    const channel = handelsbankenChannel(description);
    if (status === 'booked' && balance !== null && (!latestBooked || booked! > latestBooked.date)) {
      // Rows are newest first, so the first row of the newest booking date carries the closing balance.
      latestBooked = { date: booked!, balance };
    }
    transactions.push({
      date,
      bookedDate: booked,
      occurredAt: null,
      description,
      merchant: cleanMerchant(description, channel),
      amount,
      balance,
      rawType: null,
      channel,
      status,
      keyParts: [status, booked ?? '', date, description, amount.toFixed(2)],
    });
  }

  const dates = transactions.map((t) => t.date).sort();
  let balance: ParsedStatement['accounts'][number]['balance'] = null;
  if (headerBalance !== null) {
    balance = { asOf: exportedAt ?? `${periodEnd ?? dates.at(-1) ?? '1970-01-01'} 23:59:59`, amount: headerBalance };
  } else if (latestBooked) {
    balance = { asOf: `${latestBooked.date} 23:59:59`, amount: latestBooked.balance };
  }

  return {
    bank: 'handelsbanken',
    accounts: [
      {
        externalId: accountNumber,
        name: accountNumber === 'default' ? accountName : `${accountName} ${accountNumber}`,
        currency: 'SEK',
        balance,
        transactions,
      },
    ],
    periodStart: periodStart ?? dates[0] ?? null,
    periodEnd: periodEnd ?? dates.at(-1) ?? null,
    rowsSkipped: skipped,
  };
}
