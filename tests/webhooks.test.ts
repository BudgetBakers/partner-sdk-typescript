// The webhook verify implementation is pinned by the language-neutral vectors
// in contract-tests/fixtures/webhooksig.json (WP0.2) — sign AND verify.
// Event parsing is pinned by contract-tests/fixtures/events.json.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEvent, sign, verify } from '../src/webhooks';

const FIXTURES = resolve(import.meta.dirname, '../../../contract-tests/fixtures');

const sigFixture = JSON.parse(readFileSync(resolve(FIXTURES, 'webhooksig.json'), 'utf8')) as {
  signVectors: { name: string; secret: string; timestamp: number; body: string; expectedHeader: string }[];
  verifyVectors: { name: string; secrets: string[]; header: string; body: string; now: number; expect: string }[];
};

describe('webhooks.sign — signVectors', () => {
  for (const v of sigFixture.signVectors) {
    it(v.name, () => {
      expect(sign(v.secret, v.timestamp, Buffer.from(v.body, 'utf8'))).toBe(v.expectedHeader);
    });
  }
});

describe('webhooks.verify — verifyVectors', () => {
  for (const v of sigFixture.verifyVectors) {
    it(v.name, () => {
      expect(verify(v.secrets, v.header, Buffer.from(v.body, 'utf8'), v.now)).toBe(v.expect);
    });
  }
});

const eventsFixture = JSON.parse(readFileSync(resolve(FIXTURES, 'events.json'), 'utf8')) as {
  vectors: { name: string; body: string; expect: Record<string, unknown> }[];
};

describe('webhooks.parseEvent — event vectors', () => {
  for (const v of eventsFixture.vectors) {
    it(v.name, () => {
      const parsed = parseEvent(v.body);
      expect(parsed.kind).toBe(v.expect.kind);
      if (parsed.kind === 'event') {
        if (v.expect.type !== undefined) expect(parsed.type).toBe(v.expect.type);
        if (v.expect.eventId !== undefined) expect(parsed.eventId).toBe(v.expect.eventId);
        if (v.expect.reasonCode !== undefined) {
          expect(parsed.reason?.code ?? null).toBe(v.expect.reasonCode);
        }
        if (v.expect.extra !== undefined) {
          expect(parsed.extra).toMatchObject(v.expect.extra as Record<string, unknown>);
        }
      }
      if (parsed.kind === 'unknown' && v.expect.type !== undefined) {
        expect(parsed.type).toBe(v.expect.type);
      }
    });
  }

  it('never throws, even on garbage', () => {
    expect(parseEvent('')).toMatchObject({ kind: 'parse_error' });
    expect(parseEvent('[1,2]')).toMatchObject({ kind: 'parse_error' });
    expect(parseEvent('{"type":123}')).toMatchObject({ kind: 'unknown' });
  });
});
