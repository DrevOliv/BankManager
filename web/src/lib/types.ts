export type Kind = 'expense' | 'income' | 'savings' | 'transfer';

export interface User {
  id: number;
  username: string;
  is_admin: boolean;
}

export interface Category {
  id: number;
  name: string;
  kind: Kind;
  icon: string;
  color: string;
  system_key: string | null;
  count: number;
  rule_count: number;
}

export interface Transaction {
  id: number;
  date: string;
  booked_date: string | null;
  occurred_at: string | null;
  description: string;
  merchant: string;
  amount: number;
  currency: string;
  amount_sek: number;
  status: 'booked' | 'pending';
  channel: string;
  raw_type: string | null;
  note: string | null;
  category_id: number | null;
  category_name: string | null;
  category_icon: string | null;
  category_color: string | null;
  category_source: 'none' | 'rule' | 'ai' | 'user' | 'transfer';
  kind: Kind;
  bank: string;
  account_id: number;
  account_name: string;
  transfer_peer_id: number | null;
  peer_bank: string | null;
  peer_account_name: string | null;
  peer_merchant: string | null;
}

export interface TransactionList {
  items: Transaction[];
  total: number;
  spent: number;
  income: number;
}

export interface Account {
  id: number;
  bank: string;
  name: string;
  currency: string;
  includeInBalance: boolean;
  balance: number | null;
  pending: number;
  available: number | null;
  availableSek: number | null;
  asOf: string | null;
  lastTransaction: string | null;
  transactions?: number;
  firstDate?: string | null;
  lastDate?: string | null;
}

export interface CategoryAmount {
  id: number | null;
  name: string;
  icon: string;
  color: string;
  amount: number;
  count: number;
  previous: number;
}

export interface Totals {
  spent: number;
  income: number;
  saved: number;
  count: number;
}

export interface Overview {
  month: string;
  previousMonth: string;
  currentMonth: string;
  period: { start: string; end: string; trigger: PeriodTrigger | null };
  previousPeriod: { start: string; end: string };
  monthStartDay: number;
  isCurrentMonth: boolean;
  dayOfPeriod: number;
  daysInPeriod: number;
  balances: { accounts: Account[]; total: number };
  totals: Totals;
  previousTotals: Totals;
  previousToDate: Totals;
  projectedSpent: number | null;
  budget: { amount: number; left: number; daysLeft: number; perDay: number | null } | null;
  categories: CategoryAmount[];
  income: CategoryAmount[];
  pace: { day: number; date: string; current: number | null; previous: number | null }[];
  monthly: { month: string; start: string; end: string; spent: number; income: number; saved: number; partial: boolean; inProgress: boolean }[];
  topMerchants: { merchant: string; amount: number; count: number; icon: string; category: string }[];
  uncategorized: number;
  dataSince: string | null;
  hasPreviousMonth: boolean;
}

export interface Rule {
  id: number;
  pattern: string;
  match_type: 'contains' | 'word' | 'exact' | 'regex';
  direction: 'any' | 'in' | 'out';
  category_id: number;
  source: 'system' | 'user' | 'ai';
  category_name: string;
  category_icon: string;
  category_color: string;
}

export interface ImportResult {
  ok: true;
  importId: number;
  filename: string;
  bank: string;
  accounts: string[];
  periodStart: string | null;
  periodEnd: string | null;
  total: number;
  inserted: number;
  duplicates: number;
  pendingReplaced: number;
  skipped: number;
  transfersMatched: number;
  uncategorized: number;
}

export interface ImportFailure {
  ok: false;
  filename: string;
  error: string;
}

export interface ImportRecord {
  id: number;
  filename: string;
  bank: string;
  username: string | null;
  period_start: string | null;
  period_end: string | null;
  rows_total: number;
  rows_inserted: number;
  rows_duplicate: number;
  rows_pending_replaced: number;
  transfers_matched: number;
  rows_remaining: number;
  created_at: string;
}

export interface PeriodTrigger {
  date: string;
  amount: number;
  sources: string;
}

export interface Periods {
  current: string;
  startDay: number;
  adjustToBankingDay: boolean;
  followIncome: boolean;
  periods: { key: string; start: string; end: string; trigger: PeriodTrigger | null }[];
}

export interface Settings {
  monthlyBudget: number | null;
  monthStartDay: number;
  adjustToBankingDay: boolean;
  followIncome: boolean;
  aiEnabled: boolean;
  ollamaUrl: string;
  ollamaModel: string;
  fxRates: { currency: string; rate: number }[];
}

export interface AiStatus {
  enabled: boolean;
  url: string;
  model: string;
  reachable: boolean;
  modelAvailable: boolean;
  models: string[];
  error: string | null;
}

export interface AiCategorizeResult {
  merchants: number;
  categorized: number;
  remaining: number;
  results: { merchant: string; category: string; business: string; sure: boolean }[];
}
