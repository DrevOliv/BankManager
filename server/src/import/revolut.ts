import { cleanMerchant, revolutChannel } from './normalize.js';
import { parseAmount, parseDateTime, type Table } from './readers.js';
import type { ParsedAccount, ParsedStatement } from './types.js';
import { UserError } from '../errors.js';

// Column names in English and Swedish Revolut exports.
const ALIASES = {
  type: ['type', 'typ'],
  product: ['product', 'produkt'],
  started: ['started date', 'startdatum', 'start date', 'datum för start', 'påbörjat datum'],
  completed: ['completed date', 'slutförandedatum', 'slutfört datum', 'datum för slutförande'],
  description: ['description', 'beskrivning'],
  amount: ['amount', 'belopp'],
  fee: ['fee', 'avgift'],
  currency: ['currency', 'valuta'],
  state: ['state', 'status', 'tillstånd'],
  balance: ['balance', 'saldo'],
} as const;

type Columns = Record<keyof typeof ALIASES, number>;

function findColumns(header: string[]): Columns {
  const cells = header.map((h) => h.trim().toLowerCase());
  const out = {} as Columns;
  for (const [key, names] of Object.entries(ALIASES)) {
    out[key as keyof Columns] = cells.findIndex((c) => (names as readonly string[]).includes(c));
  }
  return out;
}

function findHeaderRow(rows: Table): number {
  return rows.slice(0, 10).findIndex((r) => {
    const c = findColumns(r);
    return c.started >= 0 && c.description >= 0 && c.amount >= 0 && c.currency >= 0;
  });
}

export function isRevolut(rows: Table): boolean {
  return findHeaderRow(rows) >= 0;
}

const SKIPPED_STATES = new Set(['reverted', 'declined', 'failed', 'återförd', 'nekad', 'misslyckad']);
const PENDING_STATES = new Set(['pending', 'väntande', 'pågående']);

/**
 * Revolut account statement (CSV or Excel):
 *   Type, Product, Started Date, Completed Date, Description, Amount, Fee, Currency, State, Balance
 * One file can hold several products/currencies; each becomes its own account.
 */
export function parseRevolut(rows: Table): ParsedStatement {
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) throw new UserError('Could not find the Revolut column headers.');
  const col = findColumns(rows[headerIdx]);
  const get = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');

  const accounts = new Map<string, ParsedAccount & { latest: string }>();
  let skipped = 0;

  for (const row of rows.slice(headerIdx + 1)) {
    if (row.every((c) => !c || !c.trim())) continue;
    const state = get(row, col.state).toLowerCase();
    if (SKIPPED_STATES.has(state)) {
      skipped++;
      continue;
    }
    const started = parseDateTime(get(row, col.started));
    const completed = parseDateTime(get(row, col.completed));
    const amount = parseAmount(get(row, col.amount));
    const description = get(row, col.description);
    if (!started || amount === null || !description) {
      skipped++;
      continue;
    }
    const fee = parseAmount(get(row, col.fee)) ?? 0;
    const currency = (get(row, col.currency) || 'SEK').toUpperCase();
    const product = get(row, col.product) || 'Current';
    const type = get(row, col.type);
    const balance = parseAmount(get(row, col.balance));
    const status = PENDING_STATES.has(state) || !completed ? 'pending' : 'booked';
    const channel = revolutChannel(type, description);
    const startedAt = `${started.date} ${started.time ?? '00:00:00'}`;
    const completedAt = completed ? `${completed.date} ${completed.time ?? '00:00:00'}` : null;

    const externalId = `${product}:${currency}`;
    let account = accounts.get(externalId);
    if (!account) {
      const isMain = product.toLowerCase() === 'current';
      const name = ['Revolut', isMain ? '' : product, currency === 'SEK' ? '' : currency].filter(Boolean).join(' ');
      account = { externalId, name, currency, balance: null, transactions: [], latest: '' };
      accounts.set(externalId, account);
    }

    // The newest completed row carries the account's current balance.
    if (status === 'booked' && balance !== null && completedAt && completedAt >= account.latest) {
      account.latest = completedAt;
      account.balance = { asOf: completedAt, amount: balance };
    }

    const total = Math.round((amount - fee) * 100) / 100;
    account.transactions.push({
      date: started.date,
      bookedDate: completed?.date ?? null,
      occurredAt: startedAt,
      description,
      merchant: cleanMerchant(description, channel),
      amount: total,
      balance,
      rawType: type || null,
      channel,
      status,
      keyParts: [type, product, startedAt, description, amount.toFixed(2), currency],
    });
  }

  const dates = [...accounts.values()].flatMap((a) => a.transactions.map((t) => t.date)).sort();
  return {
    bank: 'revolut',
    accounts: [...accounts.values()].map(({ latest: _latest, ...a }) => a),
    periodStart: dates[0] ?? null,
    periodEnd: dates.at(-1) ?? null,
    rowsSkipped: skipped,
  };
}
