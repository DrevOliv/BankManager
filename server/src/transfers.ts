import { one, query, type Db } from './db.js';

interface Candidate {
  id: number;
  account_id: number;
  date: string;
  amount: number;
  currency: string;
  description: string;
  channel: string;
}

const MAX_DAYS_APART = 4;

// Text that only shows up when money moves between your own accounts.
const STRONG_HINT = /revolut\s*\*|apple pay deposit|google pay deposit|top-?up|överf|overf|överföring|egen överföring|exchanged (to|from)|savings|vault|sparkonto/i;
// Text that suggests a transfer but could also be a payment to someone else.
const WEAK_HINT = /transfer|payment from|insättning|deposit|revolut/i;

function hint(t: Candidate): number {
  // Card purchases and payments to people are never own-account transfers.
  if (t.channel === 'card' || t.channel === 'swish' || t.channel === 'p2p') return 0;
  if (STRONG_HINT.test(t.description) || t.channel === 'topup' || t.channel === 'exchange') return 2;
  if (WEAK_HINT.test(t.description) || t.channel === 'transfer') return 1;
  return 0;
}

const daysBetween = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/**
 * Pairs up money leaving one of your accounts with the same amount arriving in another
 * (e.g. Handelsbanken "Revolut**3387*" −500 ↔ Revolut "Apple Pay deposit" +500) so that
 * neither side counts as spending or income. Returns the number of pairs created.
 */
export async function matchTransfers(db: Db): Promise<number> {
  const transferCat = await one<{ id: number }>(`SELECT id FROM categories WHERE system_key = 'transfer'`, [], db);
  if (!transferCat) return 0;

  const rows = await query<Candidate>(
    `SELECT id, account_id, date, amount, currency, description, channel
       FROM transactions
      WHERE transfer_peer_id IS NULL AND category_source <> 'user' AND amount <> 0
        AND (category_id IS NULL OR category_id NOT IN (SELECT id FROM categories WHERE kind = 'savings'))`,
    [],
    db,
  );

  // Bucket by currency + absolute amount; only opposite signs in different accounts can pair.
  const buckets = new Map<string, Candidate[]>();
  for (const r of rows) {
    const k = `${r.currency}:${Math.abs(r.amount).toFixed(2)}`;
    let list = buckets.get(k);
    if (!list) buckets.set(k, (list = []));
    list.push(r);
  }

  const pairs: { out: Candidate; in: Candidate; score: number; days: number }[] = [];
  for (const list of buckets.values()) {
    const outs = list.filter((t) => t.amount < 0);
    const ins = list.filter((t) => t.amount > 0);
    for (const o of outs) {
      for (const i of ins) {
        if (o.account_id === i.account_id) continue;
        const days = daysBetween(o.date, i.date);
        if (days > MAX_DAYS_APART) continue;
        const ho = hint(o);
        const hi = hint(i);
        // Both sides must look like a transfer, and at least one side clearly so.
        if (Math.max(ho, hi) < 2 || Math.min(ho, hi) < 1) continue;
        pairs.push({ out: o, in: i, score: ho + hi, days });
      }
    }
  }

  // Best evidence first, then closest in time.
  pairs.sort((a, b) => b.score - a.score || a.days - b.days || a.out.id - b.out.id || a.in.id - b.in.id);
  const used = new Set<number>();
  const matched: [number, number][] = [];
  for (const p of pairs) {
    if (used.has(p.out.id) || used.has(p.in.id)) continue;
    used.add(p.out.id);
    used.add(p.in.id);
    matched.push([p.out.id, p.in.id]);
  }

  for (const [a, b] of matched) {
    await db.query(
      `UPDATE transactions
          SET transfer_peer_id = CASE WHEN id = $1 THEN $2::bigint ELSE $1::bigint END,
              category_id = $3, category_source = 'transfer'
        WHERE id IN ($1, $2)`,
      [a, b, transferCat.id],
    );
  }
  return matched.length;
}

/** Breaks a transfer pair (e.g. when you recategorise one side by hand). Returns the peer id. */
export async function unlinkTransfer(db: Db, id: number): Promise<number | null> {
  const row = await one<{ transfer_peer_id: number | null }>('SELECT transfer_peer_id FROM transactions WHERE id = $1', [id], db);
  const peer = row?.transfer_peer_id ?? null;
  if (peer === null) return null;
  await db.query(
    `UPDATE transactions SET transfer_peer_id = NULL,
            category_source = CASE WHEN category_source = 'transfer' THEN 'none' ELSE category_source END
      WHERE id IN ($1, $2)`,
    [id, peer],
  );
  return peer;
}
