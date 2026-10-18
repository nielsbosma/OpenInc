import { randomUUID } from 'node:crypto';
import { eq, files, signingEvents, sql } from '@openinc/db';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ctx, closeDb, createCtx, getDb } from '../src/context.ts';
import { stopJobs } from '../src/jobs.ts';
import type { Email } from '../src/lib/email.ts';
import { getObjectBuffer, putObject } from '../src/lib/storage.ts';
import { services } from '../src/registry.ts';
import { invoke } from '../src/service.ts';
import { storeFile } from '../src/services/files.ts';
import { signerDocument } from '../src/services/signing.ts';
import { runSigningSeal } from '../src/signing/seal.ts';
import { verifySignedPdf } from '../src/signing/verify.ts';
import { freshInstall, reachable, userCtx } from './registry/db.ts';

const signer = (ip: string) => createCtx({ surface: 'web', ip, userAgent: 'vitest' });

async function emailsTo(address: string): Promise<Email[]> {
  const rows = await getDb().execute<{ data: Email }>(
    sql`select data from pgboss.job where name = 'email.send' and data->>'to' = ${address} order by created_on asc`,
  );
  return rows.rows.map((r) => r.data);
}

async function lastLink(address: string): Promise<string> {
  const mails = await emailsTo(address);
  const link = mails.flatMap((m) => m.text.match(/\/sign\/([\w-]+)/) ?? []).at(-1);
  if (!link) throw new Error(`no signing link for ${address}`);
  return link.replace('/sign/', '');
}

async function lastCode(address: string): Promise<string> {
  const mail = (await emailsTo(address)).filter((m) => /engångskod/.test(m.text)).at(-1);
  return mail!.text.match(/(\d{6})/)![1]!;
}

async function samplePdf(pages = 2) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]).drawText(`Styrelseprotokoll sida ${i + 1}`, { x: 50, y: 780, size: 16 });
  return Buffer.from(await doc.save());
}

