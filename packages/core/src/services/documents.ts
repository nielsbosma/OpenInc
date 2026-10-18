import { and, asc, count, dataRoomItems, documentFolders, documents, eq, files, ilike, inArray, isNull, or, users } from '@openinc/db';
import {
  addDocumentInput,
  createFolderInput,
  documentIdInput,
  downloadZipInput,
  empty,
  folderIdInput,
  listDocumentsInput,
  moveDocumentInput,
  renameDocumentInput,
  renameFolderInput,
  searchDocumentsInput,
} from '@openinc/shared';
import { audit } from '../audit.ts';
import type { Ctx } from '../context.ts';
import { folderTemplate, type TemplateFolder, templateFolderAt } from '../documents/template.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import { enqueue } from '../jobs.ts';
import { defineService } from '../service.ts';
import { toFileDto } from './files.ts';

type FolderRow = typeof documentFolders.$inferSelect;

/** Documents rarely has more than a few hundred folders, so paths are worked out from all of them at once. */
async function folderMap(ctx: Ctx) {
  const rows = await ctx.db.select().from(documentFolders);
  return new Map(rows.map((r) => [r.id, r]));
}

function pathOf(map: Map<string, FolderRow>, folderId: string | null): FolderRow[] {
  const path: FolderRow[] = [];
  for (let id = folderId; id; id = map.get(id)?.parentId ?? null) {
    const row = map.get(id);
    if (!row) break;
    path.unshift(row);
  }
  return path;
}

const pathText = (path: FolderRow[]) => path.map((f) => f.name).join(' / ');

async function loadFolder(ctx: Ctx, folderId: string) {
  const [row] = await ctx.db.select().from(documentFolders).where(eq(documentFolders.id, folderId));
  if (!row) throw notFound('Folder');
  return row;
}

async function loadDocument(ctx: Ctx, documentId: string) {
  const [row] = await ctx.db.select().from(documents).where(eq(documents.id, documentId));
  if (!row) throw notFound('Document');
  return row;
}

async function assertFreeName(ctx: Ctx, parentId: string | null, name: string, exceptId?: string) {
  const siblings = await ctx.db
    .select({ id: documentFolders.id, name: documentFolders.name })
    .from(documentFolders)
    .where(parentId ? eq(documentFolders.parentId, parentId) : isNull(documentFolders.parentId));
  if (siblings.some((s) => s.id !== exceptId && s.name.toLowerCase() === name.toLowerCase()))
    throw conflict(`There is already a folder called ${name} here`);
}

function documentRows(ctx: Ctx) {
  return ctx.db
    .select({ document: documents, file: files, uploadedByName: users.name })
    .from(documents)
    .innerJoin(files, eq(files.id, documents.fileId))
    .leftJoin(users, eq(users.id, documents.createdBy));
}

/** How many datarooms each document is in, for the badge in the list. */
async function roomCounts(ctx: Ctx, documentIds: string[]) {
  if (!documentIds.length) return new Map<string, number>();
  const rows = await ctx.db
    .select({ documentId: dataRoomItems.documentId, value: count() })
    .from(dataRoomItems)
    .where(inArray(dataRoomItems.documentId, documentIds))
    .groupBy(dataRoomItems.documentId);
  return new Map(rows.map((r) => [r.documentId, r.value]));
}

function toDocumentDto(
  row: { document: typeof documents.$inferSelect; file: typeof files.$inferSelect; uploadedByName: string | null },
  rooms = new Map<string, number>(),
) {
  const file = toFileDto(row.file);
  return {
    id: row.document.id,
    name: row.document.name,
    folderId: row.document.folderId,
    fileId: file.id,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    url: file.url,
    previewable: file.previewable,
    uploadedBy: row.uploadedByName,
    createdAt: row.document.createdAt,
    dataroomCount: rooms.get(row.document.id) ?? 0,
  };
}

