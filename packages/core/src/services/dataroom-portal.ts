import { randomInt } from 'node:crypto';
import { once } from 'node:events';
import type { Writable } from 'node:stream';
import {
  and,
  count,
  dataRoomEvents,
  dataRoomFolders,
  dataRoomItems,
  dataRoomLinks,
  dataRoomSessions,
  dataRooms,
  dataRoomVisitors,
  desc,
  documents,
  eq,
  files,
  gt,
  sql,
} from '@openinc/db';
import { portalHeartbeatInput, portalIdentifyInput, portalInput, portalUnlockInput, portalVerifyInput } from '@openinc/shared';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { audit } from '../audit.ts';
import type { Ctx } from '../context.ts';
import { watermarkPdf } from '../dataroom/watermark.ts';
import { AppError, badRequest, forbidden, notFound, tooManyRequests, unauthorized } from '../errors.ts';
import { queueEmail } from '../jobs.ts';
import { randomToken, safeEqual, sha256 } from '../lib/crypto.ts';
import { renderEmail } from '../lib/email.ts';
import { burnPasswordCheck, verifyPassword } from '../lib/password.ts';
import { getObjectBuffer, getObjectStream } from '../lib/storage.ts';
import { defineService } from '../service.ts';
import { getSettings } from '../settings.ts';
import { linkStatus, roomIsLive } from './dataroom.ts';
import { notify } from './notifications.ts';

const SESSION_HOURS = 12;
const CODE_MINUTES = 10;
const MAX_CODE_ATTEMPTS = 5;
const MAX_FAILED_PASSWORDS = 5;
const LOCK_MINUTES = 15;
const ALERT_FAILED_PASSWORDS = 20;
const HEARTBEAT_CAP_MS = 30_000;

/** Each link gets its own cookie, so a visitor can be inside two rooms at once. */
export const portalCookieName = (token: string) => `openinc_room_${sha256(token).slice(0, 16)}`;
export const PORTAL_SESSION_HOURS = SESSION_HOURS;

const VIEWABLE = /^(application\/pdf|image\/(png|jpe?g|gif|webp))$/;

type Link = typeof dataRoomLinks.$inferSelect;
type Room = typeof dataRooms.$inferSelect;
type Session = typeof dataRoomSessions.$inferSelect;
type Visitor = typeof dataRoomVisitors.$inferSelect;
export type PortalStep = 'email' | 'code' | 'password' | 'nda' | 'open';

/** The same answer for a bad token, a revoked or expired link and a closed room, so a guessed token learns nothing. */
const unavailable = () => new AppError('NOT_FOUND', 'This link is not available');

async function liveLink(ctx: Ctx, token: string) {
  const [row] = await ctx.db
    .select({ link: dataRoomLinks, room: dataRooms })
    .from(dataRoomLinks)
    .innerJoin(dataRooms, eq(dataRooms.id, dataRoomLinks.roomId))
    .where(eq(dataRoomLinks.token, token));
  if (!row || linkStatus(row.link) !== 'active' || !roomIsLive(row.room)) throw unavailable();
  return row;
}

async function currentSession(ctx: Ctx, link: Link) {
  if (!ctx.portalSession) return null;
  const [row] = await ctx.db
    .select({ session: dataRoomSessions, visitor: dataRoomVisitors })
    .from(dataRoomSessions)
    .leftJoin(dataRoomVisitors, eq(dataRoomVisitors.id, dataRoomSessions.visitorId))
    .where(and(eq(dataRoomSessions.tokenHash, sha256(ctx.portalSession)), gt(dataRoomSessions.expiresAt, new Date())));
  if (!row || row.session.linkId !== link.id) return null;
  return row;
}

/** An NDA can only be accepted by someone, so a room with one always asks for the email. */
const needsEmail = (link: Link, room: Room) => link.requireEmail || !!room.ndaText;

function stepFor(link: Link, room: Room, session: Session, visitor: Visitor | null): PortalStep {
  if (needsEmail(link, room) && !session.visitorId) return 'email';
  if (link.verifyEmail && !session.emailVerifiedAt) return 'code';
  if (link.passwordHash && !session.passwordOkAt) return 'password';
  if (room.ndaText && !visitor?.ndaAcceptedAt) return 'nda';
  return 'open';
}

