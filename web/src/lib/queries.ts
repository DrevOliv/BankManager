import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from './api';
import type { AiCategorizeResult, AiStatus, Category, Overview, Periods, Rule, Settings, TransactionList, User, Account, ImportRecord } from './types';

export function useAuth() {
  return useQuery({
    queryKey: ['auth'],
    queryFn: () => api.get<{ setupRequired: boolean; user: User | null }>('/api/auth/status'),
    staleTime: Infinity,
  });
}

/** Where each "month" starts and ends (it can start on payday instead of the 1st). */
export function usePeriods(enabled = true) {
  return useQuery({ queryKey: ['periods'], queryFn: () => api.get<Periods>('/api/periods'), staleTime: 10 * 60_000, enabled });
}

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/api/categories') });
}

export function useOverview(month: string) {
  return useQuery({
    queryKey: ['overview', month],
    queryFn: () => api.get<Overview>(`/api/stats/overview?month=${month}`),
    placeholderData: (prev) => prev, // keep the previous render while the next month loads
  });
}

export interface TxFilters {
  month?: string;
  q?: string;
  category?: string;
  account?: string;
  kind?: string;
  channel?: string;
  merchant?: string;
  showTransfers?: boolean;
  limit?: number;
}

export function useTransactions(f: TxFilters) {
  return useQuery({
    queryKey: ['transactions', f],
    queryFn: () => api.get<TransactionList>(`/api/transactions${qs({ ...f })}`),
    placeholderData: (prev) => prev,
  });
}

export function useRules() {
  return useQuery({ queryKey: ['rules'], queryFn: () => api.get<Rule[]>('/api/rules') });
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/api/settings') });
}

export function useAiStatus() {
  return useQuery({ queryKey: ['ai-status'], queryFn: () => api.get<AiStatus>('/api/ai/status'), staleTime: 60_000 });
}

export function useAccounts() {
  return useQuery({ queryKey: ['accounts'], queryFn: () => api.get<{ total: number; accounts: Account[] }>('/api/accounts') });
}

export function useImports() {
  return useQuery({ queryKey: ['imports'], queryFn: () => api.get<ImportRecord[]>('/api/imports') });
}

/** Anything that changes transactions invalidates every view derived from them. */
export function useInvalidateData() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ['overview', 'transactions', 'categories', 'rules', 'accounts', 'imports', 'insights'].map((k) => qc.invalidateQueries({ queryKey: [k] })),
    );
}

export function useAiCategorize() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: () => api.post<AiCategorizeResult>('/api/ai/categorize', {}),
    onSuccess: () => invalidate(),
  });
}
