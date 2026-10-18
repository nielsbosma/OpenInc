import {
  and,
  asc,
  count,
  dataRoomEvents,
  dataRoomFolders,
  dataRoomItems,
  dataRoomLinks,
  dataRooms,
  dataRoomVisitors,
  desc,
  documentFolders,
  documents,
  eq,
  files,
  inArray,
  isNull,
  max,
  users,
} from '@openinc/db';
import {
  addRoomDocumentsInput,
  createLinkInput,
  createRoomFolderInput,
  createRoomInput,
  type DataRoomStatus,
  empty,
  linkIdInput,
  moveRoomItemInput,
  renameRoomFolderInput,
  roomDocumentStatsInput,
  roomFolderIdInput,
  roomIdInput,
  roomItemIdInput,
  roomStatsInput,
  roomsForDocumentInput,
  roomVisitorInput,
  updateLinkInput,
  updateRoomInput,
} from '@openinc/shared';
import { audit, diff } from '../audit.ts';
import type { Ctx } from '../context.ts';
import { daily, overview, perDocument, perPage, perVisitor, type StatsEvent } from '../dataroom/stats.ts';
import { roomTemplates } from '../dataroom/templates.ts';
import { appUrl } from '../env.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import { randomToken } from '../lib/crypto.ts';
import { hashPassword } from '../lib/password.ts';
import { defineService } from '../service.ts';
import { getSettings } from '../settings.ts';
import { toFileDto } from './files.ts';

type RoomRow = typeof dataRooms.$inferSelect;
type LinkRow = typeof dataRoomLinks.$inferSelect;

export const portalUrl = (token: string) => `${appUrl()}/r/${token}`;

async function loadRoom(ctx: Ctx, roomId: string) {
  const [row] = await ctx.db.select().from(dataRooms).where(eq(dataRooms.id, roomId));
  if (!row) throw notFound('Dataroom');
  return row;
}

async function loadRoomFolder(ctx: Ctx, folderId: string, roomId?: string) {
  const [row] = await ctx.db.select().from(dataRoomFolders).where(eq(dataRoomFolders.id, folderId));
  if (!row || (roomId && row.roomId !== roomId)) throw notFound('Folder');
  return row;
}

async function loadItem(ctx: Ctx, itemId: string) {
  const [row] = await ctx.db.select().from(dataRoomItems).where(eq(dataRoomItems.id, itemId));
  if (!row) throw notFound('Document in the dataroom');
  return row;
}

async function loadLink(ctx: Ctx, linkId: string) {
  const [row] = await ctx.db.select().from(dataRoomLinks).where(eq(dataRoomLinks.id, linkId));
  if (!row) throw notFound('Link');
  return row;
}

export function linkStatus(link: Pick<LinkRow, 'revokedAt' | 'expiresAt'>, now = new Date()) {
  if (link.revokedAt) return 'revoked' as const;
  if (link.expiresAt && link.expiresAt <= now) return 'expired' as const;
  return 'active' as const;
}

/** Whether a room's links work right now. */
export function roomIsLive(room: Pick<RoomRow, 'status' | 'closesAt'>, now = new Date()) {
  return room.status === 'open' && (!room.closesAt || room.closesAt > now);
}

async function assertFreeFolderName(ctx: Ctx, roomId: string, parentId: string | null, name: string, exceptId?: string) {
  const siblings = await ctx.db
    .select({ id: dataRoomFolders.id, name: dataRoomFolders.name })
    .from(dataRoomFolders)
    .where(and(eq(dataRoomFolders.roomId, roomId), parentId ? eq(dataRoomFolders.parentId, parentId) : isNull(dataRoomFolders.parentId)));
  if (siblings.some((s) => s.id !== exceptId && s.name.toLowerCase() === name.toLowerCase()))
    throw conflict(`There is already a folder called ${name} here`);
}

async function nextPosition(ctx: Ctx, roomId: string, folderId: string | null) {
  const [row] = await ctx.db
    .select({ value: max(dataRoomItems.position) })
    .from(dataRoomItems)
    .where(and(eq(dataRoomItems.roomId, roomId), folderId ? eq(dataRoomItems.folderId, folderId) : isNull(dataRoomItems.folderId)));
  return (row?.value ?? -1) + 1;
}

async function assertRoomFolders(ctx: Ctx, roomId: string, folderIds: string[] | null | undefined) {
  if (!folderIds?.length) return;
  const rows = await ctx.db
    .select({ id: dataRoomFolders.id })
    .from(dataRoomFolders)
    .where(and(eq(dataRoomFolders.roomId, roomId), inArray(dataRoomFolders.id, folderIds)));
  if (rows.length !== new Set(folderIds).size) throw badRequest('Pick folders from this dataroom');
}