async function branding() {
  const company = await getSettings('company');
  return { companyName: company?.name ?? 'OpenInc', logoUrl: company?.logoFileId ? '/api/public/logo' : null };
}

async function event(
  ctx: Ctx,
  at: { room: Room; link: Link; session: Session | null },
  type: string,
  extra: Partial<typeof dataRoomEvents.$inferInsert> = {},
) {
  await ctx.db.insert(dataRoomEvents).values({
    roomId: at.room.id,
    linkId: at.link.id,
    sessionId: at.session?.id ?? null,
    visitorId: at.session?.visitorId ?? null,
    type,
    ...extra,
  });
}

function alert(ctx: Ctx, room: Room, n: { type: string; title: string; body: string; tab: string }) {
  const to = room.ownerId ?? room.createdBy;
  if (!to) return Promise.resolve();
  return notify(ctx.db, [to], {
    type: n.type,
    title: n.title,
    body: n.body,
    link: `/documents/dataroom/${room.id}?tab=${n.tab}`,
    email: true,
  });
}

/** Moves the session to the room once every gate is passed: the visit is recorded and the owner may get an alert. */
async function state(ctx: Ctx, link: Link, room: Room, session: Session, visitor: Visitor | null, sessionToken?: string) {
  const step = stepFor(link, room, session, visitor);
  if (step === 'open' && !session.openedAt) {
    const now = new Date();
    await ctx.db.update(dataRoomSessions).set({ openedAt: now }).where(eq(dataRoomSessions.id, session.id));
    const [before] = visitor
      ? await ctx.db
          .select({ value: count() })
          .from(dataRoomEvents)
          .where(and(eq(dataRoomEvents.visitorId, visitor.id), eq(dataRoomEvents.type, 'room_opened')))
      : [{ value: 1 }];
    await event(ctx, { room, link, session }, 'room_opened');
    if (visitor && !before?.value && room.alertOnFirstVisit)
      await alert(ctx, room, {
        type: 'dataroom.first_visit',
        title: `${visitor.email} opened ${room.name}`,
        body: `First visit, through the link ${link.label}.`,
        tab: 'visitors',
      });
  }
  return {
    status: 'gate' as const,
    step,
    room: { name: room.name, ndaText: step === 'nda' ? room.ndaText : null },
    ...(await branding()),
    email: visitor?.email ?? null,
    sessionToken,
  };
}

/** For the portal's file and zip routes, and every call made from inside the room. */
export async function openSession(ctx: Ctx, token: string) {
  const { link, room } = await liveLink(ctx, token);
  const current = await currentSession(ctx, link);
  if (!current) throw unauthorized('Your visit has ended. Open the link again.');
  const { session, visitor } = current;
  if (!session.openedAt || stepFor(link, room, session, visitor) !== 'open') throw unauthorized('Open the link again to continue.');
  return { link, room, session, visitor };
}

type Open = Awaited<ReturnType<typeof openSession>>;

function watermarkText(open: Open, companyName: string) {
  const date = new Date().toISOString().slice(0, 10);
  return `${open.visitor?.email ?? 'Anonymous visitor'} · ${companyName} · ${date}`;
}

/** The items the link shows: the whole room, or only its folders and everything under them. */
async function visibleContent(ctx: Ctx, open: Open) {
  const folders = await ctx.db.select().from(dataRoomFolders).where(eq(dataRoomFolders.roomId, open.room.id));
  let allowed: Set<string | null> | null = null;
  if (open.link.folderIds?.length) {
    allowed = new Set(open.link.folderIds);
    for (let grew = true; grew; ) {
      grew = false;
      for (const f of folders)
        if (!allowed.has(f.id) && f.parentId && allowed.has(f.parentId)) {
          allowed.add(f.id);
          grew = true;
        }
    }
  }
  const items = await ctx.db
    .select({ item: dataRoomItems, document: documents, file: files })
    .from(dataRoomItems)
    .innerJoin(documents, eq(documents.id, dataRoomItems.documentId))
    .innerJoin(files, eq(files.id, documents.fileId))
    .where(eq(dataRoomItems.roomId, open.room.id));
  const visibleFolders = folders.filter((f) => !allowed || allowed.has(f.id));
  const ids = new Set(visibleFolders.map((f) => f.id));
  // A folder the link shows is shown at the top when its parent is not.
  const topOf = (f: (typeof folders)[number]) => (f.parentId && ids.has(f.parentId) ? f.parentId : null);
  return {
    folders: visibleFolders
      .map((f) => ({ id: f.id, parentId: topOf(f), name: f.name, position: f.position }))
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
    items: items
      .filter(({ item }) => (allowed ? !!item.folderId && allowed.has(item.folderId) : true))
      .filter(({ file }) => !file.deletedAt)
      .sort((a, b) => a.item.position - b.item.position || a.document.name.localeCompare(b.document.name)),
  };
}

