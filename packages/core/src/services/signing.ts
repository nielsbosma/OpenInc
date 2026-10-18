import { randomInt } from 'node:crypto';
import {
  and,
  asc,
  desc,
  documents,
  eq,
  files,
  inArray,
  isNull,
  signingEnvelopes,
  signingFields,
  signingRecipients,
  sql,
  users,
} from '@openinc/db';
import {
  createEnvelopeInput,
  declineEnvelopeInput,
  envelopeIdInput,
  listEnvelopesInput,
  SIGNING_CONSENT,
  sendEnvelopeInput,
  signEnvelopeInput,
  signerAccessInput,
  signerTokenInput,
  updateEnvelopeInput,
  verifySignerCodeInput,
  voidEnvelopeInput,
} from '@openinc/shared';
import { audit } from '../audit.ts';
import type { Ctx } from '../context.ts';
import { appUrl } from '../env.ts';
import { AppError, badRequest, conflict, forbidden, notFound, tooManyRequests } from '../errors.ts';
import { enqueue, queueEmail } from '../jobs.ts';
import { randomToken, safeEqual, sha256, sign, verifySigned } from '../lib/crypto.ts';
import { renderEmail } from '../lib/email.ts';
import { getObjectBuffer } from '../lib/storage.ts';
import { canonicalJson } from '../registry/hash.ts';
import { defineService } from '../service.ts';
import { getSettings } from '../settings.ts';
import { appendEvent, listEvents, verifyEvents } from '../signing/chain.ts';
import { loadPdf } from '../signing/pdf.ts';
import { sha256Hex } from '../signing/pki.ts';
import { fileUrl } from './files.ts';
import { notify } from './notifications.ts';

type Envelope = typeof signingEnvelopes.$inferSelect;
type Recipient = typeof signingRecipients.$inferSelect;

const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_RESEND_MS = 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const ACCESS_TTL_SECONDS = 60 * 60;
const MAX_DRAWN_SIGNATURE = 300_000;

/** Signer-facing text is Swedish; the app around it is English. */
export const SIGNING_METHOD_LABEL = 'Personlig länk och engångskod via e-post';

async function loadEnvelope(ctx: Ctx, envelopeId: string): Promise<Envelope> {
  const [row] = await ctx.db.select().from(signingEnvelopes).where(eq(signingEnvelopes.id, envelopeId));
  if (!row) throw notFound('Envelope');
  return row;
}

async function loadRecipients(ctx: Ctx, envelopeId: string): Promise<Recipient[]> {
  return ctx.db
    .select()
    .from(signingRecipients)
    .where(eq(signingRecipients.envelopeId, envelopeId))
    .orderBy(asc(signingRecipients.order), asc(signingRecipients.name));
}

function isExpired(envelope: Envelope, now = new Date()) {
  return envelope.status === 'sent' && !!envelope.expiresAt && envelope.expiresAt < now;
}

const formatSwedish = (value: Date, timeZone?: string) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(value);

async function companyInfo() {
  const company = await getSettings('company');
  return { name: company?.name ?? 'OpenInc', timeZone: company?.timeZone };
}

/** The bytes that were sent, checked against the hash frozen at send. A swapped object fails closed. */
export async function frozenDocument(ctx: Ctx, envelope: Envelope): Promise<Buffer> {
  const [file] = await ctx.db.select().from(files).where(eq(files.id, envelope.fileId));
  if (!file) throw notFound('Document');
  const bytes = await getObjectBuffer(file.storageKey);
  if (envelope.documentHash && sha256Hex(bytes) !== envelope.documentHash)
    throw conflict('The stored document no longer matches the one that was sent. Signing is stopped.');
  return bytes;
}

function signerLink(token: string) {
  return `${appUrl()}/sign/${token}`;
}

