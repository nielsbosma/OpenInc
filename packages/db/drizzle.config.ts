import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` diffs the TypeScript schema against migrations/meta. It needs no database.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  schemaFilter: ['public', 'registry', 'captable'],
  casing: 'snake_case',
});
