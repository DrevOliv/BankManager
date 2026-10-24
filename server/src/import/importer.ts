import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { one, query, tx } from '../db.js';
import { applyRules } from '../categorize.js';
import { matchTransfers } from '../transfers.js';
import { parseStatement } from './parse.js';
import type { ParsedAccount, ParsedTransaction } from './types.js';

export interface ImportResult {
  importId: number;
  filename: string;
  bank: string;
  accounts: string[];
  periodStart: string | null;
  periodEnd: string | null;
  total: number;
  inserted: number;
  duplicates: number;
  pendingReplaced: number;
  skipped: number;
  transfersMatched: number;
  uncategorized: number;
}

/**
 * Gives every row a key derived from its stable fields. Identical rows inside one file
 * (two 500 kr top-ups on the same day) get an occurrence counter, so re-uploading an
 * overlapping export maps each row onto the same key and duplicates are skipped.
 */
function withKeys(transactions: ParsedTransaction[]): (ParsedTransaction & { key: string })[] {
  const seen = new Map<string, number>();
  return transactions.map((t) => {
    const base = createHash('sha256').update(t.keyParts.join('\u001f')).digest('hex').slice(0, 32);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...t, key: `${t.status === 'pending' ? 'p' : 'b'}:${base}:${n}` };
  });
}

async function upsertAccount(c: PoolClient, bank: string, a: ParsedAccount): Promise<number> {
  const row = await one<{ id: number }>(
    `INSERT INTO accounts (bank, external_id, name, currency) VALUES ($1, $2, $3, $4)
     ON CONFLICT (bank, external_id) DO UPDATE SET currency = EXCLUDED.currency
     RETURNING id`,
    [bank, a.externalId, a.name, a.currency],
    c,
  );
  return row!.id;
}

interface OldPending {
  id: number;
  date: string;
  amount: number;
  category_id: number | null;
  category_source: string;
  note: string | null;
  external_key: string;
}

async function importAccount(
  c: PoolClient,
  importId: number,
  bank: string,
  account: ParsedAccount,
  period: { start: string | null; end: string | null },
) {
  const accountId = await upsertAccount(c, bank, account);
  const rows = withKeys(account.transactions);

  // Pending rows are a snapshot: earlier pending rows in this period that the new file
  // no longer lists have been booked (often under a different text) or dropped.
  const dates = rows.map((r) => r.date).sort();
  const from = [dates[0], period.start].filter(Boolean).sort()[0] ?? null;
  const to = [dates.at(-1), period.end].filter(Boolean).sort().at(-1) ?? null;
  const newPendingKeys = new Set(rows.filter((r) => r.status === 'pending').map((r) => r.key));
  let removed: OldPending[] = [];
  if (from && to) {
    const oldPending = await query<OldPending>(
      `SELECT id, date, amount, category_id, category_source, note, external_key FROM transactions
        WHERE account_id = $1 AND status = 'pending' AND date BETWEEN $2 AND $3`,
      [accountId, from, to],
      c,
    );
    removed = oldPending.filter((p) => !newPendingKeys.has(p.external_key));
    if (removed.length) {
      await c.query('DELETE FROM transactions WHERE id = ANY($1::bigint[])', [removed.map((p) => p.id)]);
    }
  }
  // Hand-picked categories and notes on those rows carry over to the new version.
  const carryable = removed.filter((p) => p.category_source === 'user' || p.note);

  let inserted = 0;
  const insertedIds: number[] = [];
  for (const r of rows) {
    const res = await one<{ id: number }>(
      `INSERT INTO transactions
         (account_id, import_id, external_key, date, booked_date, occurred_at, description, merchant,
          amount, currency, balance, raw_type, channel, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (account_id, external_key) DO NOTHING
       RETURNING id`,
      [accountId, importId, r.key, r.date, r.bookedDate, r.occurredAt, r.description, r.merchant,
        r.amount, account.currency, r.balance, r.rawType, r.channel, r.status],
      c,
    );
    if (!res) continue;
    inserted++;
    insertedIds.push(res.id);

    const i = carryable.findIndex(
      (p) => Math.abs(p.amount - r.amount) < 0.01 && Math.abs(Date.parse(p.date) - Date.parse(r.date)) <= 5 * 86_400_000,
    );
    if (i >= 0) {
      const [p] = carryable.splice(i, 1);
      const byHand = p.category_source === 'user';
      await c.query(
        `UPDATE transactions SET note = $2,
                category_id = CASE WHEN $3 THEN $4::int ELSE category_id END,
                category_source = CASE WHEN $3 THEN 'user' ELSE category_source END
          WHERE id = $1`,
        [res.id, p.note, byHand, p.category_id],
      );
    }
  }

  if (account.balance) {
    await c.query(
      `INSERT INTO balance_snapshots (account_id, as_of, balance, import_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, as_of) DO NOTHING`,
      [accountId, account.balance.asOf, account.balance.amount, importId],
    );
  }

  return { accountId, inserted, duplicates: rows.length - inserted, insertedIds, pendingReplaced: removed.length };
}

export async function importFile(buf: Buffer, filename: string, userId: number | null): Promise<ImportResult> {
  const statement = await parseStatement(buf, filename);

  return tx(async (c) => {
    const imp = await one<{ id: number }>(
      `INSERT INTO imports (filename, bank, user_id, period_start, period_end, rows_skipped)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [filename, statement.bank, userId, statement.periodStart, statement.periodEnd, statement.rowsSkipped],
      c,
    );
    const importId = imp!.id;

    let total = 0;
    let inserted = 0;
    let duplicates = 0;
    let pendingReplaced = 0;
    const ids: number[] = [];
    for (const account of statement.accounts) {
      const r = await importAccount(c, importId, statement.bank, account, {
        start: statement.periodStart,
        end: statement.periodEnd,
      });
      total += account.transactions.length;
      inserted += r.inserted;
      duplicates += r.duplicates;
      pendingReplaced += r.pendingReplaced;
      ids.push(...r.insertedIds);
    }

    if (ids.length) await applyRules(c, 't.id = ANY($1::bigint[])', [ids]);
    const transfersMatched = await matchTransfers(c);
    // Rows whose transfer partner was a replaced pending row fall back to the normal rules.
    await applyRules(c, `t.category_source = 'transfer'`);

    await c.query(
      `UPDATE imports SET rows_total = $2, rows_inserted = $3, rows_duplicate = $4,
              rows_pending_replaced = $5, transfers_matched = $6 WHERE id = $1`,
      [importId, total, inserted, duplicates, pendingReplaced, transfersMatched],
    );

    const unc = await one<{ n: number }>(
      'SELECT count(*)::int AS n FROM transactions WHERE id = ANY($1::bigint[]) AND category_id IS NULL',
      [ids],
      c,
    );

    return {
      importId,
      filename,
      bank: statement.bank,
      accounts: statement.accounts.map((a) => a.name),
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      total,
      inserted,
      duplicates,
      pendingReplaced,
      skipped: statement.rowsSkipped,
      transfersMatched,
      uncategorized: unc?.n ?? 0,
    };
  });
}
