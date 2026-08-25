import { describe, expect, it } from 'vitest';
import { parseBody } from '../src/lossless';

describe('lossless body parsing', () => {
  it('keeps money keys as exact decimal strings, other numbers as numbers', () => {
    const parsed = parseBody(
      '{"limit":2,"data":[{"id":"t1","amount":0.10},{"id":"t2","amount":90071992547409.93}],"balance":1490.1}',
    ) as { limit: number; data: { amount: string }[]; balance: string };
    expect(parsed.limit).toBe(2);
    expect(parsed.data[0].amount).toBe('0.10');
    expect(parsed.data[1].amount).toBe('90071992547409.93');
    expect(parsed.balance).toBe('1490.10');
  });

  it('does not touch numbers inside string values', () => {
    const parsed = parseBody('{"note":"pay 12.34 today","amount":5}') as {
      note: string;
      amount: string;
    };
    expect(parsed.note).toBe('pay 12.34 today');
    expect(parsed.amount).toBe('5.00');
  });

  it('handles escaped quotes inside strings', () => {
    const parsed = parseBody('{"desc":"a \\" quote 1.5","limit":10}') as {
      desc: string;
      limit: number;
    };
    expect(parsed.desc).toBe('a " quote 1.5');
    expect(parsed.limit).toBe(10);
  });

  it('null money stays null; negative money is exact', () => {
    const parsed = parseBody('{"amount":null,"balance":-2500.00}') as {
      amount: null;
      balance: string;
    };
    expect(parsed.amount).toBeNull();
    expect(parsed.balance).toBe('-2500.00');
  });
});
