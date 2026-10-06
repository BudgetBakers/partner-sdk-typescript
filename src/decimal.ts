// Money is never a float. The partner API serves amounts as decimal strings
// ("parse as decimal"): two fraction digits, or three when the third digit
// carries value ("1.005", upstream stores amounts at three-decimal
// precision). This SDK surfaces them as branded decimal STRINGS parsed
// losslessly from the wire bytes (see lossless.ts), a zero-dependency
// representation that callers can feed into the decimal library of their
// choice. The BigInt cent helpers below cover exact arithmetic without one
// and refuse sub-cent amounts rather than round them.

declare const decimalStringBrand: unique symbol;

/** Exact decimal amount as a string: two fraction digits ("1234.56", "-0.10"), three only when the third carries value ("1.005"). */
export type DecimalString = string & { readonly [decimalStringBrand]: true };

const DECIMAL_RE = /^-?\d+\.\d{2,3}$/;

/** Type guard for a canonical decimal string (2 dp, or 3 dp with a non-zero third digit). */
export function isDecimalString(value: unknown): value is DecimalString {
  return typeof value === 'string' && DECIMAL_RE.test(value) && !/\.\d\d0$/.test(value);
}

/** Normalize a decimal literal (≤3 fraction digits, no exponent) to 2 dp; a value-carrying third digit is kept. */
export function toDecimalString(literal: string): DecimalString {
  if (/[eE]/.test(literal)) {
    throw new RangeError(`amount with exponent notation is not supported: ${literal}`);
  }
  const negative = literal.startsWith('-');
  const bare = negative ? literal.slice(1) : literal;
  const [int, frac = ''] = bare.split('.');
  if (!/^\d+$/.test(int) || !/^\d*$/.test(frac) || frac.length > 3) {
    throw new RangeError(`not a valid amount literal: ${literal}`);
  }
  const fraction = frac.length === 3 && frac.endsWith('0') ? frac.slice(0, 2) : frac.padEnd(2, '0');
  return `${negative ? '-' : ''}${int}.${fraction}` as DecimalString;
}

/** "1234.56" → 123456n. Exact, sign-preserving; a sub-cent amount ("1.005") has no cent value and throws. */
export function toCents(amount: DecimalString): bigint {
  const negative = amount.startsWith('-');
  const [int, frac] = (negative ? amount.slice(1) : amount).split('.');
  if (frac.length !== 2) {
    throw new RangeError(`sub-cent amount has no exact cent value: ${amount}`);
  }
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
