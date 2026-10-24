import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query, tx } from '../db.js';
import { applyRules } from '../categorize.js';
import { unlinkTransfer } from '../transfers.js';
import { resolvePeriod } from '../period.js';
import { UserError } from '../errors.js';

const filterSchema = z.object({
  month: z.string().regex(/^(\d{4}-\d{2}|current)$/).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().trim().max(200).optional(),
  category: z.string().optional(), // id or 'none'
  account: z.coerce.number().int().optional(),
  kind: z.enum(['expense', 'income', 'savings', 'transfer']).optional(),
  channel: z.string().max(20).optional(),
  merchant: z.string().max(200).optional(),
  showTransfers: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(10000).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

async function buildWhere(f: z.infer<typeof filterSchema>) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.month) {
    // A "month" follows the configured start day (e.g. payday), not the calendar.
    const p = await resolvePeriod(f.month);
    add('t.date >= ?', p.start);
    add('t.date < ?', p.end);
  }
  if (f.from) add('t.date >= ?', f.from);
  if (f.to) add('t.date <= ?', f.to);
  if (f.q) {
    params.push(`%${f.q.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
    const p = `$${params.length}`;
    where.push(`(t.merchant ILIKE ${p} OR t.description ILIKE ${p} OR coalesce(t.note, '') ILIKE ${p} OR coalesce(t.category_name, '') ILIKE ${p})`);
  }
  if (f.category === 'none') where.push('t.category_id IS NULL');
  else if (f.category) add('t.category_id = ?', Number(f.category));
  if (f.account) add('t.account_id = ?', f.account);
  if (f.kind) add('t.kind = ?', f.kind);
  if (f.channel) add('t.channel = ?', f.channel);
  if (f.merchant) add('lower(t.merchant) = lower(?)', f.merchant);
  // Transfers between your own accounts are hidden unless asked for (or explicitly filtered on).
  if (f.showTransfers !== 'true' && f.kind !== 'transfer' && !f.category) where.push(`t.kind <> 'transfer'`);
  return { sql: where.length ? where.join(' AND ') : 'TRUE', params };
}

const SELECT = `
  SELECT t.id, t.date, t.booked_date, t.occurred_at, t.description, t.merchant, t.amount, t.currency, t.amount_sek,
         t.status, t.channel, t.raw_type, t.note, t.category_id, t.category_name, t.category_icon, t.category_color,
         t.category_source, t.kind, t.bank, t.account_id, t.account_name, t.transfer_peer_id,
         p.bank AS peer_bank, p.account_name AS peer_account_name, p.merchant AS peer_merchant
    FROM tx_view t
    LEFT JOIN tx_view p ON p.id = t.transfer_peer_id`;

export async function transactionRoutes(app: FastifyInstance) {
  app.get('/api/transactions', async (req) => {
    const f = filterSchema.parse(req.query);
    const { sql, params } = await buildWhere(f);
    const [items, summary] = await Promise.all([
      query(`${SELECT} WHERE ${sql} ORDER BY t.date DESC, t.occurred_at DESC NULLS LAST, t.id DESC LIMIT ${f.limit} OFFSET ${f.offset}`, params),
      one<{ total: number; spent: number; income: number }>(
        `SELECT count(*)::int AS total,
                coalesce(sum(-amount_sek) FILTER (WHERE kind = 'expense'), 0) AS spent,
                coalesce(sum(amount_sek) FILTER (WHERE kind = 'income'), 0) AS income
           FROM tx_view t WHERE ${sql}`,
        params,
      ),
    ]);
    return { items, ...summary };
  });

  app.get('/api/transactions/export.csv', async (req, reply) => {
    const f = filterSchema.parse({ ...(req.query as object), limit: 10000 });
    const { sql, params } = await buildWhere({ ...f, showTransfers: 'true' });
    const rows = await query(`${SELECT} WHERE ${sql} ORDER BY t.date DESC, t.id DESC`, params);
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      // Prefix formula-like cells so spreadsheets don't execute them.
      const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const header = ['date', 'bank', 'account', 'merchant', 'description', 'amount', 'currency', 'category', 'kind', 'status', 'note'];
    const lines = rows.map((r) =>
      [r.date, r.bank, r.account_name, r.merchant, r.description, r.amount, r.currency, r.category_name, r.kind, r.status, r.note].map(esc).join(','),
    );
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="transactions.csv"');
    return [header.join(','), ...lines].join('\n');
  });

  app.patch<{ Params: { id: string } }>('/api/transactions/:id', async (req) => {
    const id = Number(req.params.id);
    const body = z
      .object({
        categoryId: z.number().int().nullable().optional(), // null = back to automatic
        note: z.string().max(500).nullable().optional(),
        applyToMerchant: z.boolean().optional(),
      })
      .parse(req.body);

    return tx(async (c) => {
      const t = await one<{ id: number; merchant: string; amount: number }>('SELECT id, merchant, amount FROM transactions WHERE id = $1', [id], c);
      if (!t) throw new UserError('Transaction not found', 404);
      let updatedSimilar = 0;

      if (body.note !== undefined) {
        await c.query('UPDATE transactions SET note = $2 WHERE id = $1', [id, body.note?.trim() || null]);
      }

      if (body.categoryId !== undefined) {
        const peer = await unlinkTransfer(c, id);
        if (body.categoryId === null) {
          await c.query(`UPDATE transactions SET category_id = NULL, category_source = 'none' WHERE id = $1`, [id]);
          await applyRules(c, 't.id = $1', [id]);
        } else {
          const cat = await one('SELECT id FROM categories WHERE id = $1', [body.categoryId], c);
          if (!cat) throw new UserError('Unknown category');
          await c.query(`UPDATE transactions SET category_id = $2, category_source = 'user' WHERE id = $1`, [id, body.categoryId]);

          if (body.applyToMerchant) {
            // Remember the choice as a rule so future imports of this merchant land in the same place.
            const existing = await one<{ id: number }>(
              `SELECT id FROM rules WHERE source = 'user' AND match_type = 'exact' AND lower(pattern) = lower($1)`,
              [t.merchant],
              c,
            );
            if (existing) await c.query('UPDATE rules SET category_id = $2 WHERE id = $1', [existing.id, body.categoryId]);
            else {
              await c.query(
                `INSERT INTO rules (pattern, match_type, direction, category_id, source) VALUES ($1, 'exact', 'any', $2, 'user')`,
                [t.merchant, body.categoryId],
              );
            }
            updatedSimilar = await applyRules(c, 'lower(t.merchant) = lower($1)', [t.merchant]);
          }
        }
        if (peer) await applyRules(c, 't.id = $1', [peer]);
      }

      const row = await one(`${SELECT} WHERE t.id = $1`, [id], c);
      return { transaction: row, updatedSimilar };
    });
  });

  app.post('/api/transactions/bulk-category', async (req) => {
    const body = z.object({ ids: z.array(z.number().int()).min(1).max(5000), categoryId: z.number().int() }).parse(req.body);
    return tx(async (c) => {
      for (const id of body.ids) await unlinkTransfer(c, id);
      const res = await c.query(`UPDATE transactions SET category_id = $2, category_source = 'user' WHERE id = ANY($1::bigint[])`, [body.ids, body.categoryId]);
      await applyRules(c, `t.category_source = 'transfer'`);
      return { updated: res.rowCount };
    });
  });
}
