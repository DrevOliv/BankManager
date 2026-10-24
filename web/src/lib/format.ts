const nf0 = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1 234 kr" — whole kronor for overviews. */
export function kr(n: number | null | undefined, opts: { decimals?: boolean; sign?: boolean } = {}): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  const abs = Math.abs(n);
  const body = opts.decimals ? nf2.format(abs) : nf0.format(Math.round(abs));
  const sign = n < 0 ? '−' : opts.sign && n > 0 ? '+' : '';
  return `${sign}${body} kr`;
}

/** Amount in its own currency, e.g. "−12,50 EUR". */
export function money(n: number, currency: string, sign = true): string {
  if (currency === 'SEK') return kr(n, { decimals: true, sign });
  const s = n < 0 ? '−' : sign && n > 0 ? '+' : '';
  return `${s}${nf2.format(Math.abs(n))} ${currency}`;
}

/** Axis ticks: 0 / 500 / 1K / 12K. */
export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace('.0', '')}M`;
  if (abs >= 1000) return `${(n / 1000).toFixed(abs >= 10_000 ? 0 : 1).replace('.0', '')}K`;
  return String(Math.round(n));
}

const parseDay = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`);

export function monthName(month: string, style: 'long' | 'short' = 'long'): string {
  return parseDay(`${month}-01`).toLocaleString('en-GB', { month: style, year: 'numeric' });
}

export function monthShort(month: string): string {
  return parseDay(`${month}-01`).toLocaleString('en-GB', { month: 'short' });
}

export function dayLabel(date: string): string {
  const d = parseDay(date);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export function shortDate(date: string): string {
  return parseDay(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function dateTime(ts: string): string {
  const d = new Date(ts.replace(' ', 'T'));
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

export const BANKS: Record<string, { label: string; short: string }> = {
  handelsbanken: { label: 'Handelsbanken', short: 'HB' },
  revolut: { label: 'Revolut', short: 'R' },
};

/** "25 Oct – 24 Nov" for a period; plain month boundaries are left implicit. */
export function rangeLabel(start: string, end: string): string {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const a = parseDay(start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' });
  const b = parseDay(end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${a} – ${b}`;
}