/** Sends each recipient a fresh personal link. Old links stop working. */
async function invite(ctx: Ctx, envelope: Envelope, recipients: Recipient[], reminder = false) {
  if (!recipients.length) return;
  const company = await companyInfo();
  const [sender] = envelope.createdBy ? await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, envelope.createdBy)) : [];
  const from = sender?.name ?? company.name;
  for (const r of recipients) {
    const token = randomToken();
    await ctx.db
      .update(signingRecipients)
      .set({ tokenHash: sha256(token), status: r.status === 'waiting' ? 'sent' : r.status })
      .where(eq(signingRecipients.id, r.id));
    await queueEmail(
      renderEmail({
        to: r.email,
        subject: reminder ? `Påminnelse: signera ”${envelope.title}”` : `${from} vill att du signerar ”${envelope.title}”`,
        greeting: `Hej ${r.name},`,
        paragraphs: [
          `${from} på ${company.name} har skickat ”${envelope.title}” till dig för elektronisk signering.`,
          ...(envelope.message ? [envelope.message] : []),
          'Öppna länken nedan. Du får en engångskod till den här adressen innan du kan läsa och signera dokumentet.',
        ],
        action: { label: 'Granska och Signera', url: signerLink(token) },
        footer: `Länken är personlig, vidarebefordra den inte.${envelope.expiresAt ? ` Den gäller till ${formatSwedish(envelope.expiresAt, company.timeZone)}.` : ''}`,
      }),
    );
    await appendEvent(ctx, {
      envelopeId: envelope.id,
      recipientId: r.id,
      type: reminder ? 'reminded' : 'invited',
      payload: { email: r.email },
    });
  }
}

/** In order: the lowest order number that still has someone to sign. In parallel: everyone. */
function nextToInvite(envelope: Envelope, recipients: Recipient[]): Recipient[] {
  const signers = recipients.filter((r) => r.role === 'signer');
  if (envelope.routing === 'parallel') return signers.filter((r) => r.status === 'waiting');
  const pending = signers.filter((r) => r.status !== 'signed');
  if (!pending.length) return [];
  const order = Math.min(...pending.map((r) => r.order));
  return pending.filter((r) => r.order === order && r.status === 'waiting');
}

function toRecipientDto(r: Recipient) {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role as 'signer' | 'cc',
    order: r.order,
    status: r.status,
    signedAt: r.signedAt,
    declinedAt: r.declinedAt,
    declineReason: r.declineReason,
  };
}

function statusOf(envelope: Envelope) {
  return isExpired(envelope) ? 'expired' : envelope.status;
}

export const listEnvelopes = defineService({
  name: 'signing.list',
  description:
    'List documents sent for signature (envelopes), newest first: title, status (draft, sent = waiting for others, completed, declined, voided, expired), how many signers have signed, and who sent it. Filter by status.',
  kind: 'query',
  access: 'signing.read',
  input: listEnvelopesInput,
  async handler(ctx, input) {
    const rows = await ctx.db
      .select({ envelope: signingEnvelopes, senderName: users.name })
      .from(signingEnvelopes)
      .leftJoin(users, eq(users.id, signingEnvelopes.createdBy))
      .orderBy(desc(signingEnvelopes.createdAt))
      .limit(500);
    const ids = rows.map((r) => r.envelope.id);
    const recipients = ids.length ? await ctx.db.select().from(signingRecipients).where(inArray(signingRecipients.envelopeId, ids)) : [];
    return rows
      .map((r) => {
        const signers = recipients.filter((x) => x.envelopeId === r.envelope.id && x.role === 'signer');
        return {
          id: r.envelope.id,
          title: r.envelope.title,
          status: statusOf(r.envelope),
          sentBy: r.senderName,
          createdAt: r.envelope.createdAt,
          sentAt: r.envelope.sentAt,
          completedAt: r.envelope.completedAt,
          signers: signers.length,
          signed: signers.filter((x) => x.status === 'signed').length,
          recipients: signers.map((x) => x.name),
        };
      })
      .filter((e) => !input.status || e.status === input.status);
  },
});

