import { useMemo, useState } from 'react';
import { Check, RotateCcw, Search } from 'lucide-react';
import { useCategories } from '../lib/queries';
import type { Kind } from '../lib/types';
import { CategoryIcon } from './CategoryIcon';
import { Popover, cx } from './ui';

const KIND_LABEL: Record<Kind, string> = { expense: 'Spending', income: 'Income', savings: 'Savings', transfer: 'Transfers' };

export function CategoryPicker({
  anchor,
  open,
  onClose,
  selectedId,
  merchant,
  isAmountPositive,
  onPick,
  onReset,
}: {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  selectedId: number | null;
  merchant: string;
  isAmountPositive: boolean;
  onPick: (categoryId: number, applyToMerchant: boolean) => void;
  onReset?: () => void;
}) {
  const { data: categories = [] } = useCategories();
  const [q, setQ] = useState('');
  const [remember, setRemember] = useState(true);

  const groups = useMemo(() => {
    const filtered = categories.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
    // Show the most likely kind first: income for money in, spending for money out.
    const order: Kind[] = isAmountPositive ? ['income', 'expense', 'savings', 'transfer'] : ['expense', 'savings', 'income', 'transfer'];
    return order.map((k) => ({ kind: k, items: filtered.filter((c) => c.kind === k) })).filter((g) => g.items.length);
  }, [categories, q, isAmountPositive]);

  return (
    <Popover anchor={anchor} open={open} onClose={onClose} width={300}>
      <div className="border-b border-line p-2">
        <div className="relative">
          <Search size={15} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find category…"
            className="h-9 w-full rounded-lg bg-surface-2 pr-2 pl-8 text-sm outline-none placeholder:text-muted"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
        {groups.map((g) => (
          <div key={g.kind} className="mb-1">
            <p className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{KIND_LABEL[g.kind]}</p>
            {g.items.map((c) => (
              <button
                key={c.id}
                onClick={() => onPick(c.id, remember)}
                className={cx('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-hover', c.id === selectedId && 'bg-accent-wash')}
              >
                <CategoryIcon icon={c.icon} color={c.color} size={26} />
                <span className="flex-1 truncate">{c.name}</span>
                {c.id === selectedId && <Check size={16} strokeWidth={2.5} className="text-accent" />}
              </button>
            ))}
          </div>
        ))}
        {!groups.length && <p className="px-3 py-6 text-center text-sm text-muted">No category matches “{q}”.</p>}
      </div>
      <div className="space-y-1 border-t border-line p-2.5">
        <label className="flex cursor-pointer items-start gap-2 text-[13px] text-ink-2">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
          <span>
            Always use this for <span className="font-medium text-ink">{merchant}</span>
          </span>
        </label>
        {onReset && (
          <button onClick={onReset} className="flex items-center gap-1.5 text-[12px] text-muted hover:text-ink">
            <RotateCcw size={12} /> Back to automatic
          </button>
        )}
      </div>
    </Popover>
  );
}
