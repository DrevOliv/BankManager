import { one, query, tx } from './db.js';

type Kind = 'expense' | 'income' | 'savings' | 'transfer';

// [name, kind, icon (lucide name), color, system key]
const CATEGORIES: [string, Kind, string, string, string][] = [
  ['Groceries', 'expense', 'shopping-cart', '#1baf7a', 'groceries'],
  ['Restaurants & takeaway', 'expense', 'utensils', '#eb6834', 'restaurants'],
  ['Alcohol & bars', 'expense', 'wine', '#e87ba4', 'alcohol'],
  ['Transport', 'expense', 'bus', '#2a78d6', 'transport'],
  ['Housing', 'expense', 'house', '#6250d6', 'housing'],
  ['Shopping', 'expense', 'shopping-bag', '#eda100', 'shopping'],
  ['Subscriptions', 'expense', 'repeat', '#6250d6', 'subscriptions'],
  ['Bills & insurance', 'expense', 'receipt', '#898781', 'bills'],
  ['Entertainment', 'expense', 'ticket', '#e34948', 'entertainment'],
  ['Health & beauty', 'expense', 'heart-pulse', '#e34948', 'health'],
  ['Travel', 'expense', 'plane', '#2a78d6', 'travel'],
  ['Cash', 'expense', 'banknote', '#008300', 'cash'],
  ['Swish & friends', 'expense', 'send', '#1baf7a', 'swish'],
  ['Other', 'expense', 'shapes', '#898781', 'other'],
  ['Salary', 'income', 'briefcase', '#008300', 'salary'],
  ['Swish received', 'income', 'hand-coins', '#1baf7a', 'swish_in'],
  ['Other income', 'income', 'circle-plus', '#008300', 'other_income'],
  ['Savings & investments', 'savings', 'piggy-bank', '#2a78d6', 'savings'],
  ['Transfer between accounts', 'transfer', 'arrow-left-right', '#898781', 'transfer'],
];

