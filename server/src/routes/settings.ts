import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { getSettings, updateSettings } from '../settings.js';
import { overview } from '../stats.js';
import { addDays, addMonths, today } from '../util.js';
import { periodConfig, periodOf, periodRange } from '../period.js';

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', async () => ({
    ...(await getSettings()),
    fxRates: await query('SELECT currency, rate FROM fx_rates ORDER BY currency'),
  }));

  app.put('/api/settings', async (req) => {
    const body = z
      .object({
        monthlyBudget: z.number().min(0).max(10_000_000).nullable().optional(),
        monthStartDay: z.number().int().min(1).max(28).optional(),
        adjustToBankingDay: z.boolean().optional(),
        followIncome: z.boolean().optional(),
        aiEnabled: z.boolean().optional(),
        ollamaUrl: z.string().trim().url().max(300).optional(),
        ollamaModel: z.string().trim().min(1).max(100).optional(),
      })
      .parse(req.body);
    return updateSettings(body);
  });

  app.put('/api/settings/fx', async (req) => {
    const body = z.object({ currency: z.string().trim().regex(/^[A-Z]{3}$/), rate: z.number().positive().max(100_000) }).parse(req.body);
    await query(
      `INSERT INTO fx_rates (currency, rate) VALUES ($1, $2) ON CONFLICT (currency) DO UPDATE SET rate = EXCLUDED.rate`,
      [body.currency, body.currency === 'SEK' ? 1 : body.rate],
    );
    return query('SELECT currency, rate FROM fx_rates ORDER BY currency');
  });

  app.get('/api/stats/overview', async (req) => overview((req.query as { month?: string }).month));

  // Period boundaries for the UI (labels, date ranges, which month is "now").
  app.get('/api/periods', async () => {
    const cfg = await periodConfig();
    const current = periodOf(today(), cfg);
    const periods = Array.from({ length: 62 }, (_, i) => {
      const p = periodRange(addMonths(current.key, i - 60), cfg);
      return { key: p.key, start: p.start, end: addDays(p.end, -1), trigger: p.trigger };
    });
    return { current: current.key, startDay: cfg.startDay, adjustToBankingDay: cfg.adjustToBankingDay, followIncome: cfg.followIncome, periods };
  });
}