async function assertVerifiable(input: { verifyEmail?: boolean; requireEmail?: boolean }) {
  if (!input.verifyEmail) return;
  if (input.requireEmail === false) throw badRequest('Verifying the email needs Require Email on');
  if (!(await getSettings('email'))) throw badRequest('Set up email under Settings → Email before turning on email verification');
}

function toLinkDto(link: LinkRow, usage?: { visitors: number; lastUsedAt: Date | null; failedPasswords: number }) {
  return {
    id: link.id,
    roomId: link.roomId,
    label: link.label,
    url: portalUrl(link.token),
    hasPassword: !!link.passwordHash,
    allowedEmails: link.allowedEmails,
    allowedDomains: link.allowedDomains,
    requireEmail: link.requireEmail,
    verifyEmail: link.verifyEmail,
    allowDownload: link.allowDownload,
    watermark: link.watermark,
    folderIds: link.folderIds,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    status: linkStatus(link),
    createdAt: link.createdAt,
    visitors: usage?.visitors ?? 0,
    lastUsedAt: usage?.lastUsedAt ?? null,
    failedPasswords: usage?.failedPasswords ?? 0,
  };
}

/** What audit entries show of a link: its rules, never the token or the password. */
function linkAudit(link: LinkRow) {
  const { token: _token, passwordHash, ...rest } = link;
  return { ...rest, hasPassword: !!passwordHash };
}

async function roomEvents(ctx: Ctx, roomId: string, range: { from?: string; to?: string } = {}): Promise<StatsEvent[]> {
  const rows = await ctx.db
    .select({
      type: dataRoomEvents.type,
      visitorId: dataRoomEvents.visitorId,
      sessionId: dataRoomEvents.sessionId,
      linkId: dataRoomEvents.linkId,
      documentId: dataRoomEvents.documentId,
      page: dataRoomEvents.page,
      pageCount: dataRoomEvents.pageCount,
      durationMs: dataRoomEvents.durationMs,
      at: dataRoomEvents.at,
    })
    .from(dataRoomEvents)
    .where(eq(dataRoomEvents.roomId, roomId))
    .orderBy(asc(dataRoomEvents.at));
  const from = range.from ? new Date(range.from) : null;
  const to = range.to ? new Date(range.to) : null;
  return rows.filter((e) => (!from || e.at >= from) && (!to || e.at <= to));
}

/** Names of documents that have events, including ones removed from the room or from Documents since. */
async function documentNames(ctx: Ctx, documentIds: string[]) {
  if (!documentIds.length) return new Map<string, string>();
  const rows = await ctx.db.select({ id: documents.id, name: documents.name }).from(documents).where(inArray(documents.id, documentIds));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export const listRooms = defineService({
  name: 'dataroom.list',
  description:
    'List every dataroom: name, status (draft, open or closed), how many documents, active links and visitors it has, and when a visitor was last active. Use it to find a roomId.',
  kind: 'query',
  access: 'dataroom.read',
  input: empty,
  async handler(ctx) {
    const rooms = await ctx.db
      .select({ room: dataRooms, ownerName: users.name })
      .from(dataRooms)
      .leftJoin(users, eq(users.id, dataRooms.ownerId))
      .orderBy(desc(dataRooms.createdAt));
    const [items, links, visitors, activity] = await Promise.all([
      ctx.db.select({ roomId: dataRoomItems.roomId, value: count() }).from(dataRoomItems).groupBy(dataRoomItems.roomId),
      ctx.db.select().from(dataRoomLinks),
      ctx.db.select({ roomId: dataRoomVisitors.roomId, value: count() }).from(dataRoomVisitors).groupBy(dataRoomVisitors.roomId),
      ctx.db
        .select({ roomId: dataRoomEvents.roomId, value: max(dataRoomEvents.at) })
        .from(dataRoomEvents)
        .groupBy(dataRoomEvents.roomId),
    ]);
    const by = <T extends { roomId: string }>(rows: T[]) => new Map(rows.map((r) => [r.roomId, r]));
    const itemCount = by(items);
    const visitorCount = by(visitors);
    const last = by(activity);
    return rooms.map(({ room, ownerName }) => ({
      id: room.id,
      name: room.name,
      description: room.description,
      status: room.status as DataRoomStatus,
      live: roomIsLive(room),
      closesAt: room.closesAt,
      ownerName,
      documentCount: itemCount.get(room.id)?.value ?? 0,
      linkCount: links.filter((l) => l.roomId === room.id && linkStatus(l) === 'active').length,
      visitorCount: visitorCount.get(room.id)?.value ?? 0,
      lastActivityAt: last.get(room.id)?.value ?? null,
      createdAt: room.createdAt,
    }));
  },
});

export const getRoom = defineService({
  name: 'dataroom.get',
  description:
    "One dataroom with its settings, its folder tree and the documents in it (each with the item id, the document id in Documents and a staff download URL). Folders and documents are flat lists ordered by position; folderId null is the room's top level.",
  kind: 'query',
  access: 'dataroom.read',
  input: roomIdInput,
  async handler(ctx, input) {
    const room = await loadRoom(ctx, input.roomId);
    const [owner] = room.ownerId ? await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, room.ownerId)) : [];
    const folders = await ctx.db
      .select()
      .from(dataRoomFolders)
      .where(eq(dataRoomFolders.roomId, room.id))
      .orderBy(asc(dataRoomFolders.position), asc(dataRoomFolders.name));
    const items = await ctx.db
      .select({ item: dataRoomItems, document: documents, file: files })
      .from(dataRoomItems)
      .innerJoin(documents, eq(documents.id, dataRoomItems.documentId))
      .innerJoin(files, eq(files.id, documents.fileId))
      .where(eq(dataRoomItems.roomId, room.id))
      .orderBy(asc(dataRoomItems.position), asc(documents.name));
    return {
      id: room.id,
      name: room.name,
      description: room.description,
      welcomeMessage: room.welcomeMessage,
      status: room.status as DataRoomStatus,
      live: roomIsLive(room),
      ownerName: owner?.name ?? null,
      ndaText: room.ndaText,
      closesAt: room.closesAt,
      defaultAllowDownload: room.defaultAllowDownload,
      defaultWatermark: room.defaultWatermark,
      alertOnFirstVisit: room.alertOnFirstVisit,
      alertOnDownload: room.alertOnDownload,
      alertOnFailedPasswords: room.alertOnFailedPasswords,
      createdAt: room.createdAt,
      folders: folders.map((f) => ({ id: f.id, parentId: f.parentId, name: f.name, position: f.position })),
      items: items.map(({ item, document, file }) => {
        const dto = toFileDto(file);
        return {
          id: item.id,
          folderId: item.folderId,
          position: item.position,
          documentId: document.id,
          name: document.name,
          contentType: dto.contentType,
          sizeBytes: dto.sizeBytes,
          url: dto.url,
          previewable: dto.previewable,
          addedAt: item.addedAt,
        };
      }),
    };
  },
});

