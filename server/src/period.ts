import { query } from './db.js';
import { getSettings } from './settings.js';
import { UserError } from './errors.js';
import { addDays, addMonths, today } from './util.js';

/**
 * A "month" in the app can start on any day, e.g. when the salary arrives. A period is named
 * after the month it starts in: with start day 25, "2026-10" runs from about 25 Oct to 24 Nov.
 */
export interface IncomeDay {
  amount: number;
  sources: string;
}

export interface PeriodConfig {
  startDay: number; // 1–28
  adjustToBankingDay: boolean; // start earlier when the day is a weekend/holiday, like Swedish salaries
  followIncome: boolean; // start on the day income actually arrived near the start day
  incomeDays?: Map<string, IncomeDay>; // date → income that day (salary, CSN…, not Swish)
}

export interface Period {
  key: string; // YYYY-MM
  start: string; // inclusive YYYY-MM-DD
  end: string; // exclusive YYYY-MM-DD
  days: number;
  /** Set when the start was moved to the day income arrived. */
  trigger: { date: string; amount: number; sources: string } | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Easter Sunday (anonymous Gregorian algorithm). */
function easter(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

const holidayCache = new Map<number, Set<string>>();

/** Swedish days when banks don't pay out salaries (weekends are handled separately). */
function swedishBankHolidays(year: number): Set<string> {
  let set = holidayCache.get(year);
  if (set) return set;
  const e = easter(year);
  const midsummerEve = [19, 20, 21, 22, 23, 24, 25]
    .map((d) => `${year}-06-${pad(d)}`)
    .find((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 5)!;
  set = new Set([
    `${year}-01-01`, // Nyårsdagen
    `${year}-01-06`, // Trettondedag jul
    addDays(e, -2), // Långfredagen
    addDays(e, 1), // Annandag påsk
    `${year}-05-01`, // Första maj
    addDays(e, 39), // Kristi himmelsfärd
    `${year}-06-06`, // Nationaldagen
    midsummerEve, // Midsommarafton
    `${year}-12-24`, // Julafton
    `${year}-12-25`, // Juldagen
    `${year}-12-26`, // Annandag jul
    `${year}-12-31`, // Nyårsafton
  ]);
  holidayCache.set(year, set);
  return set;
}

export function isBankingDay(date: string): boolean {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !swedishBankHolidays(Number(date.slice(0, 4))).has(date);
}

function previousBankingDay(date: string): string {
  let d = date;
  while (!isBankingDay(d)) d = addDays(d, -1);
  return d;
}

// Income this many days before / after the start day can start the month.
const WINDOW_BEFORE = 10;
const WINDOW_AFTER = 6;

/**
 * The day the month's income arrived: the biggest income day near the nominal start, moved back
 * to an earlier income day (≥ 1 000 kr) at most 3 days before it — e.g. a salary arriving a day
 * or two before student aid. Smaller or earlier deposits (refunds, a stray transfer) are ignored.
 */
function incomeStart(nominal: string, days: Map<string, IncomeDay>): Period['trigger'] {
  const window: [string, IncomeDay][] = [];
  for (let d = addDays(nominal, -WINDOW_BEFORE); d <= addDays(nominal, WINDOW_AFTER); d = addDays(d, 1)) {
    const income = days.get(d);
    if (income && income.amount >= 1000) window.push([d, income]);
  }
  if (!window.length) return null;
  const [peakDate] = window.reduce((best, cur) => (cur[1].amount > best[1].amount ? cur : best));
  const [date, income] = window.find(([d]) => d >= addDays(peakDate, -3))!;
  return { date, amount: income.amount, sources: income.sources };
}

function periodStart(key: string, cfg: PeriodConfig): { start: string; trigger: Period['trigger'] } {
  if (cfg.startDay <= 1) return { start: `${key}-01`, trigger: null };
  const nominal = `${key}-${pad(cfg.startDay)}`;
  if (cfg.followIncome && cfg.incomeDays?.size) {
    const trigger = incomeStart(nominal, cfg.incomeDays);
    if (trigger) return { start: trigger.date, trigger };
  }
  return { start: cfg.adjustToBankingDay ? previousBankingDay(nominal) : nominal, trigger: null };
}

export function periodRange(key: string, cfg: PeriodConfig): Period {
  const { start, trigger } = periodStart(key, cfg);
  const end = periodStart(addMonths(key, 1), cfg).start;
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);
  return { key, start, end, days, trigger };
}

/** The period that contains a given date. */
export function periodOf(date: string, cfg: PeriodConfig): Period {
  const month = date.slice(0, 7);
  for (const k of [addMonths(month, -1), month, addMonths(month, 1)]) {
    const p = periodRange(k, cfg);
    if (date >= p.start && date < p.end) return p;
  }
  return periodRange(month, cfg); // unreachable for valid configs
}

export async function periodConfig(): Promise<PeriodConfig> {
  const s = await getSettings();
  const startDay = Math.min(28, Math.max(1, Math.round(Number(s.monthStartDay) || 1)));
  const cfg: PeriodConfig = { startDay, adjustToBankingDay: s.adjustToBankingDay !== false, followIncome: s.followIncome !== false };
  if (startDay > 1 && cfg.followIncome) {
    const rows = await query<{ date: string; amount: number; sources: string }>(
      `SELECT t.date, sum(t.amount_sek) AS amount, string_agg(DISTINCT t.merchant, ' + ') AS sources
         FROM tx_view t LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.kind = 'income' AND t.amount > 0 AND coalesce(c.system_key, '') <> 'swish_in'
        GROUP BY t.date`,
    );
    cfg.incomeDays = new Map(rows.map((r) => [r.date, { amount: r.amount, sources: r.sources }]));
  }
  return cfg;
}

/** Resolves a requested period key (or the current one when omitted). */
export async function resolvePeriod(month: string | undefined, cfg?: PeriodConfig): Promise<Period> {
  const c = cfg ?? (await periodConfig());
  if (month === undefined || month === '' || month === 'current') return periodOf(today(), c);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new UserError('month must look like 2026-10');
  return periodRange(month, c);
}
