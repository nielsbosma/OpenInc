import { eq, files, notifications } from '@openinc/db';
import { unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ctx, closeDb, getDb, systemCtx } from '../src/context.ts';
import { deleteOldDocumentZips, runDocumentsZip } from '../src/documents/zip.ts';
import { stopJobs } from '../src/jobs.ts';
import { getObjectBuffer } from '../src/lib/storage.ts';
import { services } from '../src/registry.ts';
import { invoke } from '../src/service.ts';
import { storeFile } from '../src/services/files.ts';
import { freshInstall, reachable, userCtx } from './registry/db.ts';

describe.runIf(await reachable())('documents (database)', () => {
  let admin: Ctx;
  let auditor: Ctx;

  beforeAll(async () => {
    admin = await freshInstall();
    auditor = await userCtx('auditor', 'audrey@example.com');
  });

  afterAll(async () => {
    await stopJobs();
    await closeDb();
  });

  const upload = (name: string) =>
    storeFile(admin, { name, contentType: 'application/pdf', kind: 'document', data: Buffer.from(`%PDF ${name}`) });

  it('suggests the template while empty and creates it once', async () => {
    expect((await invoke(services.documents.list, admin, {})).suggestTemplate).toBe(true);
    const first = await invoke(services.documents.applyTemplate, admin, {});
    expect(first.created).toBeGreaterThan(10);
    expect((await invoke(services.documents.applyTemplate, admin, {})).created).toBe(0);
    const top = await invoke(services.documents.list, admin, {});
    expect(top.suggestTemplate).toBe(false);
    expect(top.folders.map((f) => f.name)).toContain('Governance');
  });

  it('files, moves, renames, finds and deletes documents', async () => {
    const folders = await invoke(services.documents.folders, admin, {});
    const board = folders.find((f) => f.path === 'Governance / Board Meetings')!;
    const empty = await invoke(services.documents.list, admin, { folderId: board.id });
    expect(empty.hints).toContain('Board Minutes, Signed');
    expect(empty.path.map((p) => p.name)).toEqual(['Governance', 'Board Meetings']);

    const file = await upload('minutes-2026.pdf');
    const doc = await invoke(services.documents.add, admin, { fileId: file.id, folderId: board.id });
    await expect(invoke(services.documents.add, admin, { fileId: file.id })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await invoke(services.documents.list, auditor, { folderId: board.id })).documents).toHaveLength(1);
    await expect(invoke(services.documents.add, auditor, { fileId: file.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await invoke(services.documents.rename, admin, { documentId: doc.id, name: 'Board Minutes 2026.pdf' });
    await invoke(services.documents.move, admin, { documentId: doc.id, folderId: null });
    const found = await invoke(services.documents.search, admin, { query: 'minutes 2026' });
    expect(found.map((d) => [d.name, d.folderPath])).toEqual([['Board Minutes 2026.pdf', '']]);

    await invoke(services.documents.delete, admin, { documentId: doc.id });
    expect((await invoke(services.documents.list, admin, {})).documents).toHaveLength(0);
    await expect(invoke(services.files.get, admin, { fileId: file.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps folder names unique per parent and deletes only empty folders', async () => {
    const parent = await invoke(services.documents.createFolder, admin, { name: 'Projects' });
    await expect(invoke(services.documents.createFolder, admin, { name: 'projects' })).rejects.toMatchObject({ code: 'CONFLICT' });
    const child = await invoke(services.documents.createFolder, admin, { parentId: parent.id, name: 'Alpha' });
    await expect(invoke(services.documents.deleteFolder, admin, { folderId: parent.id })).rejects.toMatchObject({ code: 'CONFLICT' });
    await invoke(services.documents.renameFolder, admin, { folderId: child.id, name: 'Beta' });
    await invoke(services.documents.deleteFolder, admin, { folderId: child.id });
    await invoke(services.documents.deleteFolder, admin, { folderId: parent.id });
  });

  it('zips a folder with its subfolders and notifies with a link only the requester can open', async () => {
    const folders = await invoke(services.documents.folders, admin, {});
    const governance = folders.find((f) => f.path === 'Governance')!;
    const board = folders.find((f) => f.path === 'Governance / Board Meetings')!;
    for (const [name, folderId] of [
      ['Minutes.pdf', board.id],
      ['Minutes.pdf', board.id],
      ['Rules.txt', governance.id],
    ] as const) {
      const file = await upload(name);
      await invoke(services.documents.add, admin, { fileId: file.id, folderId });
    }
    await expect(invoke(services.documents.downloadZip, admin, { folderId: governance.id })).resolves.toHaveProperty('jobId');

    const result = await runDocumentsZip(systemCtx('worker'), { userId: admin.actor!.userId, folderId: governance.id });
    const fileId = result.fileId!;
    expect(result.documents).toBe(3);
    const file = await invoke(services.files.get, admin, { fileId: fileId });
    expect(file.name).toMatch(/^Governance \d{4}-\d{2}-\d{2}\.zip$/);
    const [row] = await getDb().select().from(files).where(eq(files.id, fileId));
    const entries = unzipSync(new Uint8Array(await getObjectBuffer(row!.storageKey)));
    expect(Object.keys(entries).sort()).toEqual([
      'Board Meetings/',
      'Board Meetings/Minutes (2).pdf',
      'Board Meetings/Minutes.pdf',
      'General Meetings/',
      'Policies/',
      'Rules.txt',
    ]);
    expect(new TextDecoder().decode(entries['Rules.txt'])).toBe('%PDF Rules.txt');
    await expect(invoke(services.files.get, auditor, { fileId: fileId })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const [note] = await getDb().select().from(notifications).where(eq(notifications.type, 'documents.zip_ready'));
    expect(note!.link).toBe(`/api/files/${fileId}/content?download`);

    expect(await deleteOldDocumentZips(systemCtx('worker'), new Date(Date.now() + 8 * 24 * 60 * 60 * 1000))).toBe(1);
    await expect(invoke(services.files.get, admin, { fileId: fileId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
