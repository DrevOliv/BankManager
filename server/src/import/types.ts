import type { Channel } from './normalize.js';

export type Bank = 'handelsbanken' | 'revolut';

export interface ParsedTransaction {
  date: string; // YYYY-MM-DD, when it happened
  bookedDate: string | null;
  occurredAt: string | null; // 'YYYY-MM-DD HH:MM:SS' local time, if known
  description: string;
  merchant: string;
  amount: number; // signed, fees included
  balance: number | null;
  rawType: string | null;
  channel: Channel;
  status: 'booked' | 'pending';
  /** Stable fields identifying this row across overlapping exports (no balance/booking date). */
  keyParts: string[];
}

export interface ParsedAccount {
  externalId: string;
  name: string;
  currency: string;
  balance: { asOf: string; amount: number } | null;
  transactions: ParsedTransaction[];
}

export interface ParsedStatement {
  bank: Bank;
  accounts: ParsedAccount[];
  periodStart: string | null;
  periodEnd: string | null;
  rowsSkipped: number;
}
