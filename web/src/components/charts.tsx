import { useState, type ReactNode } from 'react';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartLine, Table2 } from 'lucide-react';
import { compact, kr, monthName, monthShort, rangeLabel, shortDate } from '../lib/format';
import { useChartColors } from '../lib/theme';
import type { Overview } from '../lib/types';
import { Card, CardHeader, cx } from './ui';

/** Card with a chart/table switch: every chart has a table twin so no value is hover-only. */
export function ChartCard({ title, subtitle, legend, chart, table, className }: { title: string; subtitle?: ReactNode; legend?: ReactNode; chart: ReactNode; table: ReactNode; className?: string }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <Card className={className}>
      <CardHeader
        title={title}
        subtitle={subtitle}
        action={
          <div className="flex rounded-lg bg-surface-2 p-0.5">
            {(['chart', 'table'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                title={v === 'chart' ? 'Chart' : 'Table'}
                className={cx('flex h-7 w-8 items-center justify-center rounded-md', view === v ? 'bg-surface text-ink shadow-card ring-1 ring-line' : 'text-muted hover:text-ink')}
              >
                {v === 'chart' ? <ChartLine size={14} /> : <Table2 size={14} />}
              </button>
            ))}
          </div>
        }
      />
      {view === 'chart' ? (
        <div className="px-3 pb-4">
          {legend && <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 px-2">{legend}</div>}
          {chart}
        </div>
      ) : (
        <div className="max-h-72 overflow-auto px-5 pb-4">{table}</div>
      )}
    </Card>
  );
}

export function LegendItem({ color, label, shape = 'line' }: { color: string; label: string; shape?: 'line' | 'rect' }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2">
      {shape === 'line' ? (
        <span className="h-[2px] w-3.5 rounded-full" style={{ background: color }} />
      ) : (
        <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
      )}
      {label}
    </span>
  );
}