export const listDocuments = defineService({
  name: 'documents.list',
  description:
    'List one folder in Documents, the company document store: its subfolders (with how many documents and folders each holds), its documents with download URLs, and the path to it. Leave folderId out for the top level. When Documents is completely empty, `suggestTemplate` is true and documents.template has the suggested structure.',
  kind: 'query',
  access: 'files.read',
  input: listDocumentsInput,
  async handler(ctx, input) {
    const map = await folderMap(ctx);
    const folderId = input.folderId ?? null;
    if (folderId && !map.has(folderId)) throw notFound('Folder');
    const path = pathOf(map, folderId);
    const docs = await documentRows(ctx)
      .where(folderId ? eq(documents.folderId, folderId) : isNull(documents.folderId))
      .orderBy(asc(documents.name));
    const allDocs = await ctx.db.select({ folderId: documents.folderId }).from(documents);
    const docCount = new Map<string | null, number>();
    for (const d of allDocs) docCount.set(d.folderId, (docCount.get(d.folderId) ?? 0) + 1);
    const children = [...map.values()].filter((f) => f.parentId === folderId).sort((a, b) => a.name.localeCompare(b.name));
    const rooms = await roomCounts(
      ctx,
      docs.map((d) => d.document.id),
    );
    const hints = folderId && docs.length === 0 ? (templateFolderAt(path.map((f) => f.name))?.documents ?? []) : [];
    return {
      folder: folderId ? { id: folderId, name: map.get(folderId)!.name, description: map.get(folderId)!.description } : null,
      path: path.map((f) => ({ id: f.id, name: f.name })),
      folders: children.map((f) => ({
        id: f.id,
        name: f.name,
        description: f.description,
        documentCount: docCount.get(f.id) ?? 0,
        folderCount: [...map.values()].filter((c) => c.parentId === f.id).length,
      })),
      documents: docs.map((d) => toDocumentDto(d, rooms)),
      hints,
      suggestTemplate: map.size === 0 && allDocs.length === 0,
    };
  },
});

export const listFolders = defineService({
  name: 'documents.folders',
  description: 'Every folder in Documents with its full path, e.g. "Governance / Board Meetings". Use it to find a folderId.',
  kind: 'query',
  access: 'files.read',
  input: empty,
  async handler(ctx) {
    const map = await folderMap(ctx);
    return [...map.values()]
      .map((f) => ({ id: f.id, name: f.name, path: pathText(pathOf(map, f.id)) }))
      .sort((a, b) => a.path.localeCompare(b.path));
  },
});

export const documentsTemplate = defineService({
  name: 'documents.template',
  description:
    'The suggested folder structure for company documents (corporate, governance, ownership, finance, legal, people, IP, fundraising), with the documents that usually belong in each folder. Create it with documents.applyTemplate.',
  kind: 'query',
  access: 'files.read',
  input: empty,
  handler: async () => ({ folders: folderTemplate() }),
});

export const applyDocumentsTemplate = defineService({
  name: 'documents.applyTemplate',
  description:
    'Create the suggested folder structure (see documents.template) in Documents. Folders that already exist with the same name are kept, so it is safe to run again.',
  kind: 'mutation',
  access: 'files.write',
  input: empty,
  async handler(ctx) {
    const existing = await ctx.db.select().from(documentFolders);
    const created: string[] = [];
    const walk = async (folders: TemplateFolder[], parentId: string | null, at: string) => {
      for (const t of folders) {
        let row = existing.find((e) => e.parentId === parentId && e.name.toLowerCase() === t.name.toLowerCase());
        if (!row) {
          [row] = await ctx.db
            .insert(documentFolders)
            .values({ parentId, name: t.name, description: t.description, createdBy: ctx.actor!.userId })
            .returning();
          created.push(`${at}${t.name}`);
        }
        await walk(t.folders, row!.id, `${at}${t.name} / `);
      }
    };
    await walk(folderTemplate(), null, '');
    if (created.length) await audit(ctx, { action: 'documents.template_apply', entityType: 'document_folder', after: { created } });
    return { created: created.length };
  },
});

