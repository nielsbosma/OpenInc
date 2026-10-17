import { randomUUID } from 'node:crypto';
import { and, eq, files, isNull } from '@openinc/db';
import { type FileKind, fileIdInput, MAX_UPLOAD_BYTES } from '@openinc/shared';
import { audit } from '../audit.ts';
import { type Ctx, can } from '../context.ts';
import { badRequest, forbidden, notFound, unauthorized } from '../errors.ts';
import { getObjectBuffer, putObject } from '../lib/storage.ts';
import { defineService } from '../service.ts';

/**
 * Every uploaded file goes to the bucket with a row here. Signing and the dataroom will build on
 * this: new kinds add their own read and write rules below.
 */

export const TEXT_TYPES = /^(text\/|application\/(json|xml|csv|x-ndjson|markdown))/;
export const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|svg\+xml)$/;
const PREVIEWABLE = /^(image\/(png|jpe?g|gif|webp)|application\/pdf|text\/plain)$/;

export function fileUrl(fileId: string) {
  return `/api/files/${fileId}/content`;
}

export function toFileDto(row: typeof files.$inferSelect) {
  return {
    id: row.id,
    kind: row.kind as FileKind,
    name: row.name,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt,
    url: fileUrl(row.id),
    previewable: PREVIEWABLE.test(row.contentType),
  };
}

function checkWrite(ctx: Ctx, kind: FileKind, contentType: string) {
  if (!ctx.actor) throw unauthorized();
  if (ctx.actor.mustEnableTwoFactor) throw forbidden('Set up two-factor authentication first');
  if (kind === 'chat-attachment' && !can(ctx, 'ai.chat')) throw forbidden();
  if (kind === 'logo' && !can(ctx, 'settings.manage')) throw forbidden();
  if (kind === 'document' && !can(ctx, 'files.write')) throw forbidden();
  if ((kind === 'registry-document' || kind === 'registry-import') && !can(ctx, 'registry.draft')) throw forbidden();
  if ((kind === 'avatar' || kind === 'logo') && !IMAGE_TYPES.test(contentType)) throw badRequest('Use a PNG, JPEG, GIF, WebP or SVG image');
}

/** Avatars and the logo are visible to everyone signed in; chat attachments to their uploader; documents need files.read. */
function checkRead(ctx: Ctx, row: typeof files.$inferSelect) {
  if (row.kind === 'logo') return;
  if (!ctx.actor) throw unauthorized();
  if (row.kind === 'avatar') return;
  if (row.kind === 'chat-attachment' && row.uploadedBy === ctx.actor.userId) return;
  if (row.kind === 'document' && can(ctx, 'files.read')) return;
  if (row.kind === 'registry-document' && can(ctx, 'registry.read')) return;
  if (row.kind === 'registry-import' && can(ctx, 'registry.draft')) return;
  throw forbidden();
}

export async function storeFile(ctx: Ctx, input: { name: string; contentType: string; kind: FileKind; data: Buffer }) {
  checkWrite(ctx, input.kind, input.contentType);
  if (input.data.length === 0) throw badRequest('The file is empty');
  if (input.data.length > MAX_UPLOAD_BYTES) throw badRequest(`Files can be at most ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  const id = randomUUID();
  const storageKey = `files/${input.kind}/${id.slice(0, 2)}/${id}`;
  await putObject(storageKey, input.data, input.contentType);
  const [row] = await ctx.db
    .insert(files)
    .values({
      id,
      kind: input.kind,
      name: input.name.slice(0, 255),
      contentType: input.contentType,
      sizeBytes: input.data.length,
      storageKey,
      uploadedBy: ctx.actor!.userId,
    })
    .returning();
  await audit(ctx, {
    action: 'files.upload',
    entityType: 'file',
    entityId: id,
    after: { kind: row!.kind, name: row!.name, contentType: row!.contentType, sizeBytes: row!.sizeBytes },
  });
  return toFileDto(row!);
}

export async function getReadableFile(ctx: Ctx, fileId: string) {
  const [row] = await ctx.db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), isNull(files.deletedAt)));
  if (!row) throw notFound('File');
  checkRead(ctx, row);
  return row;
}

export const getFile = defineService({
  name: 'files.get',
  description: "A file's name, type, size and download URL.",
  kind: 'query',
  access: 'authenticated',
  input: fileIdInput,
  handler: async (ctx, input) => toFileDto(await getReadableFile(ctx, input.fileId)),
});

export const readFileText = defineService({
  name: 'files.readText',
  description: 'Read the text of a text-based file (txt, csv, json, markdown), e.g. a chat attachment. Cut off at 100 kB.',
  kind: 'query',
  access: 'authenticated',
  input: fileIdInput,
  async handler(ctx, input) {
    const row = await getReadableFile(ctx, input.fileId);
    if (!TEXT_TYPES.test(row.contentType)) throw badRequest(`Cannot read ${row.contentType} as text`);
    const buffer = await getObjectBuffer(row.storageKey);
    const limit = 100_000;
    return { name: row.name, truncated: buffer.length > limit, text: buffer.subarray(0, limit).toString('utf8') };
  },
});
