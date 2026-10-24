import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Sparkles, Upload, Wallet } from 'lucide-react';
import { BANKS, kr, monthName, percentChange, rangeLabel, shortDate } from '../lib/format';
import { useAiCategorize, useAiStatus, useOverview, useTransactions } from '../lib/queries';
import type { CategoryAmount, Overview } from '../lib/types';
import { MonthPicker, useMonth } from '../components/MonthPicker';
import { CategoryIcon } from '../components/CategoryIcon';
import { MonthlyChart, PaceChart } from '../components/charts';
import { TransactionRow } from '../components/TransactionRow';
import { AskCard, InsightsCard } from '../components/AiCards';
import { BankBadge, Button, Card, CardHeader, EmptyState, Segmented, Spinner, cx, useToast } from '../components/ui';

export function OverviewPage() {
  const [month, setMonth] = useMonth();
  const { data, isLoading, isFetching } = useOverview(month);
  // When AI is switched off on purpose, its cards are left out instead of nagging.
  const aiOn = useAiStatus().data?.enabled ?? false;

  if (isLoading || !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const noData = data.balances.accounts.length === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-0.5 text-sm text-muted">
            {noData
              ? 'Nothing imported yet'
              : `${rangeLabel(data.period.start, data.period.end)}${data.period.trigger ? ` · started when ${data.period.trigger.sources} arrived` : ''} · ${freshness(data)}`}
          </p>
        </div>
        {!noData && <MonthPicker month={month} onChange={setMonth} />}
      </div>

      {noData ? (
        <Card>
          <EmptyState icon={<Upload size={22} />} title="Upload your first bank statement">
            Export your transactions from Handelsbanken (Excel) or Revolut (CSV/Excel) and drop the files on the Import page.
            <div className="mt-4">
              <Link to="/import">
                <Button variant="primary">
                  <Upload size={15} /> Go to Import
                </Button>
              </Link>
            </div>
          </EmptyState>
        </Card>
      ) : (
        // Refetching keeps the previous render, slightly dimmed, instead of flashing a skeleton.
        <div className={cx('space-y-5 transition-opacity', isFetching && 'opacity-60')}>
          <BalanceHero data={data} />
          <KpiRow data={data} />
          <UncategorizedNudge count={data.uncategorized} month={month} />
          {/* Two independent columns on desktop (no gaps under short cards); on phones the
              columns dissolve (display: contents) and `order` interleaves the cards. */}
          <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
            <div className="contents lg:flex lg:flex-col lg:gap-5">
              <div className="order-1 lg:order-none">
                <CategoryBreakdown data={data} />
              </div>
              <div className="order-4 lg:order-none">
                <MonthlyChart data={data} onSelect={setMonth} />
              </div>
              <div className="order-6 lg:order-none">
                <RecentTransactions month={month} />
              </div>
            </div>
            <div className="contents lg:flex lg:flex-col lg:gap-5">
              <div className="order-2 lg:order-none">
                <PaceChart data={data} />
              </div>
              <div className="order-3 lg:order-none">
                <TopMerchants data={data} />
              </div>
              {aiOn && (
                <div className="order-5 lg:order-none">
                  <InsightsCard month={month} />
                </div>
              )}
              {aiOn && (
                <div className="order-7 lg:order-none">
                  <AskCard month={month} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function freshness(o: Overview): string {
  const latest = o.balances.accounts.map((a) => a.lastTransaction).filter(Boolean).sort().at(-1);
  return latest ? `Data up to ${shortDate(latest!)} · ${o.balances.accounts.length} account${o.balances.accounts.length === 1 ? '' : 's'}` : '';
}

/* ---------- Hero: money available right now ---------- */

function BalanceHero({ data }: { data: Overview }) {
  const accounts = data.balances.accounts;
  const pending = accounts.reduce((s, a) => s + (a.includeInBalance ? a.pending : 0), 0);
  return (
    <Card className="overflow-hidden">
      <div className="grid gap-6 p-5 sm:p-6 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-ink-2">
            <Wallet size={16} /> Money available now
          </p>
          <p className="mt-2 text-5xl font-semibold tracking-tight sm:text-[56px]">{kr(data.balances.total)}</p>
          <p className="mt-2 text-[13px] text-muted">
            Across your accounts{pending < 0 ? `, after ${kr(-pending)} in pending card payments` : ''}.
          </p>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-1 md:min-w-72">
          {accounts.map((a) => (
            <div key={a.id} className={cx('flex items-center justify-between gap-4 rounded-xl bg-surface-2 px-3.5 py-2.5', !a.includeInBalance && 'opacity-60')}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <BankBadge bank={a.bank} />
                  <span className="min-w-0 truncate text-[13px] text-ink-2">{a.name === BANKS[a.bank]?.label ? '' : a.name}</span>
                </div>
                <p className="mt-1 text-[12px] text-muted">{a.asOf ? `Balance from ${shortDate(a.asOf)}` : 'No balance in statement'}</p>
              </div>
              <span className="tabular shrink-0 text-[15px] font-semibold whitespace-nowrap">{a.available === null ? '–' : kr(a.available)}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

/* ---------- KPI tiles ---------- */

function Delta({ current, previous, upIsGood, label }: { current: number; previous: number; upIsGood: boolean; label: string }) {
  const pct = percentChange(current, previous);
  if (pct === null) return <span className="text-[12px] text-muted">No data for {label}</span>;
  const up = pct >= 0;
  const good = up === upIsGood;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-[12px]">
      <span className={cx('inline-flex items-center font-semibold', good ? 'text-good' : 'text-bad')}>
        <Icon size={14} strokeWidth={2.5} />
        {Math.abs(Math.round(pct))}%
      </span>
      <span className="text-muted">vs {label}</span>
    </span>
  );
}

function StatTile({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <Card className="p-4 sm:p-5">
      <p className="text-[13px] font-medium text-ink-2">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</p>
      <div className="mt-1.5 min-h-[18px]">{children}</div>
    </Card>
  );
}

function KpiRow({ data }: { data: Overview }) {
  const t = data.totals;
  const prev = data.isCurrentMonth ? data.previousToDate : data.previousTotals;
  const prevLabel = data.isCurrentMonth ? 'same point last month' : monthName(data.previousMonth, 'short');
  const budget = data.budget;
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
      <StatTile label="Spent" value={kr(t.spent)}>
        {data.hasPreviousMonth ? (
          <Delta current={t.spent} previous={prev.spent} upIsGood={false} label={prevLabel} />
        ) : (
          <span className="text-[12px] text-muted">{t.count} purchases</span>
        )}
      </StatTile>
      <StatTile label="Money in" value={kr(t.income)}>
        {data.hasPreviousMonth ? <Delta current={t.income} previous={prev.income} upIsGood label={prevLabel} /> : <span className="text-[12px] text-muted">Salary, Swish and other income</span>}
      </StatTile>
      <StatTile label="Saved & invested" value={kr(t.saved)}>
        <span className="text-[12px] text-muted">Robo, stocks, savings</span>
      </StatTile>
      {budget ? (
        <StatTile label={budget.left >= 0 ? 'Left to spend' : 'Over budget'} value={kr(Math.abs(budget.left))}>
          <BudgetMeter spent={t.spent} budget={budget.amount} />
          <p className="mt-1.5 text-[12px] text-muted">
            of {kr(budget.amount)}
            {budget.perDay !== null && budget.left > 0 ? ` · ${kr(budget.perDay)}/day for ${budget.daysLeft} days` : ''}
          </p>
        </StatTile>
      ) : (
        <StatTile label="Net this month" value={kr(t.income - t.spent, { sign: true })}>
          <Link to="/settings" className="text-[12px] font-medium text-accent-ink hover:underline">
            Set a monthly budget →
          </Link>
        </StatTile>
      )}
    </div>
  );
}

function BudgetMeter({ spent, budget }: { spent: number; budget: number }) {
  const ratio = budget > 0 ? spent / budget : 0;
  // Fill carries severity; the unfilled track is a lighter step of the same ramp.
  const fill = ratio > 1 ? 'var(--critical)' : ratio > 0.85 ? 'var(--warning)' : 'var(--accent)';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-accent-soft" role="meter" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={spent} aria-label="Budget used">
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, ratio * 100)}%`, background: fill }} />
    </div>
  );
}

function UncategorizedNudge({ count, month }: { count: number; month: string }) {
  const ai = useAiStatus();
  const categorize = useAiCategorize();
  const toast = useToast();
  if (!count) return null;
  const aiReady = ai.data?.enabled && ai.data.reachable && ai.data.modelAvailable;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3">
      <p className="text-sm text-ink">
        <span className="font-semibold">{count}</span> transaction{count === 1 ? '' : 's'} in {monthName(month)} {count === 1 ? "doesn't" : "don't"} have a category yet.
      </p>
      <div className="flex gap-2">
        <Link to={`/transactions?month=${month}&category=none`}>
          <Button size="sm">Review</Button>
        </Link>
        {aiReady && (
          <Button
            size="sm"
            variant="primary"
            loading={categorize.isPending}
            onClick={() =>
              categorize.mutate(undefined, {
                onSuccess: (r) => toast(`AI categorised ${r.categorized} of ${r.merchants} merchants`),
                onError: (e) => toast((e as Error).message, 'error'),
              })
            }
          >
            <Sparkles size={14} /> Categorise with AI
          </Button>
        )}
      </div>
    </div>
  );
}

/* ---------- Where the money went ---------- */

function CategoryBreakdown({ data }: { data: Overview }) {
  const navigate = useNavigate();
  const [view, setView] = useState<'expense' | 'income'>('expense');
  const [showAll, setShowAll] = useState(false);
  const rows = (view === 'expense' ? data.categories : data.income).filter((c) => c.amount !== 0);
  const total = rows.reduce((s, c) => s + Math.max(0, c.amount), 0);
  const max = Math.max(...rows.map((c) => c.amount), 1);
  const visible = showAll ? rows : rows.slice(0, 8);

  const open = (c: CategoryAmount) => navigate(`/transactions?month=${data.month}&category=${c.id ?? 'none'}`);

  return (
    <Card>
      <CardHeader
        title={view === 'expense' ? 'Where your money went' : 'Where your money came from'}
        subtitle={`${rangeLabel(data.period.start, data.period.end)} · ${kr(total)} in ${rows.length} categor${rows.length === 1 ? 'y' : 'ies'}`}
        action={
          <Segmented
            value={view}
            onChange={(v) => (setView(v), setShowAll(false))}
            options={[
              { value: 'expense', label: 'Spending' },
              { value: 'income', label: 'Income' },
            ]}
          />
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={<Wallet size={20} />} title={view === 'expense' ? 'No spending this month' : 'No income this month'} />
      ) : (
        <div className="px-2 pb-3">
          {visible.map((c) => {
            const share = total > 0 ? (Math.max(0, c.amount) / total) * 100 : 0;
            const diff = c.amount - c.previous;
            return (
              <button key={c.id ?? 'none'} onClick={() => open(c)} className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-hover">
                <CategoryIcon icon={c.icon} color={c.color} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[14px] font-medium">{c.name}</span>
                    <span className="tabular shrink-0 text-[14px] font-semibold">{kr(c.amount)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(1.5, (Math.max(0, c.amount) / max) * 100)}%` }} />
                  </div>
                  <div className="mt-1 flex justify-between gap-3 text-[12px] text-muted">
                    <span>
                      {c.count} {c.count === 1 ? 'transaction' : 'transactions'} · {Math.round(share)}%
                    </span>
                    {data.hasPreviousMonth && Math.abs(diff) >= 1 && (
                      <span className="tabular">
                        {diff > 0 ? '+' : '−'}
                        {kr(Math.abs(diff)).replace(' kr', '')} kr vs {monthName(data.previousMonth, 'short').split(' ')[0]}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
          {rows.length > 8 && (
            <button onClick={() => setShowAll((s) => !s)} className="mx-3 mt-1 text-[13px] font-medium text-accent-ink hover:underline">
              {showAll ? 'Show fewer' : `Show all ${rows.length} categories`}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

function TopMerchants({ data }: { data: Overview }) {
  const navigate = useNavigate();
  if (!data.topMerchants.length) return null;
  return (
    <Card>
      <CardHeader title="Top places" subtitle={`Where you spent the most in ${monthName(data.month)}`} />
      <div className="px-2 pb-3">
        {data.topMerchants.map((m, i) => (
          <button
            key={m.merchant}
            onClick={() => navigate(`/transactions?month=${data.month}&merchant=${encodeURIComponent(m.merchant)}`)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-hover"
          >
            <span className="tabular w-4 text-center text-[12px] font-medium text-muted">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium">{m.merchant}</p>
              <p className="text-[12px] text-muted">
                {m.category} · {m.count}×
              </p>
            </div>
            <span className="tabular text-[14px] font-semibold">{kr(m.amount)}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

function RecentTransactions({ month }: { month: string }) {
  const { data } = useTransactions({ month, limit: 6 });
  return (
    <Card>
      <CardHeader
        title="Latest transactions"
        subtitle="Transfers between your own accounts are hidden"
        action={
          <Link to={`/transactions?month=${month}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-ink hover:underline">
            See all <ArrowRight size={14} />
          </Link>
        }
      />
      <div className="divide-y divide-line pb-2">
        {data?.items.map((t) => <TransactionRow key={t.id} t={t} compact />)}
        {data && !data.items.length && <p className="px-5 py-6 text-sm text-muted">No transactions this month.</p>}
      </div>
    </Card>
  );
}