type MatchType = 'contains' | 'word' | 'exact' | 'regex';
// [pattern, match type, direction, category key]
const RULES: [string, MatchType, 'any' | 'in' | 'out', string][] = [
  // Money moving between your own accounts.
  ['revolut**', 'contains', 'any', 'transfer'],
  ['apple pay deposit', 'contains', 'any', 'transfer'],
  ['google pay deposit', 'contains', 'any', 'transfer'],
  ['top-up', 'contains', 'any', 'transfer'],
  ['överf mobil', 'contains', 'any', 'transfer'],
  ['överföring', 'contains', 'any', 'transfer'],
  ['exchanged to', 'contains', 'any', 'transfer'],
  ['exchanged from', 'contains', 'any', 'transfer'],
  // Savings and investments.
  ['robo portfolio', 'contains', 'any', 'savings'],
  ['revolut digital assets', 'contains', 'any', 'savings'],
  ['avanza', 'contains', 'any', 'savings'],
  ['nordnet', 'contains', 'any', 'savings'],
  ['to savings', 'contains', 'any', 'savings'],
  ['savings vault', 'contains', 'any', 'savings'],
  ['lysa', 'word', 'any', 'savings'],
  // Income.
  ['lön', 'word', 'in', 'salary'],
  ['salary', 'contains', 'in', 'salary'],
  ['csn', 'word', 'in', 'other_income'],
  ['skatteverket', 'contains', 'in', 'other_income'],
  // Groceries.
  ...['ica', 'coop', 'willys', 'lidl', 'hemköp', 'hemkop', 'city gross', 'citygross', 'netto', 'tempo', 'mathem', 'matsmart', 'oob', 'öob', 'pressbyrån', '7-eleven', 'mat.se']
    .map((p): [string, MatchType, 'any', string] => [p, p.length <= 4 ? 'word' : 'contains', 'any', 'groceries']),
  // Restaurants & takeaway.
  ...["mcdonald", 'max hamburg', 'burger king', 'wolt', 'foodora', 'uber eats', 'sushi', 'pizza', 'thai', 'taco', 'kebab', 'burger',
    'pasta', 'restaurang', 'restaurant', 'café', 'cafe', 'espresso house', 'starbucks', 'subway', 'bistro', 'grill', 'falafel', 'bageri',
    'konditori', 'ramen', 'poke', 'tasty', 'kfc', 'o\'learys', 'bangers', 'kök', 'kitchen']
    .map((p): [string, MatchType, 'any', string] => [p, p.length <= 4 ? 'word' : 'contains', 'any', 'restaurants']),
  // Alcohol & bars.
  ...['systembolaget', 'systembo', 'bar', 'pub', 'nattklubb', 'nightclub', 'brewery', 'bryggeri']
    .map((p): [string, MatchType, 'any', string] => [p, p.length <= 4 ? 'word' : 'contains', 'any', 'alcohol']),
  // Transport.
  ...['östgötatraf', 'östgötatrafiken', 'skånetrafiken', 'västtrafik', 'sl', 'sj', 'ul', 'ryde', 'voi', 'tier', 'lime', 'bolt', 'uber',
    'taxi', 'circle k', 'preem', 'okq8', 'st1', 'ingo', 'easypark', 'parkering', 'flygbussarna', 'vy tåg', 'mtr', 'flixbus']
    .map((p): [string, MatchType, 'any', string] => [p, p.length <= 4 ? 'word' : 'contains', 'any', 'transport']),
  // Housing.
  ...['studentbostäde', 'studentbostäder', 'hyra', 'hsb', 'riksbyggen', 'heimstaden', 'vattenfall', 'tibber', 'e.on', 'ellevio', 'bahnhof', 'bredband']
    .map((p): [string, MatchType, 'any', string] => [p, p.length <= 4 ? 'word' : 'contains', 'any', 'housing']),
  // Shopping.
  ...['musikborsen', 'h&m', 'zara', 'clas ohlson', 'elgiganten', 'mediamarkt', 'netonnet', 'webhallen', 'inet', 'amazon', 'zalando', 'ikea',
    'jysk', 'rusta', 'biltema', 'jula', 'åhléns', 'bokus', 'adlibris', 'bokakademin', 'akademibokhandeln', 'kjell', 'dustin', 'ebay',
    'aliexpress', 'temu', 'shein', 'normal', 'lager 157', 'stadium', 'xxl', 'intersport', 'cdon', 'tradera', 'blocket', 'apotea']
    .map((p): [string, MatchType, 'any', string] => [p, p.length <= 4 ? 'word' : 'contains', 'any', 'shopping']),
  // Subscriptions & software.
  ...['claude', 'anthropic', 'openai', 'chatgpt', 'spotify', 'netflix', 'hbo', 'disney', 'viaplay', 'youtube', 'google', 'apple.com', 'itunes',
    'icloud', 'microsoft', 'adobe', 'github', 'patreon', 'discord', 'playstation', 'xbox', 'nintendo', 'storytel', 'audible']
    .map((p): [string, MatchType, 'any', string] => [p, p.length <= 4 ? 'word' : 'contains', 'any', 'subscriptions']),
  // Bills & insurance.
  ...['hedvig', 'folksam', 'trygg-hansa', 'länsförsäkringar', 'if skadeförs', 'collectia', 'intrum', 'csn', 'telia', 'tele2', 'tre', 'telenor',
    'comviq', 'hallon', 'vimla', 'klarna', 'qliro', 'resurs', 'walley', 'svea', 'sv ingenj', 'akavia', 'unionen', 'a-kassa', 'skatteverket']
    .map((p): [string, MatchType, 'out', string] => [p, p.length <= 4 ? 'word' : 'contains', 'out', 'bills']),
  // Entertainment.
  ...['biljard', 'bowling', 'filmstaden', 'sf bio', 'bio ', 'steam', 'ticketmaster', 'tickster', 'konsert', 'liseberg', 'escape']
    .map((p): [string, MatchType, 'any', string] => [p, 'contains', 'any', 'entertainment']),
  // Health & beauty.
  ...['apotek', 'apoteket', 'kronans', 'lloyds', 'gym', 'sats', 'friskis', 'actic', 'fitness24seven', 'nordic wellness', 'tandläkare',
    'folktandvården', 'vårdcentral', 'frisör', 'barber', 'kicks', 'lyko']
    .map((p): [string, MatchType, 'any', string] => [p, p.length <= 4 ? 'word' : 'contains', 'any', 'health']),
  // Travel.
  ...['sas', 'norwegian', 'ryanair', 'airbnb', 'booking.com', 'hotels.com', 'scandic', 'hotel', 'hotell', 'flyg']
    .map((p): [string, MatchType, 'any', string] => [p, p.length <= 4 ? 'word' : 'contains', 'any', 'travel']),
  // Cash.
  ...['bankomat', 'atm', 'uttag']
    .map((p): [string, MatchType, 'out', string] => [p, p.length <= 4 ? 'word' : 'contains', 'out', 'cash']),
];

/** Inserts default categories and rules on first start. */
export async function seed(): Promise<void> {
  const done = await one(`SELECT 1 FROM settings WHERE key = 'seeded'`);
  if (done) return;
  await tx(async (c) => {
    for (const [i, [name, kind, icon, color, key]] of CATEGORIES.entries()) {
      await c.query(
        `INSERT INTO categories (name, kind, icon, color, system_key, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [name, kind, icon, color, key, i * 10],
      );
    }
    const cats = await query<{ id: number; system_key: string }>('SELECT id, system_key FROM categories', [], c);
    const byKey = new Map(cats.map((r) => [r.system_key, r.id]));
    for (const [pattern, matchType, direction, key] of RULES) {
      await c.query(
        `INSERT INTO rules (pattern, match_type, direction, category_id, source) VALUES ($1, $2, $3, $4, 'system')`,
        [pattern, matchType, direction, byKey.get(key)],
      );
    }
    await c.query(`INSERT INTO settings (key, value) VALUES ('seeded', 'true')`);
  });
}
