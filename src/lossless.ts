// Lossless parsing of money-bearing JSON. JSON.parse maps every number onto
// a binary float64, silently corrupting decimal amounts (0.10 + 0.20 !==
// 0.30; values above 2^53/100 lose their last cent). This scanner rewrites
// bare number tokens in the raw text into sentinel-prefixed strings BEFORE
// JSON.parse; the reviver walk then keeps exact literals for money keys and
// converts everything else back to regular numbers.
//
// The sentinel is U+0001 — invalid as a raw character inside JSON strings, so
// a collision would require the server to deliberately emit the escape
// sequence followed by digits, which the BudgetBakers API never does.

import { toDecimalString, type DecimalString } from './decimal';

const SENTINEL = '\u0001';
// Inserted into the rewritten text as the ESCAPE SEQUENCE (raw control chars
// are invalid in JSON string literals); JSON.parse turns it back into SENTINEL.
const SENTINEL_ESCAPED = '\\u0001';
const NUMBER_RE = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/** Money fields of the partner API (spec: "parse as decimal, never float"). */
export const MONEY_KEYS: ReadonlySet<string> = new Set(['amount', 'balance']);

function quoteNumbers(text: string): string {
  let out = '';
  let inString = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += text[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      NUMBER_RE.lastIndex = i;
      const m = NUMBER_RE.exec(text);
      if (m !== null) {
        out += `"${SENTINEL_ESCAPED}${m[0]}"`;
        i += m[0].length;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

function revive(value: unknown, key: string | null): unknown {
  if (typeof value === 'string' && value.startsWith(SENTINEL)) {
    const literal = value.slice(1);
    return key !== null && MONEY_KEYS.has(key) ? toDecimalString(literal) : Number(literal);
  }
  if (Array.isArray(value)) {
    return value.map((el) => revive(el, key));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = revive(v, k);
    return out;
  }
  return value;
}

/** Parse an API response body: money keys → DecimalString, other numbers → number. */
export function parseBody(text: string): unknown {
  return revive(JSON.parse(quoteNumbers(text)), null);
}

export type { DecimalString };
