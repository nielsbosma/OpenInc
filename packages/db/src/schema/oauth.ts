import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, timestamptz } from './columns.ts';
import { users } from './identity.ts';

/** MCP clients registered through OAuth dynamic client registration. */
export const oauthClients = pgTable('oauth_clients', {
  clientId: text().primaryKey(),
  name: text().notNull(),
  redirectUris: text().array().notNull(),
  metadata: jsonb().$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
});

export const oauthCodes = pgTable('oauth_codes', {
  id: text().primaryKey(),
  clientId: text()
    .notNull()
    .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  codeChallenge: text().notNull(),
  redirectUri: text().notNull(),
  scopes: text().array().notNull(),
  resource: text(),
  expiresAt: timestamptz().notNull(),
  createdAt: createdAt(),
});

/** One per approved connection. Tokens are stored as sha256 hashes; refresh rotates both. */
export const oauthGrants = pgTable(
  'oauth_grants',
  {
    id: text().primaryKey(),
    clientId: text()
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scopes: text().array().notNull(),
    resource: text(),
    accessTokenHash: text().notNull().unique(),
    refreshTokenHash: text().notNull().unique(),
    accessExpiresAt: timestamptz().notNull(),
    refreshExpiresAt: timestamptz().notNull(),
    lastUsedAt: timestamptz(),
    revokedAt: timestamptz(),
    createdAt: createdAt(),
  },
  (t) => [index('oauth_grants_user_idx').on(t.userId)],
);