export const createFolder = defineService({
  name: 'documents.createFolder',
  description: 'Create a folder in Documents, at the top level or inside parentId.',
  kind: 'mutation',
  access: 'files.write',
  input: createFolderInput,
  async handler(ctx, input) {
    const parentId = input.parentId ?? null;
    if (parentId) await loadFolder(ctx, parentId);
    await assertFreeName(ctx, parentId, input.name);
    const [row] = await ctx.db
      .insert(documentFolders)
      .values({ parentId, name: input.name, description: input.description, createdBy: ctx.actor!.userId })
      .returning();
    await audit(ctx, {
      action: 'documents.folder_create',
      entityType: 'document_folder',
      entityId: row!.id,
      after: { parentId, name: row!.name },
    });
    return { id: row!.id, name: row!.name };
  },
});

export const renameFolder = defineService({
  name: 'documents.renameFolder',
  description: 'Rename a folder in Documents.',
  kind: 'mutation',
  access: 'files.write',
  input: renameFolderInput,
  async handler(ctx, input) {
    const before = await loadFolder(ctx, input.folderId);
    await assertFreeName(ctx, before.parentId, input.name, before.id);
    await ctx.db.update(documentFolders).set({ name: input.name }).where(eq(documentFolders.id, before.id));
    await audit(ctx, {
      action: 'documents.folder_rename',
      entityType: 'document_folder',
      entityId: before.id,
      before: { name: before.name },
      after: { name: input.name },
    });
    return { id: before.id, name: input.name };
  },
});

export const deleteFolder = defineService({
  name: 'documents.deleteFolder',
  description: 'Delete an empty folder in Documents. Move or delete its documents and subfolders first.',
  kind: 'mutation',
  access: 'files.write',
  input: folderIdInput,
  async handler(ctx, input) {
    const row = await loadFolder(ctx, input.folderId);
    const [child] = await ctx.db
      .select({ id: documentFolders.id })
      .from(documentFolders)
      .where(eq(documentFolders.parentId, row.id))
      .limit(1);
    const [doc] = await ctx.db.select({ id: documents.id }).from(documents).where(eq(documents.folderId, row.id)).limit(1);
    if (child || doc) throw conflict(`${row.name} is not empty. Move or delete what is inside it first.`);
    await ctx.db.delete(documentFolders).where(eq(documentFolders.id, row.id));
    await audit(ctx, { action: 'documents.folder_delete', entityType: 'document_folder', entityId: row.id, before: { name: row.name } });
    return { ok: true };
  },
});

export const addDocument = defineService({
  name: 'documents.add',
  description:
    'Put an uploaded file into Documents, in folderId or at the top level. Upload it first with kind "document" (POST /api/files?kind=document); this files it.',
  kind: 'mutation',
  access: 'files.write',
  input: addDocumentInput,
  async handler(ctx, input) {
    if (input.folderId) await loadFolder(ctx, input.folderId);
    const [file] = await ctx.db
      .select()
      .from(files)
      .where(and(eq(files.id, input.fileId), isNull(files.deletedAt)));
    if (!file) throw notFound('File');
    if (file.kind !== 'document') throw badRequest('Upload the file as a document');
    const [already] = await ctx.db.select({ id: documents.id }).from(documents).where(eq(documents.fileId, file.id));
    if (already) throw conflict('That file is already in Documents');
    const [row] = await ctx.db
      .insert(documents)
      .values({ folderId: input.folderId ?? null, fileId: file.id, name: file.name, createdBy: ctx.actor!.userId })
      .returning();
    await audit(ctx, {
      action: 'documents.add',
      entityType: 'document',
      entityId: row!.id,
      after: { name: row!.name, folderId: row!.folderId, fileId: file.id, sizeBytes: file.sizeBytes },
    });
    return { id: row!.id, name: row!.name };
  },
});

