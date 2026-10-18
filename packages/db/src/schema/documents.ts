import { type AnyPgColumn, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk } from './columns.ts';
import { users } from './identity.ts';
import { files } from './platform.ts';

/** Folders in Documents. A null parent is the top level. */
export const documentFolders = pgTable(
  'document_folders',
  {
    id: pk(),
    parentId: uuid().references((): AnyPgColumn => documentFolders.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    description: text().notNull().default(''),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [unique('document_folders_name_unique').on(t.parentId, t.name).nullsNotDistinct()],
);

/** A company document: an uploaded file (kind `document`) placed in a folder, or at the top level. */
export const documents = pgTable(
  'documents',
  {
    id: pk(),
    folderId: uuid().references(() => documentFolders.id, { onDelete: 'restrict' }),
    fileId: uuid()
      .notNull()
      .unique()
      .references(() => files.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('documents_folder_idx').on(t.folderId, t.name)],
);
