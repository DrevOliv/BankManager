import { one, query } from './db.js';
import { getSettings } from './settings.js';
import { addDays, addMonths, round2, today } from './util.js';
import { periodConfig, periodOf, periodRange, resolvePeriod, type Period } from './period.js';

export interface CategoryAmount {
  id: number | null;
  name: string;
  icon: string;
  color: string;
  amount: number;
  count: number;
  previous: number;
}

async function totals(from: string, to: string) {
  const r = await one<{ spent: number; income: number; saved: number; count: number }>(
    `SELECT coalesce(sum(-amount_sek) FILTER (WHERE kind = 'expense'), 0) AS spent,
            coalesce(sum(amount_sek)  FILTER (WHERE kind = 'income'), 0)  AS income,
            coalesce(sum(-amount_sek) FILTER (WHERE kind = 'savings'), 0) AS saved,
            count(*) FILTER (WHERE kind = 'expense')::int                 AS count
       FROM tx_view WHERE date >= $1 AND date < $2`,
    [from, to],
  );
  return { spent: round2(r!.spent), income: round2(r!.income), saved: round2(r!.saved), count: r!.count };
}

async function byCategory(kind: 'expense' | 'income', from: string, to: string, prevFrom: string, prevTo: string): Promise<CategoryAmount[]> {
  const sign = kind === 'expense' ? -1 : 1;
  const rows = await query<{ id: number | null; name: string | null; icon: string | null; color: string | null; amount: number; count: number; previous: number }>(
    `SELECT category_id AS id, category_name AS name, category_icon AS icon, category_color AS color,
            coalesce(sum($1 * amount_sek) FILTER (WHERE date >= $3 AND date < $4), 0) AS amount,
            count(*) FILTER (WHERE date >= $3 AND date < $4)::int AS count,
            coalesce(sum($1 * amount_sek) FILTER (WHERE date >= $5 AND date < $6), 0) AS previous
       FROM tx_view
      WHERE kind = $2 AND ((date >= $3 AND date < $4) OR (date >= $5 AND date < $6))
      GROUP BY 1, 2, 3, 4`,
    [sign, kind, from, to, prevFrom, prevTo],
  );
  return rows
    .filter((r) => r.count > 0)
    .map((r) => ({
      id: r.id,
      name: r.name ?? 'Uncategorized',
      icon: r.icon ?? 'circle-help',
      color: r.color ?? '#898781',
      amount: round2(r.amount),
      count: r.count,
      previous: round2(r.previous),
    }))
    .sort((a, b) => b.amount - a.amount);
}

export async function balances() {
  const rows = await query<{
    id: number; bank: string; name: string; currency: string; include_in_balance: boolean;
    balance: number | null; as_of: string | null; pending: number; rate: number | null; last_date: string | null;
  }>(
    `SELECT a.id, a.bank, a.name, a.currency, a.include_in_balance, s.balance, s.as_of,
            coalesce((SELECT sum(amount) FROM transactions t WHERE t.account_id = a.id AND t.status = 'pending'), 0) AS pending,
            (SELECT max(date) FROM transactions t WHERE t.account_id = a.id) AS last_date,
            fx.rate
       FROM accounts a
       LEFT JOIN LATERAL (
         SELECT balance, as_of FROM balance_snapshots WHERE account_id = a.id ORDER BY as_of DESC LIMIT 1
       ) s ON true
       LEFT JOIN fx_rates fx ON fx.currency = a.currency
      ORDER BY a.bank, a.id`,
  );
  const accounts = rows.map((r) => {
    // Bank balances exclude pending card payments; subtract them to get what's actually available.
    const available = r.balance === null ? null : round2(r.balance + r.pending);
    return {
      id: r.id,
      bank: r.bank,
      name: r.name,
      currency: r.currency,
      includeInBalance: r.include_in_balance,
      balance: r.balance,
      pending: round2(r.pending),
      available,
      availableSek: available === null ? null : round2(available * (r.rate ?? 1)),
      asOf: r.as_of,
      lastTransaction: r.last_date,
    };
  });
  const total = round2(accounts.filter((a) => a.includeInBalance).reduce((s, a) => s + (a.availableSek ?? 0), 0));
  return { accounts, total };
}

/** Income / spending / savings per period, for a list of periods. */
export async function periodTotals(periods: Period[]) {
  const rows = await query<{ key: string; spent: number; income: number; saved: number }>(
    `SELECT p.key,
            coalesce(sum(-t.amount_sek) FILTER (WHERE t.kind = 'expense'), 0) AS spent,
            coalesce(sum(t.amount_sek)  FILTER (WHERE t.kind = 'income'), 0)  AS income,
            coalesce(sum(-t.amount_sek) FILTER (WHERE t.kind = 'savings'), 0) AS saved
       FROM unnest($1::text[], $2::date[], $3::date[]) AS p(key, s, e)
       LEFT JOIN tx_view t ON t.date >= p.s AND t.date < p.e
      GROUP BY p.key`,
    [periods.map((p) => p.key), periods.map((p) => p.start), periods.map((p) => p.end)],
  );
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return periods.map((p) => {
    const r = byKey.get(p.key);
    return { month: p.key, start: p.start, end: addDays(p.end, -1), spent: round2(r?.spent ?? 0), income: round2(r?.income ?? 0), saved: round2(r?.saved ?? 0) };
  });
}

