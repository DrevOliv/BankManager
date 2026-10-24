import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query, tx } from '../db.js';
import { applyRules } from '../categorize.js';
import { matchTransfers } from '../transfers.js';
import { UserError } from '../errors.js';

const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(['expense', 'income', 'savings', 'transfer']),
  icon: z.string().trim().min(1).max(40).default('tag'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#898781'),
});

const ruleSchema = z.object({
  pattern: z.string().trim().min(1).max(200),
  matchType: z.enum(['contains', 'word', 'exact', 'regex']).default('contains'),
  direction: z.enum(['any', 'in', 'out']).default('any'),
  categoryId: z.number().int(),
});

function validateRegex(r: { matchType: string; pattern: string }) {
  if (r.matchType !== 'regex') return;
  try {
    new RegExp(r.pattern, 'iu');
  } catch {
    throw new UserError('That is not a valid regular expression.');
  }
}

async function reapplyAll() {
  return tx(async (c) => {
    const changed = await applyRules(c);
    const matched = await matchTransfers(c);
    return { changed, matched };
  });
}

export async function categoryRoutes(app: FastifyInstance) {
  app.get('/api/categories', async () =>
    query(
      `SELECT c.id, c.name, c.kind, c.icon, c.color, c.sort_order, c.system_key,
              (SELECT count(*)::int FROM transactions t WHERE t.category_id = c.id) AS count,
              (SELECT count(*)::int FROM rules r WHERE r.category_id = c.id) AS rule_count
         FROM categories c
        ORDER BY array_position(ARRAY['expense', 'income', 'savings', 'transfer'], c.kind), c.sort_order, c.name`,
    ),
  );

  app.post('/api/categories', async (req) => {
    const body = categorySchema.parse(req.body);
    const exists = await one('SELECT 1 FROM categories WHERE lower(name) = lower($1)', [body.name]);
    if (exists) throw new UserError('A category with that name already exists.');
    return one(
      `INSERT INTO categories (name, kind, icon, color, sort_order)
       VALUES ($1, $2, $3, $4, (SELECT coalesce(max(sort_order), 0) + 10 FROM categories))
       RETURNING id, name, kind, icon, color`,
      [body.name, body.kind, body.icon, body.color],
    );
  });

  app.patch<{ Params: { id: string } }>('/api/categories/:id', async (req) => {
    const body = categorySchema.partial().parse(req.body);
    const id = Number(req.params.id);
    const current = await one<{ system_key: string | null }>('SELECT system_key FROM categories WHERE id = $1', [id]);
    if (!current) throw new UserError('Category not found', 404);
    if (current.system_key === 'transfer' && body.kind && body.kind !== 'transfer') {
      throw new UserError('The transfer category must stay a transfer.');
    }
    if (body.name) {
      const clash = await one('SELECT 1 FROM categories WHERE lower(name) = lower($1) AND id <> $2', [body.name, id]);
      if (clash) throw new UserError('A category with that name already exists.');
    }
    return one(
      `UPDATE categories SET name = coalesce($2, name), kind = coalesce($3, kind),
              icon = coalesce($4, icon), color = coalesce($5, color)
        WHERE id = $1 RETURNING id, name, kind, icon, color`,
      [id, body.name ?? null, body.kind ?? null, body.icon ?? null, body.color ?? null],
    );
  });

  app.delete<{ Params: { id: string } }>('/api/categories/:id', async (req) => {
    const id = Number(req.params.id);
    const current = await one<{ system_key: string | null }>('SELECT system_key FROM categories WHERE id = $1', [id]);
    if (!current) throw new UserError('Category not found', 404);
    if (current.system_key === 'transfer') throw new UserError('The transfer category is needed to hide transfers between your accounts.');
    await query('DELETE FROM categories WHERE id = $1', [id]);
    await query(`UPDATE transactions SET category_source = 'none' WHERE category_id IS NULL AND category_source <> 'none'`);
    return reapplyAll();
  });

  app.get('/api/rules', async () =>
    query(
      `SELECT r.id, r.pattern, r.match_type, r.direction, r.category_id, r.source, r.created_at,
              c.name AS category_name, c.icon AS category_icon, c.color AS category_color
         FROM rules r JOIN categories c ON c.id = r.category_id
        ORDER BY array_position(ARRAY['user', 'ai', 'system'], r.source), r.created_at DESC, r.pattern`,
    ),
  );

  app.post('/api/rules', async (req) => {
    const body = ruleSchema.parse(req.body);
    validateRegex(body);
    const rule = await one(
      `INSERT INTO rules (pattern, match_type, direction, category_id, source) VALUES ($1, $2, $3, $4, 'user') RETURNING *`,
      [body.pattern, body.matchType, body.direction, body.categoryId],
    );
    return { rule, ...(await reapplyAll()) };
  });

  app.patch<{ Params: { id: string } }>('/api/rules/:id', async (req) => {
    const body = ruleSchema.partial().parse(req.body);
    if (body.pattern && body.matchType) validateRegex({ pattern: body.pattern, matchType: body.matchType });
    // Editing a built-in or AI rule turns it into your own rule.
    const rule = await one(
      `UPDATE rules SET pattern = coalesce($2, pattern), match_type = coalesce($3, match_type),
              direction = coalesce($4, direction), category_id = coalesce($5, category_id), source = 'user'
        WHERE id = $1 RETURNING *`,
      [Number(req.params.id), body.pattern ?? null, body.matchType ?? null, body.direction ?? null, body.categoryId ?? null],
    );
    if (!rule) throw new UserError('Rule not found', 404);
    return { rule, ...(await reapplyAll()) };
  });

  app.delete<{ Params: { id: string } }>('/api/rules/:id', async (req) => {
    await query('DELETE FROM rules WHERE id = $1', [Number(req.params.id)]);
    return reapplyAll();
  });

  app.post('/api/rules/reapply', async () => reapplyAll());
}
