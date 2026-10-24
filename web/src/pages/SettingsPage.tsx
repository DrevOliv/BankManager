import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { BANKS, kr, monthName, rangeLabel, shortDate } from '../lib/format';
import { useAccounts, useAiStatus, useAuth, useInvalidateData, usePeriods, useSettings } from '../lib/queries';
import type { Account, Settings, User } from '../lib/types';
import { BankBadge, Button, Card, CardHeader, Field, Input, Modal, Select, Toggle, useToast } from '../components/ui';

export function SettingsPage() {
  const { data: settings } = useSettings();
  const auth = useAuth();
  const version = useQuery({ queryKey: ['version'], queryFn: () => api.get<{ version: string }>('/api/health'), staleTime: Infinity });
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-sm text-muted">Budget, accounts, AI and users.</p>
      </div>
      {settings && <MonthStartCard settings={settings} />}
      {settings && <BudgetCard settings={settings} />}
      <AccountsCard />
      {settings && <AiCard settings={settings} />}
      <div className="grid gap-5 lg:grid-cols-2">
        <PasswordCard />
        {settings && <FxCard settings={settings} />}
      </div>
      {auth.data?.user?.is_admin && <UsersCard me={auth.data.user} />}
      {version.data && <p className="pt-2 text-center text-[12px] text-muted">BankManager {version.data.version}</p>}
    </div>
  );
}

function useSaveSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  return async (patch: Partial<Settings>, message = 'Saved') => {
    try {
      await api.put('/api/settings', patch);
      await Promise.all(['settings', 'periods', 'overview', 'transactions', 'insights', 'ai-status'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      toast(message);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
}

function MonthStartCard({ settings }: { settings: Settings }) {
  const save = useSaveSettings();
  const { data: periods } = usePeriods();
  const recent = periods ? periods.periods.filter((p) => p.key <= periods.current).slice(-3).reverse() : [];
  const ordinal = (d: number) => `${d}${d === 1 || d === 21 ? 'st' : d === 2 || d === 22 ? 'nd' : d === 3 || d === 23 ? 'rd' : 'th'}`;
  return (
    <Card>
      <CardHeader
        title="When does your month start?"
        subtitle="Line your months up with your salary or student aid. All statistics, the budget and the AI follow it."
      />
      <div className="space-y-4 px-5 pb-5">
        <div className="w-72">
          <Field label="Money usually arrives around">
            <Select value={settings.monthStartDay} onChange={(e) => save({ monthStartDay: Number(e.target.value) }, 'Month start saved')} className="w-full">
              <option value={1}>The 1st (use calendar months)</option>
              {Array.from({ length: 27 }, (_, i) => i + 2).map((d) => (
                <option key={d} value={d}>
                  The {ordinal(d)}
                  {d === 25 ? ' (salary and CSN)' : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {settings.monthStartDay !== 1 && (
          <div className="space-y-3">
            <label className="flex items-start gap-3 text-[13px] text-ink-2">
              <Toggle checked={settings.followIncome} onChange={(v) => save({ followIncome: v })} label="Start when income arrives" />
              <span>
                <b className="font-medium text-ink">Start the month on the day the money arrives.</b> Looks for salary, CSN or other income (not Swish)
                from 10 days before to 6 days after the {ordinal(settings.monthStartDay)}.
              </span>
            </label>
            <label className="flex items-start gap-3 text-[13px] text-ink-2">
              <Toggle checked={settings.adjustToBankingDay} onChange={(v) => save({ adjustToBankingDay: v })} label="Start on the banking day before" />
              <span>
                {settings.followIncome ? 'When nothing has arrived yet, ' : ''}start on the banking day before when the {ordinal(settings.monthStartDay)} is a weekend
                or Swedish holiday.
              </span>
            </label>
          </div>
        )}
        {settings.monthStartDay !== 1 && recent.length > 0 && (
          <div className="divide-y divide-line rounded-xl border border-line">
            {recent.map((p) => (
              <div key={p.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3.5 py-2.5 text-[13px]">
                <span>
                  <b className="font-medium">{monthName(p.key)}</b>
                  <span className="text-ink-2"> · {rangeLabel(p.start, p.end)}</span>
                  {p.key === periods?.current && <span className="ml-2 rounded bg-accent-wash px-1.5 py-0.5 text-[11px] font-medium text-accent-ink">now</span>}
                </span>
                <span className="text-muted">
                  {p.trigger ? `Started by ${p.trigger.sources} (${kr(p.trigger.amount)})` : settings.followIncome ? 'No income found, used the start day' : 'Fixed start day'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function BudgetCard({ settings }: { settings: Settings }) {
  const save = useSaveSettings();
  const [value, setValue] = useState(settings.monthlyBudget?.toString() ?? '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = value.trim() === '' ? null : Number(value.replace(/\s/g, '').replace(',', '.'));
    if (n !== null && (!Number.isFinite(n) || n < 0)) return;
    save({ monthlyBudget: n }, n === null ? 'Budget removed' : 'Budget saved');
  };
  return (
    <Card>
      <CardHeader title="Monthly budget" subtitle="How much you want to spend per month. The overview shows how much is left and a daily allowance." />
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2 px-5 pb-5">
        <div className="w-48">
          <Field label="Budget (kr)">
            <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 8000" />
          </Field>
        </div>
        <Button type="submit" variant="primary">
          Save
        </Button>
        {settings.monthlyBudget !== null && (
          <Button type="button" variant="ghost" onClick={() => (setValue(''), save({ monthlyBudget: null }, 'Budget removed'))}>
            Remove
          </Button>
        )}
      </form>
    </Card>
  );
}

function AccountsCard() {
  const { data } = useAccounts();
  const toast = useToast();
  const invalidate = useInvalidateData();
  const [deleting, setDeleting] = useState<Account | null>(null);

  const patch = async (a: Account, body: { name?: string; includeInBalance?: boolean }) => {
    try {
      await api.patch(`/api/accounts/${a.id}`, body);
      await invalidate();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const remove = async () => {
    if (!deleting) return;
    await api.del(`/api/accounts/${deleting.id}`);
    await invalidate();
    toast('Account and its transactions deleted');
    setDeleting(null);
  };

  return (
    <Card>
      <CardHeader title="Accounts" subtitle="Created automatically from your imports. Rename them or leave one out of the total." />
      {!data?.accounts.length ? (
        <p className="px-5 pb-5 text-sm text-muted">No accounts yet — import a statement first.</p>
      ) : (
        <div className="divide-y divide-line">
          {data.accounts.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <BankBadge bank={a.bank} />
              <input
                defaultValue={a.name}
                onBlur={(e) => e.target.value.trim() && e.target.value !== a.name && patch(a, { name: e.target.value.trim() })}
                className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-[14px] font-medium outline-none hover:border-line focus:border-accent"
                aria-label={`Name of ${BANKS[a.bank]?.label} account`}
              />
              <div className="text-right text-[12px] text-muted">
                <p className="tabular text-[14px] font-semibold text-ink">{a.available === null ? '–' : kr(a.available)}</p>
                <p>
                  {a.transactions} transactions{a.firstDate && a.lastDate ? ` · ${shortDate(a.firstDate)} – ${shortDate(a.lastDate)}` : ''}
                </p>
              </div>
              <label className="flex items-center gap-2 text-[12px] text-ink-2">
                <Toggle checked={a.includeInBalance} onChange={(v) => patch(a, { includeInBalance: v })} label="Include in total" />
                In total
              </label>
              <button onClick={() => setDeleting(a)} className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-bad" aria-label="Delete account">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete account?">
        <p className="text-sm text-ink-2">
          This permanently deletes <b>{deleting?.name}</b> and all {deleting?.transactions} of its transactions. You can import the statements again afterwards.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="danger" onClick={remove}>
            Delete
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

function AiCard({ settings }: { settings: Settings }) {
  const save = useSaveSettings();
  const status = useAiStatus();
  const qc = useQueryClient();
  const [url, setUrl] = useState(settings.ollamaUrl);
  const [model, setModel] = useState(settings.ollamaModel);
  useEffect(() => {
    setUrl(settings.ollamaUrl);
    setModel(settings.ollamaModel);
  }, [settings.ollamaUrl, settings.ollamaModel]);

  const s = status.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['ai-status'] });

  return (
    <Card>
      <CardHeader
        title="AI assistant (Ollama)"
        subtitle="Categorises unknown merchants, writes monthly insights and answers questions — all on your own Ollama server."
        action={<Toggle checked={settings.aiEnabled} onChange={(v) => save({ aiEnabled: v }, v ? 'AI turned on' : 'AI turned off')} label="Enable AI" />}
      />
      <div className="space-y-4 px-5 pb-5">
        <div className="flex items-center gap-2 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[13px]">
          {status.isFetching ? (
            <RefreshCw size={15} className="animate-spin text-muted" />
          ) : s?.reachable && s.modelAvailable ? (
            <CircleCheck size={15} className="text-good" />
          ) : (
            <CircleX size={15} className="text-bad" />
          )}
          <span className="flex-1 text-ink-2">
            {!s
              ? 'Checking…'
              : !s.reachable
                ? `Not reachable at ${s.url}${s.error ? ` (${s.error})` : ''}`
                : !s.modelAvailable
                  ? `Connected, but “${s.model}” isn’t installed. Run: ollama pull ${s.model}`
                  : `Connected · using ${s.model}`}
          </span>
          <Button size="sm" variant="ghost" onClick={refresh}>
            Test
          </Button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save({ ollamaUrl: url.trim(), ollamaModel: model.trim() }, 'AI settings saved');
          }}
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <Field label="Ollama URL" hint="From Docker, your Mac/PC is http://host.docker.internal:11434">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://host.docker.internal:11434" />
          </Field>
          <Field label="Model" hint="A 3B model such as llama3.2:3b or qwen2.5:3b works well.">
            {s?.models.length ? (
              <Select value={model} onChange={(e) => setModel(e.target.value)} className="w-full">
                {!s.models.includes(model) && <option value={model}>{model} (not installed)</option>}
                {s.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            ) : (
              <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="llama3.2:3b" />
            )}
          </Field>
          <Button type="submit" variant="primary" className="sm:mb-[22px]">
            Save
          </Button>
        </form>
      </div>
    </Card>
  );
}

function PasswordCard() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/auth/password', { currentPassword: current, newPassword: next });
      toast('Password changed');
      setCurrent('');
      setNext('');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Change password" />
      <form onSubmit={submit} className="space-y-3 px-5 pb-5">
        <Field label="Current password">
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label="New password" hint="At least 8 characters.">
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
        </Field>
        <Button type="submit" variant="primary" loading={busy}>
          Change password
        </Button>
      </form>
    </Card>
  );
}

function FxCard({ settings }: { settings: Settings }) {
  const qc = useQueryClient();
  const toast = useToast();
  const update = async (currency: string, rate: string) => {
    const n = Number(rate.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return;
    try {
      await api.put('/api/settings/fx', { currency, rate: n });
      await Promise.all(['settings', 'overview', 'transactions'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      toast(`1 ${currency} = ${n} kr`);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <Card>
      <CardHeader title="Exchange rates" subtitle="Used to count non-SEK transactions (e.g. a Revolut EUR pocket) in kronor." />
      <div className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-3">
        {settings.fxRates
          .filter((r) => r.currency !== 'SEK')
          .map((r) => (
            <Field key={r.currency} label={`1 ${r.currency} =`}>
              <div className="relative">
                <Input defaultValue={r.rate} inputMode="decimal" onBlur={(e) => Number(e.target.value) !== r.rate && update(r.currency, e.target.value)} className="pr-9" />
                <span className="absolute top-1/2 right-3 -translate-y-1/2 text-[13px] text-muted">kr</span>
              </div>
            </Field>
          ))}
      </div>
    </Card>
  );
}

function UsersCard({ me }: { me: User }) {
  const toast = useToast();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<(User & { created_at: string })[]>('/api/users') });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const add = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/users', { username, password });
      setUsername('');
      setPassword('');
      users.refetch();
      toast('User added');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const remove = async (id: number) => {
    try {
      await api.del(`/api/users/${id}`);
      users.refetch();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <Card>
      <CardHeader title="Users" subtitle="Everyone sees the same data — useful for a partner or a second device." />
      <div className="divide-y divide-line border-y border-line">
        {users.data?.map((u) => (
          <div key={u.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
            <span>
              {u.username}
              {u.is_admin && <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-2">admin</span>}
            </span>
            {u.id !== me.id && (
              <button onClick={() => remove(u.id)} className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-bad" aria-label={`Delete ${u.username}`}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={add} className="grid gap-2 p-5 sm:grid-cols-[1fr_1fr_auto]">
        <Input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={2} autoComplete="off" />
        <Input placeholder="Password (8+ characters)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
        <Button type="submit">Add user</Button>
      </form>
    </Card>
  );
}
