import { createHash } from 'node:crypto';
import { one, query, tx } from '../db.js';
import { applyRules } from '../categorize.js';
import { overview } from '../stats.js';
import { addDays, addMonths, monthLabel, today } from '../util.js';
import { periodConfig, periodRange } from '../period.js';
import { chat, type ChatMessage } from './ollama.js';

const kr = (n: number) => `${Math.round(n).toLocaleString('sv-SE')} kr`;

// Short descriptions help a small model pick the right built-in category.
const HINTS: Record<string, string> = {
  groceries: 'supermarkets, food shops, kiosks',
  restaurants: 'restaurants, cafés, fast food, food delivery',
  alcohol: 'Systembolaget, bars, pubs, nightclubs',
  transport: 'public transport, taxis, e-scooters, petrol stations, parking',
  housing: 'rent, electricity, home internet',
  shopping: 'clothes, electronics, books, music gear, home goods, online shops',
  subscriptions: 'software, streaming, apps, AI tools, monthly memberships',
  bills: 'insurance companies, phone plan, loans, debt collection agencies, trade unions, Klarna',
  entertainment: 'cinema, games, events, activities, billiards, bowling',
  health: 'pharmacy, gym, healthcare, dentist, hairdresser, beauty',
  travel: 'flights, hotels, trips abroad',
  cash: 'ATM cash withdrawals',
  swish: 'payments to friends or family',
  other: 'spending that fits nowhere else',
  salary: 'wages from an employer',
  swish_in: 'money received from friends',
  other_income: 'refunds, benefits, other money received',
  savings: 'investments, savings accounts, stocks, funds, crypto',
};

const SYSTEM_CATEGORIZE = 'You categorise card payments made by a person in Sweden. Merchant names are often truncated Swedish shop or company names.';

type Cat = { id: number; name: string; kind: string; system_key: string | null };

/**
 * Asks the model three slightly different ways and takes the majority answer. A 3B model is
 * noisy on its own (~70% right on unknown Swedish merchants); the three prompts make different
 * mistakes, so voting is noticeably more accurate. Returns null if Ollama gave no usable answer.
 */
async function classifyMerchant(example: string, context: string, options: Cat[]) {
  const names = options.map((c) => c.name);
  const withHints = options.map((c) => `- ${c.name}${c.system_key && HINTS[c.system_key] ? `: ${HINTS[c.system_key]}` : ''}`).join('\n');
  const plain = options.map((c) => `- ${c.name}`).join('\n');
  const question = `Which category fits the merchant "${example}" (${context})?`;
  const think = 'First say in a few words what kind of business the name suggests, then pick the category. Answer as JSON {"business": "...", "category": "..."}.';
  const prompts = [
    { list: withHints, ask: `${question} Answer as JSON {"category": "..."}.`, business: false },
    { list: withHints, ask: `${question} ${think}`, business: true },
    { list: plain, ask: `${question} ${think}`, business: true },
  ];
  const answers: { category: string; business?: string }[] = [];
  for (const p of prompts) {
    const properties: Record<string, unknown> = p.business
      ? { business: { type: 'string', maxLength: 60 }, category: { type: 'string', enum: names } }
      : { category: { type: 'string', enum: names } };
    try {
      const raw = await chat(
        [
          { role: 'system', content: SYSTEM_CATEGORIZE },
          { role: 'user', content: `Categories:\n${p.list}\n\n${p.ask}` },
        ],
        { format: { type: 'object', properties, required: Object.keys(properties) }, temperature: 0, numCtx: 2048, maxTokens: 80, timeoutMs: 60_000 },
      );
      const parsed = JSON.parse(raw) as { category?: string; business?: string };
      if (parsed.category && names.includes(parsed.category)) answers.push({ category: parsed.category, business: parsed.business });
    } catch (err) {
      if ((err as Error).name === 'UserError') throw err; // Ollama unreachable: stop and report it
    }
  }
  if (!answers.length) return null;
  const counts = new Map<string, number>();
  for (const a of answers) counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
  const [top, votes] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  // Without a majority, trust the last prompt (the most accurate one on its own).
  const category = votes >= 2 ? top : answers.at(-1)!.category;
  const business = [...answers].reverse().find((a) => a.category === category && a.business)?.business ?? answers.find((a) => a.business)?.business ?? '';
  return { category, business: business.slice(0, 60), sure: votes >= 2 };
}

/**
 * Categorises merchants that no rule matched, then stores each answer as an "AI" rule so the
 * same merchant is categorised instantly on future imports.
 */
