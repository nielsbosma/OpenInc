# Contributing

Thanks for helping. Issues and pull requests are welcome.

1. Open an issue first for anything larger than a small fix, so we can agree on the approach.
2. Set up the project as described under **Development** in the README.
3. Follow [CLAUDE.md](CLAUDE.md): logic in services, a permission on every service, audit every change, a story for every UI component, a guide entry for every page.
4. Before opening a pull request run `pnpm lint && pnpm typecheck && pnpm test`, and `pnpm test:e2e` if you touched setup, sign-in or MCP.
5. Add a line under **Unreleased** in `CHANGELOG.md` for anything a user or self-hoster would notice.

Schema changes need a migration from `pnpm db:generate`; never edit one that has been released. Security issues: please report them privately through GitHub's security advisories, not in a public issue.

By contributing you agree that your contribution is licensed under the MIT license.
