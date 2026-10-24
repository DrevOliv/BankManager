import { readTable } from './readers.js';
import { isHandelsbanken, parseHandelsbanken } from './handelsbanken.js';
import { isRevolut, parseRevolut } from './revolut.js';
import type { ParsedStatement } from './types.js';
import { UserError } from '../errors.js';

/** Reads a statement file and detects which bank it came from by its columns. */
export async function parseStatement(buf: Buffer, filename: string): Promise<ParsedStatement> {
  const rows = await readTable(buf, filename);
  if (isRevolut(rows)) return parseRevolut(rows);
  if (isHandelsbanken(rows)) return parseHandelsbanken(rows);
  throw new UserError(
    `${filename}: unrecognised format. Upload a Handelsbanken export (.xlsx) or a Revolut account statement (.csv/.xlsx).`,
  );
}