export const portalStart = defineService({
  name: 'portal.start',
  description: 'Starts or resumes a visit to a dataroom link and says which step comes next.',
  kind: 'mutation',
  access: 'public',
  input: portalInput,
  async handler(ctx, input) {
    const { link, room } = await liveLink(ctx, input.token);
    const current = await currentSession(ctx, link);
    if (current) return state(ctx, link, room, current.session, current.visitor);
    const sessionToken = randomToken();
    const [session] = await ctx.db
      .insert(dataRoomSessions)
      .values({
        linkId: link.id,
        tokenHash: sha256(sessionToken),
        ipAddress: ctx.ip ?? null,
        userAgent: ctx.userAgent?.slice(0, 500) ?? null,
        expiresAt: new Date(Date.now() + SESSION_HOURS * 3600_000),
      })
      .returning();
    return state(ctx, link, room, session!, null, sessionToken);
  },
});

async function gateSession(ctx: Ctx, token: string, expected: PortalStep) {
  const { link, room } = await liveLink(ctx, token);
  const current = await currentSession(ctx, link);
  if (!current) throw unauthorized('Your visit has ended. Open the link again.');
  if (stepFor(link, room, current.session, current.visitor) !== expected) throw badRequest('Reload the page to continue.');
  return { link, room, ...current };
}

function allowedEmail(link: Link, email: string) {
  if (!link.allowedEmails.length && !link.allowedDomains.length) return true;
  const domain = email.split('@')[1] ?? '';
  return link.allowedEmails.includes(email) || link.allowedDomains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

async function sendCode(ctx: Ctx, room: Room, session: Session, email: string) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await ctx.db
    .update(dataRoomSessions)
    .set({ codeHash: sha256(`${session.id}:${code}`), codeExpiresAt: new Date(Date.now() + CODE_MINUTES * 60_000), codeAttempts: 0 })
    .where(eq(dataRoomSessions.id, session.id));
  const { companyName } = await branding();
  await queueEmail(
    renderEmail({
      to: email,
      subject: `${code} is your code for ${room.name}`,
      paragraphs: [
        `Enter ${code} to open ${room.name} from ${companyName}.`,
        `The code works for ${CODE_MINUTES} minutes. If you did not ask for it, you can ignore this email.`,
      ],
    }),
  );
}

export const portalIdentify = defineService({
  name: 'portal.identify',
  description: 'The visitor gives their email (and optionally name and company) at a dataroom link.',
  kind: 'mutation',
  access: 'public',
  input: portalIdentifyInput,
  async handler(ctx, input) {
    const { link, room, session } = await gateSession(ctx, input.token, 'email');
    if (!allowedEmail(link, input.email)) throw forbidden('This link is not shared with that email address.');
    const [visitor] = await ctx.db
      .insert(dataRoomVisitors)
      .values({ roomId: room.id, email: input.email, name: input.name, company: input.company })
      .onConflictDoUpdate({
        target: [dataRoomVisitors.roomId, dataRoomVisitors.email],
        set: {
          lastSeenAt: new Date(),
          ...(input.name ? { name: input.name } : {}),
          ...(input.company ? { company: input.company } : {}),
        },
      })
      .returning();
    const [updated] = await ctx.db
      .update(dataRoomSessions)
      .set({ visitorId: visitor!.id })
      .where(eq(dataRoomSessions.id, session.id))
      .returning();
    if (link.verifyEmail) await sendCode(ctx, room, updated!, visitor!.email);
    return state(ctx, link, room, updated!, visitor!);
  },
});

