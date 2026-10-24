import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseStatement } from '../src/import/parse.js';
import { parseAmount } from '../src/import/readers.js';
import { cleanMerchant, handelsbankenChannel, looksLikePersonName, revolutChannel } from '../src/import/normalize.js';

const samples = new URL('../../samples/', import.meta.url);
const HB = 'Handelsbanken_Account_Transactions_2026-10-24.xlsx';
const REV = 'account-statement_2026-10-01_2026-10-24_en-us_8fb5be.csv';

test('parses amounts in Swedish and English formats', () => {
  assert.equal(parseAmount('-1300'), -1300);
  assert.equal(parseAmount('1 234,50'), 1234.5);
  assert.equal(parseAmount('−99.00'), -99);
  assert.equal(parseAmount('2,298.26'), 2298.26);
  assert.equal(parseAmount('-851,4'), -851.4);
  assert.equal(parseAmount(''), null);
});

test('recognises Swish payments in Handelsbanken text', () => {
  for (const s of ['FACQ, ELIAS', 'YTTERMALM,GUST', 'SANDRA EJNARSS', 'Angelina Millb', 'Lovisa Farman']) {
    assert.ok(looksLikePersonName(s), s);
    assert.equal(handelsbankenChannel(s), 'swish', s);
  }
  for (const s of ['COOP LAMBOHOV', 'Ryde Sweden AB', 'Klarna', 'Hedvig', 'BENNE PASTA BO', 'Collectia AB']) {
    assert.ok(!looksLikePersonName(s), s);
  }
  assert.equal(handelsbankenChannel('Revolut**3387*'), 'topup');
  assert.equal(handelsbankenChannel('Överf Mobil'), 'transfer');
  assert.equal(cleanMerchant('FACQ, ELIAS', 'swish'), 'Elias Facq');
  assert.equal(cleanMerchant('COOP LAMBOHOV', 'other'), 'Coop');
});

test('classifies Revolut transfers to people', () => {
  assert.equal(revolutChannel('Transfer', 'Transfer to Gustav Yttermalm'), 'p2p');
  assert.equal(revolutChannel('Transfer', 'To Robo portfolio'), 'transfer');
  assert.equal(revolutChannel('Card Payment', 'Coop'), 'card');
  assert.equal(revolutChannel('Deposit', 'Apple Pay deposit by *6738'), 'topup');
});

test('parses the Handelsbanken sample', async () => {
  const s = await parseStatement(await readFile(new URL(HB, samples)), HB);
  assert.equal(s.bank, 'handelsbanken');
  assert.equal(s.accounts.length, 1);
  const a = s.accounts[0];
  assert.equal(a.externalId, '428 398 871');
  assert.deepEqual(a.balance, { asOf: '2026-10-24 13:23:00', amount: 5617.51 });
  assert.equal(a.transactions.length, 62);
  const pending = a.transactions.filter((t) => t.status === 'pending');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].merchant, 'Systembolaget');
  assert.equal(s.periodStart, '2026-09-24');
});

test('parses the Revolut sample', async () => {
  const s = await parseStatement(await readFile(new URL(REV, samples)), REV);
  assert.equal(s.bank, 'revolut');
  assert.equal(s.accounts.length, 1);
  const a = s.accounts[0];
  assert.equal(a.transactions.length, 73);
  assert.equal(a.transactions.filter((t) => t.status === 'pending').length, 2);
  assert.deepEqual(a.balance, { asOf: '2026-10-24 09:58:42', amount: 616.81 });
});
