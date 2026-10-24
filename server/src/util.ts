import { UserError } from './errors.js';

const TZ = process.env.TZ || 'Europe/Stockholm';

/** Today's date (YYYY-MM-DD) in the configured timezone. */
export function today(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function parseMonth(month: string | undefined): string {
  const m = month ?? today().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new UserError('month must look like 2026-10');
  return m;
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export const monthStart = (month: string) => `${month}-01`;
export const monthEnd = (month: string) => `${addMonths(month, 1)}-01`; // exclusive

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
