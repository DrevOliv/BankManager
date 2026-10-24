import { config } from './config.js';
import { query } from './db.js';

export interface AppSettings {
  monthlyBudget: number | null;
  monthStartDay: number;
  adjustToBankingDay: boolean;
  followIncome: boolean;
  aiEnabled: boolean;
  ollamaUrl: string;
  ollamaModel: string;
}

const DEFAULTS: AppSettings = {
  monthlyBudget: null,
  monthStartDay: 1,
  adjustToBankingDay: true,
  followIncome: true,
  aiEnabled: true,
  ollamaUrl: config.ollamaUrl,
  ollamaModel: config.ollamaModel,
};

export async function getSettings(): Promise<AppSettings> {
  const rows = await query<{ key: string; value: unknown }>('SELECT key, value FROM settings WHERE key = ANY($1)', [Object.keys(DEFAULTS)]);
  const out: Record<string, unknown> = { ...DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out as unknown as AppSettings;
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULTS) || value === undefined) continue;
    await query(
      `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value)],
    );
  }
  return getSettings();
}