export const getEnvelope = defineService({
  name: 'signing.get',
  description:
    'One envelope: its document, recipients and their status, the fields placed for each signer, and the full evidence trail of events with a check of its hash chain. Includes the signed PDF once completed.',
  kind: 'query',
  access: 'signing.read',
  input: envelopeIdInput,
  async handler(ctx, input) {
    const envelope = await loadEnvelope(ctx, input.envelopeId);
    const recipients = await loadRecipients(ctx, envelope.id);
    const fields = await ctx.db.select().from(signingFields).where(eq(signingFields.envelopeId, envelope.id));
    const events = await listEvents(ctx, envelope.id);
    const [sender] = envelope.createdBy
      ? await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, envelope.createdBy))
      : [];
    const [file] = await ctx.db.select({ name: files.name }).from(files).where(eq(files.id, envelope.fileId));
    const chain = verifyEvents(events);
    return {
      id: envelope.id,
      title: envelope.title,
      message: envelope.message,
      status: statusOf(envelope),
      routing: envelope.routing as 'parallel' | 'sequential',
      pageCount: envelope.pageCount,
      documentId: envelope.documentId,
      fileName: file?.name ?? '',
      fileUrl: fileUrl(envelope.fileId),
      documentHash: envelope.documentHash,
      sentBy: sender?.name ?? null,
      createdAt: envelope.createdAt,
      sentAt: envelope.sentAt,
      expiresAt: envelope.expiresAt,
      completedAt: envelope.completedAt,
      voidedAt: envelope.voidedAt,
      voidReason: envelope.voidReason,
      sealed: envelope.sealedFileId
        ? { fileUrl: fileUrl(envelope.sealedFileId), documentId: envelope.sealedDocumentId, hash: envelope.sealedHash }
        : null,
      recipients: recipients.map(toRecipientDto),
      fields: fields.map((f) => ({
        id: f.id,
        recipientId: f.recipientId,
        type: f.type,
        page: f.page,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        required: f.required,
        label: f.label,
        filled: f.value !== null,
      })),
      events: events.map((e) => ({
        seq: e.seq,
        type: e.type,
        recipientId: e.recipientId,
        occurredAt: e.occurredAt,
        ip: e.ip,
        hash: e.hash,
      })),
      chain: { ok: chain.ok, head: chain.head, brokenAt: chain.brokenAt },
    };
  },
});

export const createEnvelope = defineService({
  name: 'signing.create',
  description:
    'Start a draft envelope that sends a PDF from Documents for signature. Then add recipients and place fields with signing.update, and send it with signing.send.',
  kind: 'mutation',
  access: 'signing.send',
  input: createEnvelopeInput,
  async handler(ctx, input) {
    const [row] = await ctx.db
      .select({ document: documents, file: files })
      .from(documents)
      .innerJoin(files, eq(files.id, documents.fileId))
      .where(and(eq(documents.id, input.documentId), isNull(files.deletedAt)));
    if (!row) throw notFound('Document');
    if (row.file.contentType !== 'application/pdf') throw badRequest('Only PDF documents can be sent for signature');
    let pageCount: number;
    try {
      pageCount = (await loadPdf(await getObjectBuffer(row.file.storageKey))).getPageCount();
    } catch (error) {
      throw badRequest((error as Error).message);
    }
    const [envelope] = await ctx.db
      .insert(signingEnvelopes)
      .values({
        documentId: row.document.id,
        fileId: row.file.id,
        title: row.document.name.replace(/\.pdf$/i, ''),
        pageCount,
        createdBy: ctx.actor!.userId,
      })
      .returning();
    await audit(ctx, {
      action: 'signing.create',
      entityType: 'signing_envelope',
      entityId: envelope!.id,
      after: { title: envelope!.title, documentId: row.document.id, pageCount },
    });
    return { id: envelope!.id };
  },
});

