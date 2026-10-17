import type { Role } from '@openinc/shared';
import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, timestamptz, updatedAt } from './columns.ts';

export const users = pgTable(
  'users',
  {
    id: pk(),
    email: text().notNull(),
    name: text().notNull(),
    passwordHash: text().notNull(),
    role: text().$type<Role>().notNull(),
    active: boolean().notNull().default(true),
    /** Encrypted with APP_SECRET. */
    totpSecret: text(),
    totpPendingSecret: text(),
    totpEnabledAt: timestamptz(),
    /** The 30-second step of the last accepted code, so a code cannot be used twice. */
    totpLastStep: integer(),
    avatarFileId: uuid(),
    failedLoginCount: integer().notNull().default(0),
    lockedUntil: timestamptz(),
    lastLoginAt: timestamptz(),
    /** Hid the dashboard's setup checklist. Per person; "Show Setup Checklist" clears it. */
    checklistDismissedAt: timestamptz(),
    passwordChangedAt: timestamptz().notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_unique').on(sql`lower(${t.email})`)],
);

export const recoveryCodes = pgTable(
  'recovery_codes',
  {
    id: pk(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text().notNull(),
    usedAt: timestamptz(),
    createdAt: createdAt(),
  },
  (t) => [index('recovery_codes_user_idx').on(t.userId)],
);

export const sessions = pgTable(
  'sessions',
  {
    /** sha256 of the cookie token; the token itself is never stored. */
    id: text().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamptz().notNull(),
    lastSeenAt: timestamptz().notNull().defaultNow(),
    ip: text(),
    userAgent: text(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const loginChallenges = pgTable('login_challenges', {
  id: text().primaryKey(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  attempts: integer().notNull().default(0),
  expiresAt: timestamptz().notNull(),
  createdAt: createdAt(),
});

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: text().primaryKey(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamptz().notNull(),
  usedAt: timestamptz(),
  createdAt: createdAt(),
});

export const invites = pgTable(
  'invites',
  {
    id: pk(),
    email: text().notNull(),
    name: text(),
    role: text().$type<Role>().notNull(),
    tokenHash: text().notNull().unique(),
    invitedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamptz().notNull(),
    lastSentAt: timestamptz().notNull().defaultNow(),
    acceptedAt: timestamptz(),
    acceptedUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamptz(),
    createdAt: createdAt(),
  },
  (t) => [index('invites_email_idx').on(sql`lower(${t.email})`)],
);