export async function aiCategorize(maxMerchants = 25) {
  const categories = await query<Cat>(`SELECT id, name, kind, system_key FROM categories WHERE kind <> 'transfer' ORDER BY sort_order`);
  const merchants = await query<{ merchant: string; example: string; n: number; avg: number; all_out: boolean; all_in: boolean }>(
    `SELECT merchant, (array_agg(description ORDER BY date DESC))[1] AS example, count(*)::int AS n,
            avg(amount) AS avg, bool_and(amount < 0) AS all_out, bool_and(amount > 0) AS all_in
       FROM transactions
      WHERE category_id IS NULL AND category_source = 'none' AND transfer_peer_id IS NULL
      GROUP BY merchant ORDER BY count(*) DESC, merchant LIMIT $1`,
    [maxMerchants],
  );
  const remaining = await one<{ n: number }>(
    `SELECT count(DISTINCT merchant)::int AS n FROM transactions WHERE category_id IS NULL AND category_source = 'none' AND transfer_peer_id IS NULL`,
  );

  type Result = { merchant: string; category: string; categoryId: number; business: string; sure: boolean; direction: 'in' | 'out' | 'any' };
  const results: Result[] = [];
  for (const m of merchants) {
    // Only offer categories that fit the direction of the money.
    const options = categories.filter((c) => (m.all_in ? c.kind === 'income' : m.all_out ? c.kind !== 'income' : true));
    const context = `${m.all_in ? 'money received' : 'money spent'}, ${m.n} transaction${m.n === 1 ? '' : 's'}, typically ${kr(Math.abs(m.avg))}`;
    const answer = await classifyMerchant(m.example, context, options);
    const cat = answer && options.find((c) => c.name === answer.category);
    if (!answer || !cat) continue;
    results.push({ merchant: m.merchant, category: cat.name, categoryId: cat.id, business: answer.business, sure: answer.sure, direction: m.all_out ? 'out' : m.all_in ? 'in' : 'any' });
  }

  await tx(async (c) => {
    for (const r of results) {
      await c.query(`DELETE FROM rules WHERE source = 'ai' AND match_type = 'exact' AND lower(pattern) = lower($1)`, [r.merchant]);
      await c.query(
        `INSERT INTO rules (pattern, match_type, direction, category_id, source) VALUES ($1, 'exact', $2, $3, 'ai')`,
        [r.merchant, r.direction, r.categoryId],
      );
    }
    if (results.length) await applyRules(c, 'lower(t.merchant) = ANY($1::text[])', [results.map((r) => r.merchant.toLowerCase())]);
  });

  return {
    merchants: merchants.length,
    categorized: results.length,
    remaining: Math.max(0, (remaining?.n ?? 0) - results.length),
    results: results.map(({ merchant, category, business, sure }) => ({ merchant, category, business, sure })),
  };
}

const BANK_NAMES: Record<string, string> = { handelsbanken: 'Handelsbanken', revolut: 'Revolut' };

