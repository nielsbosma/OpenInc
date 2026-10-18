import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ctx, closeDb } from '../src/context.ts';
import { stopJobs } from '../src/jobs.ts';
import { services } from '../src/registry.ts';
import { invoke } from '../src/service.ts';
import { storeFile } from '../src/services/files.ts';
import { getSettingsOrDefaults, saveSettings } from '../src/settings.ts';
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

  it('stops suggesting the template once someone skips it', async () => {
    await expect(invoke(services.documents.skipTemplate, auditor, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await invoke(services.documents.skipTemplate, admin, {});
    expect((await invoke(services.documents.list, auditor, {})).suggestTemplate).toBe(false);
    await saveSettings(admin, 'onboarding', { ...(await getSettingsOrDefaults('onboarding')), documentsTemplateSkippedAt: null });
  });

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
});
