import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { LayoutDashboard, List, LogOut, Monitor, Moon, Settings, Sparkles, Sun, Tags, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { useThemePref, type ThemePref } from '../lib/theme';
import type { User } from '../lib/types';
import { cx } from './ui';

const NAV: { to: string; label: string; icon: typeof List; short?: string }[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/transactions', label: 'Transactions', icon: List, short: 'Activity' },
  { to: '/assistant', label: 'Assistant', icon: Sparkles },
  { to: '/import', label: 'Import', icon: Upload },
  { to: '/categories', label: 'Categories', icon: Tags },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="h-8 w-8" />
      <span className="text-[15px] font-semibold tracking-tight">BankManager</span>
    </div>
  );
}

function ThemeSwitch() {
  const [pref, setPref] = useThemePref();
  const options: { value: ThemePref; icon: typeof Sun; label: string }[] = [
    { value: 'light', icon: Sun, label: 'Light' },
    { value: 'system', icon: Monitor, label: 'System' },
    { value: 'dark', icon: Moon, label: 'Dark' },
  ];
  return (
    <div className="flex rounded-xl bg-surface-2 p-0.5" role="radiogroup" aria-label="Theme">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={pref === o.value}
          title={o.label}
          onClick={() => setPref(o.value)}
          className={cx('flex h-7 flex-1 items-center justify-center rounded-[10px] transition', pref === o.value ? 'bg-surface text-ink shadow-card ring-1 ring-line' : 'text-muted hover:text-ink')}
        >
          <o.icon size={14} />
        </button>
      ))}
    </div>
  );
}

export function Layout({ user, children }: { user: User; children: ReactNode }) {
  const qc = useQueryClient();
  const location = useLocation();
  const logout = async () => {
    await api.post('/api/auth/logout');
    qc.clear();
    qc.setQueryData(['auth'], { setupRequired: false, user: null });
  };
  const keepMonth = (to: string) => {
    // Carry the selected month between Overview and Transactions.
    const month = new URLSearchParams(location.search).get('month');
    return month && (to === '/' || to === '/transactions' || to === '/assistant') ? `${to}?month=${month}` : to;
  };

  return (
    <div className="min-h-screen md:pl-60">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-surface px-3 py-5 md:flex">
        <div className="px-2.5 pb-6">
          <Logo />
        </div>
        <nav className="flex flex-1 flex-col gap-0.5">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={keepMonth(n.to)}
              end={n.to === '/'}
              className={({ isActive }) =>
                cx(
                  'flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition',
                  isActive ? 'bg-accent-wash text-accent-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
                )
              }
            >
              <n.icon size={18} strokeWidth={2} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-3 px-1">
          <ThemeSwitch />
          <div className="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[13px] font-semibold text-ink-2 uppercase">
                {user.username.slice(0, 1)}
              </span>
              <span className="truncate text-sm font-medium">{user.username}</span>
            </div>
            <button onClick={logout} className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-ink" title="Log out" aria-label="Log out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface/90 px-4 backdrop-blur md:hidden">
        <Logo />
        <button onClick={logout} className="rounded-lg p-2 text-muted hover:bg-hover hover:text-ink" aria-label="Log out">
          <LogOut size={18} />
        </button>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-5 pb-28 sm:px-6 md:pt-8 md:pb-12">{children}</main>

      {/* Mobile tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={keepMonth(n.to)}
            end={n.to === '/'}
            className={({ isActive }) => cx('flex h-16 flex-col items-center justify-center gap-1 text-[10.5px] font-medium', isActive ? 'text-accent' : 'text-muted')}
          >
            <n.icon size={20} />
            {n.short ?? n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
