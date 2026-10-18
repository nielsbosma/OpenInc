import { type AnyPgColumn, boolean, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, timestamptz } from './columns.ts';
import { documents } from './documents.ts';
import { users } from './identity.ts';

/** A dataroom: a curated selection of Documents shared with outside people through links. */
export const dataRooms = pgTable('data_rooms', {
  id: pk(),
  name: text().notNull(),
  description: text().notNull().default(''),
  welcomeMessage: text().notNull().default(''),
  /** draft: only staff see it. open: links work. closed: links stop working, statistics stay. */
  status: text().notNull().default('draft'),
  ownerId: uuid().references(() => users.id, { onDelete: 'set null' }),
  defaultAllowDownload: boolean().notNull().default(false),
  defaultWatermark: boolean().notNull().default(true),
  /** Null means visitors are not asked to accept an NDA. */
  ndaText: text(),
  closesAt: timestamptz(),
  alertOnFirstVisit: boolean().notNull().default(true),
  alertOnDownload: boolean().notNull().default(true),
  alertOnFailedPasswords: boolean().notNull().default(true),
  createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

/** The room's own folder tree, independent of the folders in Documents. */
export const dataRoomFolders = pgTable(
  'data_room_folders',
  {
    id: pk(),
    roomId: uuid()
      .notNull()
      .references(() => dataRooms.id, { onDelete: 'cascade' }),
    parentId: uuid().references((): AnyPgColumn => dataRoomFolders.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    position: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [unique('data_room_folders_name_unique').on(t.roomId, t.parentId, t.name).nullsNotDistinct()],
);

/** A document placed in a room. It points at Documents, so a replaced file shows in every room at once. */
export const dataRoomItems = pgTable(
  'data_room_items',
  {
    id: pk(),
    roomId: uuid()
      .notNull()
      .references(() => dataRooms.id, { onDelete: 'cascade' }),
    folderId: uuid().references(() => dataRoomFolders.id, { onDelete: 'cascade' }),
    documentId: uuid()
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    position: integer().notNull().default(0),
    addedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    addedAt: createdAt(),
  },
  (t) => [unique('data_room_items_document_unique').on(t.roomId, t.documentId), index('data_room_items_document_idx').on(t.documentId)],
);

/** A share link and the rules for whoever opens it. The token is the URL; the password is the secret. */
export const dataRoomLinks = pgTable(
  'data_room_links',
  {
    id: pk(),
    roomId: uuid()
      .notNull()
      .references(() => dataRooms.id, { onDelete: 'cascade' }),
    label: text().notNull(),
    token: text().notNull().unique(),
    passwordHash: text(),
    allowedEmails: text().array().notNull().default([]),
    allowedDomains: text().array().notNull().default([]),
    requireEmail: boolean().notNull().default(true),
    verifyEmail: boolean().notNull().default(false),
    allowDownload: boolean().notNull().default(false),
    watermark: boolean().notNull().default(true),
    /** Null shows the whole room; otherwise only these folders and what is inside them. */
    folderIds: uuid().array(),
    expiresAt: timestamptz(),
    revokedAt: timestamptz(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('data_room_links_room_idx').on(t.roomId)],
);

/** A person who opened a room, known by the email they gave. */
export const dataRoomVisitors = pgTable(
  'data_room_visitors',
  {
    id: pk(),
    roomId: uuid()
      .notNull()
      .references(() => dataRooms.id, { onDelete: 'cascade' }),
    email: text().notNull(),
    name: text().notNull().default(''),
    company: text().notNull().default(''),
    verifiedAt: timestamptz(),
    ndaAcceptedAt: timestamptz(),
    firstSeenAt: createdAt(),
    lastSeenAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [unique('data_room_visitors_email_unique').on(t.roomId, t.email)],
);

/**
 * One visit through a link. It starts at the first gate and is open once every gate the link sets
 * has been passed (`openedAt`).
 */
export const dataRoomSessions = pgTable(
  'data_room_sessions',
  {
    id: pk(),
    linkId: uuid()
      .notNull()
      .references(() => dataRoomLinks.id, { onDelete: 'cascade' }),
    visitorId: uuid().references(() => dataRoomVisitors.id, { onDelete: 'cascade' }),
    tokenHash: text().notNull().unique(),
    codeHash: text(),
    codeExpiresAt: timestamptz(),
    codeAttempts: integer().notNull().default(0),
    emailVerifiedAt: timestamptz(),
    passwordOkAt: timestamptz(),
    openedAt: timestamptz(),
    ipAddress: text(),
    userAgent: text(),
    createdAt: createdAt(),
    expiresAt: timestamptz().notNull(),
    lastSeenAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [index('data_room_sessions_link_idx').on(t.linkId, t.createdAt)],
);

export const DATA_ROOM_EVENT_TYPES = [
  'room_opened',
  'password_failed',
  'nda_accepted',
  'document_opened',
  'page_viewed',
  'document_downloaded',
  'room_downloaded',
] as const;

/** Everything visitors do, append-only. Statistics are rolled up from here. */
export const dataRoomEvents = pgTable(
  'data_room_events',
  {
    id: pk(),
    roomId: uuid()
      .notNull()
      .references(() => dataRooms.id, { onDelete: 'cascade' }),
    linkId: uuid().references(() => dataRoomLinks.id, { onDelete: 'set null' }),
    visitorId: uuid().references(() => dataRoomVisitors.id, { onDelete: 'set null' }),
    sessionId: uuid().references(() => dataRoomSessions.id, { onDelete: 'set null' }),
    itemId: uuid().references(() => dataRoomItems.id, { onDelete: 'set null' }),
    /** Kept after the item leaves the room, so past statistics survive. No foreign key for the same reason. */
    documentId: uuid(),
    type: text().notNull(),
    page: integer(),
    pageCount: integer(),
    durationMs: integer(),
    at: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index('data_room_events_room_idx').on(t.roomId, t.at),
    index('data_room_events_document_idx').on(t.documentId, t.at),
    index('data_room_events_session_idx').on(t.sessionId, t.type),
  ],
);
