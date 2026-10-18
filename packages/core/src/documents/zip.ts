import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { and, documentFolders, documents, eq, files, inArray, isNull, lt } from '@openinc/db';
import { formatBytes } from '@openinc/shared';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import type { Ctx } from '../context.ts';
import { deleteObject, getObjectStream, uploadStream } from '../lib/storage.ts';
import { notify } from '../services/notifications.ts';

/** Formats that are compressed already; deflating them again only costs time. */
const STORED = /^(image\/(png|jpe?g|gif|webp)|application\/(zip|x-7z-compressed|gzip|vnd\.openxmlformats.*)|video\/|audio\/)/;

const KEEP_DAYS = 7;

function uniqueName(taken: Set<string>, path: string) {
  let candidate = path;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    const dot = path.lastIndexOf('.');
    candidate = dot > path.lastIndexOf('/') ? `${path.slice(0, dot)} (${n})${path.slice(dot)}` : `${path} (${n})`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

const safe = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_');

/**
 * Zips a folder of Documents (everything when folderId is null), with its subfolders, into the bucket,
 * then tells the person who asked where to download it.
 */
export async function runDocumentsZip(ctx: Ctx, { userId, folderId }: { userId: string; folderId: string | null }) {
  const folders = await ctx.db.select().from(documentFolders);
  const root = folderId ? folders.find((f) => f.id === folderId) : undefined;
  if (folderId && !root) return { fileId: null, documents: 0, missing: [], sizeBytes: 0 };

  const relative = new Map<string | null, string>([[folderId, '']]);
  for (let added = true; added; ) {
    added = false;
    for (const f of folders) {
      if (relative.has(f.id) || !relative.has(f.parentId)) continue;
      relative.set(f.id, `${relative.get(f.parentId)}${safe(f.name)}/`);
      added = true;
    }
  }

  const folderIds = [...relative.keys()].filter((id): id is string => id !== null);
  const scope = folderId ? inArray(documents.folderId, folderIds) : undefined;
  const rows = await ctx.db
    .select({ name: documents.name, folderId: documents.folderId, storageKey: files.storageKey, contentType: files.contentType })
    .from(documents)
    .innerJoin(files, eq(files.id, documents.fileId))
    .where(scope);

  const id = randomUUID();
  const storageKey = `files/documents-zip/${id.slice(0, 2)}/${id}`;
  const out = new PassThrough();
  let size = 0;
  const uploaded = uploadStream(storageKey, out, 'application/zip');
  const zip = new Zip((error, chunk, final) => {
    if (error) return out.destroy(error);
    size += chunk.length;
    out.write(chunk);
    if (final) out.end();
  });

  const taken = new Set<string>();
  for (const path of [...relative.values()].filter(Boolean).sort()) {
    const dir = new ZipPassThrough(uniqueName(taken, path));
    zip.add(dir);
    dir.push(new Uint8Array(0), true);
  }
  const missing: string[] = [];
  for (const row of rows.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = `${relative.get(row.folderId) ?? ''}${safe(row.name)}`;
    // One object gone from the bucket should not cost the person the whole zip.
    const body = await getObjectStream(row.storageKey).catch((error: { name?: string }) => {
      if (error.name !== 'NoSuchKey') throw error;
      missing.push(path);
      return null;
    });
    if (!body) continue;
    const entry = uniqueName(taken, path);
    const file = STORED.test(row.contentType) ? new ZipPassThrough(entry) : new ZipDeflate(entry, { level: 6 });
    zip.add(file);
    for await (const chunk of body) {
      file.push(chunk as Uint8Array);
      if (out.writableNeedDrain) await once(out, 'drain');
    }
    file.push(new Uint8Array(0), true);
  }
  zip.end();
  await uploaded;

  const count = rows.length - missing.length;
  const date = new Date().toISOString().slice(0, 10);
  const name = `${root ? safe(root.name) : 'Documents'} ${date}.zip`;
  await ctx.db
    .insert(files)
    .values({ id, kind: 'documents-zip', name, contentType: 'application/zip', sizeBytes: size, storageKey, uploadedBy: userId });
  await notify(ctx.db, [userId], {
    type: 'documents.zip_ready',
    title: `${name} is ready`,
    body: [
      `${count} ${count === 1 ? 'document' : 'documents'}, ${formatBytes(size)}. Click to download it; the link works for ${KEEP_DAYS} days.`,
      missing.length ? `Missing from the bucket, so left out: ${missing.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' '),
    link: `/api/files/${id}/content?download`,
  });
  return { fileId: id, documents: count, missing, sizeBytes: size };
}

/** Zips are a convenience copy; the nightly cleanup removes them from the bucket after a week. */
export async function deleteOldDocumentZips(ctx: Ctx, now = new Date()) {
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000);
  const old = await ctx.db
    .select({ id: files.id, storageKey: files.storageKey })
    .from(files)
    .where(and(eq(files.kind, 'documents-zip'), isNull(files.deletedAt), lt(files.createdAt, cutoff)));
  for (const f of old) {
    await deleteObject(f.storageKey);
    await ctx.db.update(files).set({ deletedAt: now }).where(eq(files.id, f.id));
  }
  return old.length;
}
