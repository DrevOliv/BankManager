import { FIRST_NAMES } from './firstnames.js';

export type Channel = 'card' | 'swish' | 'p2p' | 'transfer' | 'topup' | 'exchange' | 'atm' | 'fee' | 'reward' | 'other';

/** Well-known chains, so "COOP LAMBOHOV" and "Coop" group together as one merchant. */
const BRANDS: [RegExp, string][] = [
  [/^coop\b/i, 'Coop'],
  [/^ica\b/i, 'ICA'],
  [/^willys/i, 'Willys'],
  [/^lidl/i, 'Lidl'],
  [/^hemk[oö]p/i, 'Hemköp'],
  [/^city ?gross/i, 'City Gross'],
  [/^netto\b/i, 'Netto'],
  [/^(ö|oe?)ob\b/i, 'ÖoB'],
  [/systembo/i, 'Systembolaget'],
  [/pressbyr/i, 'Pressbyrån'],
  [/^7[- ]?eleven/i, '7-Eleven'],
  [/mcdonald/i, "McDonald's"],
  [/^max hamburg/i, 'Max'],
  [/^burger king/i, 'Burger King'],
  [/^espresso house/i, 'Espresso House'],
  [/^wolt\b/i, 'Wolt'],
  [/^foodora/i, 'Foodora'],
  [/^uber \*?eats/i, 'Uber Eats'],
  [/^uber\b/i, 'Uber'],
  [/^bolt\b/i, 'Bolt'],
  [/^(ab )?östgötatraf/i, 'Östgötatrafiken'],
  [/^sj\b/i, 'SJ'],
  [/^circle k/i, 'Circle K'],
  [/^studentbost/i, 'Studentbostäder'],
  [/^spotify/i, 'Spotify'],
  [/^netflix/i, 'Netflix'],
  [/^(claude|anthropic)/i, 'Claude'],
  [/^(openai|chatgpt)/i, 'OpenAI'],
  [/^apple\.com|^apple services/i, 'Apple'],
  [/^google\b/i, 'Google'],
  [/^klarna/i, 'Klarna'],
  [/^avanza/i, 'Avanza'],
  [/^sv ingenj/i, 'Sveriges Ingenjörer'],
  [/^hedvig/i, 'Hedvig'],
  [/^revolut\s*\*+/i, 'Revolut'],
  [/^to robo portfolio$/i, 'Robo portfolio'],
  [/revolut digital assets/i, 'Revolut crypto'],
  [/^apple pay deposit/i, 'Apple Pay top-up'],
  [/^google pay deposit/i, 'Google Pay top-up'],
  [/^h ?& ?m\b/i, 'H&M'],
  [/^ikea/i, 'IKEA'],
  [/^clas ohlson/i, 'Clas Ohlson'],
  [/^elgiganten/i, 'Elgiganten'],
  [/^apotek(et)?\b/i, 'Apoteket'],
];

const COMPANY_WORDS = /\b(ab|hb|kb|ltd|inc|gmbh|oy|as|aps|bv|llc|restaurang|cafe|café|bar|pizzeria|kiosk|butik|shop|store|hotell?)\b/i;

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s\-/'&.])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

const isUpper = (s: string) => s === s.toUpperCase() && /\p{L}/u.test(s);

/**
 * Handelsbanken shows Swish payments as the other person's name, truncated to ~14 chars:
 * "FACQ, ELIAS", "YTTERMALM,GUST", "SANDRA EJNARSS", "Angelina Millb".
 */
export function looksLikePersonName(text: string): boolean {
  const s = text.trim();
  if (!s || /\d|\*|@|\//.test(s) || COMPANY_WORDS.test(s)) return false;
  // "LASTNAME, FIRSTNAME" / "LASTNAME,FIRST" is how HB prints people.
  if (/^[\p{L}'\- ]+,\s?[\p{L}'\- ]+$/u.test(s)) return true;
  const words = s.split(/\s+/);
  if (words.length < 2 || words.length > 3) return false;
  return FIRST_NAMES.has(words[0].toLowerCase());
}

/** Turns "FACQ, ELIAS" into "Elias Facq" and "SANDRA EJNARSS" into "Sandra Ejnarss". */
function personDisplayName(text: string): string {
  const s = text.trim();
  const comma = s.match(/^([^,]+),\s?(.+)$/);
  const name = comma ? `${comma[2]} ${comma[1]}` : s;
  return isUpper(name) ? titleCase(name) : name;
}

export function handelsbankenChannel(text: string): Channel {
  const s = text.trim();
  if (/^swish/i.test(s)) return 'swish';
  if (/^(prel\s+)?(överf|overf|överföring|insättning|uttag\s+överf)/i.test(s)) return 'transfer';
  if (/^revolut\s*\*/i.test(s)) return 'topup';
  if (/^(bankomat|uttag)/i.test(s)) return 'atm';
  if (looksLikePersonName(stripPrel(s))) return 'swish';
  return 'other';
}

export function revolutChannel(type: string, description: string): Channel {
  const t = type.trim().toLowerCase();
  const d = description.trim();
  if (/swish/i.test(d)) return 'swish';
  if (t === 'card payment' || t === 'card refund' || t === 'kortbetalning') return 'card';
  if (t === 'topup' || t === 'top-up' || t === 'deposit' || t === 'insättning') return 'topup';
  if (t === 'exchange' || t === 'växling') return 'exchange';
  if (t === 'atm') return 'atm';
  if (t === 'fee' || t === 'charge' || t === 'avgift') return 'fee';
  if (t === 'cashback' || t === 'reward' || t === 'interest' || t === 'ränta') return 'reward';
  if (t === 'transfer' || t === 'överföring') {
    // "Transfer to Gustav Yttermalm" is a payment to a person; "To Robo portfolio" is not.
    const target = d.match(/^(?:transfer to|transfer from|payment from|to|from)\s+(.+)$/i)?.[1] ?? '';
    const isPerson = /^\p{Lu}\p{Ll}+\s+\p{Lu}/u.test(target) && !/robo|portfolio|savings|vault|pocket|revolut/i.test(target);
    return isPerson ? 'p2p' : 'transfer';
  }
  return 'other';
}

function stripPrel(s: string): string {
  return s.replace(/^prel\s+/i, '');
}

/** A short, human display name for a transaction, consistent across statements. */
export function cleanMerchant(description: string, channel: Channel): string {
  let s = stripPrel(description.trim()).replace(/\s+/g, ' ');
  for (const [re, name] of BRANDS) if (re.test(s)) return name;

  if (channel === 'swish' && looksLikePersonName(s)) return personDisplayName(s);

  const p2p = s.match(/^(?:transfer to|transfer from|payment from|to|from)\s+(.+)$/i);
  if (channel === 'p2p' && p2p) return p2p[1];

  s = s.replace(/\*+\d*\*?$/, '').replace(/\s+\d{1,4}$/, '').trim();
  if (isUpper(s)) s = titleCase(s).replace(/\bAb\b/g, 'AB');
  return s || description.trim();
}