function TooltipBox({ title, rows }: { title: string; rows: { color: string; label: string; value: string }[] }) {
  return (
    <div className="min-w-40 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-pop">
      <p className="mb-1.5 text-[12px] text-muted">{title}</p>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 py-0.5">
          <span className="h-[2px] w-3 rounded-full" style={{ background: r.color }} />
          <span className="tabular text-[13px] font-semibold text-ink">{r.value}</span>
          <span className="text-[12px] text-ink-2">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

const th = 'py-2 text-left text-[12px] font-medium text-muted';
const td = 'tabular py-1.5 text-[13px] text-ink';

/* ---------- Spending pace: cumulative this month vs last month ---------- */

export function PaceChart({ data }: { data: Overview }) {
  const c = useChartColors();
  const lastIdx = data.pace.reduce((acc, p, i) => (p.current !== null ? i : acc), -1);
  const last = lastIdx >= 0 ? data.pace[lastIdx] : null;
  const ticks = [1, 8, 15, 22, data.daysInPeriod];
  const prevLabel = monthShort(data.previousMonth);
  const curLabel = monthShort(data.month);
  const dateOf = (day: number) => data.pace[day - 1]?.date;
  const prevDateOf = (day: number) => {
    const d = new Date(`${data.previousPeriod.start}T12:00:00`);
    d.setDate(d.getDate() + day - 1);
    return d.toISOString().slice(0, 10);
  };
  const range = rangeLabel(data.period.start, data.period.end);

  return (
    <ChartCard
      title="Spending pace"
      subtitle={
        data.hasPreviousMonth
          ? `Cumulative spending ${range}, compared with the month before`
          : `Cumulative spending ${range}`
      }
      legend={
        <>
          <LegendItem color={c.accent} label={monthName(data.month)} />
          {data.hasPreviousMonth && <LegendItem color={c.seriesMuted} label={monthName(data.previousMonth)} />}
        </>
      }
      chart={
        <ResponsiveContainer width="100%" height={232}>
          <ComposedChart data={data.pace} margin={{ top: 22, right: 26, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={c.grid} strokeWidth={1} />
            <XAxis dataKey="day" ticks={ticks} interval={0} tickLine={false} axisLine={{ stroke: c.axis }} tick={{ fill: c.muted, fontSize: 12 }} tickFormatter={(d) => (dateOf(d) ? shortDate(dateOf(d)!) : '')} />
            <YAxis width={44} tickLine={false} axisLine={false} tick={{ fill: c.muted, fontSize: 12 }} tickFormatter={compact} />
            <Tooltip
              cursor={{ stroke: c.axis, strokeWidth: 1 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as Overview['pace'][number];
                const rows = [];
                if (p.current !== null) rows.push({ color: c.accent, label: `${curLabel} · to ${shortDate(p.date)}`, value: kr(p.current) });
                if (data.hasPreviousMonth && p.previous !== null) rows.push({ color: c.seriesMuted, label: `${prevLabel} · to ${shortDate(prevDateOf(p.day))}`, value: kr(p.previous) });
                return rows.length ? <TooltipBox title={`Day ${label} of the month`} rows={rows} /> : null;
              }}
            />
            {data.hasPreviousMonth && (
              <Line dataKey="previous" type="monotone" stroke={c.seriesMuted} strokeWidth={2} dot={false} activeDot={false} isAnimationActive={false} strokeLinecap="round" />
            )}
            <Area
              dataKey="current"
              type="monotone"
              stroke={c.accent}
              strokeWidth={2}
              fill={c.accent}
              fillOpacity={0.1}
              isAnimationActive={false}
              connectNulls={false}
              activeDot={{ r: 4, fill: c.accent, stroke: c.surface, strokeWidth: 2 }}
              dot={(props: { cx?: number; cy?: number; index?: number }) => {
                if (props.index !== lastIdx || props.cx === undefined || props.cy === undefined || !last) return <g key={props.index} />;
                // End marker + direct label at the line end (text in ink, not the series colour).
                return (
                  <g key="end">
                    <circle cx={props.cx} cy={props.cy} r={4} fill={c.accent} stroke={c.surface} strokeWidth={2} />
                    <text x={props.cx} y={props.cy - 11} textAnchor={lastIdx > data.pace.length * 0.8 ? 'end' : 'middle'} fill={c.ink} fontSize={12} fontWeight={600}>
                      {kr(last.current)}
                    </text>
                  </g>
                );
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      }
      table={
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <th className={th}>Date</th>
              <th className={cx(th, 'text-right')}>{monthName(data.month)}</th>
              {data.hasPreviousMonth && <th className={cx(th, 'text-right')}>{monthName(data.previousMonth)}</th>}
            </tr>
          </thead>
          <tbody>
            {data.pace.map((p) => (
              <tr key={p.day} className="border-b border-line last:border-0">
                <td className={td}>{shortDate(p.date)}</td>
                <td className={cx(td, 'text-right')}>{p.current === null ? '–' : kr(p.current)}</td>
                {data.hasPreviousMonth && <td className={cx(td, 'text-right text-ink-2')}>{p.previous === null ? '–' : kr(p.previous)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      }
    />
  );
}

/* ---------- Monthly income vs spending ---------- */

export function MonthlyChart({ data, onSelect }: { data: Overview; onSelect: (month: string) => void }) {
  const c = useChartColors();
  const rows = data.monthly;
  const note = (r: Overview['monthly'][number]) =>
    r.inProgress ? 'in progress' : r.partial && data.dataSince ? `partial · data starts ${shortDate(data.dataSince)}` : null;
  return (
    <ChartCard
      title="Income vs spending"
      subtitle={rows.length > 1 ? `Last ${rows.length} months · click a month to open it` : 'Monthly totals'}
      legend={
        <>
          <LegendItem color={c.income} label="Income" shape="rect" />
          <LegendItem color={c.accent} label="Spending" shape="rect" />
        </>
      }
      chart={
        <ResponsiveContainer width="100%" height={232}>
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke={c.grid} strokeWidth={1} />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={{ stroke: c.axis }}
              interval={0}
              tick={(props: { x?: number | string; y?: number | string; payload?: { value: string } }) => {
                // The month being viewed gets ink + weight and an accent underline instead of dimming the others.
                const key = props.payload?.value ?? '';
                const selected = key === data.month;
                const x = Number(props.x);
                const y = Number(props.y);
                return (
                  <g transform={`translate(${x},${y})`} style={{ cursor: 'pointer' }} onClick={() => onSelect(key)}>
                    <text dy={12} textAnchor="middle" fill={selected ? c.ink : c.muted} fontSize={12} fontWeight={selected ? 600 : 400}>
                      {monthShort(key)}
                    </text>
                    {selected && <rect x={-10} y={18} width={20} height={2} rx={1} fill={c.accent} />}
                  </g>
                );
              }}
            />
            <YAxis width={44} tickLine={false} axisLine={false} tick={{ fill: c.muted, fontSize: 12 }} tickFormatter={compact} />
            <Tooltip
              cursor={{ fill: c.grid, fillOpacity: 0.45 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload as Overview['monthly'][number];
                return (
                  <TooltipBox
                    title={[monthName(r.month), data.monthStartDay !== 1 ? rangeLabel(r.start, r.end) : null, note(r)].filter(Boolean).join(' · ')}
                    rows={[
                      { color: c.income, label: 'Income', value: kr(r.income) },
                      { color: c.accent, label: 'Spending', value: kr(r.spent) },
                      { color: c.seriesMuted, label: 'Saved', value: kr(r.saved) },
                    ]}
                  />
                );
              }}
            />
            {(['income', 'spent'] as const).map((key) => (
              <Bar
                key={key}
                dataKey={key}
                maxBarSize={24}
                radius={[4, 4, 0, 0]}
                fill={key === 'income' ? c.income : c.accent}
                isAnimationActive={false}
                cursor="pointer"
                onClick={(d: { payload?: { month: string } }) => d.payload && onSelect(d.payload.month)}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      }
      table={
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <th className={th}>Month</th>
              <th className={cx(th, 'text-right')}>Income</th>
              <th className={cx(th, 'text-right')}>Spending</th>
              <th className={cx(th, 'text-right')}>Saved</th>
              <th className={cx(th, 'text-right')}>Net</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.month} className="border-b border-line last:border-0">
                <td className={td}>
                  {monthName(r.month)}
                  {(data.monthStartDay !== 1 || note(r)) && (
                    <span className="block text-[11px] text-muted">{[data.monthStartDay !== 1 ? rangeLabel(r.start, r.end) : null, note(r)].filter(Boolean).join(' · ')}</span>
                  )}
                </td>
                <td className={cx(td, 'text-right')}>{kr(r.income)}</td>
                <td className={cx(td, 'text-right')}>{kr(r.spent)}</td>
                <td className={cx(td, 'text-right')}>{kr(r.saved)}</td>
                <td className={cx(td, 'text-right', r.income - r.spent >= 0 ? 'text-good' : 'text-bad')}>{kr(r.income - r.spent, { sign: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    />
  );
}
