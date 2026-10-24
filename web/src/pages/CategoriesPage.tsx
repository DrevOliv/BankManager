import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Plus, RefreshCw, Sparkles, Trash2, User as UserIcon, Wrench } from 'lucide-react';
import { api } from '../lib/api';
import { useCategories, useInvalidateData, useRules } from '../lib/queries';
import type { Category, Kind, Rule } from '../lib/types';
import { CategoryIcon, ICON_CHOICES } from '../components/CategoryIcon';
import { Button, Card, CardHeader, Field, Input, Modal, Segmented, Select, cx, useToast } from '../components/ui';

const KINDS: { value: Kind; label: string; help: string }[] = [
  { value: 'expense', label: 'Spending', help: 'Counts as money spent' },
  { value: 'income', label: 'Income', help: 'Counts as money in' },
  { value: 'savings', label: 'Savings', help: 'Money put aside, not spending' },
  { value: 'transfer', label: 'Transfer', help: 'Ignored in all statistics' },
];

const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948', '#898781'];

export function CategoriesPage() {
  const { data: categories = [] } = useCategories();
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const navigate = useNavigate();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
          <p className="mt-0.5 text-sm text-muted">How transactions are grouped, and the rules that sort them automatically.</p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Plus size={16} /> New category
        </Button>
      </div>

      {KINDS.map((k) => {
        const list = categories.filter((c) => c.kind === k.value);
        if (!list.length) return null;
        return (
          <section key={k.value}>
            <h2 className="mb-2 px-1 text-[13px] font-semibold text-ink-2">
              {k.label} <span className="font-normal text-muted">· {k.help}</span>
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((c) => (
                <Card key={c.id} className="group flex items-center gap-3 p-3.5">
                  <CategoryIcon icon={c.icon} color={c.color} size={40} />
                  <button className="min-w-0 flex-1 text-left" onClick={() => navigate(`/transactions?month=all&category=${c.id}`)}>
                    <p className="truncate text-[14px] font-medium">{c.name}</p>
                    <p className="text-[12px] text-muted">
                      {c.count} transaction{c.count === 1 ? '' : 's'} · {c.rule_count} rule{c.rule_count === 1 ? '' : 's'}
                    </p>
                  </button>
                  <button onClick={() => setEditing(c)} className="rounded-lg p-2 text-muted hover:bg-hover hover:text-ink" aria-label={`Edit ${c.name}`}>
                    <Pencil size={15} />
                  </button>
                </Card>
              ))}
            </div>
          </section>
        );
      })}

      <RulesCard categories={categories} />

      <CategoryEditor key={editing === 'new' ? 'new' : editing?.id} category={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function CategoryEditor({ category, onClose }: { category: Category | 'new' | null; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const isNew = category === 'new';
  const c = isNew || !category ? null : category;
  const [name, setName] = useState(c?.name ?? '');
  const [kind, setKind] = useState<Kind>(c?.kind ?? 'expense');
  const [icon, setIcon] = useState(c?.icon ?? 'tag');
  const [color, setColor] = useState(c?.color ?? COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (isNew) await api.post('/api/categories', { name, kind, icon, color });
      else await api.patch(`/api/categories/${c!.id}`, { name, kind, icon, color });
      await invalidate();
      toast(isNew ? 'Category created' : 'Category saved');
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      await api.del(`/api/categories/${c!.id}`);
      await invalidate();
      toast('Category deleted');
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <Modal open={category !== null} onClose={onClose} title={isNew ? 'New category' : 'Edit category'}>
      <form onSubmit={save} className="space-y-4">
        <div className="flex items-center gap-3">
          <CategoryIcon icon={icon} color={color} size={48} />
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoFocus />
          </Field>
        </div>
        <Field label="Type">
          <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="w-full" disabled={c?.system_key === 'transfer'}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label} — {k.help}
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Icon</span>
          <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-10">
            {ICON_CHOICES.map((i) => (
              <button
                type="button"
                key={i}
                onClick={() => setIcon(i)}
                className={cx('flex aspect-square items-center justify-center rounded-lg', icon === i ? 'bg-accent-wash ring-2 ring-accent' : 'hover:bg-hover')}
                aria-label={i}
                aria-pressed={icon === i}
              >
                <CategoryIcon icon={i} color={icon === i ? color : '#898781'} size={28} />
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Colour</span>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((col) => (
              <button
                type="button"
                key={col}
                onClick={() => setColor(col)}
                className={cx('h-8 w-8 rounded-full ring-offset-2 ring-offset-[var(--surface)]', color === col && 'ring-2 ring-ink')}
                style={{ background: col }}
                aria-label={`Colour ${col}`}
                aria-pressed={color === col}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 pt-2">
          {!isNew && c?.system_key !== 'transfer' ? (
            confirmDelete ? (
              <Button type="button" variant="danger" onClick={remove}>
                Really delete?
              </Button>
            ) : (
              <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={15} /> Delete
              </Button>
            )
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Save
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

const MATCH_LABEL: Record<Rule['match_type'], string> = { contains: 'contains', word: 'has the word', exact: 'is exactly', regex: 'matches regex' };
const DIR_LABEL: Record<Rule['direction'], string> = { any: '', in: 'money in', out: 'money out' };
const SOURCE: Record<Rule['source'], { label: string; icon: typeof UserIcon }> = {
  user: { label: 'Yours', icon: UserIcon },
  ai: { label: 'Learned by AI', icon: Sparkles },
  system: { label: 'Built-in', icon: Wrench },
};

function RulesCard({ categories }: { categories: Category[] }) {
  const { data: rules = [] } = useRules();
  const toast = useToast();
  const invalidate = useInvalidateData();
  const [tab, setTab] = useState<Rule['source']>('user');
  const [pattern, setPattern] = useState('');
  const [matchType, setMatchType] = useState<Rule['match_type']>('contains');
  const [direction, setDirection] = useState<Rule['direction']>('any');
  const [categoryId, setCategoryId] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => rules.filter((r) => r.source === tab), [rules, tab]);
  const counts = useMemo(() => ({ user: 0, ai: 0, system: 0, ...Object.fromEntries((['user', 'ai', 'system'] as const).map((s) => [s, rules.filter((r) => r.source === s).length])) }), [rules]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!categoryId) return toast('Pick a category for the rule', 'error');
    setBusy(true);
    try {
      const r = await api.post<{ changed: number }>('/api/rules', { pattern, matchType, direction, categoryId: Number(categoryId) });
      await invalidate();
      toast(`Rule added · ${r.changed} transaction${r.changed === 1 ? '' : 's'} recategorised`);
      setPattern('');
      setTab('user');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Rule) => {
    try {
      await api.del(`/api/rules/${r.id}`);
      await invalidate();
      toast('Rule removed');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const reapply = async () => {
    const r = await api.post<{ changed: number; matched: number }>('/api/rules/reapply');
    await invalidate();
    toast(`${r.changed} transactions updated · ${r.matched} new transfers matched`);
  };

  return (
    <Card>
      <CardHeader
        title="Rules"
        subtitle="Checked in order: yours first, then Swish detection, built-in rules, and finally what the AI learned. The most specific match wins."
        action={
          <Button size="sm" variant="ghost" onClick={reapply} title="Run all rules again">
            <RefreshCw size={14} /> Re-apply
          </Button>
        }
      />
      <form onSubmit={add} className="mx-5 mb-4 grid gap-2 rounded-xl bg-surface-2 p-3 sm:grid-cols-[auto_1fr_auto_1fr_auto] sm:items-center">
        <Select value={matchType} onChange={(e) => setMatchType(e.target.value as Rule['match_type'])} aria-label="Match type">
          <option value="contains">Text contains</option>
          <option value="word">Text has the word</option>
          <option value="exact">Merchant is exactly</option>
          <option value="regex">Regex</option>
        </Select>
        <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="e.g. spotify" required />
        <Select value={direction} onChange={(e) => setDirection(e.target.value as Rule['direction'])} aria-label="Direction">
          <option value="any">In or out</option>
          <option value="out">Money out</option>
          <option value="in">Money in</option>
        </Select>
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Category">
          <option value="">→ Category…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="primary" loading={busy}>
          Add rule
        </Button>
      </form>

      <div className="px-5 pb-2">
        <Segmented
          value={tab}
          onChange={setTab}
          options={(['user', 'ai', 'system'] as const).map((s) => ({ value: s, label: `${SOURCE[s].label} (${counts[s]})` }))}
        />
      </div>
      <div className="max-h-[480px] divide-y divide-line overflow-y-auto">
        {shown.length === 0 && (
          <p className="px-5 py-6 text-sm text-muted">
            {tab === 'user'
              ? 'No rules of your own yet. Change a transaction’s category and tick “Always use this” to create one.'
              : tab === 'ai'
                ? 'Nothing learned yet. Use “Categorise with AI” on uncategorised transactions.'
                : 'No built-in rules.'}
          </p>
        )}
        {shown.map((r) => (
          <div key={r.id} className="flex items-center gap-3 px-5 py-2.5">
            <div className="min-w-0 flex-1 text-[13px]">
              <span className="text-muted">{MATCH_LABEL[r.match_type]} </span>
              <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-ink">{r.pattern}</span>
              {r.direction !== 'any' && <span className="text-muted"> · {DIR_LABEL[r.direction]}</span>}
            </div>
            <span className="flex shrink-0 items-center gap-1.5 text-[13px]">
              <CategoryIcon icon={r.category_icon} color={r.category_color} size={22} />
              <span className="hidden sm:inline">{r.category_name}</span>
            </span>
            <button onClick={() => remove(r)} className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-bad" aria-label="Delete rule">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}
