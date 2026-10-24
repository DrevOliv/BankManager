import { useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, CircleCheck, Copy, FileSpreadsheet, Sparkles, Tag, TriangleAlert, Undo2, Upload, Clock } from 'lucide-react';
import { api } from '../lib/api';
import { BANKS, dateTime, shortDate } from '../lib/format';
import { useAiCategorize, useAiStatus, useImports, useInvalidateData } from '../lib/queries';
import type { ImportFailure, ImportResult } from '../lib/types';
import { BankBadge, Button, Card, CardHeader, Modal, Spinner, cx, useToast } from '../components/ui';

export function ImportPage() {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<(ImportResult | ImportFailure)[] | null>(null);
  const [undoId, setUndoId] = useState<number | null>(null);
  const imports = useImports();
  const ai = useAiStatus();
  const categorize = useAiCategorize();
  const aiReady = ai.data?.enabled && ai.data.reachable && ai.data.modelAvailable;

  const upload = async (files: FileList | File[]) => {
    const list = [...files];
    if (!list.length) return;
    const form = new FormData();
    for (const f of list) form.append('file', f, f.name);
    setBusy(true);
    setResults(null);
    try {
      const res = await api.post<{ results: (ImportResult | ImportFailure)[] }>('/api/imports', form);
      setResults(res.results);
      await invalidate();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    upload(e.dataTransfer.files);
  };

  const undo = async () => {
    if (undoId === null) return;
    try {
      const r = await api.del<{ removed: number }>(`/api/imports/${undoId}`);
      toast(`Removed ${r.removed} transactions`);
      await invalidate();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
    setUndoId(null);
  };

  const uncategorized = results?.reduce((s, r) => s + (r.ok ? r.uncategorized : 0), 0) ?? 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import statements</h1>
        <p className="mt-0.5 text-sm text-muted">Upload as often as you like. Duplicates are skipped automatically.</p>
      </div>

      <div
        onDragOver={(e) => (e.preventDefault(), setDragging(true))}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !busy && input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        className={cx(
          'flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition',
          dragging ? 'border-accent bg-accent-wash' : 'border-line-strong bg-surface hover:border-accent/60 hover:bg-hover',
        )}
      >
        <input ref={input} type="file" multiple accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} />
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-wash text-accent">
          {busy ? <Spinner className="text-accent" /> : <Upload size={24} />}
        </div>
        <p className="text-base font-semibold">{busy ? 'Importing…' : 'Drop your bank statements here'}</p>
        <p className="mt-1 text-sm text-muted">Handelsbanken .xlsx and Revolut .csv / .xlsx · several files at once is fine</p>
      </div>

      {results && (
        <div className="space-y-3">
          {results.map((r, i) => (r.ok ? <ResultCard key={i} r={r} /> : <FailureCard key={i} r={r} />))}
          {uncategorized > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3">
              <p className="text-sm">
                <span className="font-semibold">{uncategorized}</span> new transaction{uncategorized === 1 ? '' : 's'} didn't match any rule.
              </p>
              <div className="flex gap-2">
                <Link to="/transactions?month=all&category=none">
                  <Button size="sm">Review</Button>
                </Link>
                {aiReady && (
                  <Button
                    size="sm"
                    variant="primary"
                    loading={categorize.isPending}
                    onClick={() =>
                      categorize.mutate(undefined, {
                        onSuccess: (x) => toast(`AI categorised ${x.categorized} of ${x.merchants} merchants`),
                        onError: (e) => toast((e as Error).message, 'error'),
                      })
                    }
                  >
                    <Sparkles size={14} /> Categorise with AI
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <Card className="p-5">
          <div className="mb-2 flex items-center gap-2">
            <BankBadge bank="handelsbanken" />
            <span className="text-sm font-semibold">How to export</span>
          </div>
          <p className="text-[13px] leading-relaxed text-ink-2">
            In the Handelsbanken internet bank, open the account, pick the period under <i>Kontoutdrag / Transaktioner</i> and choose <b>Exportera till Excel</b>. Upload the .xlsx as is.
          </p>
        </Card>
        <Card className="p-5">
          <div className="mb-2 flex items-center gap-2">
            <BankBadge bank="revolut" />
            <span className="text-sm font-semibold">How to export</span>
          </div>
          <p className="text-[13px] leading-relaxed text-ink-2">
            In the Revolut app, open your account, tap <b>Statement</b>, choose <b>Excel</b> or <b>CSV</b>, pick a period and share the file to this computer.
          </p>
        </Card>
      </div>

      <Card>
        <CardHeader title="Import history" subtitle="Undo an import to remove exactly the transactions it added." />
        {imports.isLoading ? (
          <div className="flex h-24 items-center justify-center">
            <Spinner />
          </div>
        ) : !imports.data?.length ? (
          <p className="px-5 pb-5 text-sm text-muted">No imports yet.</p>
        ) : (
          <div className="divide-y divide-line">
            {imports.data.map((i) => (
              <div key={i.id} className="flex items-center gap-3 px-5 py-3">
                <FileSpreadsheet size={20} className="shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <BankBadge bank={i.bank} />
                    <span className="truncate text-[14px] font-medium">{i.filename}</span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {dateTime(i.created_at)}
                    {i.username ? ` · ${i.username}` : ''}
                    {i.period_start && i.period_end ? ` · ${shortDate(i.period_start)} – ${shortDate(i.period_end)}` : ''}
                    {` · ${i.rows_inserted} new, ${i.rows_duplicate} duplicates`}
                  </p>
                </div>
                {i.rows_remaining > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setUndoId(i.id)} title="Undo this import">
                    <Undo2 size={14} /> Undo
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={undoId !== null} onClose={() => setUndoId(null)} title="Undo this import?">
        <p className="text-sm text-ink-2">
          This removes the {imports.data?.find((i) => i.id === undoId)?.rows_remaining ?? ''} transactions that were added by this file. Your categories and rules stay. You can import the file again later.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setUndoId(null)}>Cancel</Button>
          <Button variant="danger" onClick={undo}>
            Remove transactions
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Stat({ icon, children, tone = 'default' }: { icon: React.ReactNode; children: React.ReactNode; tone?: 'default' | 'good' | 'muted' }) {
  return (
    <li className={cx('flex items-start gap-2 text-[13px]', tone === 'muted' ? 'text-muted' : 'text-ink-2')}>
      <span className={cx('mt-px shrink-0', tone === 'good' ? 'text-good' : 'text-muted')}>{icon}</span>
      <span>{children}</span>
    </li>
  );
}

function ResultCard({ r }: { r: ImportResult }) {
  return (
    <Card className="animate-in p-5">
      <div className="flex flex-wrap items-center gap-2">
        <CircleCheck size={18} className="text-good" />
        <BankBadge bank={r.bank} />
        <span className="truncate text-[14px] font-semibold">{r.filename}</span>
      </div>
      <p className="mt-1 text-[12px] text-muted">
        {BANKS[r.bank]?.label ?? r.bank} · {r.accounts.join(', ')}
        {r.periodStart && r.periodEnd ? ` · ${shortDate(r.periodStart)} – ${shortDate(r.periodEnd)}` : ''}
      </p>
      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        <Stat icon={<CircleCheck size={14} />} tone="good">
          <b className="text-ink">{r.inserted}</b> new transaction{r.inserted === 1 ? '' : 's'} added
        </Stat>
        <Stat icon={<Copy size={14} />} tone={r.duplicates ? 'default' : 'muted'}>
          {r.duplicates} already imported (skipped)
        </Stat>
        <Stat icon={<ArrowLeftRight size={14} />} tone={r.transfersMatched ? 'default' : 'muted'}>
          {r.transfersMatched} transfer{r.transfersMatched === 1 ? '' : 's'} between your banks matched and hidden
        </Stat>
        {r.pendingReplaced > 0 && (
          <Stat icon={<Clock size={14} />}>
            {r.pendingReplaced} pending transaction{r.pendingReplaced === 1 ? '' : 's'} updated
          </Stat>
        )}
        {r.uncategorized > 0 && (
          <Stat icon={<Tag size={14} />}>
            {r.uncategorized} need{r.uncategorized === 1 ? 's' : ''} a category
          </Stat>
        )}
        {r.skipped > 0 && (
          <Stat icon={<TriangleAlert size={14} />} tone="muted">
            {r.skipped} row{r.skipped === 1 ? '' : 's'} ignored (declined, reverted or empty)
          </Stat>
        )}
      </ul>
    </Card>
  );
}

function FailureCard({ r }: { r: ImportFailure }) {
  return (
    <Card className="animate-in border-bad/30 p-5">
      <div className="flex items-center gap-2">
        <TriangleAlert size={18} className="text-bad" />
        <span className="text-[14px] font-semibold">{r.filename}</span>
      </div>
      <p className="mt-1.5 text-[13px] text-ink-2">{r.error}</p>
    </Card>
  );
}
