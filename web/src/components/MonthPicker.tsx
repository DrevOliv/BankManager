import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonths, currentMonth, monthName, rangeLabel } from '../lib/format';
import { usePeriods } from '../lib/queries';

/** The current "month" (period) and a lookup for any period's date range. */
export function usePeriodInfo() {
  const { data } = usePeriods();
  const current = data?.current ?? currentMonth();
  const range = (key: string) => data?.periods.find((p) => p.key === key) ?? null;
  return { current, startDay: data?.startDay ?? 1, range };
}

/** The selected month lives in the URL (?month=2026-10) so it survives navigation and reloads. */
export function useMonth(): [string, (m: string) => void] {
  const [params, setParams] = useSearchParams();
  const { current } = usePeriodInfo();
  const raw = params.get('month');
  const month = raw && /^\d{4}-\d{2}$/.test(raw) ? raw : current;
  const set = (m: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (m === current) next.delete('month');
        else next.set('month', m);
        return next;
      },
      { replace: true },
    );
  return [month, set];
}

export function MonthPicker({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const { current, startDay, range } = usePeriodInfo();
  const r = range(month);
  const showRange = startDay !== 1 && r;
  const atCurrent = month >= current;
  return (
    <div className={`inline-flex items-center rounded-xl border border-line-strong bg-surface ${showRange ? 'h-12' : 'h-10'}`}>
      <button onClick={() => onChange(addMonths(month, -1))} className="flex h-full w-9 items-center justify-center rounded-l-xl text-ink-2 hover:bg-hover" aria-label="Previous month">
        <ChevronLeft size={17} />
      </button>
      <span className="flex min-w-36 flex-col items-center px-1 text-center leading-tight">
        <span className="text-sm font-medium">{monthName(month)}</span>
        {showRange && <span className="tabular text-[11px] text-muted">{rangeLabel(r.start, r.end)}</span>}
      </span>
      <button
        onClick={() => onChange(addMonths(month, 1))}
        disabled={atCurrent}
        className="flex h-full w-9 items-center justify-center rounded-r-xl text-ink-2 hover:bg-hover disabled:opacity-30 disabled:hover:bg-transparent"
        aria-label="Next month"
      >
        <ChevronRight size={17} />
      </button>
    </div>
  );
}