export const listRoomTemplates = defineService({
  name: 'dataroom.templates',
  description:
    'Starting structures for a new dataroom (seed round, Series A due diligence, bank), each with its folders and the Documents folders whose documents it pulls in. Pass the key to dataroom.create.',
  kind: 'query',
  access: 'dataroom.read',
  input: empty,
  handler: async () => roomTemplates(),
});

export const roomsForDocument = defineService({
  name: 'dataroom.roomsForDocument',
  description: 'Which datarooms a document from Documents is in.',
  kind: 'query',
  access: 'dataroom.read',
  input: roomsForDocumentInput,
  async handler(ctx, input) {
    return ctx.db
      .select({ roomId: dataRooms.id, name: dataRooms.name, status: dataRooms.status, itemId: dataRoomItems.id })
      .from(dataRoomItems)
      .innerJoin(dataRooms, eq(dataRooms.id, dataRoomItems.roomId))
      .where(eq(dataRoomItems.documentId, input.documentId))
      .orderBy(asc(dataRooms.name));
  },
});

export const createRoom = defineService({
  name: 'dataroom.create',
  description:
    'Create a dataroom as a draft. With a template key (see dataroom.templates) it gets that folder structure and the documents already in the matching Documents folders. Nobody outside can open it until it is opened (dataroom.open) and has a link (dataroom.createLink).',
  kind: 'mutation',
  access: 'dataroom.manage',
  input: createRoomInput,
  async handler(ctx, input) {
    const template = input.template ? roomTemplates().find((t) => t.key === input.template) : undefined;
    if (input.template && !template) throw badRequest(`There is no template called ${input.template}`);
    const [room] = await ctx.db
      .insert(dataRooms)
      .values({ name: input.name, description: input.description, ownerId: ctx.actor!.userId, createdBy: ctx.actor!.userId })
      .returning();
    let added = 0;
    if (template) {
      const allFolders = await ctx.db.select().from(documentFolders);
      const byPath = new Map<string, string>();
      const pathOf = (id: string | null): string => {
        const f = allFolders.find((x) => x.id === id);
        return f ? (f.parentId ? `${pathOf(f.parentId)} / ${f.name}` : f.name).toLowerCase() : '';
      };
      for (const f of allFolders) byPath.set(pathOf(f.id), f.id);
      for (const [position, t] of template.folders.entries()) {
        const [folder] = await ctx.db.insert(dataRoomFolders).values({ roomId: room!.id, name: t.name, position }).returning();
        const sources = t.from.map((p) => byPath.get(p.toLowerCase())).filter((id): id is string => !!id);
        if (!sources.length) continue;
        const docs = await ctx.db
          .select({ id: documents.id })
          .from(documents)
          .where(inArray(documents.folderId, sources))
          .orderBy(asc(documents.name));
        if (!docs.length) continue;
        await ctx.db
          .insert(dataRoomItems)
          .values(
            docs.map((d, i) => ({ roomId: room!.id, folderId: folder!.id, documentId: d.id, position: i, addedBy: ctx.actor!.userId })),
          )
          .onConflictDoNothing();
        added += docs.length;
      }
    }
    await audit(ctx, {
      action: 'dataroom.create',
      entityType: 'data_room',
      entityId: room!.id,
      after: { name: room!.name, template: template?.key ?? null, documents: added },
    });
    return { id: room!.id, name: room!.name, documents: added };
  },
});

