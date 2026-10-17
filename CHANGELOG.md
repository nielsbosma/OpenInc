# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/) and versions follow [Semantic Versioning](https://semver.org/). Database migrations always run forward; see the README for upgrades.

## [Unreleased]

### Added

- One Docker image (web, API, MCP and job worker), configured with Postgres, an S3 bucket and `APP_SECRET`.
- Self-installing database: setup wizard with install progress, automatic migrations on start with a `pg_dump` backup to the bucket, advisory lock, refusal to run against a newer database.
- First-run wizard behind a one-time setup code: admin account, two-factor, company, email, AI and error tracking.
- Accounts: password sign-in, TOTP two-factor with recovery codes, enforceable two-factor, password reset, invites, profile images.
- Roles (Admin, Member, Read-only) and an audit log with before and after values, enforced in one service layer.
- Admin settings stored in Postgres, secrets encrypted with `APP_SECRET`, applied without a restart, pinnable by environment variables.
- App shell: navigation with placeholders for the company modules, dashboard with a setup checklist, Cmd/Ctrl+K palette, notifications, light and dark mode.
- AI assistant (Anthropic, OpenAI or any OpenAI-compatible endpoint) with attachments, using the same services and permissions as the UI.
- Remote MCP server over Streamable HTTP with OAuth 2.1, for Claude and other clients.
- Share register ledger (no screens yet): transactions are the only writes, hash-chained and immutable once committed, with corrections as reversing transactions; the register can be read as of any date or as it was recorded at any moment. Rule packs for any EU private company and for Swedish aktiebolag (personnummer and organisationsnummer checks, numbered shares, interim shares until Bolagsverket registers an issue, consent, pre-emption and post-transfer purchase clauses). Incorporation, opening balance, transfers, holder changes, new and bonus issues, splits, reverse splits, pledges. New roles Board / CEO and Auditor; optional four-eyes approval; commits over MCP off by default; a nightly hash-chain check.
- Share Register module: set up per country and legal form; the register as of any date with share numbers, votes and percentages; holder pages with their history; the transaction ledger with statuses; classes. One wizard for every transaction with steps from the rule pack, a before and after preview with the changed holders highlighted, evidence documents, and commit, park as awaiting decision or registration, or submit for approval. Exports: the register as a print-ready PDF in English or Swedish (aktiebok), XLSX and CSV for any date; the full history; holder extracts; settlement notes; everything as JSON.
