# Changelog

All notable changes to this SDK are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
SDK adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Earlier versions were distributed only as downloads from the documentation
site.

## [Unreleased]

## [0.2.1] - 2026-10-08

### Added

- Published on npm as `@budgetbakers/partner-sdk`: `npm install
  @budgetbakers/partner-sdk` replaces installing the downloaded artifact.
  Your code does not change, and the downloads stay available.
- Registry package metadata: `repository`, `homepage` and `bugs` fields,
  `LICENSE` in the tarball, and separate type declarations for CommonJS
  consumers (`dist/index.d.cts`) in `exports`.

### Changed

- README rewritten for partners: install, a worked example, webhook
  verification, runtime behavior and links to the documentation site.
- Documentation comments no longer refer to internal design notes.

The client API, webhook verification and error types are unchanged since
0.2.0.