describe.runIf(await reachable())('signing (database)', () => {
  let admin: Ctx;
  let auditor: Ctx;
  let documentId: string;

  beforeAll(async () => {
    admin = await freshInstall();
    auditor = await userCtx('auditor', 'audrey@example.com');
    const file = await storeFile(admin, {
      name: 'Protokoll.pdf',
      contentType: 'application/pdf',
      kind: 'document',
      data: await samplePdf(),
    });
    documentId = (await invoke(services.documents.add, admin, { fileId: file.id })).id;
  });

  afterAll(async () => {
    await stopJobs();
    await closeDb();
  });

  async function draft(signers: { name: string; email: string; order?: number }[], routing: 'parallel' | 'sequential' = 'parallel') {
    const { id } = await invoke(services.signing.create, admin, { documentId });
    const recipients = signers.map((s) => ({ id: randomUUID(), role: 'signer' as const, order: s.order ?? 1, ...s }));
    await invoke(services.signing.update, admin, {
      envelopeId: id,
      title: 'Styrelseprotokoll 2026-10-18',
      message: 'Signera gärna idag.',
      routing,
      recipients: [...recipients, { id: randomUUID(), name: 'Revisor', email: 'revisor@example.com', role: 'cc', order: 1 }],
      fields: recipients.flatMap((r, i) => [
        { id: randomUUID(), recipientId: r.id, type: 'signature' as const, page: 2, x: 0.1, y: 0.7 + i * 0.1, width: 0.3, height: 0.06 },
        { id: randomUUID(), recipientId: r.id, type: 'date' as const, page: 2, x: 0.5, y: 0.72 + i * 0.1, width: 0.2, height: 0.03 },
        { id: randomUUID(), recipientId: r.id, type: 'name' as const, page: 2, x: 0.5, y: 0.75 + i * 0.1, width: 0.3, height: 0.03 },
      ]),
    });
    return { id, recipients };
  }

  async function signAs(email: string, ip: string, value = 'Signed') {
    const token = await lastLink(email);
    const ctx = signer(ip);
    expect((await invoke(services.signing.describe, ctx, { token })).state).toBe('open');
    await invoke(services.signing.requestCode, ctx, { token });
    const code = await lastCode(email);
    await expect(invoke(services.signing.verifyCode, ctx, { token, code: code === '000000' ? '111111' : '000000' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    const { access } = await invoke(services.signing.verifyCode, ctx, { token, code });
    const view = await invoke(services.signing.view, ctx, { token, access });
    const signature = view.fields.find((f) => f.type === 'signature')!;
    await expect(invoke(services.signing.sign, ctx, { token, access, values: [], consent: true })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    return invoke(services.signing.sign, ctx, { token, access, values: [{ fieldId: signature.id, value }], consent: true });
  }

  it('runs a sequential envelope to a sealed PDF that verifies', async () => {
    const { id } = await draft(
      [
        { name: 'Anna Andersson', email: 'anna@example.com', order: 1 },
        { name: 'Örjan Östlund', email: 'orjan@example.com', order: 2 },
      ],
      'sequential',
    );
    await expect(invoke(services.signing.send, auditor, { envelopeId: id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const sent = await invoke(services.signing.send, admin, { envelopeId: id });
    expect(sent.documentHash).toMatch(/^[0-9a-f]{64}$/);
    await expect(invoke(services.signing.update, admin, { envelopeId: id, title: 'x', recipients: [], fields: [] })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    expect(await emailsTo('orjan@example.com')).toHaveLength(0);
    expect((await signAs('anna@example.com', '10.0.0.1')).allSigned).toBe(false);
    expect(await emailsTo('orjan@example.com')).toHaveLength(1);

    const last = await signAs('orjan@example.com', '10.0.0.2', 'Örjan Östlund');
    expect(last.allSigned).toBe(true);

    const result = await runSigningSeal(createCtx({ surface: 'worker' }), { envelopeId: id });
    expect(result.sealed).toBe(true);
    expect((await runSigningSeal(createCtx({ surface: 'worker' }), { envelopeId: id })).sealed).toBe(false);

    const envelope = await invoke(services.signing.get, auditor, { envelopeId: id });
    expect(envelope.status).toBe('completed');
    expect(envelope.chain.ok).toBe(true);
    expect(envelope.events.map((e) => e.type)).toEqual([
      'sent',
      'invited',
      'code_sent',
      'verified',
      'signed',
      'invited',
      'code_sent',
      'verified',
      'signed',
      'completed',
    ]);
    const listed = await invoke(services.documents.list, admin, {});
    expect(listed.documents.map((d) => d.name)).toContain('Styrelseprotokoll 2026-10-18 (signerat).pdf');

    const [sealedFile] = await getDb()
      .select()
      .from(files)
      .where(eq(files.id, envelope.sealed!.fileUrl.split('/')[3]!));
    const sealed = await getObjectBuffer(sealedFile!.storageKey);
    const check = await verifySignedPdf(createCtx({ surface: 'web' }), sealed);
    expect(check.outcome).toBe('valid');
    expect(check.envelope?.signers.map((s) => s.name)).toEqual(['Anna Andersson', 'Örjan Östlund']);
    expect((await PDFDocument.load(sealed)).getPageCount()).toBe(3);

    const tampered = Buffer.from(sealed);
    tampered[100] = tampered[100]! ^ 1;
    expect((await verifySignedPdf(createCtx({ surface: 'web' }), tampered)).outcome).toBe('invalid');
    const appended = Buffer.concat([sealed, Buffer.from('\n% extra\n')]);
    expect((await verifySignedPdf(createCtx({ surface: 'web' }), appended)).outcome).toBe('modified');
    expect((await verifySignedPdf(createCtx({ surface: 'web' }), await samplePdf(1))).outcome).toBe('not_signed');

    const completion = (await emailsTo('revisor@example.com')).at(-1)!;
    expect(completion.attachments?.[0]?.filename).toBe('Styrelseprotokoll 2026-10-18 (signerat).pdf');
  });

  it('keeps the evidence trail immutable', async () => {
    const [event] = await getDb().select().from(signingEvents).limit(1);
    await expect(getDb().update(signingEvents).set({ type: 'forged' }).where(eq(signingEvents.id, event!.id))).rejects.toThrow();
    await expect(getDb().delete(signingEvents).where(eq(signingEvents.id, event!.id))).rejects.toThrow();
  });

  it('stops when the stored document is swapped after sending', async () => {
    const { id } = await draft([{ name: 'Bo Berg', email: 'bo@example.com' }]);
    await invoke(services.signing.send, admin, { envelopeId: id });
    const token = await lastLink('bo@example.com');
    const ctx = signer('10.0.0.3');
    await invoke(services.signing.requestCode, ctx, { token });
    const { access } = await invoke(services.signing.verifyCode, ctx, { token, code: await lastCode('bo@example.com') });
    expect((await signerDocument(ctx, token, access)).bytes.subarray(0, 5).toString()).toBe('%PDF-');

    const envelope = await invoke(services.signing.get, admin, { envelopeId: id });
    const [file] = await getDb()
      .select()
      .from(files)
      .where(eq(files.id, envelope.fileUrl.split('/')[3]!));
    const original = await getObjectBuffer(file!.storageKey);
    await putObject(file!.storageKey, await samplePdf(2), 'application/pdf');
    await expect(signerDocument(ctx, token, access)).rejects.toMatchObject({ code: 'CONFLICT' });
    await putObject(file!.storageKey, original, 'application/pdf');

    await invoke(services.signing.void, admin, { envelopeId: id, reason: 'Fel version' });
    await expect(invoke(services.signing.describe, ctx, { token })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('locks the code after too many wrong attempts and records a decline', async () => {
    const { id } = await draft([{ name: 'Cecilia Carlsson', email: 'cecilia@example.com' }]);
    await invoke(services.signing.send, admin, { envelopeId: id });
    const token = await lastLink('cecilia@example.com');
    const ctx = signer('10.0.0.4');
    await invoke(services.signing.requestCode, ctx, { token });
    await expect(invoke(services.signing.requestCode, ctx, { token })).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    const right = await lastCode('cecilia@example.com');
    const wrong = right === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) await expect(invoke(services.signing.verifyCode, ctx, { token, code: wrong })).rejects.toBeTruthy();
    await expect(invoke(services.signing.verifyCode, ctx, { token, code: right })).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });

    await getDb().execute(sql`update signing_recipients set code_sent_at = now() - interval '2 minutes'`);
    await invoke(services.signing.requestCode, ctx, { token });
    const { access } = await invoke(services.signing.verifyCode, ctx, { token, code: await lastCode('cecilia@example.com') });
    await expect(invoke(services.signing.view, ctx, { token, access: `${access}x` })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await invoke(services.signing.decline, ctx, { token, access, reason: 'Fel belopp i punkt 3' });
    expect((await invoke(services.signing.get, admin, { envelopeId: id })).status).toBe('declined');
  });

  it('refuses a send without a signature field for every signer', async () => {
    const { id } = await invoke(services.signing.create, admin, { documentId });
    await invoke(services.signing.update, admin, {
      envelopeId: id,
      title: 'Avtal',
      recipients: [{ id: randomUUID(), name: 'Dan', email: 'dan@example.com' }],
      fields: [],
    });
    await expect(invoke(services.signing.send, admin, { envelopeId: id })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await invoke(services.signing.deleteDraft, admin, { envelopeId: id });
    expect((await invoke(services.signing.list, admin, {})).find((e) => e.id === id)).toBeUndefined();
  });
});
