import { Prisma } from '@prisma/client';
import { currencyMeta, MoneyLike, toDecimal } from './formatting';

const ONES = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
];
// Indexed by group-of-three position. Covers up to just under one quadrillion,
// far beyond any realistic invoice total but cheap to carry.
const SCALES = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];

/** Convert an integer in [0, 999] to words (no leading/trailing spaces). */
function threeDigitsToWords(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest > 0) {
    if (rest < 20) {
      parts.push(ONES[rest]);
    } else {
      const tens = Math.floor(rest / 10);
      const ones = rest % 10;
      parts.push(ones > 0 ? `${TENS[tens]}-${ONES[ones]}` : TENS[tens]);
    }
  }
  return parts.join(' ');
}

/** Convert a non-negative integer to title-case words. */
export function integerToWords(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '';
  let n = Math.floor(value);
  if (n === 0) return 'Zero';

  const groups: number[] = [];
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  if (groups.length > SCALES.length) return ''; // out of supported range

  const segments: string[] = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    if (groups[i] === 0) continue;
    const words = threeDigitsToWords(groups[i]);
    segments.push(SCALES[i] ? `${words} ${SCALES[i]}` : words);
  }
  // Comma-separate the scale groups, matching the design's reference rendering
  // ("Sixty Million, Seven Hundred and Ninety-Seven Thousand, Seven Hundred").
  return segments.join(', ');
}

/**
 * Render a money amount as a currency-aware "amount in words" phrase, e.g.
 * "Sixty Million, Seven Hundred and Ninety-Seven Thousand, Seven Hundred Naira
 * Only" or, with kobo, "... Naira and Fifty Kobo Only". The minor unit is taken
 * from the two decimal places of the stored value.
 */
export function amountInWords(value: MoneyLike, currencyCode: string): string {
  const meta = currencyMeta(currencyCode);
  const rounded = toDecimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const whole = rounded.floor();
  const minorUnits = rounded.sub(whole).mul(100).round().toNumber();

  const majorWords = integerToWords(whole.toNumber());
  if (!majorWords) return '';

  let phrase = `${majorWords} ${meta.major}`;
  if (minorUnits > 0) {
    phrase += ` and ${integerToWords(minorUnits)} ${meta.minor}`;
  }
  return `${phrase} Only`;
}