export const updateRoom = defineService({
  name: 'dataroom.update',
  description:
    "Change a dataroom's name, description, welcome message, NDA text, closing time, the download and watermark defaults for new links, or which alerts the owner gets.",
  kind: 'mutation',
  access: 'dataroom.manage',
  input: updateRoomInput,
  async handler(ctx, input) {
    const before = await loadRoom(ctx, input.roomId);
    const { roomId: _roomId, closesAt, ndaText, ...rest } = input;
    const changes: Partial<RoomRow> = { ...rest };
    if (closesAt !== undefined) changes.closesAt = closesAt ? new Date(closesAt) : null;
    if (ndaText !== undefined) changes.ndaText = ndaText?.trim() ? ndaText.trim() : null;
    if (!Object.keys(changes).length) return { id: before.id };
    await ctx.db.update(dataRooms).set(changes).where(eq(dataRooms.id, before.id));
    await audit(ctx, { action: 'dataroom.update', entityType: 'data_room', entityId: before.id, ...diff(before, changes) });
    return { id: before.id };
  },
});

async function setStatus(ctx: Ctx, roomId: string, status: DataRoomStatus, action: string) {
  const before = await loadRoom(ctx, roomId);
  if (before.status === status) return { id: before.id, status };
  await ctx.db.update(dataRooms).set({ status }).where(eq(dataRooms.id, before.id));
  await audit(ctx, { action, entityType: 'data_room', entityId: before.id, before: { status: before.status }, after: { status } });
  return { id: before.id, status };
}

export const openRoom = defineService({
  name: 'dataroom.open',
  description: 'Open a dataroom so its active links work. Also reopens a closed room. Links still need a password if they have one.',
  kind: 'mutation',
  access: 'dataroom.manage',
  input: roomIdInput,
  handler: (ctx, input) => setStatus(ctx, input.roomId, 'open', 'dataroom.open'),
});

export const closeRoom = defineService({
  name: 'dataroom.close',
  description:
    'Close a dataroom: every link stops working at once and visitors are signed out. Statistics are kept; it can be opened again.',
  kind: 'mutation',
  access: 'dataroom.manage',
  input: roomIdInput,
  handler: (ctx, input) => setStatus(ctx, input.roomId, 'closed', 'dataroom.close'),
});

export const deleteRoom = defineService({
  name: 'dataroom.delete',
  description:
    'Delete a dataroom with its links, visitors and statistics. The documents stay in Documents. Cannot be undone; closing the room is usually enough.',
  kind: 'mutation',
  access: 'dataroom.manage',
  input: roomIdInput,
  async handler(ctx, input) {
    const room = await loadRoom(ctx, input.roomId);
    await ctx.db.delete(dataRooms).where(eq(dataRooms.id, room.id));
    await audit(ctx, {
      action: 'dataroom.delete',
      entityType: 'data_room',
      entityId: room.id,
      before: { name: room.name, status: room.status },
    });
    return { ok: true };
  },
});

export const createRoomFolder = defineService({
  name: 'dataroom.createFolder',
  description:
    "Create a folder in a dataroom, at the room's top level or inside parentId. Room folders are separate from the folders in Documents.",
  kind: 'mutation',
  access: 'dataroom.manage',
  input: createRoomFolderInput,
  async handler(ctx, input) {
    const room = await loadRoom(ctx, input.roomId);
    const parentId = input.parentId ?? null;
    if (parentId) await loadRoomFolder(ctx, parentId, room.id);
    await assertFreeFolderName(ctx, room.id, parentId, input.name);
    const [last] = await ctx.db
      .select({ value: max(dataRoomFolders.position) })
      .from(dataRoomFolders)
      .where(
        and(eq(dataRoomFolders.roomId, room.id), parentId ? eq(dataRoomFolders.parentId, parentId) : isNull(dataRoomFolders.parentId)),
      );
    const [row] = await ctx.db
      .insert(dataRoomFolders)
      .values({ roomId: room.id, parentId, name: input.name, position: (last?.value ?? -1) + 1 })
      .returning();
    await audit(ctx, {
      action: 'dataroom.folder_create',
      entityType: 'data_room_folder',
      entityId: row!.id,
      after: { roomId: room.id, parentId, name: row!.name },
    });
    return { id: row!.id, name: row!.name };
  },
});

