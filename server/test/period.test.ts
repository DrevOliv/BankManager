import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBankingDay, periodOf, periodRange, type IncomeDay, type PeriodConfig } from '../src/period.js';

const payday25: PeriodConfig = { startDay: 25, adjustToBankingDay: true, followIncome: false };

test('calendar months when the month starts on the 1st', () => {
  const p = periodRange('2026-10', { startDay: 1, adjustToBankingDay: true, followIncome: true });
  assert.deepEqual([p.start, p.end, p.days], ['2026-10-01', '2026-11-01', 31]);
});

test('a month is named after the month it starts in', () => {
  // 25 Nov 2026 is a Wednesday.
  assert.equal(periodRange('2026-11', payday25).start, '2026-11-25');
  assert.equal(periodOf('2026-11-30', payday25).key, '2026-11');
  assert.equal(periodOf('2026-11-24', payday25).key, '2026-10');
});

test('starts on the banking day before a weekend or holiday payday', () => {
  // 25 Oct 2026 is a Sunday → Friday 23 Oct.
  assert.equal(periodRange('2026-10', payday25).start, '2026-10-23');
  assert.equal(periodOf('2026-10-22', payday25).key, '2026-09');
  // 24–26 Dec are holidays → 23 Dec.
  assert.equal(periodRange('2026-12', payday25).start, '2026-12-23');
  assert.equal(periodRange('2026-10', { ...payday25, adjustToBankingDay: false }).start, '2026-10-25');
});

test('starts on the day income actually arrives', () => {
  const incomeDays = new Map<string, IncomeDay>([
    ['2026-09-24', { amount: 16933, sources: 'Bostadsbidrag + Lön + Studiestöd' }],
    ['2026-10-12', { amount: 400, sources: 'Refund' }], // small, ignored
    ['2026-10-22', { amount: 15633, sources: 'Lön + Studiestöd' }],
  ]);
  const cfg: PeriodConfig = { startDay: 25, adjustToBankingDay: true, followIncome: true, incomeDays };
  const sep = periodRange('2026-09', cfg);
  const oct = periodRange('2026-10', cfg);
  assert.deepEqual([sep.start, sep.end], ['2026-09-24', '2026-10-22']);
  assert.equal(sep.trigger?.sources, 'Bostadsbidrag + Lön + Studiestöd');
  assert.equal(oct.start, '2026-10-22');
  // November's income hasn't arrived, so the fallback (25 Nov, a Wednesday) ends October.
  assert.equal(oct.end, '2026-11-25');
  assert.equal(periodRange('2026-11', cfg).trigger, null);
  assert.equal(periodOf('2026-10-24', cfg).key, '2026-10');
  assert.equal(periodOf('2026-10-21', cfg).key, '2026-09');
});

test('the first big income in the window wins over a smaller one before it', () => {
  const incomeDays = new Map<string, IncomeDay>([
    ['2026-10-16', { amount: 1200, sources: 'Small transfer' }], // ≥1000 kr but < 30% of the salary day
    ['2026-10-23', { amount: 2041, sources: 'Lön' }],
    ['2026-10-26', { amount: 13592, sources: 'Studiestöd' }],
  ]);
  const cfg: PeriodConfig = { startDay: 25, adjustToBankingDay: true, followIncome: true, incomeDays };
  assert.equal(periodRange('2026-10', cfg).start, '2026-10-23');
});

test('periods are contiguous', () => {
  const keys = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
  for (let i = 0; i < keys.length - 1; i++) assert.equal(periodRange(keys[i], payday25).end, periodRange(keys[i + 1], payday25).start);
});

test('knows Swedish bank holidays', () => {
  assert.equal(isBankingDay('2026-04-03'), false); // Good Friday
  assert.equal(isBankingDay('2026-06-19'), false); // Midsummer Eve
  assert.equal(isBankingDay('2026-10-23'), true);
});