export const portalResendCode = defineService({
  name: 'portal.resendCode',
  description: 'Emails the visitor a new verification code.',
  kind: 'mutation',
  access: 'public',
  input: portalInput,
  async handler(ctx, input) {
    const { room, session, visitor } = await gateSession(ctx, input.token, 'code');
    if (session.codeExpiresAt && session.codeExpiresAt.getTime() - Date.now() > (CODE_MINUTES - 1) * 60_000)
      throw tooManyRequests('Wait a minute before asking for another code.');
    await sendCode(ctx, room, session, visitor!.email);
    return { ok: true };
  },
});

export const portalVerify = defineService({
  name: 'portal.verify',
  description: 'The visitor enters the code that was emailed to them.',
  kind: 'mutation',
  access: 'public',
  input: portalVerifyInput,
  transaction: false,
  async handler(ctx, input) {
    const { link, room, session, visitor } = await gateSession(ctx, input.token, 'code');
    if (!session.codeHash || !session.codeExpiresAt || session.codeExpiresAt < new Date())
      throw badRequest('The code has expired. Ask for a new one.');
    if (session.codeAttempts >= MAX_CODE_ATTEMPTS) throw tooManyRequests('Too many wrong codes. Ask for a new one.');
    if (!safeEqual(session.codeHash, sha256(`${session.id}:${input.code}`))) {
      await ctx.db
        .update(dataRoomSessions)
        .set({ codeAttempts: session.codeAttempts + 1 })
        .where(eq(dataRoomSessions.id, session.id));
      throw badRequest('That code is not right.');
    }
    const now = new Date();
    const [updated] = await ctx.db
      .update(dataRoomSessions)
      .set({ emailVerifiedAt: now, codeHash: null, codeExpiresAt: null })
      .where(eq(dataRoomSessions.id, session.id))
      .returning();
    const [v] = await ctx.db.update(dataRoomVisitors).set({ verifiedAt: now }).where(eq(dataRoomVisitors.id, visitor!.id)).returning();
    return state(ctx, link, room, updated!, v!);
  },
});

/** Failed tries on this link from this IP address in the lockout window. */
async function recentFailures(ctx: Ctx, link: Link, minutes: number, ip?: string | null) {
  const [row] = await ctx.db
    .select({ value: count() })
    .from(dataRoomEvents)
    .innerJoin(dataRoomSessions, eq(dataRoomSessions.id, dataRoomEvents.sessionId))
    .where(
      and(
        eq(dataRoomEvents.linkId, link.id),
        eq(dataRoomEvents.type, 'password_failed'),
        gt(dataRoomEvents.at, new Date(Date.now() - minutes * 60_000)),
        ip === undefined ? undefined : ip === null ? sql`${dataRoomSessions.ipAddress} is null` : eq(dataRoomSessions.ipAddress, ip),
      ),
    );
  return row?.value ?? 0;
}

export const portalUnlock = defineService({
  name: 'portal.unlock',
  description: "The visitor enters the link's password.",
  kind: 'mutation',
  access: 'public',
  input: portalUnlockInput,
  transaction: false,
  async handler(ctx, input) {
    const { link, room, session, visitor } = await gateSession(ctx, input.token, 'password');
    const ip = ctx.ip ?? null;
    if ((await recentFailures(ctx, link, LOCK_MINUTES, ip)) >= MAX_FAILED_PASSWORDS) {
      await burnPasswordCheck(input.password);
      throw tooManyRequests(`Too many wrong passwords. Try again in ${LOCK_MINUTES} minutes.`);
    }
    if (!(await verifyPassword(link.passwordHash!, input.password))) {
      await event(ctx, { room, link, session }, 'password_failed');
      const failures = await recentFailures(ctx, link, LOCK_MINUTES, ip);
      if (failures === MAX_FAILED_PASSWORDS)
        await audit(ctx, {
          action: 'dataroom.link_locked',
          entityType: 'data_room_link',
          entityId: link.id,
          metadata: { label: link.label, minutes: LOCK_MINUTES, email: visitor?.email ?? null },
        });
      if (room.alertOnFailedPasswords && (await recentFailures(ctx, link, 60)) === ALERT_FAILED_PASSWORDS)
        await alert(ctx, room, {
          type: 'dataroom.failed_passwords',
          title: `Repeated wrong passwords on ${room.name}`,
          body: `${ALERT_FAILED_PASSWORDS} wrong passwords in the last hour on the link ${link.label}. Revoke it if it may have leaked.`,
          tab: 'links',
        });
      throw badRequest('That password is not right.');
    }
    const [updated] = await ctx.db
      .update(dataRoomSessions)
      .set({ passwordOkAt: new Date() })
      .where(eq(dataRoomSessions.id, session.id))
      .returning();
    return state(ctx, link, room, updated!, visitor);
  },
});

