import { boolean, index, integer, jsonb, pgTable, real, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, timestamptz } from './columns.ts';
import { documents } from './documents.ts';
import { users } from './identity.ts';
import { files } from './platform.ts';

/** A document sent for signature, with its recipients and fields. The file is frozen by its hash when sent. */
export const signingEnvelopes = pgTable(
  'signing_envelopes',
  {
    id: pk(),
    documentId: uuid().references(() => documents.id, { onDelete: 'set null' }),
    fileId: uuid()
      .notNull()
      .references(() => files.id, { onDelete: 'restrict' }),
    title: text().notNull(),
    message: text().notNull().default(''),
    /** draft, sent, completed, declined, voided, expired */
    status: text().notNull().default('draft'),
    /** parallel or sequential */
    routing: text().notNull().default('parallel'),
    pageCount: integer().notNull().default(1),
    documentHash: text(),
    sentAt: timestamptz(),
    expiresAt: timestamptz(),
    completedAt: timestamptz(),
    voidedAt: timestamptz(),
    voidReason: text(),
    sealedFileId: uuid().references(() => files.id, { onDelete: 'set null' }),
    sealedDocumentId: uuid().references(() => documents.id, { onDelete: 'set null' }),
    sealedHash: text(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('signing_envelopes_status_idx').on(t.status, t.createdAt), index('signing_envelopes_sealed_hash_idx').on(t.sealedHash)],
);

export const signingRecipients = pgTable(
  'signing_recipients',
  {
    id: uuid().primaryKey(),
    envelopeId: uuid()
      .notNull()
      .references(() => signingEnvelopes.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    email: text().notNull(),
    /** signer or cc */
    role: text().notNull().default('signer'),
    order: integer().notNull().default(1),
    /** waiting, sent, opened, signed, declined */
    status: text().notNull().default('waiting'),
    tokenHash: text().unique(),
    codeHash: text(),
    codeExpiresAt: timestamptz(),
    codeAttempts: integer().notNull().default(0),
    codeSentAt: timestamptz(),
    verifiedAt: timestamptz(),
    signedAt: timestamptz(),
    declinedAt: timestamptz(),
    declineReason: text(),
  },
  (t) => [index('signing_recipients_envelope_idx').on(t.envelopeId, t.order)],
);

export const signingFields = pgTable(
  'signing_fields',
  {
    id: uuid().primaryKey(),
    envelopeId: uuid()
      .notNull()
      .references(() => signingEnvelopes.id, { onDelete: 'cascade' }),
    recipientId: uuid()
      .notNull()
      .references(() => signingRecipients.id, { onDelete: 'cascade' }),
    /** signature, initials, date, name, text, checkbox */
    type: text().notNull(),
    page: integer().notNull(),
    /** Position and size as fractions of the page, from its top left corner. */
    x: real().notNull(),
    y: real().notNull(),
    width: real().notNull(),
    height: real().notNull(),
    required: boolean().notNull().default(true),
    label: text().notNull().default(''),
    value: text(),
  },
  (t) => [index('signing_fields_envelope_idx').on(t.envelopeId)],
);

/** The evidence trail of a sent envelope. Insert-only and hash-chained: each hash covers the one before it. */
export const signingEvents = pgTable(
  'signing_events',
  {
    id: pk(),
    envelopeId: uuid()
      .notNull()
      .references(() => signingEnvelopes.id, { onDelete: 'restrict' }),
    recipientId: uuid(),
    seq: integer().notNull(),
    type: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ip: text(),
    userAgent: text(),
    occurredAt: createdAt(),
    prevHash: text().notNull(),
    hash: text().notNull(),
  },
  (t) => [unique('signing_events_seq_unique').on(t.envelopeId, t.seq)],
);

/** The install's signing CA and document-sealing certificate. Private keys are encrypted with APP_SECRET. */
export const signingKeys = pgTable('signing_keys', {
  id: pk(),
  /** ca or seal */
  kind: text().notNull(),
  certificatePem: text().notNull(),
  privateKey: text().notNull(),
  fingerprint: text().notNull().unique(),
  active: boolean().notNull().default(true),
  createdAt: createdAt(),
  retiredAt: timestamptz(),
});