export const renameRoomFolder = defineService({
  name: 'dataroom.renameFolder',
  description: 'Rename a folder in a dataroom.',
  kind: 'mutation',
  access: 'dataroom.manage',
  input: renameRoomFolderInput,
  async handler(ctx, input) {
    const before = await loadRoomFolder(ctx, input.folderId);
    await assertFreeFolderName(ctx, before.roomId, before.parentId, input.name, before.id);
    await ctx.db.update(dataRoomFolders).set({ name: input.name }).where(eq(dataRoomFolders.id, before.id));
    await audit(ctx, {
      action: 'dataroom.folder_rename',
      entityType: 'data_room_folder',
      entityId: before.id,
      before: { name: before.name },
      after: { name: input.name },
    });
    return { id: before.id, name: input.name };
  },
});

export const deleteRoomFolder = defineService({
  name: 'dataroom.deleteFolder',
  description: 'Delete a folder from a dataroom, with its subfolders. The documents in it leave the room but stay in Documents.',
  kind: 'mutation',
  access: 'dataroom.manage',
  input: roomFolderIdInput,
  async handler(ctx, input) {
    const row = await loadRoomFolder(ctx, input.folderId);
    await ctx.db.delete(dataRoomFolders).where(eq(dataRoomFolders.id, row.id));
    await audit(ctx, {
      action: 'dataroom.folder_delete',
      entityType: 'data_room_folder',
      entityId: row.id,
      before: { roomId: row.roomId, name: row.name },
    });
    return { ok: true };
  },
});

export const addRoomDocuments = defineService({
  name: 'dataroom.addDocuments',
  description:
    'Add documents from Documents to a dataroom, into folderId (a room folder) or the top level. The room points at them; nothing is copied. Documents already in the room are skipped.',
  kind: 'mutation',
  access: 'dataroom.manage',
  input: addRoomDocumentsInput,
  async handler(ctx, input) {
    const room = await loadRoom(ctx, input.roomId);
    const folderId = input.folderId ?? null;
    if (folderId) await loadRoomFolder(ctx, folderId, room.id);
    const ids = [...new Set(input.documentIds)];
    const found = await ctx.db.select({ id: documents.id, name: documents.name }).from(documents).where(inArray(documents.id, ids));
    if (found.length !== ids.length) throw notFound('Document');
    const existing = await ctx.db
      .select({ documentId: dataRoomItems.documentId })
      .from(dataRoomItems)
      .where(and(eq(dataRoomItems.roomId, room.id), inArray(dataRoomItems.documentId, ids)));
    const skip = new Set(existing.map((e) => e.documentId));
    const fresh = ids.filter((id) => !skip.has(id));
    let position = await nextPosition(ctx, room.id, folderId);
    if (fresh.length)
      await ctx.db
        .insert(dataRoomItems)
        .values(fresh.map((documentId) => ({ roomId: room.id, folderId, documentId, position: position++, addedBy: ctx.actor!.userId })));
    if (fresh.length)
      await audit(ctx, {
        action: 'dataroom.add_documents',
        entityType: 'data_room',
        entityId: room.id,
        after: { folderId, documents: found.filter((d) => !skip.has(d.id)).map((d) => d.name) },
      });
    return { added: fresh.length, skipped: skip.size };
  },
});

export const removeRoomItem = defineService({
  name: 'dataroom.removeItem',
  description: 'Take a document out of a dataroom. It stays in Documents, and its past statistics are kept.',
  kind: 'mutation',
  access: 'dataroom.manage',
  input: roomItemIdInput,
  async handler(ctx, input) {
    const item = await loadItem(ctx, input.itemId);
    await ctx.db.delete(dataRoomItems).where(eq(dataRoomItems.id, item.id));
    await audit(ctx, {
      action: 'dataroom.remove_item',
      entityType: 'data_room',
      entityId: item.roomId,
      before: { itemId: item.id, documentId: item.documentId, folderId: item.folderId },
    });
    return { ok: true };
  },
});

export const moveRoomItem = defineService({
  name: 'dataroom.moveItem',
  description:
    'Move a document within its dataroom: to another room folder (null for the top level) and, optionally, to a position in that folder.',
  kind: 'mutation',
  access: 'dataroom.manage',
  input: moveRoomItemInput,
  async handler(ctx, input) {
    const item = await loadItem(ctx, input.itemId);
    if (input.folderId) await loadRoomFolder(ctx, input.folderId, item.roomId);
    const siblings = await ctx.db
      .select({ id: dataRoomItems.id })
      .from(dataRoomItems)
      .where(
        and(
          eq(dataRoomItems.roomId, item.roomId),
          input.folderId ? eq(dataRoomItems.folderId, input.folderId) : isNull(dataRoomItems.folderId),
        ),
      )
      .orderBy(asc(dataRoomItems.position));
    const order = siblings.map((s) => s.id).filter((id) => id !== item.id);
    order.splice(Math.min(input.position ?? order.length, order.length), 0, item.id);
    for (const [position, id] of order.entries())
      await ctx.db
        .update(dataRoomItems)
        .set({ position, ...(id === item.id ? { folderId: input.folderId } : {}) })
        .where(eq(dataRoomItems.id, id));
    await audit(ctx, {
      action: 'dataroom.move_item',
      entityType: 'data_room',
      entityId: item.roomId,
      before: { itemId: item.id, folderId: item.folderId, position: item.position },
      after: { folderId: input.folderId, position: order.indexOf(item.id) },
    });
    return { ok: true };
  },
});