export const updateEnvelope = defineService({
  name: 'signing.update',
  description:
    'Replace a draft envelope’s title, message, routing (parallel, or sequential by each recipient’s order), recipients (signers and cc) and fields. Field positions are fractions of the page from its top left corner. Every signer needs at least one signature field before sending.',
  kind: 'mutation',
  access: 'signing.send',
  input: updateEnvelopeInput,
  async handler(ctx, input) {
    const envelope = await loadEnvelope(ctx, input.envelopeId);
    if (envelope.status !== 'draft') throw conflict('Only a draft can be changed');
    const emails = input.recipients.map((r) => r.email);
    if (new Set(emails).size !== emails.length) throw badRequest('Each recipient needs a different email address');
    const recipientIds = new Set(input.recipients.map((r) => r.id));
    for (const f of input.fields) {
      if (!recipientIds.has(f.recipientId)) throw badRequest('A field belongs to a recipient who is not on the envelope');
      if (f.page > envelope.pageCount) throw badRequest(`The document has ${envelope.pageCount} pages`);
      if (input.recipients.find((r) => r.id === f.recipientId)?.role === 'cc') throw badRequest('Fields can only be given to signers');
    }
    await ctx.db.delete(signingFields).where(eq(signingFields.envelopeId, envelope.id));
    await ctx.db.delete(signingRecipients).where(eq(signingRecipients.envelopeId, envelope.id));
    if (input.recipients.length)
      await ctx.db.insert(signingRecipients).values(input.recipients.map((r) => ({ ...r, envelopeId: envelope.id })));
    if (input.fields.length) await ctx.db.insert(signingFields).values(input.fields.map((f) => ({ ...f, envelopeId: envelope.id })));
    await ctx.db
      .update(signingEnvelopes)
      .set({ title: input.title, message: input.message, routing: input.routing })
      .where(eq(signingEnvelopes.id, envelope.id));
    await audit(ctx, {
      action: 'signing.update',
      entityType: 'signing_envelope',
      entityId: envelope.id,
      before: { title: envelope.title, routing: envelope.routing },
      after: {
        title: input.title,
        routing: input.routing,
        recipients: input.recipients.map((r) => `${r.name} <${r.email}> (${r.role})`),
        fields: input.fields.length,
      },
    });
    return { id: envelope.id };
  },
});

export const sendEnvelope = defineService({
  name: 'signing.send',
  description:
    'Send a draft envelope. The document is frozen by its SHA-256 hash, and signers get a personal link by email (in parallel, or one order group at a time). The link expires after expiresInDays.',
  kind: 'mutation',
  access: 'signing.send',
  input: sendEnvelopeInput,
  async handler(ctx, input) {
    const envelope = await loadEnvelope(ctx, input.envelopeId);
    if (envelope.status !== 'draft') throw conflict('This envelope has already been sent');
    const recipients = await loadRecipients(ctx, envelope.id);
    const fields = await ctx.db.select().from(signingFields).where(eq(signingFields.envelopeId, envelope.id));
    const signers = recipients.filter((r) => r.role === 'signer');
    if (!signers.length) throw badRequest('Add at least one signer');
    const missing = signers.filter((s) => !fields.some((f) => f.recipientId === s.id && f.type === 'signature'));
    if (missing.length) throw badRequest(`Place a signature field for ${missing.map((m) => m.name).join(', ')}`);

    const documentHash = sha256Hex(await frozenDocument(ctx, envelope));
    const now = new Date();
    const [sent] = await ctx.db
      .update(signingEnvelopes)
      .set({ status: 'sent', documentHash, sentAt: now, expiresAt: new Date(now.getTime() + input.expiresInDays * 86_400_000) })
      .where(and(eq(signingEnvelopes.id, envelope.id), eq(signingEnvelopes.status, 'draft')))
      .returning();
    if (!sent) throw conflict('This envelope has already been sent');
    await appendEvent(ctx, {
      envelopeId: envelope.id,
      type: 'sent',
      payload: {
        title: sent.title,
        documentHash,
        routing: sent.routing,
        expiresAt: sent.expiresAt!.toISOString(),
        sentBy: { id: ctx.actor!.userId, name: ctx.actor!.name, email: ctx.actor!.email },
        recipients: recipients.map((r) => ({ id: r.id, name: r.name, email: r.email, role: r.role, order: r.order })),
        fields: fields.map((f) => ({
          id: f.id,
          recipientId: f.recipientId,
          type: f.type,
          page: f.page,
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
          required: f.required,
        })),
      },
    });
    await invite(ctx, sent, nextToInvite(sent, recipients));
    await audit(ctx, {
      action: 'signing.send',
      entityType: 'signing_envelope',
      entityId: envelope.id,
      after: { documentHash, signers: signers.length, expiresAt: sent.expiresAt },
    });
    return { id: envelope.id, documentHash };
  },
});

