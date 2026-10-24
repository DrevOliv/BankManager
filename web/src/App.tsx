import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { setUnauthorizedHandler } from './lib/api';
import { useAuth, usePeriods } from './lib/queries';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { AuthPage } from './pages/AuthPage';
import { OverviewPage } from './pages/OverviewPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { ImportPage } from './pages/ImportPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { SettingsPage } from './pages/SettingsPage';
import { AssistantPage } from './pages/AssistantPage';

export default function App() {
  const qc = useQueryClient();
  const auth = useAuth();
  const periods = usePeriods(!!auth.data?.user);

  useEffect(() => {
    setUnauthorizedHandler(() => qc.setQueryData(['auth'], { setupRequired: false, user: null }));
  }, [qc]);

  if (auth.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (auth.isError || !auth.data) {
    return (
      <div className="flex h-screen items-center justify-center px-6 text-center text-sm text-muted">
        Could not reach the server. Is the BankManager container running?
      </div>
    );
  }
  if (auth.data.setupRequired) return <AuthPage mode="setup" />;
  if (!auth.data.user) return <AuthPage mode="login" />;
  if (periods.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <Layout user={auth.data.user}>
      <Routes>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/transactions" element={<TransactionsPage />} />
        <Route path="/assistant" element={<AssistantPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
