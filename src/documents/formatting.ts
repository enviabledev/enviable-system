import { Prisma } from '@prisma/client';

/** A money-ish value as it arrives from Prisma or a DTO. */
export type MoneyLike = Prisma.Decimal | string | number;

/**
 * Per-currency display metadata. `symbol` prefixes formatted figures; `major`
 * and `minor` name the units for the amount-in-words rendering (e.g. Naira /
 * Kobo). Currencies not listed fall back to the ISO code as the symbol and
 * generic sub-unit naming, which is correct enough for a document header while
 * staying honest about what we do not have a localised name for.
 */
interface CurrencyMeta {
  symbol: string;
  major: string;
  minor: string;
}

const CURRENCIES: Record<string, CurrencyMeta> = {
  NGN: { symbol: '₦', major: 'Naira', minor: 'Kobo' },
  USD: { symbol: '$', major: 'US Dollars', minor: 'Cents' },
  EUR: { symbol: '€', major: 'Euros', minor: 'Cents' },
  GBP: { symbol: '£', major: 'Pounds', minor: 'Pence' },
  INR: { symbol: '₹', major: 'Rupees', minor: 'Paise' },
};

export function currencyMeta(code: string): CurrencyMeta {
  const key = (code || '').toUpperCase();
  return CURRENCIES[key] ?? { symbol: key || '', major: key || 'Units', minor: 'Cents' };
}

export function toDecimal(value: MoneyLike): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

/**
 * Format money to a grouped, two-decimal string. Matches the design figures
 * (e.g. "3,280,000.00"). The amount is rounded HALF_UP to 2dp for display only;
 * the stored Decimal is the source of truth and is never mutated here.
 */
export function formatAmount(value: MoneyLike): string {
  const fixed = toDecimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
  const [whole, fraction] = fixed.split('.');
  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${fraction}`;
}

/** Format with the currency symbol and a thin separating space (e.g. "N 60,797,700.00"). */
export function formatMoney(value: MoneyLike, currencyCode: string): string {
  return `${currencyMeta(currencyCode).symbol} ${formatAmount(value)}`.trim();
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Format a date as "02 Jun 2026" (UTC, so a document renders the same date in any timezone). */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${day} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Add whole days to a date, returning a new Date (UTC arithmetic). */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** HTML-escape a plain string for safe interpolation into a triple-stache slot. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Join address lines into escaped HTML with <br/> separators, dropping blanks. */
export function addressHtml(lines: Array<string | null | undefined>): string {
  return lines
    .map((line) => (line ?? '').trim())
    .filter((line) => line.length > 0)
    .map(escapeHtml)
    .join('<br/>');
}