export const portalAcceptNda = defineService({
  name: 'portal.acceptNda',
  description: "The visitor accepts the dataroom's NDA.",
  kind: 'mutation',
  access: 'public',
  input: portalInput,
  async handler(ctx, input) {
    const { link, room, session, visitor } = await gateSession(ctx, input.token, 'nda');
    const [v] = await ctx.db
      .update(dataRoomVisitors)
      .set({ ndaAcceptedAt: new Date() })
      .where(eq(dataRoomVisitors.id, visitor!.id))
      .returning();
    await event(ctx, { room, link, session }, 'nda_accepted');
    return state(ctx, link, room, session, v!);
  },
});

export const portalRoom = defineService({
  name: 'portal.room',
  description: 'What a visitor inside a dataroom sees: its welcome message, folders and documents, and what the link lets them do.',
  kind: 'query',
  access: 'public',
  input: portalInput,
  async handler(ctx, input) {
    const open = await openSession(ctx, input.token);
    const { companyName, logoUrl } = await branding();
    const content = await visibleContent(ctx, open);
    return {
      name: open.room.name,
      welcomeMessage: open.room.welcomeMessage,
      companyName,
      logoUrl,
      email: open.visitor?.email ?? null,
      allowDownload: open.link.allowDownload,
      watermark: open.link.watermark ? watermarkText(open, companyName) : null,
      folders: content.folders,
      items: content.items.map(({ item, document, file }) => ({
        id: item.id,
        folderId: content.folders.some((f) => f.id === item.folderId) ? item.folderId : null,
        name: document.name,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        viewable: VIEWABLE.test(file.contentType),
      })),
    };
  },
});

export const portalHeartbeat = defineService({
  name: 'portal.heartbeat',
  description: 'The viewer reports that a page of a document is on screen.',
  kind: 'mutation',
  access: 'public',
  input: portalHeartbeatInput,
  async handler(ctx, input) {
    const open = await openSession(ctx, input.token);
    const [item] = await ctx.db
      .select()
      .from(dataRoomItems)
      .where(and(eq(dataRoomItems.id, input.itemId), eq(dataRoomItems.roomId, open.room.id)));
    if (!item) throw notFound('Document');
    const now = new Date();
    const ms = Math.min(HEARTBEAT_CAP_MS, Math.round(input.seconds * 1000));
    const [last] = await ctx.db
      .select()
      .from(dataRoomEvents)
      .where(and(eq(dataRoomEvents.sessionId, open.session.id), eq(dataRoomEvents.type, 'page_viewed'), eq(dataRoomEvents.itemId, item.id)))
      .orderBy(desc(dataRoomEvents.at))
      .limit(1);
    if (last && last.page === input.page && now.getTime() - last.at.getTime() <= HEARTBEAT_CAP_MS + 5_000) {
      await ctx.db
        .update(dataRoomEvents)
        .set({ durationMs: (last.durationMs ?? 0) + ms, at: now, pageCount: input.pageCount ?? last.pageCount })
        .where(eq(dataRoomEvents.id, last.id));
    } else {
      await event(ctx, open, 'page_viewed', {
        itemId: item.id,
        documentId: item.documentId,
        page: input.page,
        pageCount: input.pageCount ?? null,
        durationMs: ms,
      });
    }
    await ctx.db.update(dataRoomSessions).set({ lastSeenAt: now }).where(eq(dataRoomSessions.id, open.session.id));
    if (open.visitor) await ctx.db.update(dataRoomVisitors).set({ lastSeenAt: now }).where(eq(dataRoomVisitors.id, open.visitor.id));
    return { ok: true };
  },
});

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_');

async function maybeWatermark(open: Open, file: typeof files.$inferSelect, companyName: string): Promise<Buffer | null> {
  if (!open.link.watermark || file.contentType !== 'application/pdf') return null;
  const data = await getObjectBuffer(file.storageKey);
  try {
    return Buffer.from(await watermarkPdf(new Uint8Array(data), watermarkText(open, companyName)));
  } catch {
    throw new AppError('PRECONDITION_FAILED', 'This PDF cannot be watermarked, so it cannot be shown here. Ask the company for it.');
  }
}

