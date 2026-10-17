import { bigint, bigserial, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, timestamptz, updatedAt } from './columns.ts';
import { users } from './identity.ts';

/** One row per settings group. Secret fields live in `secrets`, each encrypted with APP_SECRET. */
export const settings = pgTable('settings', {
  group: text().primaryKey(),
  values: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  secrets: jsonb().$type<Record<string, string>>().notNull().default({}),
  updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial({ mode: 'bigint' }).primaryKey(),
    occurredAt: timestamptz().notNull().defaultNow(),
    actorId: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** The actor's email at the time, or the surface for system actions. Survives user deletion. */
    actorLabel: text().notNull(),
    surface: text().notNull(),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text(),
    before: jsonb(),
    after: jsonb(),
    metadata: jsonb(),
  },
  (t) => [
    index('audit_log_entity_idx').on(t.entityType, t.entityId),
    index('audit_log_actor_idx').on(t.actorId),
    index('audit_log_occurred_idx').on(t.occurredAt),
    index('audit_log_action_idx').on(t.action),
  ],
);

export const files = pgTable(
  'files',
  {
    id: pk(),
    kind: text().notNull(),
    name: text().notNull(),
    contentType: text().notNull(),
    sizeBytes: bigint({ mode: 'number' }).notNull(),
    storageKey: text().notNull().unique(),
    uploadedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    deletedAt: timestamptz(),
  },
  (t) => [index('files_kind_idx').on(t.kind, t.createdAt)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text().notNull(),
    title: text().notNull(),
    body: text().notNull().default(''),
    link: text(),
    readAt: timestamptz(),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

export const chatThreads = pgTable(
  'chat_threads',
  {
    id: pk(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text().notNull().default('New chat'),
    messages: jsonb().$type<unknown[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('chat_threads_user_idx').on(t.userId, t.updatedAt)],
);

/** Backfills too slow for startup. They run as background jobs after the schema change; Admin settings shows progress. */
export const dataMigrations = pgTable('data_migrations', {
  name: text().primaryKey(),
  status: text().$type<'pending' | 'running' | 'done' | 'failed'>().notNull().default('pending'),
  done: integer().notNull().default(0),
  total: integer(),
  error: text(),
  startedAt: timestamptz(),
  finishedAt: timestamptz(),
  createdAt: createdAt(),
});