export const remindEnvelope = defineService({
  name: 'signing.remind',
  description: 'Email a new personal link to every signer who has been invited but not signed yet. Their old links stop working.',
  kind: 'mutation',
  access: 'signing.send',
  input: envelopeIdInput,
  async handler(ctx, input) {
    const envelope = await loadEnvelope(ctx, input.envelopeId);
    if (statusOf(envelope) !== 'sent') throw conflict('Only an envelope waiting for signatures can be reminded');
    const pending = (await loadRecipients(ctx, envelope.id)).filter(
      (r) => r.role === 'signer' && (r.status === 'sent' || r.status === 'opened'),
    );
    await invite(ctx, envelope, pending, true);
    await audit(ctx, {
      action: 'signing.remind',
      entityType: 'signing_envelope',
      entityId: envelope.id,
      after: { reminded: pending.length },
    });
    return { reminded: pending.length };
  },
});

export const voidEnvelope = defineService({
  name: 'signing.void',
  description: 'Withdraw an envelope that is waiting for signatures. Its links stop working and invited signers are told by email.',
  kind: 'mutation',
  access: 'signing.send',
  input: voidEnvelopeInput,
  async handler(ctx, input) {
    const envelope = await loadEnvelope(ctx, input.envelopeId);
    if (envelope.status !== 'sent') throw conflict('Only an envelope waiting for signatures can be voided');
    await ctx.db
      .update(signingEnvelopes)
      .set({ status: 'voided', voidedAt: new Date(), voidReason: input.reason })
      .where(eq(signingEnvelopes.id, envelope.id));
    const recipients = await loadRecipients(ctx, envelope.id);
    await ctx.db.update(signingRecipients).set({ tokenHash: null }).where(eq(signingRecipients.envelopeId, envelope.id));
    await appendEvent(ctx, { envelopeId: envelope.id, type: 'voided', payload: { reason: input.reason, by: ctx.actor!.email } });
    const company = await companyInfo();
    for (const r of recipients.filter((x) => x.role === 'signer' && x.status !== 'waiting')) {
      await queueEmail(
        renderEmail({
          to: r.email,
          subject: `”${envelope.title}” har dragits tillbaka`,
          greeting: `Hej ${r.name},`,
          paragraphs: [
            `${company.name} har dragit tillbaka ”${envelope.title}”. Du behöver inte signera det.`,
            `Anledning: ${input.reason}`,
          ],
        }),
      );
    }
    await audit(ctx, { action: 'signing.void', entityType: 'signing_envelope', entityId: envelope.id, after: { reason: input.reason } });
    return { ok: true };
  },
});

export const deleteDraftEnvelope = defineService({
  name: 'signing.deleteDraft',
  description: 'Delete a draft envelope that was never sent. The document stays in Documents.',
  kind: 'mutation',
  access: 'signing.send',
  input: envelopeIdInput,
  async handler(ctx, input) {
    const envelope = await loadEnvelope(ctx, input.envelopeId);
    if (envelope.status !== 'draft') throw conflict('Only a draft can be deleted. Void a sent envelope instead.');
    await ctx.db.delete(signingEnvelopes).where(eq(signingEnvelopes.id, envelope.id));
    await audit(ctx, {
      action: 'signing.delete_draft',
      entityType: 'signing_envelope',
      entityId: envelope.id,
      before: { title: envelope.title },
    });
    return { ok: true };
  },
});

// Public signer services: reached with the personal link, never tools.

async function findByToken(ctx: Ctx, token: string) {
  const [row] = await ctx.db
    .select({ recipient: signingRecipients, envelope: signingEnvelopes })
    .from(signingRecipients)
    .innerJoin(signingEnvelopes, eq(signingEnvelopes.id, signingRecipients.envelopeId))
    .where(eq(signingRecipients.tokenHash, sha256(token)));
  if (!row) throw new AppError('NOT_FOUND', 'Länken gäller inte längre. Be avsändaren om en ny.');
  return row;
}

function signerState(envelope: Envelope, recipient: Recipient) {
  if (recipient.status === 'signed') return 'signed' as const;
  if (recipient.status === 'declined') return 'declined' as const;
  const status = statusOf(envelope);
  if (status === 'sent') return 'open' as const;
  return status as 'completed' | 'declined' | 'voided' | 'expired' | 'draft';
}

function issueAccess(recipient: Recipient) {
  return sign({ rid: recipient.id, purpose: 'signing' }, ACCESS_TTL_SECONDS);
}

