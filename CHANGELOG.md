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
