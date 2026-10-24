import { query, type Db } from './db.js';

export interface Rule {
  id: number;
  pattern: string;
  match_type: 'contains' | 'word' | 'exact' | 'regex';
  direction: 'any' | 'in' | 'out';
  category_id: number;
  source: 'system' | 'user' | 'ai';
}

interface TxForRules {
  description: string;
  merchant: string;
  amount: number;
  channel: string;
}

type Matcher = (t: { haystack: string; merchant: string; description: string; amount: number }) => boolean;

interface Compiled {
  rule: Rule;
  test: Matcher;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(rule: Rule): Compiled | null {
  const p = rule.pattern.trim().toLowerCase();
  if (!p) return null;
  let textTest: (t: { haystack: string; merchant: string; description: string }) => boolean;
  switch (rule.match_type) {
    case 'exact':
      textTest = (t) => t.merchant === p || t.description === p;
      break;
    case 'word': {
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(p)}($|[^\\p{L}\\p{N}])`, 'u');
      textTest = (t) => re.test(t.haystack);
      break;
    }
    case 'regex': {
      let re: RegExp;
      try {
        re = new RegExp(rule.pattern, 'iu');
      } catch {
        return null;
      }
      textTest = (t) => re.test(t.description) || re.test(t.merchant);
      break;
    }
    default:
      textTest = (t) => t.haystack.includes(p);
  }
  const dir = rule.direction;
  return {
    rule,
    test: (t) => (dir === 'any' || (dir === 'in' ? t.amount > 0 : t.amount < 0)) && textTest(t),
  };
}

export class Categorizer {
  private user: Compiled[];
  private system: Compiled[];
  private ai: Compiled[];

  constructor(
    rules: Rule[],
    private keys: Map<string, number>,
  ) {
    // More specific (longer) patterns win within the same source: "taco" beats "bar" for "Taco Bar".
    const bySource = (s: Rule['source']) =>
      rules
        .filter((r) => r.source === s)
        .sort((a, b) => b.pattern.length - a.pattern.length || a.id - b.id)
        .map(compile)
        .filter((c): c is Compiled => c !== null);
    this.user = bySource('user');
    this.system = bySource('system');
    this.ai = bySource('ai');
  }

  static async load(db?: Db): Promise<Categorizer> {
    const rules = await query<Rule>('SELECT id, pattern, match_type, direction, category_id, source FROM rules', [], db);
    const cats = await query<{ id: number; system_key: string | null }>('SELECT id, system_key FROM categories', [], db);
    const keys = new Map<string, number>();
    for (const c of cats) if (c.system_key) keys.set(c.system_key, c.id);
    return new Categorizer(rules, keys);
  }

  key(k: string): number | null {
    return this.keys.get(k) ?? null;
  }

  /** Returns the category for a transaction, and whether it came from an AI-learned rule. */
  categorize(t: TxForRules): { categoryId: number | null; source: 'rule' | 'ai' | 'none' } {
    const description = t.description.toLowerCase();
    const merchant = t.merchant.toLowerCase();
    const input = { haystack: `${description} | ${merchant}`, description, merchant, amount: t.amount };
    const first = (list: Compiled[]) => list.find((c) => c.test(input))?.rule.category_id ?? null;

    let id = first(this.user);
    if (id) return { categoryId: id, source: 'rule' };

    // Payments to/from people: their names shouldn't trip merchant keywords.
    if (t.channel === 'swish' || t.channel === 'p2p') {
      id = this.key(t.amount < 0 ? 'swish' : 'swish_in');
      if (id) return { categoryId: id, source: 'rule' };
    }

    id = first(this.system);
    if (id) return { categoryId: id, source: 'rule' };

    const channelDefault: Record<string, string> = {
      topup: 'transfer',
      exchange: 'transfer',
      atm: 'cash',
      fee: 'bills',
      reward: 'other_income',
    };
    if (channelDefault[t.channel]) {
      id = this.key(channelDefault[t.channel]);
      if (id) return { categoryId: id, source: 'rule' };
    }

    id = first(this.ai);
    if (id) return { categoryId: id, source: 'ai' };

    return { categoryId: null, source: 'none' };
  }
}

/**
 * Re-runs the rules over transactions that weren't categorised by hand.
 * Restrict with `where` (SQL on alias t) to only touch e.g. one import's rows.
 */
export async function applyRules(db: Db, where = 'TRUE', params: unknown[] = []): Promise<number> {
  const categorizer = await Categorizer.load(db);
  const rows = await query<{ id: number; description: string; merchant: string; amount: number; channel: string; category_id: number | null; category_source: string }>(
    `SELECT t.id, t.description, t.merchant, t.amount, t.channel, t.category_id, t.category_source
       FROM transactions t
      WHERE t.category_source <> 'user'
        AND t.transfer_peer_id IS NULL
        AND (${where})`,
    params,
    db,
  );
  const changes: [number, number | null, string][] = [];
  for (const r of rows) {
    const { categoryId, source } = categorizer.categorize(r);
    if (categoryId !== r.category_id || source !== r.category_source) changes.push([r.id, categoryId, source]);
  }
  for (let i = 0; i < changes.length; i += 500) {
    const chunk = changes.slice(i, i + 500);
    await db.query(
      `UPDATE transactions t SET category_id = v.category_id, category_source = v.source
         FROM unnest($1::bigint[], $2::int[], $3::text[]) AS v(id, category_id, source)
        WHERE t.id = v.id`,
      [chunk.map((c) => c[0]), chunk.map((c) => c[1]), chunk.map((c) => c[2])],
    );
  }
  return changes.length;
}