async function withAccess(ctx: Ctx, token: string, access: string) {
  const row = await findByToken(ctx, token);
  const claims = verifySigned<{ rid: string; purpose: string }>(access);
  if (claims?.purpose !== 'signing' || claims.rid !== row.recipient.id || !row.recipient.verifiedAt)
    throw forbidden('Sessionen har gått ut. Begär en ny kod.');
  return row;
}

const maskEmail = (email: string) =>
  email.replace(/^(.)(.*)(@.*)$/, (_m, a: string, b: string, c: string) => `${a}${'•'.repeat(Math.min(b.length, 6))}${c}`);

export const describeSigning = defineService({
  name: 'signing.describe',
  description: 'What a personal signing link is for, shown before the signer verifies their email.',
  kind: 'query',
  access: 'public',
  input: signerTokenInput,
  async handler(ctx, input) {
    const { recipient, envelope } = await findByToken(ctx, input.token);
    const company = await companyInfo();
    const [sender] = envelope.createdBy
      ? await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, envelope.createdBy))
      : [];
    return {
      company: company.name,
      title: envelope.title,
      sender: sender?.name ?? company.name,
      name: recipient.name,
      email: maskEmail(recipient.email),
      state: signerState(envelope, recipient),
      expiresAt: envelope.expiresAt,
      codeSentAt: recipient.codeSentAt,
    };
  },
});

export const requestSigningCode = defineService({
  name: 'signing.requestCode',
  description: 'Email the signer a one-time code that unlocks the document.',
  kind: 'mutation',
  access: 'public',
  input: signerTokenInput,
  async handler(ctx, input) {
    const { recipient, envelope } = await findByToken(ctx, input.token);
    if (signerState(envelope, recipient) !== 'open') throw conflict('Dokumentet kan inte längre signeras.');
    if (recipient.codeSentAt && Date.now() - recipient.codeSentAt.getTime() < CODE_RESEND_MS)
      throw tooManyRequests('Vänta en minut innan du begär en ny kod.');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const now = new Date();
    await ctx.db
      .update(signingRecipients)
      .set({
        codeHash: sha256(`${recipient.id}:${code}`),
        codeExpiresAt: new Date(now.getTime() + CODE_TTL_MS),
        codeAttempts: 0,
        codeSentAt: now,
      })
      .where(eq(signingRecipients.id, recipient.id));
    await queueEmail(
      renderEmail({
        to: recipient.email,
        subject: `${code} är din kod för att signera ”${envelope.title}”`,
        greeting: `Hej ${recipient.name},`,
        paragraphs: [
          `Din engångskod är ${code}. Den gäller i 10 minuter.`,
          'Om du inte försökte öppna dokumentet kan du bortse från det här meddelandet.',
        ],
      }),
    );
    await appendEvent(ctx, { envelopeId: envelope.id, recipientId: recipient.id, type: 'code_sent', payload: { email: recipient.email } });
    return { sentAt: now };
  },
});

export const verifySigningCode = defineService({
  name: 'signing.verifyCode',
  description: 'Check the signer’s one-time code and open the document for them.',
  kind: 'mutation',
  access: 'public',
  // A wrong code must still count as an attempt, so this manages its own transaction.
  transaction: false,
  input: verifySignerCodeInput,
  async handler(ctx, input) {
    const { recipient, envelope } = await findByToken(ctx, input.token);
    if (signerState(envelope, recipient) !== 'open') throw conflict('Dokumentet kan inte längre signeras.');
    if (!recipient.codeHash || !recipient.codeExpiresAt || recipient.codeExpiresAt < new Date())
      throw badRequest('Koden har gått ut. Begär en ny.');
    if (recipient.codeAttempts >= MAX_CODE_ATTEMPTS) throw tooManyRequests('För många felaktiga försök. Begär en ny kod.');
    if (!safeEqual(sha256(`${recipient.id}:${input.code}`), recipient.codeHash)) {
      await ctx.db
        .update(signingRecipients)
        .set({ codeAttempts: sql`${signingRecipients.codeAttempts} + 1` })
        .where(eq(signingRecipients.id, recipient.id));
      throw badRequest('Fel kod. Försök igen.');
    }
    return ctx.db.transaction(async (tx) => {
      const t = { ...ctx, db: tx };
      const verifiedAt = new Date();
      const [updated] = await tx
        .update(signingRecipients)
        .set({ codeHash: null, codeExpiresAt: null, verifiedAt, status: recipient.status === 'sent' ? 'opened' : recipient.status })
        .where(eq(signingRecipients.id, recipient.id))
        .returning();
      await appendEvent(t, {
        envelopeId: envelope.id,
        recipientId: recipient.id,
        type: 'verified',
        payload: { method: 'email-otp', email: recipient.email },
      });
      return { access: issueAccess(updated!) };
    });
  },
});

