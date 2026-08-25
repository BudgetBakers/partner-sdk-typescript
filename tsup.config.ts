import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'node20',
  },
  {
    // Conformance driver (contract-tests/PROTOCOL.md) — ESM executable,
    // invoked as `node dist/conformance/cli.js <subcommand>`.
    entry: { 'conformance/cli': 'src/conformance/cli.ts' },
    format: ['esm'],
    sourcemap: true,
    target: 'node20',
  },
]);
