import { randomUUID } from 'node:crypto';
import { asc, documents, eq, files, signingEnvelopes, signingFields, signingRecipients, users } from '@openinc/db';
import { audit } from '../audit.ts';
import type { Ctx } from '../context.ts';
import { appUrl } from '../env.ts';
import { queueEmail } from '../jobs.ts';
import { renderEmail } from '../lib/email.ts';
import { putObject } from '../lib/storage.ts';
import { notify } from '../services/notifications.ts';
import { frozenDocument, SIGNING_METHOD_LABEL } from '../services/signing.ts';
import { getSettings } from '../settings.ts';
import { appendEvent, listEvents, verifyEvents } from './chain.ts';
import { loadSealingKey } from './keys.ts';
import { appendCertificate, loadPdf, sealPdf, stampFields } from './pdf.ts';
import { sha256Hex } from './pki.ts';

/** Above this the signed PDF is not attached to the completion email; signers download it from their link instead. */
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/**
 * Runs once every signer has signed: stamps the field values, appends the signing certificate, seals the
 * PDF with the install's key, files it in Documents next to the original and sends everyone a copy.
 */
export async function runSigningSeal(ctx: Ctx, { envelopeId }: { envelopeId: string }) {
  const [envelope] = await ctx.db.select().from(signingEnvelopes).where(eq(signingEnvelopes.id, envelopeId));
  if (envelope?.status !== 'sent' || envelope.sealedFileId) return { sealed: false };
  const recipients = await ctx.db
    .select()
    .from(signingRecipients)
    .where(eq(signingRecipients.envelopeId, envelope.id))
    .orderBy(asc(signingRecipients.order), asc(signingRecipients.name));
  const signers = recipients.filter((r) => r.role === 'signer');
  if (!signers.length || signers.some((s) => s.status !== 'signed')) return { sealed: false };

  const events = await listEvents(ctx, envelope.id);
  const chain = verifyEvents(events);
  if (!chain.ok) throw new Error(`Signing events of envelope ${envelope.id} fail their hash chain at ${chain.brokenAt}`);

  const original = await frozenDocument(ctx, envelope);
  const fields = await ctx.db.select().from(signingFields).where(eq(signingFields.envelopeId, envelope.id));
  const company = await getSettings('company');
  const timeZone = company?.timeZone;
  const when = (d: Date) =>
    new Intl.DateTimeFormat('sv-SE', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    }).format(d);
  const [file] = await ctx.db.select().from(files).where(eq(files.id, envelope.fileId));
  const [sender] = envelope.createdBy ? await ctx.db.select().from(users).where(eq(users.id, envelope.createdBy)) : [];
  const signedEvents = new Map(events.filter((e) => e.type === 'signed').map((e) => [e.recipientId, e]));
  const completedAt = new Date();

  const doc = await loadPdf(original);
  await stampFields(doc, fields);
  const key = await loadSealingKey(ctx);
  await appendCertificate(doc, {
    envelopeId: envelope.id,
    title: envelope.title,
    fileName: file?.name ?? '',
    company: company?.name ?? 'OpenInc',
    documentHash: envelope.documentHash!,
    sentBy: sender ? `${sender.name} <${sender.email}>` : (company?.name ?? ''),
    sentAt: when(envelope.sentAt!),
    completedAt: when(completedAt),
    chainHead: chain.head,
    verifyUrl: `${appUrl()}/verify`,
    sealedBy: key.issuerName,
    signers: recipients.map((r) => {
      const signed = signedEvents.get(r.id);
      return {
        name: r.name,
        email: r.email,
        role: r.role,
        status: r.status,
        signedAt: r.signedAt ? when(r.signedAt) : null,
        method: SIGNING_METHOD_LABEL,
        ip: signed?.ip ?? null,
        statementHash: (signed?.payload.statementHash as string | undefined) ?? null,
      };
    }),
  });
  const sealed = await sealPdf(doc, key, {
    envelopeId: envelope.id,
    name: company?.name ?? 'OpenInc',
    reason: `Signerat av ${signers.map((s) => s.name).join(', ')}`,
    location: company?.country ?? '',
    contactInfo: appUrl(),
    signingTime: completedAt,
  });
  const sealedHash = sha256Hex(sealed);

  const fileId = randomUUID();
  const storageKey = `files/document/${fileId.slice(0, 2)}/${fileId}`;
  const name = `${envelope.title} (signerat).pdf`;
  await putObject(storageKey, sealed, 'application/pdf');

  const result = await ctx.db.transaction(async (tx) => {
    const t = { ...ctx, db: tx };
    const [fresh] = await tx.select().from(signingEnvelopes).where(eq(signingEnvelopes.id, envelope.id)).for('update');
    if (fresh?.status !== 'sent' || fresh.sealedFileId) return null;
    await tx.insert(files).values({
      id: fileId,
      kind: 'document',
      name,
      contentType: 'application/pdf',
      sizeBytes: sealed.length,
      storageKey,
      uploadedBy: envelope.createdBy,
    });
    const [originalDoc] = envelope.documentId ? await tx.select().from(documents).where(eq(documents.id, envelope.documentId)) : [];
    const [filed] = await tx
      .insert(documents)
      .values({ folderId: originalDoc?.folderId ?? null, fileId, name, createdBy: envelope.createdBy })
      .returning();
    await tx
      .update(signingEnvelopes)
      .set({ status: 'completed', completedAt, sealedFileId: fileId, sealedDocumentId: filed!.id, sealedHash })
      .where(eq(signingEnvelopes.id, envelope.id));
    await appendEvent(t, {
      envelopeId: envelope.id,
      type: 'completed',
      payload: { sealedHash, chainHead: chain.head, documentId: filed!.id },
    });
    await audit(t, {
      action: 'signing.complete',
      entityType: 'signing_envelope',
      entityId: envelope.id,
      after: { sealedHash, documentId: filed!.id, signers: signers.length },
    });
    return { documentId: filed!.id };
  });
  if (!result) return { sealed: false };

  const attach = sealed.length <= MAX_ATTACHMENT_BYTES;
  for (const r of recipients) {
    const email = renderEmail({
      to: r.email,
      subject: `Klart: ”${envelope.title}” är signerat`,
      greeting: `Hej ${r.name},`,
      paragraphs: [
        `Alla har nu signerat ”${envelope.title}”.`,
        attach
          ? 'Det signerade dokumentet är bifogat, med ett signeringsintyg på sista sidan. Spara det.'
          : `Det signerade dokumentet är för stort för att bifogas. Be ${company?.name ?? 'avsändaren'} om en kopia.`,
        `Dokumentets äkthet kan kontrolleras på ${appUrl()}/verify.`,
      ],
    });
    if (attach)
      email.attachments = [{ filename: name, content: sealed.toString('base64'), encoding: 'base64', contentType: 'application/pdf' }];
    await queueEmail(email);
  }
  if (envelope.createdBy) {
    await notify(ctx.db, [envelope.createdBy], {
      type: 'signing.completed',
      title: `${envelope.title} is signed`,
      body: 'Everyone has signed. The sealed PDF is filed next to the original in Documents.',
      link: `/documents/signing/${envelope.id}`,
      email: true,
    });
  }
  return { sealed: true, documentId: result.documentId, sealedHash };
}
