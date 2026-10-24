import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Search, Sparkles, X, ListX } from 'lucide-react';
import { qs } from '../lib/api';
import { dayLabel, kr } from '../lib/format';
import { useAccounts, useAiCategorize, useAiStatus, useCategories, useTransactions, type TxFilters } from '../lib/queries';
import type { Transaction } from '../lib/types';
import { MonthPicker, usePeriodInfo } from '../components/MonthPicker';
import { TransactionRow } from '../components/TransactionRow';
import { Button, Card, EmptyState, Segmented, Select, Spinner, cx, useToast } from '../components/ui';

type KindFilter = 'all' | 'expense' | 'income' | 'savings' | 'transfer';
const PAGE = 200;

export function TransactionsPage() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const { current } = usePeriodInfo();
  const month = params.get('month') ?? current;
  const allTime = month === 'all';
  const kind = (params.get('kind') ?? 'all') as KindFilter;
  const category = params.get('category') ?? '';
  const account = params.get('account') ?? '';
  const merchant = params.get('merchant') ?? '';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [limit, setLimit] = useState(PAGE);

  const set = (key: string, value: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (value === null || value === '') n.delete(key);
        else n.set(key, value);
        return n;
      },
      { replace: true },
    );

  // Debounce the search box into the URL.
  useEffect(() => {
    const t = setTimeout(() => set('q', search.trim() || null), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => setLimit(PAGE), [month, kind, category, account, merchant, params.get('q')]);

  const filters: TxFilters = {
    month: allTime ? undefined : month,
    q: params.get('q') ?? undefined,
    category: category || undefined,
    account: account || undefined,
    kind: kind === 'all' ? undefined : kind,
    merchant: merchant || undefined,
    limit,
  };
  const { data, isLoading, isFetching } = useTransactions(filters);
  const { data: categories = [] } = useCategories();
  const { data: accountData } = useAccounts();
  const ai = useAiStatus();
  const categorize = useAiCategorize();
  const aiReady = ai.data?.enabled && ai.data.reachable && ai.data.modelAvailable;

  const groups = useMemo(() => {
    const out: { date: string; items: Transaction[]; spent: number }[] = [];
    for (const t of data?.items ?? []) {
      let g = out.at(-1);
      if (!g || g.date !== t.date) out.push((g = { date: t.date, items: [], spent: 0 }));
      g.items.push(t);
      if (t.kind === 'expense') g.spent -= t.amount_sek;
    }
    return out;
  }, [data]);

  const exportHref = `/api/transactions/export.csv${qs({ ...filters, limit: undefined })}`;
  const uncategorizedView = category === 'none';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
          <p className="mt-0.5 text-sm text-muted">
            {data ? (
              <>
                {data.total} transaction{data.total === 1 ? '' : 's'}
                {data.spent > 0 && <> · {kr(data.spent)} spent</>}
                {data.income > 0 && <> · {kr(data.income)} in</>}
              </>
            ) : (
              ' '
            )}
          </p>
        </div>
        <a href={exportHref} download>
          <Button size="sm">
            <Download size={14} /> Export CSV
          </Button>
        </a>
      </div>

      {/* One filter row above everything it scopes. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search merchant, text, note…"
            className="h-10 w-full rounded-xl border border-line-strong bg-surface pr-3 pl-9 text-sm outline-none placeholder:text-muted focus:border-accent focus:ring-3 focus:ring-accent-wash"
          />
        </div>
        {allTime ? (
          <Button onClick={() => set('month', null)}>All time ✕</Button>
        ) : (
          <>
            <MonthPicker month={month} onChange={(m) => set('month', m === current ? null : m)} />
            <Button variant="ghost" onClick={() => set('month', 'all')}>
              All time
            </Button>
          </>
        )}
        <Select value={category} onChange={(e) => set('category', e.target.value || null)} aria-label="Category" className="min-w-40 flex-1 sm:flex-none">
          <option value="">All categories</option>
          <option value="none">Uncategorised</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        {(accountData?.accounts.length ?? 0) > 1 && (
          <Select value={account} onChange={(e) => set('account', e.target.value || null)} aria-label="Account" className="min-w-40 flex-1 sm:flex-none">
            <option value="">All accounts</option>
            {accountData!.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="max-w-full overflow-x-auto">
          <Segmented<KindFilter>
            value={kind}
            onChange={(v) => set('kind', v === 'all' ? null : v)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'expense', label: 'Spending' },
              { value: 'income', label: 'Income' },
              { value: 'savings', label: 'Savings' },
              { value: 'transfer', label: 'Transfers' },
            ]}
          />
        </div>
        {merchant && (
          <button onClick={() => set('merchant', null)} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent-wash px-3 text-[13px] font-medium text-accent-ink">
            {merchant} <X size={13} />
          </button>
        )}
      </div>

      {kind === 'transfer' && (
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-[13px] text-ink-2">
          These are movements between your own accounts (for example Handelsbanken → Revolut top-ups). They are left out of spending and income everywhere else.
        </p>
      )}

      {uncategorizedView && (data?.total ?? 0) > 0 && aiReady && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-accent-wash px-4 py-3">
          <p className="text-sm">Let your local AI suggest categories. Its choices are saved as rules you can change later.</p>
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
        </div>
      )}

      <Card className={cx('transition-opacity [&>section:first-child>div:first-child]:rounded-t-2xl [&>section:last-child]:pb-1', isFetching && !isLoading && 'opacity-60')}>
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        ) : !groups.length ? (
          <EmptyState icon={<ListX size={22} />} title="No transactions found">
            Try another month, clear the filters, or import more statements.
          </EmptyState>
        ) : (
          groups.map((g) => (
            <section key={g.date}>
              <div className="sticky top-14 z-10 flex items-center justify-between border-b border-line bg-surface-2/95 px-4 py-2 backdrop-blur sm:px-5 md:top-0">
                <h3 className="text-[13px] font-semibold text-ink-2">{dayLabel(g.date)}</h3>
                {g.spent > 0 && <span className="tabular text-[12px] text-muted">{kr(g.spent)} spent</span>}
              </div>
              <div className="divide-y divide-line">
                {g.items.map((t) => (
                  <TransactionRow key={t.id} t={t} />
                ))}
              </div>
            </section>
          ))
        )}
      </Card>

      {data && data.items.length < data.total && (
        <div className="flex justify-center">
          <Button onClick={() => setLimit((l) => l + PAGE)} loading={isFetching}>
            Show more ({data.total - data.items.length} left)
          </Button>
        </div>
      )}
    </div>
  );
}
