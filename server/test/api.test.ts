// End-to-end API test. Needs a throwaway database: TEST_DATABASE_URL=postgres://... npm test
// WARNING: it wipes the public schema of that database first.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';

const url = process.env.TEST_DATABASE_URL;
const samples = new URL('../../samples/', import.meta.url);
const HB = 'Handelsbanken_Account_Transactions_2026-10-24.xlsx';
const REV = 'account-statement_2026-10-01_2026-10-24_en-us_8fb5be.csv';

let app: FastifyInstance;
let cookie = '';
let closeDb: () => Promise<void>;

function multipart(files: { name: string; data: Buffer }[]) {
  const boundary = '----bm' + Math.random().toString(16).slice(2);
  const parts = files.flatMap((f) => [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    f.data,
    Buffer.from('\r\n'),
  ]);
  return { payload: Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function api(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) {
  const res = await app.inject({
    method,
    url: path,
    headers: { cookie, 'x-requested-with': 'bankmanager', ...(body ? { 'content-type': 'application/json' } : {}) },
    payload: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers['set-cookie'];
  if (setCookie) cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];
  return { status: res.statusCode, json: res.headers['content-type']?.includes('json') ? res.json() : res.body };
}

async function upload(names: string[]) {
  const { payload, contentType } = multipart(await Promise.all(names.map(async (n) => ({ name: n, data: await readFile(new URL(n, samples)) }))));
  const res = await app.inject({ method: 'POST', url: '/api/imports', headers: { cookie, 'content-type': contentType, 'x-requested-with': 'bankmanager' }, payload });
  assert.equal(res.statusCode, 200, res.body);
  return res.json().results;
}

before(async () => {
  if (!url) return;
  process.env.DATABASE_URL = url;
  const db = await import('../src/db.js');
  await db.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.migrate();
  await (await import('../src/seed.js')).seed();
  app = await (await import('../src/app.js')).buildApp();
  closeDb = () => db.pool.end();
});

after(async () => {
  await app?.close();
  await closeDb?.();
});

test('full flow: setup, import, dedupe, transfers, stats', { skip: !url && 'TEST_DATABASE_URL not set' }, async () => {
  let r = await api('GET', '/api/auth/status');
  assert.equal(r.json.setupRequired, true);

  r = await api('GET', '/api/transactions');
  assert.equal(r.status, 401);

  r = await api('POST', '/api/auth/setup', { username: 'oliver', password: 'correct horse' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  r = await api('POST', '/api/auth/setup', { username: 'other', password: 'correct horse' });
  assert.equal(r.status, 409);

  // Mutations without the CSRF header are refused.
  const csrf = await app.inject({ method: 'POST', url: '/api/rules/reapply', headers: { cookie } });
  assert.equal(csrf.statusCode, 403);

  const first = await upload([HB, REV]);
  assert.equal(first.length, 2);
  for (const f of first) assert.ok(f.ok, JSON.stringify(f));
  const [hb, rev] = first;
  assert.equal(hb.inserted, 62);
  assert.equal(rev.inserted, 73);
  // Revolut**3387* on Handelsbanken ↔ Apple Pay deposit on Revolut, Oct 2–23 (9 pairs in the overlap).
  assert.equal(rev.transfersMatched, 9, JSON.stringify(rev));

  // Uploading the same files again inserts nothing.
  const again = await upload([REV, HB]);
  for (const f of again) {
    assert.equal(f.inserted, 0, JSON.stringify(f));
    assert.equal(f.pendingReplaced, 0);
  }

  // Transfers are hidden from the default list but visible on request.
  r = await api('GET', '/api/transactions?month=2026-10');
  const visible = r.json.items;
  assert.ok(visible.every((t: any) => t.kind !== 'transfer'));
  assert.ok(!visible.some((t: any) => /Apple Pay|Revolut\*\*/.test(t.description)));
  r = await api('GET', '/api/transactions?month=2026-10&kind=transfer');
  const pairs = r.json.items.filter((t: any) => t.transfer_peer_id);
  assert.equal(pairs.length, 18);

  // Swish payments are categorised and flagged.
  const swish = visible.filter((t: any) => t.channel === 'swish');
  assert.ok(swish.length >= 10);
  assert.ok(swish.filter((t: any) => t.amount < 0).every((t: any) => t.category_name === 'Swish & friends'));

  // Categorisation spot checks.
  const cat = (m: string) => visible.find((t: any) => t.merchant === m)?.category_name;
  assert.equal(cat('Coop'), 'Groceries');
  assert.equal(cat('Taco Bar'), 'Restaurants & takeaway');
  assert.equal(cat('Systembolaget'), 'Alcohol & bars');
  assert.equal(cat('Studentbostäder'), 'Housing');
  assert.equal(cat('Robo portfolio'), 'Savings & investments');
  assert.equal(cat('Claude'), 'Subscriptions');

  // Overview numbers.
  r = await api('GET', '/api/stats/overview?month=2026-10');
  const o = r.json;
  const hbAcc = o.balances.accounts.find((a: any) => a.bank === 'handelsbanken');
  const revAcc = o.balances.accounts.find((a: any) => a.bank === 'revolut');
  assert.equal(hbAcc.balance, 5617.51);
  assert.equal(hbAcc.available, 5617.51 - 460.8);
  assert.equal(revAcc.available, Math.round((616.81 - 102.95 - 251.67) * 100) / 100);
  assert.ok(o.totals.spent > 0);
  assert.ok(o.categories.length > 3);
  assert.ok(o.pace.length >= 30);

  // Recategorise one merchant and remember it.
  const gull = visible.find((t: any) => t.merchant === 'Gull Olle');
  const restaurants = (await api('GET', '/api/categories')).json.find((c: any) => c.name === 'Restaurants & takeaway');
  r = await api('PATCH', `/api/transactions/${gull.id}`, { categoryId: restaurants.id, applyToMerchant: true });
  assert.equal(r.status, 200);
  assert.equal(r.json.transaction.category_name, 'Restaurants & takeaway');
  const rules = (await api('GET', '/api/rules')).json;
  assert.ok(rules.some((x: any) => x.source === 'user' && x.pattern === 'Gull Olle'));

  // Undoing an import removes its rows and un-pairs the transfers on the other side.
  const imports = (await api('GET', '/api/imports')).json;
  const hbImport = imports.find((i: any) => i.bank === 'handelsbanken' && i.rows_inserted === 62);
  r = await api('DELETE', `/api/imports/${hbImport.id}`);
  assert.equal(r.json.removed, 62);
  r = await api('GET', '/api/transactions?month=2026-10&kind=transfer');
  assert.ok(r.json.items.every((t: any) => !t.transfer_peer_id));

  // Re-import: pairs come back.
  const re = await upload([HB]);
  assert.equal(re[0].inserted, 62);
  assert.equal(re[0].transfersMatched, 9);
});