/**
 * A document for the portal's file route. Viewing records an open; downloading needs the link to
 * allow it and records a download. Watermarked links get PDFs stamped with who is reading them.
 */
export async function portalFile(ctx: Ctx, token: string, itemId: string, mode: 'view' | 'download') {
  const open = await openSession(ctx, token);
  const content = await visibleContent(ctx, open);
  const row = content.items.find((r) => r.item.id === itemId);
  if (!row) throw notFound('Document');
  if (mode === 'download' && !open.link.allowDownload) throw forbidden('This link does not allow downloads.');
  if (mode === 'view' && !VIEWABLE.test(row.file.contentType)) throw forbidden('This document can only be downloaded.');
  const { companyName } = await branding();
  const body = await maybeWatermark(open, row.file, companyName);
  await event(ctx, open, mode === 'view' ? 'document_opened' : 'document_downloaded', { itemId, documentId: row.document.id });
  if (mode === 'download' && open.room.alertOnDownload)
    await alert(ctx, open.room, {
      type: 'dataroom.download',
      title: `${open.visitor?.email ?? 'A visitor'} downloaded ${row.document.name}`,
      body: `From ${open.room.name}, through the link ${open.link.label}.`,
      tab: 'activity',
    });
  return {
    name: row.document.name,
    contentType: row.file.contentType,
    sizeBytes: body?.length ?? row.file.sizeBytes,
    storageKey: row.file.storageKey,
    body,
  };
}

/**
 * Every document the link shows as one zip, folders kept. Checks and records the download first, so
 * a refusal is an error response, then returns the writer that streams the zip.
 */
export async function portalZip(ctx: Ctx, token: string) {
  const open = await openSession(ctx, token);
  if (!open.link.allowDownload) throw forbidden('This link does not allow downloads.');
  const content = await visibleContent(ctx, open);
  const { companyName } = await branding();
  await event(ctx, open, 'room_downloaded');
  if (open.room.alertOnDownload)
    await alert(ctx, open.room, {
      type: 'dataroom.download',
      title: `${open.visitor?.email ?? 'A visitor'} downloaded ${open.room.name}`,
      body: `Everything the link ${open.link.label} shows, as a zip.`,
      tab: 'activity',
    });
  return { filename: `${safeName(open.room.name)}.zip`, write: (out: Writable) => writeZip(open, content, companyName, out) };
}

async function writeZip(open: Open, content: Awaited<ReturnType<typeof visibleContent>>, companyName: string, out: Writable) {
  const pathOf = (folderId: string | null): string => {
    const f = content.folders.find((x) => x.id === folderId);
    return f ? `${pathOf(f.parentId)}${safeName(f.name)}/` : '';
  };
  const zip = new Zip((error, chunk, final) => {
    if (error) return out.destroy(error);
    out.write(chunk);
    if (final) out.end();
  });
  const taken = new Set<string>();
  for (const { item, document, file } of content.items) {
    const stamped = await maybeWatermark(open, file, companyName).catch(() => undefined);
    // A PDF that cannot carry the watermark is left out rather than sent without it.
    if (stamped === undefined) continue;
    let entry = `${pathOf(content.folders.some((f) => f.id === item.folderId) ? item.folderId : null)}${safeName(document.name)}`;
    for (let n = 2; taken.has(entry.toLowerCase()); n++) entry = `${entry} (${n})`;
    taken.add(entry.toLowerCase());
    const zipped = /^(image\/|application\/(zip|pdf|vnd\.openxmlformats.*))/.test(file.contentType)
      ? new ZipPassThrough(entry)
      : new ZipDeflate(entry, { level: 6 });
    zip.add(zipped);
    if (stamped) zipped.push(new Uint8Array(stamped));
    else
      for await (const chunk of await getObjectStream(file.storageKey)) {
        zipped.push(chunk as Uint8Array);
        if (out.writableNeedDrain) await once(out, 'drain');
      }
    zipped.push(new Uint8Array(0), true);
  }
  zip.end();
  if (!out.writableFinished) await once(out, 'finish');
}