export const listLinks = defineService({
  name: 'dataroom.links',
  description:
    "A dataroom's share links: label, URL, status (active, expired or revoked), their rules (password, allowed emails and domains, email required or verified, downloads, watermark, folders, expiry) and how much each was used.",
  kind: 'query',
  access: 'dataroom.read',
  input: roomIdInput,
  async handler(ctx, input) {
    const room = await loadRoom(ctx, input.roomId);
    const links = await ctx.db.select().from(dataRoomLinks).where(eq(dataRoomLinks.roomId, room.id)).orderBy(desc(dataRoomLinks.createdAt));
    const events = await roomEvents(ctx, room.id);
    return links.map((link) => {
      const mine = events.filter((e) => e.linkId === link.id);
      const people = new Set(mine.filter((e) => e.type !== 'password_failed').map((e) => e.visitorId ?? e.sessionId));
      people.delete(null);
      return toLinkDto(link, {
        visitors: people.size,
        lastUsedAt: mine.filter((e) => e.type !== 'password_failed').at(-1)?.at ?? null,
        failedPasswords: mine.filter((e) => e.type === 'password_failed').length,
      });
    });
  },
});

export const createLink = defineService({
  name: 'dataroom.createLink',
  description:
    "Create a share link to a dataroom, usually one per investor, with its own rules. Downloads and watermark default to the room's settings. Returns the URL to send. Set the password in the app, not through chat, so it is not stored in a transcript.",
  kind: 'mutation',
  access: 'dataroom.manage',
  input: createLinkInput,
  async handler(ctx, input) {
    const room = await loadRoom(ctx, input.roomId);
    await assertRoomFolders(ctx, room.id, input.folderIds);
    await assertVerifiable(input);
    const [link] = await ctx.db
      .insert(dataRoomLinks)
      .values({
        roomId: room.id,
        label: input.label,
        token: randomToken(24),
        passwordHash: input.password ? await hashPassword(input.password) : null,
        allowedEmails: input.allowedEmails,
        allowedDomains: input.allowedDomains,
        requireEmail: input.requireEmail || input.allowedEmails.length > 0 || input.allowedDomains.length > 0,
        verifyEmail: input.verifyEmail,
        allowDownload: input.allowDownload ?? room.defaultAllowDownload,
        watermark: input.watermark ?? room.defaultWatermark,
        folderIds: input.folderIds?.length ? input.folderIds : null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        createdBy: ctx.actor!.userId,
      })
      .returning();
    await audit(ctx, { action: 'dataroom.create_link', entityType: 'data_room_link', entityId: link!.id, after: linkAudit(link!) });
    return toLinkDto(link!);
  },
});

export const updateLink = defineService({
  name: 'dataroom.updateLink',
  description:
    "Change a share link's label, password, allowed emails or domains, email rules, downloads, watermark, folders or expiry. Changes apply to visitors already inside at their next request.",
  kind: 'mutation',
  access: 'dataroom.manage',
  input: updateLinkInput,
  async handler(ctx, input) {
    const before = await loadLink(ctx, input.linkId);
    if (before.revokedAt) throw conflict('This link is revoked. Create a new one instead.');
    await assertRoomFolders(ctx, before.roomId, input.folderIds);
    const { linkId: _linkId, password, expiresAt, folderIds, ...rest } = input;
    const changes: Partial<LinkRow> = { ...rest };
    if (password !== undefined) changes.passwordHash = password ? await hashPassword(password) : null;
    if (expiresAt !== undefined) changes.expiresAt = expiresAt ? new Date(expiresAt) : null;
    if (folderIds !== undefined) changes.folderIds = folderIds?.length ? folderIds : null;
    const merged = { ...before, ...changes };
    if (merged.allowedEmails.length || merged.allowedDomains.length) changes.requireEmail = true;
    if (input.verifyEmail) await assertVerifiable({ verifyEmail: true, requireEmail: changes.requireEmail ?? merged.requireEmail });
    else if ((changes.requireEmail ?? merged.requireEmail) === false) changes.verifyEmail = false;
    await ctx.db.update(dataRoomLinks).set(changes).where(eq(dataRoomLinks.id, before.id));
    const after = { ...before, ...changes };
    await audit(ctx, {
      action: 'dataroom.update_link',
      entityType: 'data_room_link',
      entityId: before.id,
      ...diff(linkAudit(before), linkAudit(after)),
    });
    return toLinkDto(after);
  },
});