const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Merchants paid at least twice, roughly a month apart, with about the same amount. */
export async function recurringPayments(before: string) {
  const rows = await query<{ merchant: string; dates: string[]; amounts: number[]; category: string | null }>(
    `SELECT merchant, array_agg(date ORDER BY date) AS dates, array_agg(-amount_sek ORDER BY date) AS amounts,
            (array_agg(category_name ORDER BY date DESC))[1] AS category
       FROM tx_view
      WHERE kind IN ('expense', 'savings') AND amount < 0 AND date >= $1::date - 120 AND date < $1
      GROUP BY merchant HAVING count(*) >= 2`,
    [before],
  );
  const out: { merchant: string; amount: number; category: string | null; last: string }[] = [];
  for (const r of rows) {
    // Look for two payments 20–40 days apart whose amounts differ by at most 10%.
    let hit: { amount: number; last: string } | null = null;
    for (let i = 0; i < r.dates.length && !hit; i++) {
      for (let j = i + 1; j < r.dates.length; j++) {
        const gap = (Date.parse(r.dates[j]) - Date.parse(r.dates[i])) / 86_400_000;
        const a = r.amounts[i];
        const b = r.amounts[j];
        if (gap >= 20 && gap <= 40 && Math.abs(a - b) <= 0.1 * Math.max(a, b)) {
          hit = { amount: b, last: r.dates.at(-1)! };
          break;
        }
      }
    }
    if (hit) out.push({ merchant: r.merchant, category: r.category, ...hit });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

/** A compact, plain-text summary of a period that a small model can reason over without doing maths. */
export async function monthFacts(month?: string): Promise<{ key: string; facts: string }> {
  const o = await overview(month);
  const from = o.period.start;
  const to = addDays(o.period.end, 1);
  const pct = (a: number, b: number) => (b > 0 ? `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%` : 'new');
  const lines: string[] = [];
  lines.push(
    `Month: ${monthLabel(o.month)}, ${shortDate(o.period.start)} – ${shortDate(o.period.end)}` +
      (o.isCurrentMonth ? ` (day ${o.dayOfPeriod} of ${o.daysInPeriod}, still in progress; today is ${shortDate(today())})` : ' (complete)'),
  );
  lines.push(
    `Spent: ${kr(o.totals.spent)} in ${o.totals.count} purchases. ` +
      (o.isCurrentMonth && o.hasPreviousMonth ? `At the same point last month: ${kr(o.previousToDate.spent)}. ` : '') +
      (o.hasPreviousMonth ? `All of last month (${monthLabel(o.previousMonth)}): ${kr(o.previousTotals.spent)}.` : 'There is no data for last month.'),
  );
  if (o.projectedSpent) lines.push(`Projected spending for the whole month at the current pace: ${kr(o.projectedSpent)}.`);
  lines.push(`Money in: ${kr(o.totals.income)}. Saved/invested: ${kr(o.totals.saved)}.`);
  if (o.budget) {
    lines.push(
      `Monthly budget: ${kr(o.budget.amount)}; ${o.budget.left >= 0 ? `${kr(o.budget.left)} left` : `over budget by ${kr(-o.budget.left)}`}` +
        (o.budget.perDay !== null ? `, ${o.budget.daysLeft} days left (about ${kr(o.budget.perDay)} per day).` : '.'),
    );
  }

  // Category totals with the places behind them.
  const byPlace = await query<{ category: string | null; merchant: string; amount: number; n: number }>(
    `SELECT category_name AS category, merchant, sum(-amount_sek) AS amount, count(*)::int AS n FROM tx_view
      WHERE kind = 'expense' AND date >= $1 AND date < $2 GROUP BY 1, 2 ORDER BY amount DESC`,
    [from, to],
  );
  lines.push('Spending by category, with the places:');
  for (const c of o.categories.slice(0, 10)) {
    const places = byPlace.filter((p) => (p.category ?? 'Uncategorized') === c.name).slice(0, 3);
    const change = o.hasPreviousMonth ? `, last month ${kr(c.previous)} (${pct(c.amount, c.previous)})` : '';
    lines.push(`- ${c.name}: ${kr(c.amount)}${change}. ` + places.map((p) => `${p.merchant} ${kr(p.amount)} (${p.n}×)`).join(', '));
  }
  if (o.income.length) lines.push('Money in by category: ' + o.income.map((c) => `${c.name} ${kr(c.amount)} (${c.count}×)`).join(', ') + '.');

  const big = await query<{ merchant: string; amount: number; date: string }>(
    `SELECT merchant, -amount_sek AS amount, date FROM tx_view
      WHERE kind = 'expense' AND date >= $1 AND date < $2 ORDER BY amount_sek ASC LIMIT 3`,
    [from, to],
  );
  if (big.length) lines.push('Largest single purchases: ' + big.map((b) => `${b.merchant} ${kr(b.amount)} on ${shortDate(b.date)}`).join(', ') + '.');

  const weekdays = await query<{ dow: number; amount: number }>(
    `SELECT extract(isodow FROM date)::int AS dow, sum(-amount_sek) AS amount FROM tx_view
      WHERE kind = 'expense' AND date >= $1 AND date < $2 GROUP BY 1 ORDER BY 2 DESC`,
    [from, to],
  );
  const DAYS = ['', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
  if (weekdays.length >= 3) lines.push(`Spending by weekday: ${weekdays.map((w) => `${DAYS[w.dow]} ${kr(w.amount)}`).join(', ')}.`);

  const recurring = await recurringPayments(to);
  if (recurring.length) {
    lines.push('Recurring monthly payments: ' + recurring.slice(0, 8).map((r) => `${r.merchant} ~${kr(r.amount)} (${r.category ?? 'Uncategorized'})`).join(', ') + '.');
  }

  lines.push(
    'Money available now: ' +
      o.balances.accounts.filter((a) => a.availableSek !== null).map((a) => `${BANK_NAMES[a.bank] ?? a.bank} ${kr(a.availableSek!)}`).join(', ') +
      ` (total ${kr(o.balances.total)}).`,
  );
  return { key: o.month, facts: lines.join('\n') };
}

export async function insightMessages(month?: string) {
  const { key, facts } = await monthFacts(month);
  const hash = createHash('sha256').update(facts).digest('hex').slice(0, 16);
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a friendly, practical personal finance coach inside a budgeting app. Amounts are Swedish kronor (kr). ' +
        'Only use numbers that appear in the data. Never invent numbers or merchants.',
    },
    {
      role: 'user',
      content:
        `${facts}\n\nWrite 3 or 4 short insights about this month as a bulleted list (each line starts with "- "). ` +
        'Each insight is one sentence. Mention concrete categories, places and amounts. ' +
        'If spending is rising somewhere, say so; finish with one realistic tip to spend less. No introduction, no conclusion.',
    },
  ];
  return { messages, hash, key };
}

export async function cachedInsight(month: string, hash: string): Promise<string | null> {
  const row = await one<{ value: { hash: string; text: string } }>('SELECT value FROM settings WHERE key = $1', [`insights:${month}`]);
  return row?.value?.hash === hash ? row.value.text : null;
}

export async function saveInsight(month: string, hash: string, text: string) {
  await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [`insights:${month}`, JSON.stringify({ hash, text, createdAt: new Date().toISOString() })],
  );
}

