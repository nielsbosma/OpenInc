import { auditLog, dataRoomEvents, eq, notifications } from '@openinc/db';
import { unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ctx, closeDb, createCtx, getDb, systemCtx } from '../src/context.ts';
import { cleanupDataroom } from '../src/dataroom/cleanup.ts';
import { stopJobs } from '../src/jobs.ts';
import { services } from '../src/registry.ts';
import { invoke } from '../src/service.ts';
import { portalFile, portalZip } from '../src/services/dataroom-portal.ts';
import { storeFile } from '../src/services/files.ts';
import { freshInstall, reachable, userCtx } from './registry/db.ts';

async function pdf(pages: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([300, 400]);
  return Buffer.from(await doc.save());
}

/** A browser at the portal: it keeps the cookie the server sets, like the tRPC router does. */
function visitor(ip = '203.0.113.7') {
  let cookie: string | undefined;
  const ctx = () => createCtx({ surface: 'web', ip, portalSession: cookie });
  return {
    ctx,
    async start(token: string) {
      const result = await invoke(services.portal.start, ctx(), { token });
      if (result.sessionToken) cookie = result.sessionToken;
      return result;
    },
  };
}

describe.runIf(await reachable())('dataroom (database)', () => {
  let admin: Ctx;
  let auditor: Ctx;
  let deck: { id: string };
  let model: { id: string };
  let notes: { id: string };

  beforeAll(async () => {
    admin = await freshInstall();
    auditor = await userCtx('auditor', 'audrey@example.com');
    await invoke(services.documents.applyTemplate, admin, {});
    const folders = await invoke(services.documents.folders, admin, {});
    const at = (path: string) => folders.find((f) => f.path === path)!.id;
    const add = async (name: string, contentType: string, data: Buffer, folder: string) => {
      const file = await storeFile(admin, { name, contentType, kind: 'document', data });
      return invoke(services.documents.add, admin, { fileId: file.id, folderId: at(folder) });
    };
    deck = await add('Deck.pdf', 'application/pdf', await pdf(4), 'Fundraising / Pitch Deck');
    model = await add(
      'Model.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      Buffer.from('xlsx'),
      'Finance / Management Accounts',
    );
    notes = await add('Notes.txt', 'text/plain', Buffer.from('notes'), 'Legal / Disputes');
  });

  afterAll(async () => {
    await stopJobs();
    await closeDb();
  });

  it('creates a room from a template that points at the matching Documents folders', async () => {
    const room = await invoke(services.dataroom.create, admin, { name: 'Seed 2026', template: 'seed-round' });
    expect(room.documents).toBe(2);
    const full = await invoke(services.dataroom.get, admin, { roomId: room.id });
    expect(full.status).toBe('draft');
    expect(full.folders.map((f) => f.name)).toEqual(['Pitch and Updates', 'Company', 'Ownership', 'Financials']);
    expect(full.items.map((i) => i.name).sort()).toEqual(['Deck.pdf', 'Model.xlsx']);
    await expect(invoke(services.dataroom.create, auditor, { name: 'Nope' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await invoke(services.dataroom.list, auditor, {})).toHaveLength(1);
    expect(await invoke(services.dataroom.roomsForDocument, admin, { documentId: deck.id })).toMatchObject([{ name: 'Seed 2026' }]);
  });

  it('runs a visitor through email, password and NDA, and records what they read', async () => {
    const room = await invoke(services.dataroom.create, admin, { name: 'Series A' });
    const folder = await invoke(services.dataroom.createFolder, admin, { roomId: room.id, name: 'Finance' });
    await invoke(services.dataroom.addDocuments, admin, { roomId: room.id, documentIds: [deck.id] });
    await invoke(services.dataroom.addDocuments, admin, { roomId: room.id, folderId: folder.id, documentIds: [model.id, deck.id] });
    await invoke(services.dataroom.update, admin, { roomId: room.id, ndaText: 'Keep it secret.', welcomeMessage: 'Welcome.' });
    const link = await invoke(services.dataroom.createLink, admin, {
      roomId: room.id,
      label: 'Northzone',
      password: 'open-sesame',
      allowedDomains: ['northzone.com'],
    });
    expect(link).toMatchObject({ hasPassword: true, requireEmail: true, allowDownload: false, watermark: true, status: 'active' });
    const token = link.url.split('/r/')[1]!;

    const v = visitor();
    await expect(v.start(token)).rejects.toMatchObject({ message: 'This link is not available' });
    await invoke(services.dataroom.open, admin, { roomId: room.id });

    expect(await v.start(token)).toMatchObject({ step: 'email', companyName: 'Exempel AB' });
    await expect(invoke(services.portal.identify, v.ctx(), { token, email: 'eve@evil.com' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await invoke(services.portal.identify, v.ctx(), { token, email: 'Pia@NorthZone.com', name: 'Pia' })).toMatchObject({
      step: 'password',
    });
    await expect(invoke(services.portal.room, v.ctx(), { token })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(invoke(services.portal.unlock, v.ctx(), { token, password: 'wrong' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await invoke(services.portal.unlock, v.ctx(), { token, password: 'open-sesame' })).toMatchObject({
      step: 'nda',
      room: { ndaText: 'Keep it secret.' },
    });
    expect(await invoke(services.portal.acceptNda, v.ctx(), { token })).toMatchObject({ step: 'open' });

    const inside = await invoke(services.portal.room, v.ctx(), { token });
    expect(inside).toMatchObject({ name: 'Series A', welcomeMessage: 'Welcome.', allowDownload: false, email: 'pia@northzone.com' });
    expect(inside.watermark).toMatch(/^pia@northzone\.com · Exempel AB · \d{4}-\d{2}-\d{2}$/);
    expect(inside.items.map((i) => [i.name, i.viewable])).toEqual([
      ['Deck.pdf', true],
      ['Model.xlsx', false],
    ]);

    const deckItem = inside.items.find((i) => i.name === 'Deck.pdf')!;
    const viewed = await portalFile(v.ctx(), token, deckItem.id, 'view');
    const stamped = await PDFDocument.load(viewed.body!);
    expect(stamped.getPageCount()).toBe(4);
    expect(viewed.body!.length).toBeGreaterThan((await pdf(4)).length);
    await expect(portalFile(v.ctx(), token, deckItem.id, 'download')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(portalFile(v.ctx(), token, inside.items[1]!.id, 'view')).rejects.toMatchObject({ code: 'FORBIDDEN' });

    for (const page of [1, 1, 2, 4])
      await invoke(services.portal.heartbeat, v.ctx(), { token, itemId: deckItem.id, page, pageCount: 4, seconds: 10 });
    await invoke(services.portal.heartbeat, v.ctx(), { token, itemId: deckItem.id, page: 1, seconds: 60 });

    const stats = await invoke(services.dataroom.stats, auditor, { roomId: room.id });
    expect(stats.overview).toMatchObject({ visitors: 1, visits: 1, views: 1, downloads: 0, totalTimeMs: 70_000, failedPasswords: 1 });
    expect(stats.daily).toHaveLength(1);
    expect(stats.documents[0]).toMatchObject({
      name: 'Deck.pdf',
      uniqueVisitors: 1,
      views: 1,
      totalTimeMs: 70_000,
      pageCount: 4,
      pagesReached: 1,
    });
    const perPage = await invoke(services.dataroom.documentStats, admin, { roomId: room.id, documentId: deck.id });
    expect(perPage.pages.map((p) => p.timeMs)).toEqual([50_000, 10_000, 0, 10_000]);
    expect(perPage.visitors).toMatchObject([{ email: 'pia@northzone.com', furthestPage: 4 }]);

    const people = await invoke(services.dataroom.visitors, admin, { roomId: room.id });
    expect(people).toMatchObject([{ email: 'pia@northzone.com', name: 'Pia', links: ['Northzone'], visits: 1, documentsOpened: 1 }]);
    const pia = await invoke(services.dataroom.visitor, admin, { roomId: room.id, visitorId: people[0]!.id! });
    expect(pia.timeline.map((t) => t.type)).toEqual([
      'nda_accepted',
      'room_opened',
      'document_opened',
      'page_viewed',
      'page_viewed',
      'page_viewed',
      'page_viewed',
    ]);
    const [first] = await getDb().select().from(notifications).where(eq(notifications.type, 'dataroom.first_visit'));
    expect(first!.title).toBe('pia@northzone.com opened Series A');

    // Coming back with the same cookie goes straight in; a second visit is not a "first visit" again.
    expect(await v.start(token)).toMatchObject({ step: 'open' });
    const again = visitor('198.51.100.1');
    await again.start(token);
    await invoke(services.portal.identify, again.ctx(), { token, email: 'pia@northzone.com' });
    await invoke(services.portal.unlock, again.ctx(), { token, password: 'open-sesame' });
    expect((await getDb().select().from(notifications).where(eq(notifications.type, 'dataroom.first_visit'))).length).toBe(1);

    await invoke(services.dataroom.revokeLink, admin, { linkId: link.id });
    await expect(invoke(services.portal.room, v.ctx(), { token })).rejects.toMatchObject({ message: 'This link is not available' });
    const links = await invoke(services.dataroom.links, admin, { roomId: room.id });
    expect(links[0]).toMatchObject({ status: 'revoked', visitors: 1, failedPasswords: 1 });
  });

  it('locks a link for an IP after five wrong passwords and audits it', async () => {
    const room = await invoke(services.dataroom.create, admin, { name: 'Bank' });
    await invoke(services.dataroom.open, admin, { roomId: room.id });
    const link = await invoke(services.dataroom.createLink, admin, {
      roomId: room.id,
      label: 'Bank',
      password: 'right-password',
      requireEmail: false,
    });
    const token = link.url.split('/r/')[1]!;
    const v = visitor('192.0.2.50');
    expect(await v.start(token)).toMatchObject({ step: 'password' });
    for (let i = 0; i < 5; i++)
      await expect(invoke(services.portal.unlock, v.ctx(), { token, password: 'nope' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(invoke(services.portal.unlock, v.ctx(), { token, password: 'right-password' })).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
    const other = visitor('192.0.2.51');
    await other.start(token);
    expect(await invoke(services.portal.unlock, other.ctx(), { token, password: 'right-password' })).toMatchObject({ step: 'open' });
    const locked = await getDb().select().from(auditLog).where(eq(auditLog.action, 'dataroom.link_locked'));
    expect(locked).toHaveLength(1);
  });

  it('scopes a link to folders, zips what it shows and alerts on downloads', async () => {
    const room = await invoke(services.dataroom.create, admin, { name: 'Diligence' });
    const legal = await invoke(services.dataroom.createFolder, admin, { roomId: room.id, name: 'Legal' });
    const sub = await invoke(services.dataroom.createFolder, admin, { roomId: room.id, parentId: legal.id, name: 'Disputes' });
    const finance = await invoke(services.dataroom.createFolder, admin, { roomId: room.id, name: 'Finance' });
    await invoke(services.dataroom.addDocuments, admin, { roomId: room.id, folderId: sub.id, documentIds: [notes.id, deck.id] });
    await invoke(services.dataroom.addDocuments, admin, { roomId: room.id, folderId: finance.id, documentIds: [model.id] });
    await invoke(services.dataroom.open, admin, { roomId: room.id });
    const link = await invoke(services.dataroom.createLink, admin, {
      roomId: room.id,
      label: 'Counsel',
      requireEmail: false,
      allowDownload: true,
      watermark: false,
      folderIds: [legal.id],
    });
    const token = link.url.split('/r/')[1]!;
    const v = visitor();
    expect(await v.start(token)).toMatchObject({ step: 'open' });
    const inside = await invoke(services.portal.room, v.ctx(), { token });
    expect(inside.folders.map((f) => [f.name, f.parentId === legal.id]).sort()).toEqual([
      ['Disputes', true],
      ['Legal', false],
    ]);
    expect(inside.items.map((i) => i.name)).toEqual(['Notes.txt', 'Deck.pdf']);
    expect(inside.watermark).toBeNull();

    const zip = await portalZip(v.ctx(), token);
    const chunks: Buffer[] = [];
    const { PassThrough } = await import('node:stream');
    const out = new PassThrough();
    out.on('data', (c: Buffer) => chunks.push(c));
    await zip.write(out);
    expect(Object.keys(unzipSync(new Uint8Array(Buffer.concat(chunks)))).sort()).toEqual([
      'Legal/Disputes/Deck.pdf',
      'Legal/Disputes/Notes.txt',
    ]);

    const notesItem = inside.items.find((i) => i.name === 'Notes.txt')!;
    await expect(portalFile(v.ctx(), token, notesItem.id, 'view')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await portalFile(v.ctx(), token, notesItem.id, 'download')).body).toBeNull();
    const alerts = await getDb().select().from(notifications).where(eq(notifications.type, 'dataroom.download'));
    expect(alerts.map((a) => a.title)).toEqual(['A visitor downloaded Diligence', 'A visitor downloaded Notes.txt']);

    await invoke(services.dataroom.moveItem, admin, { itemId: notesItem.id, folderId: finance.id, position: 0 });
    expect((await invoke(services.portal.room, v.ctx(), { token })).items.map((i) => i.name)).toEqual(['Deck.pdf']);

    await invoke(services.dataroom.close, admin, { roomId: room.id });
    await expect(v.start(token)).rejects.toMatchObject({ message: 'This link is not available' });
  });

  it('keeps statistics when a document leaves the room, and the retention job removes old events', async () => {
    const [room] = (await invoke(services.dataroom.list, admin, {})).filter((r) => r.name === 'Series A');
    const full = await invoke(services.dataroom.get, admin, { roomId: room!.id });
    await invoke(services.dataroom.removeItem, admin, { itemId: full.items.find((i) => i.name === 'Deck.pdf')!.id });
    const stats = await invoke(services.dataroom.stats, admin, { roomId: room!.id });
    expect(stats.documents.find((d) => d.name === 'Deck.pdf')).toMatchObject({ inRoom: false, views: 1 });

    await invoke(services.settings.update, admin, {
      group: 'system',
      values: { auditRetentionDays: 0, updateCheck: true, dataroomEventRetentionDays: 30 },
    });
    const before = (await getDb().select().from(dataRoomEvents)).length;
    expect((await cleanupDataroom(systemCtx('worker'), new Date(Date.now() + 31 * 86_400_000))).events).toBe(before);
  });
});