/** Everything the overview page shows for one period ("month", which may start on payday). */
export async function overview(month?: string) {
  const cfg = await periodConfig();
  const period = await resolvePeriod(month, cfg);
  const prevPeriod = periodRange(addMonths(period.key, -1), cfg);
  const current = periodOf(today(), cfg);
  const { start: from, end: to, days } = period;
  const { start: prevFrom, end: prevTo, days: prevDays } = prevPeriod;

  const now = today();
  const isCurrent = now >= from && now < to;
  const dayOfPeriod = isCurrent ? Math.round((Date.parse(now) - Date.parse(from)) / 86_400_000) + 1 : days;
  // For a period in progress, compare against the same number of days of the previous one.
  const prevSameTo = isCurrent ? addDays(prevFrom, Math.min(dayOfPeriod, prevDays)) : prevTo;

  const [totalsNow, previous, previousToDate, categories, income, settings, bal] = await Promise.all([
    totals(from, to),
    totals(prevFrom, prevTo),
    totals(prevFrom, prevSameTo),
    byCategory('expense', from, to, prevFrom, prevTo),
    byCategory('income', from, to, prevFrom, prevTo),
    getSettings(),
    balances(),
  ]);

  // Cumulative spending per day of the period, this one vs the previous one.
  const daily = await query<{ date: string; spent: number }>(
    `SELECT date, sum(-amount_sek) AS spent FROM tx_view
      WHERE kind = 'expense' AND date >= $1 AND date < $2 GROUP BY date`,
    [prevFrom, to],
  );
  const dailyMap = new Map(daily.map((d) => [d.date, d.spent]));
  const pace: { day: number; date: string; current: number | null; previous: number | null }[] = [];
  let cur = 0;
  let prev = 0;
  for (let d = 1; d <= Math.max(days, prevDays); d++) {
    const date = addDays(from, d - 1);
    cur += dailyMap.get(date) ?? 0;
    prev += dailyMap.get(addDays(prevFrom, d - 1)) ?? 0;
    pace.push({
      day: d,
      date,
      current: d <= days && d <= dayOfPeriod ? round2(cur) : null,
      previous: d <= prevDays ? round2(prev) : null,
    });
  }

  // Comparisons with the previous period are only fair if data reaches back that far.
  const since = await one<{ d: string | null }>('SELECT min(date) AS d FROM transactions');

  // Last 12 periods of income / spending / savings, trimmed to when data starts. A period that
  // began before the first imported transaction, or hasn't ended yet, is flagged so the chart can say so.
  const totalsByPeriod = await periodTotals(Array.from({ length: 12 }, (_, i) => periodRange(addMonths(period.key, i - 11), cfg)));
  let monthly = totalsByPeriod.map((m) => ({
    ...m,
    partial: !!since?.d && since.d > addDays(m.start, 1),
    inProgress: now >= m.start && now <= m.end,
  }));
  const firstWithData = monthly.findIndex((r) => r.spent || r.income || r.saved);
  monthly = firstWithData < 0 ? monthly.slice(-1) : monthly.slice(Math.min(firstWithData, 11));

  const merchants = await query<{ merchant: string; amount: number; count: number; icon: string | null; category: string | null }>(
    `SELECT merchant, sum(-amount_sek) AS amount, count(*)::int AS count,
            (array_agg(category_icon ORDER BY date DESC))[1] AS icon,
            (array_agg(category_name ORDER BY date DESC))[1] AS category
       FROM tx_view WHERE kind = 'expense' AND date >= $1 AND date < $2
      GROUP BY merchant HAVING sum(-amount_sek) > 0 ORDER BY amount DESC LIMIT 8`,
    [from, to],
  );

  const unc = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM transactions WHERE category_id IS NULL AND date >= $1 AND date < $2`,
    [from, to],
  );

  const daysLeft = isCurrent ? days - dayOfPeriod + 1 : 0;
  const budget = settings.monthlyBudget
    ? {
        amount: settings.monthlyBudget,
        left: round2(settings.monthlyBudget - totalsNow.spent),
        daysLeft,
        perDay: isCurrent ? round2(Math.max(0, settings.monthlyBudget - totalsNow.spent) / daysLeft) : null,
      }
    : null;

  return {
    month: period.key,
    previousMonth: prevPeriod.key,
    currentMonth: current.key,
    period: { start: from, end: addDays(to, -1), trigger: period.trigger },
    previousPeriod: { start: prevFrom, end: addDays(prevTo, -1) },
    monthStartDay: cfg.startDay,
    isCurrentMonth: isCurrent,
    dayOfPeriod,
    daysInPeriod: days,
    balances: bal,
    totals: totalsNow,
    previousTotals: previous,
    previousToDate,
    projectedSpent: isCurrent && dayOfPeriod > 3 ? round2((totalsNow.spent / dayOfPeriod) * days) : null,
    budget,
    categories,
    income,
    pace,
    monthly,
    topMerchants: merchants.map((m) => ({ ...m, amount: round2(m.amount), icon: m.icon ?? 'circle-help', category: m.category ?? 'Uncategorized' })),
    uncategorized: unc?.n ?? 0,
    dataSince: since?.d ?? null,
    hasPreviousMonth: !!since?.d && since.d <= addDays(prevFrom, 2),
  };
}
