import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

describe('package.json (npm publish surface)', () => {
  it('ships only dist, README, LICENSE and NOTICE', () => {
    expect([...pkg.files].sort()).toEqual(['LICENSE', 'NOTICE', 'README.md', 'dist']);
    for (const f of ['LICENSE', 'NOTICE', 'README.md']) {
      expect(existsSync(join(pkgDir, f)), f).toBe(true);
    }
  });

  it('is publishable as a public scoped package', () => {
    expect(pkg.private).toBeUndefined();
    expect(pkg.name).toBe('@budgetbakers/partner-sdk');
    expect(pkg.license).toBe('Apache-2.0');
    expect(pkg.publishConfig).toMatchObject({ access: 'public' });
    expect(pkg.repository?.url).toMatch(/^git\+https:\/\//);
    expect(pkg.homepage).toMatch(/^https:\/\//);
  });

  it('resolves separate type declarations for ESM and CJS consumers', () => {
    expect(pkg.exports['.']).toEqual({
      import: { types: './dist/index.d.ts', default: './dist/index.js' },
      require: { types: './dist/index.d.cts', default: './dist/index.cjs' },
    });
  });
});