export const revokeLink = defineService({
  name: 'dataroom.revokeLink',
  description: 'Revoke a share link: it stops working at once and anyone inside through it is signed out. Its statistics are kept.',
  kind: 'mutation',
  access: 'dataroom.manage',
  input: linkIdInput,
  async handler(ctx, input) {
    const before = await loadLink(ctx, input.linkId);
    if (before.revokedAt) return toLinkDto(before);
    const revokedAt = new Date();
    await ctx.db.update(dataRoomLinks).set({ revokedAt }).where(eq(dataRoomLinks.id, before.id));
    await audit(ctx, {
      action: 'dataroom.revoke_link',
      entityType: 'data_room_link',
      entityId: before.id,
      before: { label: before.label },
      after: { revokedAt },
    });
    return toLinkDto({ ...before, revokedAt });
  },
});

export const listVisitors = defineService({
  name: 'dataroom.visitors',
  description:
    'Everyone who opened a dataroom: email, name, company, the links they used, first and last visit, number of visits, time spent reading, documents opened, downloads and when they accepted the NDA. Visitors who gave no email are listed as anonymous visits.',
  kind: 'query',
  access: 'dataroom.read',
  input: roomIdInput,
  async handler(ctx, input) {
    const room = await loadRoom(ctx, input.roomId);
    const [visitors, links, events] = await Promise.all([
      ctx.db.select().from(dataRoomVisitors).where(eq(dataRoomVisitors.roomId, room.id)),
      ctx.db.select({ id: dataRoomLinks.id, label: dataRoomLinks.label }).from(dataRoomLinks).where(eq(dataRoomLinks.roomId, room.id)),
      roomEvents(ctx, room.id),
    ]);
    const label = new Map(links.map((l) => [l.id, l.label]));
    const stats = perVisitor(events);
    const rows = visitors.map((v) => {
      const s = stats.get(v.id);
      return {
        id: v.id as string | null,
        email: v.email as string | null,
        name: v.name,
        company: v.company,
        links: [...(s?.linkIds ?? [])].map((id) => label.get(id) ?? '').filter(Boolean),
        firstVisitAt: s?.firstAt ?? v.firstSeenAt,
        lastVisitAt: s?.lastAt ?? v.lastSeenAt,
        visits: s?.visits ?? 0,
        timeSpentMs: s?.timeSpentMs ?? 0,
        documentsOpened: s?.documentsOpened.size ?? 0,
        downloads: s?.downloads ?? 0,
        verifiedAt: v.verifiedAt,
        ndaAcceptedAt: v.ndaAcceptedAt,
      };
    });
    for (const [key, s] of stats) {
      if (!key.startsWith('session:')) continue;
      rows.push({
        id: null,
        email: null,
        name: 'Anonymous',
        company: '',
        links: [...s.linkIds].map((id) => label.get(id) ?? '').filter(Boolean),
        firstVisitAt: s.firstAt,
        lastVisitAt: s.lastAt,
        visits: s.visits,
        timeSpentMs: s.timeSpentMs,
        documentsOpened: s.documentsOpened.size,
        downloads: s.downloads,
        verifiedAt: null,
        ndaAcceptedAt: null,
      });
    }
    return rows.sort((a, b) => b.lastVisitAt.getTime() - a.lastVisitAt.getTime());
  },
});

const EVENT_LABELS: Record<string, string> = {
  room_opened: 'Opened the room',
  nda_accepted: 'Accepted the NDA',
  document_opened: 'Opened',
  page_viewed: 'Read',
  document_downloaded: 'Downloaded',
  room_downloaded: 'Downloaded everything as a zip',
};

export const getVisitor = defineService({
  name: 'dataroom.visitor',
  description:
    'One visitor in a dataroom: who they are, the time they spent on each document, and their full timeline of visits, opened documents, pages read and downloads, oldest first.',
  kind: 'query',
  access: 'dataroom.read',
  input: roomVisitorInput,
  async handler(ctx, input) {
    const [visitor] = await ctx.db
      .select()
      .from(dataRoomVisitors)
      .where(and(eq(dataRoomVisitors.id, input.visitorId), eq(dataRoomVisitors.roomId, input.roomId)));
    if (!visitor) throw notFound('Visitor');
    const events = (await roomEvents(ctx, input.roomId)).filter((e) => e.visitorId === visitor.id && e.type !== 'password_failed');
    const names = await documentNames(ctx, [...new Set(events.map((e) => e.documentId).filter((d): d is string => !!d))]);
    const links = await ctx.db
      .select({ id: dataRoomLinks.id, label: dataRoomLinks.label })
      .from(dataRoomLinks)
      .where(eq(dataRoomLinks.roomId, input.roomId));
    const label = new Map(links.map((l) => [l.id, l.label]));
    const docs = perDocument(events);
    return {
      id: visitor.id,
      email: visitor.email,
      name: visitor.name,
      company: visitor.company,
      verifiedAt: visitor.verifiedAt,
      ndaAcceptedAt: visitor.ndaAcceptedAt,
      firstSeenAt: visitor.firstSeenAt,
      lastSeenAt: visitor.lastSeenAt,
      documents: [...docs.values()]
        .map((d) => ({
          documentId: d.documentId,
          name: names.get(d.documentId) ?? 'Deleted document',
          timeSpentMs: d.totalTimeMs,
          views: d.views,
          downloads: d.downloads,
          lastViewedAt: d.lastViewedAt,
        }))
        .sort((a, b) => b.timeSpentMs - a.timeSpentMs),
      timeline: events.map((e) => ({
        type: e.type,
        label: EVENT_LABELS[e.type] ?? e.type,
        document: e.documentId ? (names.get(e.documentId) ?? 'Deleted document') : null,
        page: e.page,
        durationMs: e.durationMs,
        link: e.linkId ? (label.get(e.linkId) ?? null) : null,
        at: e.at,
      })),
    };
  },
});