export const viewSigning = defineService({
  name: 'signing.view',
  description: 'The document details and fields a verified signer fills in.',
  kind: 'query',
  access: 'public',
  input: signerAccessInput,
  async handler(ctx, input) {
    const { recipient, envelope } = await withAccess(ctx, input.token, input.access);
    const recipients = await loadRecipients(ctx, envelope.id);
    const fields = await ctx.db
      .select()
      .from(signingFields)
      .where(and(eq(signingFields.envelopeId, envelope.id), eq(signingFields.recipientId, recipient.id)));
    const company = await companyInfo();
    return {
      company: company.name,
      title: envelope.title,
      message: envelope.message,
      documentHash: envelope.documentHash!,
      pageCount: envelope.pageCount,
      state: signerState(envelope, recipient),
      name: recipient.name,
      email: recipient.email,
      today: new Intl.DateTimeFormat('sv-SE', { timeZone: company.timeZone }).format(new Date()),
      consent: SIGNING_CONSENT,
      signers: recipients
        .filter((r) => r.role === 'signer')
        .map((r) => ({ name: r.name, signed: r.status === 'signed', you: r.id === recipient.id })),
      fields: fields.map((f) => ({
        id: f.id,
        type: f.type,
        page: f.page,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        required: f.required,
        label: f.label,
      })),
    };
  },
});

/** The PDF a verified signer reads: the frozen original, or the sealed copy once everyone has signed. */
export async function signerDocument(ctx: Ctx, token: string, access: string) {
  const { recipient, envelope } = await withAccess(ctx, token, access);
  if (envelope.sealedFileId && recipient.status === 'signed') {
    const [sealed] = await ctx.db.select().from(files).where(eq(files.id, envelope.sealedFileId));
    if (sealed) return { name: sealed.name, bytes: await getObjectBuffer(sealed.storageKey) };
  }
  if (signerState(envelope, recipient) !== 'open' && recipient.status !== 'signed')
    throw forbidden('Dokumentet är inte längre tillgängligt.');
  const [file] = await ctx.db.select({ name: files.name }).from(files).where(eq(files.id, envelope.fileId));
  return { name: file?.name ?? 'dokument.pdf', bytes: await frozenDocument(ctx, envelope) };
}

const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;

function checkValue(type: string, value: string): string | null {
  const v = value.trim();
  if (type === 'signature' || type === 'initials') {
    if (v.startsWith('data:')) {
      if (!PNG_DATA_URL.test(v) || v.length > MAX_DRAWN_SIGNATURE) return null;
      const header = Buffer.from(v.slice(22, 34), 'base64');
      return header.subarray(0, 4).toString('latin1') === '\x89PNG' ? v : null;
    }
    return v.length >= 1 && v.length <= 80 ? v : null;
  }
  if (type === 'checkbox') return v === 'true' || v === 'false' ? v : null;
  if (type === 'text') return v.length <= 500 ? v : null;
  return v;
}

