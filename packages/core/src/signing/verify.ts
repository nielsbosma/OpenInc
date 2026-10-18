import { asc, eq, signingEnvelopes, signingRecipients } from '@openinc/db';
import type { Ctx } from '../context.ts';
import { listEvents, verifyEvents } from './chain.ts';
import { knownSealCertificates } from './keys.ts';
import { envelopeIdFromPdf, extractSignature } from './pdf.ts';
import { certificateFingerprint, certificateName, sha256Hex, verifyCms } from './pki.ts';

export type VerifyOutcome = 'valid' | 'not_signed' | 'invalid' | 'modified' | 'unknown_signer';

/**
 * Checks an uploaded PDF: is its last signature intact, does it cover the whole file, and was it sealed by
 * this install. Signer details are only returned when the file is byte for byte the one OpenInc sealed.
 */
export async function verifySignedPdf(ctx: Ctx, pdf: Buffer) {
  const hash = sha256Hex(pdf);
  const embedded = extractSignature(pdf);
  if (!embedded) return { outcome: 'not_signed' as VerifyOutcome, hash, certificate: null, envelope: null };
  const cms = await verifyCms(embedded.cms, embedded.signedContent);
  const certificate = cms.signer
    ? {
        subject: certificateName(cms.signer),
        issuer: certificateName(cms.signer, 'issuer'),
        fingerprint: certificateFingerprint(cms.signer),
      }
    : null;
  const known = certificate ? (await knownSealCertificates(ctx)).has(certificate.fingerprint) : false;
  const outcome: VerifyOutcome = !cms.valid ? 'invalid' : !embedded.coversWholeFile ? 'modified' : !known ? 'unknown_signer' : 'valid';

  let envelope = null;
  const envelopeId = outcome === 'valid' ? await envelopeIdFromPdf(pdf) : null;
  if (envelopeId) {
    const [row] = await ctx.db.select().from(signingEnvelopes).where(eq(signingEnvelopes.id, envelopeId));
    if (row && row.sealedHash === hash) {
      const recipients = await ctx.db
        .select()
        .from(signingRecipients)
        .where(eq(signingRecipients.envelopeId, row.id))
        .orderBy(asc(signingRecipients.order));
      const chain = verifyEvents(await listEvents(ctx, row.id));
      envelope = {
        id: row.id,
        title: row.title,
        documentHash: row.documentHash,
        completedAt: row.completedAt,
        chainOk: chain.ok,
        signers: recipients.filter((r) => r.role === 'signer').map((r) => ({ name: r.name, email: r.email, signedAt: r.signedAt })),
      };
    }
  }
  return { outcome, hash, certificate, envelope };
}
