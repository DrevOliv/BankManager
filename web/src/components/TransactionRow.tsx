import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ChevronDown, MessageSquareText, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { BANKS, dateTime, money, shortDate } from '../lib/format';
import { useInvalidateData } from '../lib/queries';
import type { Transaction } from '../lib/types';
import { CategoryIcon } from './CategoryIcon';
import { CategoryPicker } from './CategoryPicker';
import { BankBadge, Button, Input, PendingBadge, SwishBadge, TransferBadge, cx, useToast } from './ui';

const CHANNEL_LABEL: Record<string, string> = {
  card: 'Card payment',
  swish: 'Swish',
  p2p: 'Transfer to/from a person',
  transfer: 'Bank transfer',
  topup: 'Top-up',
  exchange: 'Currency exchange',
  atm: 'Cash withdrawal',
  fee: 'Fee',
  reward: 'Reward / interest',
  other: 'Payment',
};

const SOURCE_LABEL: Record<Transaction['category_source'], string> = {
  none: 'Not categorised yet',
  rule: 'Categorised by a rule',
  ai: 'Categorised by AI',
  user: 'Categorised by you',
  transfer: 'Detected transfer between your accounts',
};

export function TransactionRow({ t, compact = false }: { t: Transaction; compact?: boolean }) {
  const toast = useToast();
  const invalidate = useInvalidateData();
  const pillRef = useRef<HTMLButtonElement>(null);
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(t.note ?? '');

  const update = useMutation({
    mutationFn: (body: { categoryId?: number | null; applyToMerchant?: boolean; note?: string | null }) =>
      api.patch<{ updatedSimilar: number }>(`/api/transactions/${t.id}`, body),
    onSuccess: (res, body) => {
      invalidate();
      if (body.applyToMerchant) {
        toast(res.updatedSimilar ? `Updated ${res.updatedSimilar} other ${t.merchant} transaction${res.updatedSimilar === 1 ? '' : 's'} too` : `Future ${t.merchant} transactions will use this category`);
      } else if (body.note !== undefined) toast('Note saved');
    },
    onError: (err) => toast((err as Error).message, 'error'),
  });

  const positive = t.amount > 0;
  const isTransfer = t.kind === 'transfer';
  const showSwish = t.channel === 'swish';

  return (
    <div className={cx('group', open && 'bg-surface-2/60')}>
      <div className={cx('flex items-center gap-3 px-4 sm:px-5', compact ? 'py-2.5' : 'py-3')}>
        <CategoryIcon icon={t.category_icon} color={t.category_color} size={compact ? 34 : 38} />
        <button className="min-w-0 flex-1 text-left" onClick={() => !compact && setOpen((o) => !o)} aria-expanded={open}>
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-medium text-ink">{t.merchant}</span>
            {t.note && <MessageSquareText size={13} className="shrink-0 text-muted" aria-label="Has a note" />}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <BankBadge bank={t.bank} />
            {showSwish && <SwishBadge />}
            {isTransfer && t.transfer_peer_id && <TransferBadge peerBank={t.peer_bank} />}
            {t.status === 'pending' && <PendingBadge />}
            {compact && <span className="text-[12px] text-muted">{shortDate(t.date)}</span>}
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={cx('tabular text-[14px] font-semibold', positive ? 'text-good' : 'text-ink')}>{money(t.amount, t.currency)}</span>
          <button
            ref={pillRef}
            onClick={() => setPicking(true)}
            className={cx(
              'inline-flex max-w-40 items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[12px] transition hover:bg-hover',
              t.category_name ? 'text-ink-2' : 'bg-warning/15 font-medium text-ink',
            )}
            title="Change category"
          >
            {t.category_source === 'ai' && <Sparkles size={11} className="shrink-0 text-accent" aria-label="Categorised by AI" />}
            <span className="truncate">{t.category_name ?? 'Uncategorised'}</span>
            <ChevronDown size={12} className="shrink-0 opacity-60" />
          </button>
        </div>
      </div>

      {open && !compact && (
        <div className="animate-in grid gap-3 px-4 pb-4 text-[13px] sm:grid-cols-2 sm:px-5 sm:pl-[68px]">
          <dl className="space-y-1.5">
            <Detail label="Bank text" value={t.description} />
            <Detail label="Account" value={t.account_name === BANKS[t.bank]?.label ? t.account_name : `${BANKS[t.bank]?.label ?? t.bank} · ${t.account_name}`} />
            <Detail label="Type" value={CHANNEL_LABEL[t.channel] ?? t.raw_type ?? '–'} />
            <Detail label="When" value={t.occurred_at ? dateTime(t.occurred_at) : shortDate(t.date)} />
            {t.booked_date && t.booked_date !== t.date && <Detail label="Booked" value={shortDate(t.booked_date)} />}
            {t.currency !== 'SEK' && <Detail label="In SEK" value={money(t.amount_sek, 'SEK')} />}
            {t.transfer_peer_id && <Detail label="Matched with" value={`${t.peer_merchant} (${BANKS[t.peer_bank ?? '']?.label ?? t.peer_bank})`} />}
            <Detail label="Category" value={SOURCE_LABEL[t.category_source]} />
          </dl>
          <div className="space-y-2">
            <label className="block text-[12px] font-medium text-ink-2" htmlFor={`note-${t.id}`}>
              Note
            </label>
            <div className="flex gap-2">
              <Input id={`note-${t.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Birthday present for Sara" className="h-9" />
              <Button size="sm" className="h-9" onClick={() => update.mutate({ note: note.trim() || null })} disabled={note === (t.note ?? '')}>
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      <CategoryPicker
        anchor={pillRef.current}
        open={picking}
        onClose={() => setPicking(false)}
        selectedId={t.category_id}
        merchant={t.merchant}
        isAmountPositive={positive}
        onPick={(categoryId, applyToMerchant) => {
          setPicking(false);
          update.mutate({ categoryId, applyToMerchant });
        }}
        onReset={
          t.category_source === 'user'
            ? () => {
                setPicking(false);
                update.mutate({ categoryId: null });
              }
            : undefined
        }
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{value}</dd>
    </div>
  );
}
