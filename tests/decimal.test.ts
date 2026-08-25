import { describe, expect, it } from 'vitest';
import { fromCents, isDecimalString, sumAmounts, toCents, toDecimalString } from '../src/decimal';

describe('DecimalString helpers', () => {
  it('normalizes literals to two fraction digits', () => {
    expect(toDecimalString('816')).toBe('816.00');
    expect(toDecimalString('1490.1')).toBe('1490.10');
    expect(toDecimalString('120450.50')).toBe('120450.50');
    expect(toDecimalString('-2500')).toBe('-2500.00');
    expect(toDecimalString('0')).toBe('0.00');
  });

  it('rejects exponents and >2 decimals', () => {
    expect(() => toDecimalString('1e2')).toThrow(RangeError);
    expect(() => toDecimalString('1.234')).toThrow(RangeError);
    expect(() => toDecimalString('abc')).toThrow(RangeError);
  });

  it('round-trips cents exactly, including the 2^53/100 trap', () => {
    const trap = toDecimalString('90071992547409.93');
    expect(toCents(trap)).toBe(9007199254740993n);
    expect(fromCents(9007199254740993n)).toBe('90071992547409.93');
    expect(toCents(toDecimalString('-0.10'))).toBe(-10n);
    expect(fromCents(-10n)).toBe('-0.10');
  });

  it('sums without float drift', () => {
    const amounts = [toDecimalString('0.10'), toDecimalString('0.20'), null];
    expect(sumAmounts(amounts)).toBe('0.30');
    expect(
      sumAmounts([toDecimalString('0.10'), toDecimalString('0.20'), toDecimalString('90071992547409.93')]),
    ).toBe('90071992547410.23');
    expect(sumAmounts([])).toBe('0.00');
  });

  it('guards the canonical shape', () => {
    expect(isDecimalString('1234.56')).toBe(true);
    expect(isDecimalString('-0.10')).toBe(true);
    expect(isDecimalString('1234.5')).toBe(false);
    expect(isDecimalString('1234')).toBe(false);
    expect(isDecimalString(1234.56)).toBe(false);
  });
});
