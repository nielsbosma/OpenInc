import { and, eq, signingKeys, sql } from '@openinc/db';
import type { Ctx } from '../context.ts';
import { decrypt, encrypt } from '../lib/crypto.ts';
import { getSettings } from '../settings.ts';
import { certificateName, importPrivateKey, issueSigningKeys, parseCertificate } from './pki.ts';

type KeyRow = typeof signingKeys.$inferSelect;

async function activeKeys(ctx: Ctx): Promise<{ ca?: KeyRow; seal?: KeyRow }> {
  const rows = await ctx.db.select().from(signingKeys).where(eq(signingKeys.active, true));
  return { ca: rows.find((r) => r.kind === 'ca'), seal: rows.find((r) => r.kind === 'seal') };
}

/** The company's signing CA and sealing certificate, created on first use. */
export async function ensureSigningKeys(ctx: Ctx): Promise<{ ca: KeyRow; seal: KeyRow }> {
  const found = await activeKeys(ctx);
  if (found.ca && found.seal) return { ca: found.ca, seal: found.seal };
  return ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('openinc.signing_keys'))`);
    const again = await activeKeys({ ...ctx, db: tx });
    if (again.ca && again.seal) return { ca: again.ca, seal: again.seal };
    await tx.update(signingKeys).set({ active: false, retiredAt: new Date() }).where(eq(signingKeys.active, true));
    const company = await getSettings('company');
    const issued = await issueSigningKeys({ name: company?.name || 'OpenInc', country: company?.country });
    const insert = (kind: 'ca' | 'seal', k: typeof issued.ca) =>
      tx
        .insert(signingKeys)
        .values({ kind, certificatePem: k.certificatePem, privateKey: encrypt(k.privateKeyPem), fingerprint: k.fingerprint })
        .returning();
    const [ca] = await insert('ca', issued.ca);
    const [seal] = await insert('seal', issued.seal);
    return { ca: ca!, seal: seal! };
  });
}

export async function loadSealingKey(ctx: Ctx) {
  const { ca, seal } = await ensureSigningKeys(ctx);
  const cert = parseCertificate(seal.certificatePem);
  return {
    cert,
    privateKey: await importPrivateKey(decrypt(seal.privateKey)),
    chain: [parseCertificate(ca.certificatePem)],
    issuerName: certificateName(cert, 'issuer'),
  };
}

/** Every certificate this install has sealed with, current and retired, by SHA-256 fingerprint. */
export async function knownSealCertificates(ctx: Ctx) {
  const rows = await ctx.db
    .select({ fingerprint: signingKeys.fingerprint, active: signingKeys.active, createdAt: signingKeys.createdAt })
    .from(signingKeys)
    .where(and(eq(signingKeys.kind, 'seal')));
  return new Map(rows.map((r) => [r.fingerprint, r]));
}

export async function caCertificatePem(ctx: Ctx): Promise<string> {
  return (await ensureSigningKeys(ctx)).ca.certificatePem;
}
