import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { User } from '../lib/types';
import { Logo } from '../components/Layout';
import { Button, Field, Input } from '../components/ui';

export function AuthPage({ mode }: { mode: 'setup' | 'login' }) {
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setup = mode === 'setup';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (setup && password !== confirm) return setError('The passwords do not match.');
    setBusy(true);
    try {
      const res = await api.post<{ user: User }>(setup ? '/api/auth/setup' : '/api/auth/login', { username, password });
      qc.setQueryData(['auth'], { setupRequired: false, user: res.user });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-7">
          <h1 className="text-xl font-semibold tracking-tight">{setup ? 'Welcome! Create your admin account' : 'Log in'}</h1>
          <p className="mt-1.5 text-sm text-muted">
            {setup ? 'This is the first start. The account you create here manages the app.' : 'See where your money goes.'}
          </p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field label="Username">
              <Input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={2} />
            </Field>
            <Field label="Password" hint={setup ? 'At least 8 characters.' : undefined}>
              <Input
                type="password"
                autoComplete={setup ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={setup ? 8 : undefined}
              />
            </Field>
            {setup && (
              <Field label="Repeat password">
                <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </Field>
            )}
            {error && <p className="rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
            <Button type="submit" variant="primary" className="w-full" loading={busy}>
              {setup ? 'Create account' : 'Log in'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