export const renameDocument = defineService({
  name: 'documents.rename',
  description: 'Rename a document in Documents.',
  kind: 'mutation',
  access: 'files.write',
  input: renameDocumentInput,
  async handler(ctx, input) {
    const before = await loadDocument(ctx, input.documentId);
    await ctx.db.update(documents).set({ name: input.name }).where(eq(documents.id, before.id));
    await audit(ctx, {
      action: 'documents.rename',
      entityType: 'document',
      entityId: before.id,
      before: { name: before.name },
      after: { name: input.name },
    });
    return { id: before.id, name: input.name };
  },
});

export const moveDocument = defineService({
  name: 'documents.move',
  description: 'Move a document to another folder in Documents. A null folderId moves it to the top level.',
  kind: 'mutation',
  access: 'files.write',
  input: moveDocumentInput,
  async handler(ctx, input) {
    const before = await loadDocument(ctx, input.documentId);
    if (input.folderId) await loadFolder(ctx, input.folderId);
    await ctx.db.update(documents).set({ folderId: input.folderId }).where(eq(documents.id, before.id));
    await audit(ctx, {
      action: 'documents.move',
      entityType: 'document',
      entityId: before.id,
      before: { folderId: before.folderId },
      after: { folderId: input.folderId },
    });
    return { id: before.id, folderId: input.folderId };
  },
});

export const deleteDocument = defineService({
  name: 'documents.delete',
  description:
    'Delete a document from Documents. The file is marked deleted and can no longer be downloaded, and it leaves every dataroom it was in (see dataroom.roomsForDocument).',
  kind: 'mutation',
  access: 'files.write',
  input: documentIdInput,
  async handler(ctx, input) {
    const row = await loadDocument(ctx, input.documentId);
    await ctx.db.delete(documents).where(eq(documents.id, row.id));
    await ctx.db.update(files).set({ deletedAt: new Date() }).where(eq(files.id, row.fileId));
    await audit(ctx, {
      action: 'documents.delete',
      entityType: 'document',
      entityId: row.id,
      before: { name: row.name, folderId: row.folderId, fileId: row.fileId },
    });
    return { ok: true };
  },
});

export const searchDocuments = defineService({
  name: 'documents.search',
  description:
    'Find documents in Documents whose name or folder name contains the query. Returns each with its folder path and download URL.',
  kind: 'query',
  access: 'files.read',
  input: searchDocumentsInput,
  async handler(ctx, input) {
    const map = await folderMap(ctx);
    const pattern = `%${input.query.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = await documentRows(ctx)
      .leftJoin(documentFolders, eq(documentFolders.id, documents.folderId))
      .where(or(ilike(documents.name, pattern), ilike(documentFolders.name, pattern)))
      .orderBy(asc(documents.name))
      .limit(50);
    const rooms = await roomCounts(
      ctx,
      rows.map((r) => r.document.id),
    );
    return rows.map((r) => ({ ...toDocumentDto(r, rooms), folderPath: pathText(pathOf(map, r.document.folderId)) }));
  },
});

export const downloadZip = defineService({
  name: 'documents.downloadZip',
  description:
    'Start a background job that zips a folder of Documents with all its subfolders (everything when folderId is left out). The caller gets a notification with the download link when it is ready; the zip is kept for 7 days.',
  kind: 'mutation',
  access: 'files.read',
  input: downloadZipInput,
  async handler(ctx, input) {
    const folder = input.folderId ? await loadFolder(ctx, input.folderId) : null;
    const jobId = await enqueue('documents.zip', { userId: ctx.actor!.userId, folderId: folder?.id ?? null });
    await audit(ctx, {
      action: 'documents.zip_request',
      entityType: 'document_folder',
      entityId: folder?.id,
      metadata: { jobId, folder: folder?.name ?? 'Documents' },
    });
    return { jobId };
  },
});