export const signDocument = defineService({
  name: 'signing.sign',
  description: 'Sign the document as a verified signer, with the values of their fields.',
  kind: 'mutation',
  access: 'public',
  input: signEnvelopeInput,
  async handler(ctx, input) {
    const { recipient, envelope } = await withAccess(ctx, input.token, input.access);
    if (signerState(envelope, recipient) !== 'open') throw conflict('Dokumentet kan inte längre signeras.');
    const fields = await ctx.db
      .select()
      .from(signingFields)
      .where(and(eq(signingFields.envelopeId, envelope.id), eq(signingFields.recipientId, recipient.id)));
    const company = await companyInfo();
    const signedAt = new Date();
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: company.timeZone }).format(signedAt);
    const given = new Map(input.values.map((v) => [v.fieldId, v.value]));

    const values = fields.map((f) => {
      let value: string | null;
      if (f.type === 'date') value = today;
      else if (f.type === 'name') value = recipient.name;
      else {
        const raw = given.get(f.id);
        value = raw === undefined || raw.trim() === '' ? null : checkValue(f.type, raw);
        if (raw !== undefined && raw.trim() !== '' && value === null) throw badRequest('Ett av fälten har ett ogiltigt värde.');
        if (f.type === 'checkbox' && value === 'false' && f.required) value = null;
      }
      if (f.required && value === null)
        throw badRequest(f.type === 'signature' ? 'Skriv eller rita din underskrift.' : 'Fyll i alla obligatoriska fält.');
      return { field: f, value };
    });

    await frozenDocument(ctx, envelope);
    const statement = {
      envelopeId: envelope.id,
      documentHash: envelope.documentHash,
      signer: { id: recipient.id, name: recipient.name, email: recipient.email },
      fields: values.map(({ field, value }) => ({
        id: field.id,
        type: field.type,
        page: field.page,
        valueHash: value === null ? null : sha256(value),
      })),
      consent: SIGNING_CONSENT,
      method: 'email-otp',
      verifiedAt: recipient.verifiedAt!.toISOString(),
      signedAt: signedAt.toISOString(),
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    };
    const statementHash = sha256(canonicalJson(statement));

    for (const { field, value } of values) await ctx.db.update(signingFields).set({ value }).where(eq(signingFields.id, field.id));
    await ctx.db.update(signingRecipients).set({ status: 'signed', signedAt }).where(eq(signingRecipients.id, recipient.id));
    await appendEvent(ctx, { envelopeId: envelope.id, recipientId: recipient.id, type: 'signed', payload: { statement, statementHash } });

    const recipients = await loadRecipients(ctx, envelope.id);
    const allSigned = recipients.filter((r) => r.role === 'signer').every((r) => r.status === 'signed');
    if (allSigned) await enqueue('signing.seal', { envelopeId: envelope.id }, { singletonKey: envelope.id });
    else await invite(ctx, envelope, nextToInvite(envelope, recipients));

    if (envelope.createdBy) {
      await notify(ctx.db, [envelope.createdBy], {
        type: 'signing.signed',
        title: `${recipient.name} signed ${envelope.title}`,
        body: allSigned ? 'Everyone has signed. The sealed PDF is being prepared.' : undefined,
        link: `/documents/signing/${envelope.id}`,
      });
    }
    await audit(
      { ...ctx, actor: null },
      { action: 'signing.sign', entityType: 'signing_envelope', entityId: envelope.id, after: { signer: recipient.email, statementHash } },
    );
    return { statementHash, allSigned };
  },
});

export const declineSigning = defineService({
  name: 'signing.decline',
  description: 'Decline to sign, with a reason. The envelope stops and the sender is told.',
  kind: 'mutation',
  access: 'public',
  input: declineEnvelopeInput,
  async handler(ctx, input) {
    const { recipient, envelope } = await withAccess(ctx, input.token, input.access);
    if (signerState(envelope, recipient) !== 'open') throw conflict('Dokumentet kan inte längre signeras.');
    const now = new Date();
    await ctx.db
      .update(signingRecipients)
      .set({ status: 'declined', declinedAt: now, declineReason: input.reason })
      .where(eq(signingRecipients.id, recipient.id));
    await ctx.db.update(signingEnvelopes).set({ status: 'declined' }).where(eq(signingEnvelopes.id, envelope.id));
    await appendEvent(ctx, { envelopeId: envelope.id, recipientId: recipient.id, type: 'declined', payload: { reason: input.reason } });
    if (envelope.createdBy) {
      await notify(ctx.db, [envelope.createdBy], {
        type: 'signing.declined',
        title: `${recipient.name} declined ${envelope.title}`,
        body: input.reason,
        link: `/documents/signing/${envelope.id}`,
        email: true,
      });
    }
    await audit(
      { ...ctx, actor: null },
      {
        action: 'signing.decline',
        entityType: 'signing_envelope',
        entityId: envelope.id,
        after: { signer: recipient.email, reason: input.reason },
      },
    );
    return { ok: true };
  },
});