export const roomStats = defineService({
  name: 'dataroom.stats',
  description:
    'Statistics for a dataroom, optionally between from and to: visitors, visits, document views, downloads, total reading time and failed password tries; visits and views per day; and per document the unique visitors, views, downloads, total and average reading time and how far into the document viewers got. Use it to answer who read what and which documents get attention.',
  kind: 'query',
  access: 'dataroom.read',
  input: roomStatsInput,
  async handler(ctx, input) {
    const room = await loadRoom(ctx, input.roomId);
    const events = await roomEvents(ctx, room.id, input);
    const timeZone = (await getSettings('company'))?.timeZone ?? 'UTC';
    const docs = perDocument(events);
    const items = await ctx.db
      .select({ itemId: dataRoomItems.id, documentId: dataRoomItems.documentId })
      .from(dataRoomItems)
      .where(eq(dataRoomItems.roomId, room.id));
    const ids = [...new Set([...items.map((i) => i.documentId), ...docs.keys()])];
    const names = await documentNames(ctx, ids);
    const inRoom = new Map(items.map((i) => [i.documentId, i.itemId]));
    return {
      overview: overview(events),
      daily: daily(events, timeZone),
      documents: ids
        .map((documentId) => {
          const d = docs.get(documentId);
          return {
            documentId,
            itemId: inRoom.get(documentId) ?? null,
            name: names.get(documentId) ?? 'Deleted document',
            inRoom: inRoom.has(documentId),
            uniqueVisitors: d?.uniqueVisitors ?? 0,
            views: d?.views ?? 0,
            downloads: d?.downloads ?? 0,
            totalTimeMs: d?.totalTimeMs ?? 0,
            avgTimeMs: d?.avgTimeMs ?? 0,
            pageCount: d?.pageCount ?? null,
            pagesReached: d?.pagesReached ?? null,
            lastViewedAt: d?.lastViewedAt ?? null,
          };
        })
        .sort((a, b) => b.totalTimeMs - a.totalTimeMs || b.views - a.views || a.name.localeCompare(b.name)),
    };
  },
});

export const roomDocumentStats = defineService({
  name: 'dataroom.documentStats',
  description:
    'How one document in a dataroom was read: reading time and viewers per page, and per visitor the time spent, the furthest page reached and when they last read it.',
  kind: 'query',
  access: 'dataroom.read',
  input: roomDocumentStatsInput,
  async handler(ctx, input) {
    const room = await loadRoom(ctx, input.roomId);
    const events = (await roomEvents(ctx, room.id)).filter((e) => e.documentId === input.documentId);
    const names = await documentNames(ctx, [input.documentId]);
    const visitorIds = [...new Set(events.map((e) => e.visitorId).filter((v): v is string => !!v))];
    const visitors = visitorIds.length ? await ctx.db.select().from(dataRoomVisitors).where(inArray(dataRoomVisitors.id, visitorIds)) : [];
    const people = visitors.map((v) => {
      const mine = events.filter((e) => e.visitorId === v.id);
      return {
        visitorId: v.id,
        email: v.email,
        name: v.name,
        timeSpentMs: mine.reduce((a, e) => a + (e.type === 'page_viewed' ? (e.durationMs ?? 0) : 0), 0),
        furthestPage: Math.max(0, ...mine.map((e) => e.page ?? 0)) || null,
        downloaded: mine.some((e) => e.type === 'document_downloaded'),
        lastViewedAt: mine.at(-1)?.at ?? null,
      };
    });
    return {
      documentId: input.documentId,
      name: names.get(input.documentId) ?? 'Deleted document',
      pages: perPage(events, input.documentId),
      visitors: people.sort((a, b) => b.timeSpentMs - a.timeSpentMs),
    };
  },
});
