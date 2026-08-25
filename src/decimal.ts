// Money is never a float. The partner API serves amounts as JSON numbers with
// up to 2 decimals ("parse as decimal"); this SDK surfaces them as branded
// decimal STRINGS with exactly two fraction digits, parsed losslessly from
// the wire bytes (see lossless.ts) — a zero-dependency representation that
// callers can feed into the decimal library of their choice. The BigInt cent
// helpers below cover exact arithmetic without one.

declare const decimalStringBrand: unique symbol;

/** Exact decimal amount as a string, always with two fraction digits ("1234.56", "-0.10"). */
export type DecimalString = string & { readonly [decimalStringBrand]: true };

const DECIMAL_RE = /^-?\d+\.\d{2}$/;

/** Type guard for a canonical 2-dp decimal string. */
export function isDecimalString(value: unknown): value is DecimalString {
  return typeof value === 'string' && DECIMAL_RE.test(value);
}

/** Normalize a decimal literal (≤2 fraction digits, no exponent) to 2 dp. */
export function toDecimalString(literal: string): DecimalString {
  if (/[eE]/.test(literal)) {
    throw new RangeError(`amount with exponent notation is not supported: ${literal}`);
  }
  const negative = literal.startsWith('-');
  const bare = negative ? literal.slice(1) : literal;
  const [int, frac = ''] = bare.split('.');
  if (!/^\d+$/.test(int) || !/^\d*$/.test(frac) || frac.length > 2) {
    throw new RangeError(`not a valid amount literal: ${literal}`);
  }
  return `${negative ? '-' : ''}${int}.${frac.padEnd(2, '0')}` as DecimalString;
}

/** "1234.56" → 123456n. Exact, sign-preserving. */
export function toCents(amount: DecimalString): bigint {
  const negative = amount.startsWith('-');
  const [int, frac] = (negative ? amount.slice(1) : amount).split('.');
  const cents = BigInt(int) * 100n + BigInt(frac);
  return negative ? -cents : cents;
}

/** 123456n → "1234.56". */
export function fromCents(cents: bigint): DecimalString {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}` as DecimalString;
}

/** Exact sum of amounts; nulls (absent amounts) are skipped. */
export function sumAmounts(amounts: readonly (DecimalString | null)[]): DecimalString {
  let total = 0n;
  for (const a of amounts) if (a !== null) total += toCents(a);
  return fromCents(total);
}