/** Builds the context for free-form questions: this month, the trend, top merchants and recent rows. */
export async function askMessages(question: string, month: string | undefined, history: ChatMessage[] = []): Promise<ChatMessage[]> {
  const cfg = await periodConfig();
  const { key, facts } = await monthFacts(month);
  const periods = Array.from({ length: 6 }, (_, i) => periodRange(addMonths(key, i - 5), cfg));
  const to = periods.at(-1)!.end;
  const trend = await query<{ key: string; name: string; amount: number }>(
    `SELECT p.key, coalesce(t.category_name, 'Uncategorized') AS name, sum(-t.amount_sek) AS amount
       FROM unnest($1::text[], $2::date[], $3::date[]) AS p(key, s, e)
       JOIN tx_view t ON t.date >= p.s AND t.date < p.e AND t.kind = 'expense'
      GROUP BY 1, 2 ORDER BY 1, 3 DESC`,
    [periods.map((p) => p.key), periods.map((p) => p.start), periods.map((p) => p.end)],
  );
  const trendLines = periods
    .filter((p) => trend.some((t) => t.key === p.key))
    .map((p) => `${monthLabel(p.key)}: ` + trend.filter((t) => t.key === p.key).map((t) => `${t.name} ${kr(t.amount)}`).join(', '));
  const merchants = await query<{ merchant: string; amount: number; n: number }>(
    `SELECT merchant, sum(-amount_sek) AS amount, count(*)::int AS n FROM tx_view
      WHERE kind = 'expense' AND date >= $1 AND date < $2 GROUP BY merchant ORDER BY amount DESC LIMIT 20`,
    [periods[3].start, to],
  );
  const recent = await query<{ date: string; merchant: string; amount: number; category: string | null; bank: string; channel: string }>(
    `SELECT date, merchant, amount_sek AS amount, category_name AS category, bank, channel FROM tx_view
      WHERE kind <> 'transfer' AND date < $1 ORDER BY date DESC, id DESC LIMIT 30`,
    [to],
  );
  const context = [
    `== Selected month ==\n${facts}`,
    trendLines.length ? `== Spending by category per month ==\n${trendLines.join('\n')}` : '',
    `== Top places, last 3 months ==\n${merchants.map((m) => `${m.merchant}: ${kr(m.amount)} (${m.n}×)`).join('\n')}`,
    `== Most recent transactions (newest first) ==\n${recent
      .map((r) => `${shortDate(r.date)} ${r.merchant} ${kr(r.amount)} [${r.category ?? 'Uncategorized'}, ${BANK_NAMES[r.bank] ?? r.bank}${r.channel === 'swish' ? ', Swish' : ''}]`)
      .join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  // Keep the last few turns so follow-up questions ("and the month before?") work.
  const turns = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-6)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

  return [
    {
      role: 'system',
      content:
        "You are a helpful assistant inside the user's self-hosted budgeting app. Answer using ONLY the data below. " +
        'Amounts are Swedish kronor (kr); negative amounts are money spent. Transfers between the user\'s own accounts are already excluded. ' +
        'If the data does not contain the answer, say so briefly. Keep answers short: at most 6 sentences or a short bulleted list. ' +
        'Copy numbers exactly as written; do not add up numbers yourself unless asked. ' +
        '"Food" means Groceries plus Restaurants & takeaway; "Swish" covers both Swish & friends (sent) and Swish received.\n\n' +
        context,
    },
    ...turns,
    { role: 'user', content: question },
  ];
}
