import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query, tx } from '../db.js';
import { applyRules } from '../categorize.js';
import { importFile } from '../import/importer.js';
import { UserError } from '../errors.js';
import { balances } from '../stats.js';

export async function importRoutes(app: FastifyInstance) {
  app.post('/api/imports', async (req) => {
    const results = [];
    for await (const part of req.files()) {
      const buf = await part.toBuffer();
      try {
        results.push({ ok: true as const, ...(await importFile(buf, part.filename, req.user!.id)) });
      } catch (err) {
        const message = err instanceof UserError ? err.message : 'Something went wrong while importing this file.';
        if (!(err instanceof UserError)) req.log.error(err);
        results.push({ ok: false as const, filename: part.filename, error: message });
      }
    }
    if (!results.length) throw new UserError('No files were uploaded.');
    return { results };
  });

  app.get('/api/imports', async () =>
    query(
      `SELECT i.*, u.username,
              (SELECT count(*)::int FROM transactions t WHERE t.import_id = i.id) AS rows_remaining
         FROM imports i LEFT JOIN users u ON u.id = i.user_id
        ORDER BY i.created_at DESC LIMIT 200`,
    ),
  );

  // Undo an import: removes the transactions (and balance snapshot) it added.
  app.delete<{ Params: { id: string } }>('/api/imports/:id', async (req) => {
    const id = Number(req.params.id);
    return tx(async (c) => {
      const removed = await one<{ n: number }>('SELECT count(*)::int AS n FROM transactions WHERE import_id = $1', [id], c);
      const res = await c.query('DELETE FROM imports WHERE id = $1', [id]);
      if (!res.rowCount) throw new UserError('Import not found', 404);
      // Transfers whose partner was removed go back to normal categorisation.
      await applyRules(c, `t.category_source = 'transfer'`);
      return { removed: removed?.n ?? 0 };
    });
  });

  app.get('/api/accounts', async () => {
    const { accounts, total } = await balances();
    const counts = await query<{ account_id: number; n: number; first: string; last: string }>(
      'SELECT account_id, count(*)::int AS n, min(date) AS first, max(date) AS last FROM transactions GROUP BY account_id',
    );
    const byId = new Map(counts.map((c) => [c.account_id, c]));
    return {
      total,
      accounts: accounts.map((a) => ({
        ...a,
        transactions: byId.get(a.id)?.n ?? 0,
        firstDate: byId.get(a.id)?.first ?? null,
        lastDate: byId.get(a.id)?.last ?? null,
      })),
    };
  });

  app.patch<{ Params: { id: string } }>('/api/accounts/:id', async (req) => {
    const body = z.object({ name: z.string().trim().min(1).max(80).optional(), includeInBalance: z.boolean().optional() }).parse(req.body);
    const row = await one(
      `UPDATE accounts SET name = coalesce($2, name), include_in_balance = coalesce($3, include_in_balance)
        WHERE id = $1 RETURNING id, name, include_in_balance`,
      [Number(req.params.id), body.name ?? null, body.includeInBalance ?? null],
    );
    if (!row) throw new UserError('Account not found', 404);
    return row;
  });

  app.delete<{ Params: { id: string } }>('/api/accounts/:id', async (req) =>
    tx(async (c) => {
      const res = await c.query('DELETE FROM accounts WHERE id = $1', [Number(req.params.id)]);
      if (!res.rowCount) throw new UserError('Account not found', 404);
      await applyRules(c, `t.category_source = 'transfer'`);
      return { ok: true };
    }),
  );
}
