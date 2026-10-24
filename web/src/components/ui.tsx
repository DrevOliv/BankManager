import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { CircleCheck, Clock, LoaderCircle, TriangleAlert, X, ArrowLeftRight } from 'lucide-react';
import { BANKS } from '../lib/format';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('rounded-2xl border border-line bg-surface shadow-card', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md'; loading?: boolean }) {
  const styles: Record<ButtonVariant, string> = {
    primary: 'bg-accent text-white hover:brightness-110 border-transparent',
    secondary: 'bg-surface text-ink border-line-strong hover:bg-hover',
    ghost: 'bg-transparent text-ink-2 border-transparent hover:bg-hover hover:text-ink',
    danger: 'bg-transparent text-bad border-line-strong hover:bg-hover',
  };
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-xl border font-medium whitespace-nowrap transition-[background,filter,color] disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-10 px-3.5 text-sm',
        styles[variant],
        className,
      )}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading && <LoaderCircle size={15} className="animate-spin" />}
      {children}
    </button>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        'h-10 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-muted outline-none transition focus:border-accent focus:ring-3 focus:ring-accent-wash',
        className,
      )}
      {...rest}
    />
  );
}

const CHEVRON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23898781' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;

export function Select({ className, children, style, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        'h-10 appearance-none rounded-xl border border-line-strong bg-surface bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9 pl-3 text-sm text-ink outline-none transition focus:border-accent focus:ring-3 focus:ring-accent-wash',
        className,
      )}
      style={{ backgroundImage: CHEVRON, ...style }}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[12px] text-muted">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative h-6 w-10 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line-strong')}
    >
      <span className={cx('absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-4')} />
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-surface-2 p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-8 rounded-[10px] px-3 text-[13px] font-medium whitespace-nowrap transition',
            value === o.value ? 'bg-surface text-ink shadow-card ring-1 ring-line' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cx('animate-spin text-muted', className)} size={18} />;
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-muted">{icon}</div>
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

/* ---- Badges: which bank, Swish, pending ---- */

export function BankBadge({ bank }: { bank: string }) {
  const b = BANKS[bank] ?? { label: bank, short: bank.slice(0, 2).toUpperCase() };
  const style = bank === 'handelsbanken' ? 'bg-hb-bg text-hb' : bank === 'revolut' ? 'bg-rev-bg text-rev' : 'bg-surface-2 text-ink-2';
  return (
    <span className={cx('inline-flex h-[18px] shrink-0 items-center rounded-md px-1.5 text-[11px] font-semibold tracking-wide', style)} title={b.label}>
      {b.label}
    </span>
  );
}

export function SwishBadge() {
  return (
    <span className="inline-flex h-[18px] items-center gap-1 rounded-md bg-swish-bg px-1.5 text-[11px] font-semibold text-swish" title="Swish payment">
      <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden>
        <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="14 4" />
      </svg>
      Swish
    </span>
  );
}

export function PendingBadge() {
  return (
    <span className="inline-flex h-[18px] items-center gap-1 rounded-md bg-warning/15 px-1.5 text-[11px] font-semibold text-ink-2" title="Not booked yet">
      <Clock size={10} strokeWidth={2.5} /> Pending
    </span>
  );
}

export function TransferBadge({ peerBank }: { peerBank: string | null }) {
  return (
    <span className="inline-flex h-[18px] items-center gap-1 rounded-md bg-surface-2 px-1.5 text-[11px] font-semibold text-ink-2" title="Matched transfer between your accounts">
      <ArrowLeftRight size={10} strokeWidth={2.5} /> {peerBank ? `↔ ${BANKS[peerBank]?.label ?? peerBank}` : 'Transfer'}
    </span>
  );
}

export function TransferBadgeLabel({ text }: { text: string }) {
  return <span className="inline-flex h-[18px] items-center rounded-md bg-surface-2 px-1.5 text-[11px] font-semibold text-ink-2">{text}</span>;
}

/* ---- Modal ---- */

export function Modal({ open, onClose, title, children, width = 480 }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal
        aria-label={title}
        className="animate-in max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-surface shadow-pop sm:rounded-2xl"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-hover hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 pb-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/* ---- Popover anchored to an element ---- */

export function Popover({ anchor, open, onClose, children, width = 300 }: { anchor: HTMLElement | null; open: boolean; onClose: () => void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  useEffect(() => {
    if (!open || !anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const openUp = below < 280 && above > below;
      const maxHeight = Math.min(420, openUp ? above : below);
      setPos({ top: openUp ? r.top - 6 - maxHeight : r.bottom + 6, left, maxHeight });
    };
    place();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, anchor, onClose, width]);

  if (!open || !pos) return null;
  return createPortal(
    <div
      ref={ref}
      className="animate-in fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
      style={{ top: pos.top, left: pos.left, width, maxHeight: pos.maxHeight }}
    >
      {children}
    </div>,
    document.body,
  );
}

/* ---- Toasts ---- */

type Toast = { id: number; kind: 'success' | 'error'; text: string };
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="animate-in pointer-events-auto flex max-w-md items-center gap-2 rounded-xl bg-ink px-3.5 py-2.5 text-sm text-surface shadow-pop">
              {t.kind === 'success' ? <CircleCheck size={16} className="shrink-0" /> : <TriangleAlert size={16} className="shrink-0" />}
              <span>{t.text}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}
