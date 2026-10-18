import { createHash, randomBytes, webcrypto } from 'node:crypto';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';

export type CryptoKey = webcrypto.CryptoKey;

const OID = {
  commonName: '2.5.4.3',
  organization: '2.5.4.10',
  country: '2.5.4.6',
  basicConstraints: '2.5.29.19',
  keyUsage: '2.5.29.15',
  extKeyUsage: '2.5.29.37',
  subjectKeyId: '2.5.29.14',
  authorityKeyId: '2.5.29.35',
  documentSigning: '1.3.6.1.5.5.7.3.36',
  adobeAuthenticDocuments: '1.2.840.113583.1.1.5',
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
};

const ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

pkijs.setEngine('node', new pkijs.CryptoEngine({ name: 'node', crypto: webcrypto as never }));

const toArrayBuffer = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

function pem(label: string, der: ArrayBuffer | Uint8Array): string {
  const lines =
    Buffer.from(der as ArrayBuffer)
      .toString('base64')
      .match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

function fromPem(text: string): ArrayBuffer {
  return toArrayBuffer(Buffer.from(text.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64'));
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function parseCertificate(certificatePem: string): pkijs.Certificate {
  return pkijs.Certificate.fromBER(fromPem(certificatePem));
}

export function certificateFingerprint(cert: pkijs.Certificate): string {
  return sha256Hex(new Uint8Array(cert.toSchema(true).toBER(false)));
}

export function certificateName(cert: pkijs.Certificate, of: 'subject' | 'issuer' = 'subject'): string {
  const cn = cert[of].typesAndValues.find((t) => t.type === OID.commonName);
  return cn ? String(cn.value.valueBlock.value) : '';
}

/** One attribute per RDN (CN, O, C), which pkijs would otherwise put in a single multi-valued RDN. */
function name(commonName: string, organization: string, country?: string): pkijs.RelativeDistinguishedNames {
  const parts: asn1js.BaseBlock[] = [
    new pkijs.AttributeTypeAndValue({ type: OID.commonName, value: new asn1js.Utf8String({ value: commonName }) }).toSchema(),
    new pkijs.AttributeTypeAndValue({ type: OID.organization, value: new asn1js.Utf8String({ value: organization }) }).toSchema(),
  ];
  if (country && /^[A-Z]{2}$/.test(country))
    parts.push(new pkijs.AttributeTypeAndValue({ type: OID.country, value: new asn1js.PrintableString({ value: country }) }).toSchema());
  const der = new asn1js.Sequence({ value: parts.map((p) => new asn1js.Set({ value: [p] })) }).toBER(false);
  return pkijs.RelativeDistinguishedNames.fromBER(der);
}

function keyUsage(bits: number): pkijs.Extension {
  const value = new asn1js.BitString({ valueHex: new Uint8Array([bits]).buffer, unusedBits: 1 });
  return new pkijs.Extension({ extnID: OID.keyUsage, critical: true, extnValue: value.toBER(false), parsedValue: value });
}

async function keyId(publicKey: CryptoKey): Promise<ArrayBuffer> {
  const spki = await webcrypto.subtle.exportKey('spki', publicKey);
  return toArrayBuffer(createHash('sha1').update(Buffer.from(spki)).digest());
}

export interface IssuedKey {
  certificatePem: string;
  privateKeyPem: string;
  fingerprint: string;
}

interface Issuer {
  cert: pkijs.Certificate;
  privateKey: CryptoKey;
}

async function issue(input: {
  commonName: string;
  organization: string;
  country?: string;
  years: number;
  ca: boolean;
  issuer?: Issuer;
}): Promise<IssuedKey & { cert: pkijs.Certificate; privateKey: CryptoKey }> {
  const keys = (await webcrypto.subtle.generateKey({ ...ALGORITHM, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) }, true, [
    'sign',
    'verify',
  ])) as webcrypto.CryptoKeyPair;
  const cert = new pkijs.Certificate();
  cert.version = 2;
  const serial = randomBytes(16);
  serial[0]! &= 0x7f;
  cert.serialNumber = new asn1js.Integer({ valueHex: toArrayBuffer(serial) });
  cert.subject = name(input.commonName, input.organization, input.country);
  cert.issuer = input.issuer ? input.issuer.cert.subject : name(input.commonName, input.organization, input.country);
  const now = new Date();
  cert.notBefore.value = new Date(now.getTime() - 60_000);
  cert.notAfter.value = new Date(now.getTime() + input.years * 365.25 * 24 * 3600 * 1000);
  await cert.subjectPublicKeyInfo.importKey(keys.publicKey);

  const subjectKeyId = await keyId(keys.publicKey);
  const authorityKeyId = input.issuer ? await keyId(await input.issuer.cert.getPublicKey()) : subjectKeyId;
  const constraints = new pkijs.BasicConstraints({ cA: input.ca });
  const extensions = [
    new pkijs.Extension({
      extnID: OID.basicConstraints,
      critical: true,
      extnValue: constraints.toSchema().toBER(false),
      parsedValue: constraints,
    }),
    keyUsage(input.ca ? 0x06 : 0xc0),
    new pkijs.Extension({ extnID: OID.subjectKeyId, extnValue: new asn1js.OctetString({ valueHex: subjectKeyId }).toBER(false) }),
    new pkijs.Extension({
      extnID: OID.authorityKeyId,
      extnValue: new pkijs.AuthorityKeyIdentifier({ keyIdentifier: new asn1js.OctetString({ valueHex: authorityKeyId }) })
        .toSchema()
        .toBER(false),
    }),
  ];
  if (!input.ca) {
    const usage = new pkijs.ExtKeyUsage({ keyPurposes: [OID.documentSigning, OID.adobeAuthenticDocuments] });
    extensions.push(new pkijs.Extension({ extnID: OID.extKeyUsage, extnValue: usage.toSchema().toBER(false), parsedValue: usage }));
  }
  cert.extensions = extensions;
  await cert.sign(input.issuer?.privateKey ?? keys.privateKey, 'SHA-256');

  return {
    cert,
    privateKey: keys.privateKey,
    certificatePem: pem('CERTIFICATE', cert.toSchema(true).toBER(false)),
    privateKeyPem: pem('PRIVATE KEY', await webcrypto.subtle.exportKey('pkcs8', keys.privateKey)),
    fingerprint: certificateFingerprint(cert),
  };
}

/** A company signing CA (20 years) and a document-sealing certificate it issues (5 years). */
export async function issueSigningKeys(company: { name: string; country?: string }) {
  const ca = await issue({
    commonName: `${company.name} Signing CA`,
    organization: company.name,
    country: company.country,
    years: 20,
    ca: true,
  });
  const seal = await issue({
    commonName: `${company.name} Document Seal`,
    organization: company.name,
    country: company.country,
    years: 5,
    ca: false,
    issuer: ca,
  });
  return { ca, seal };
}

export function importPrivateKey(privateKeyPem: string): Promise<CryptoKey> {
  return webcrypto.subtle.importKey('pkcs8', fromPem(privateKeyPem), ALGORITHM, false, ['sign']);
}

/**
 * A detached CMS signature in the PAdES baseline B-B profile: content type, message digest and the
 * ESS signing-certificate-v2 attribute, no signing-time attribute (the time is in the PDF itself).
 */
export async function signCms(content: Buffer, signer: { cert: pkijs.Certificate; privateKey: CryptoKey; chain: pkijs.Certificate[] }) {
  const digest = createHash('sha256').update(content).digest();
  const certDer = Buffer.from(signer.cert.toSchema(true).toBER(false));
  const essCertId = new asn1js.Sequence({
    value: [
      new asn1js.OctetString({ valueHex: toArrayBuffer(createHash('sha256').update(certDer).digest()) }),
      new asn1js.Sequence({
        value: [
          new pkijs.GeneralNames({ names: [new pkijs.GeneralName({ type: 4, value: signer.cert.issuer })] }).toSchema(),
          signer.cert.serialNumber,
        ],
      }),
    ],
  });
  const signingCertificateV2 = new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [essCertId] })] });

  const signedData = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID.data }),
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({ issuer: signer.cert.issuer, serialNumber: signer.cert.serialNumber }),
        signedAttrs: new pkijs.SignedAndUnsignedAttributes({
          type: 0,
          attributes: [
            new pkijs.Attribute({ type: OID.contentType, values: [new asn1js.ObjectIdentifier({ value: OID.data })] }),
            new pkijs.Attribute({ type: OID.messageDigest, values: [new asn1js.OctetString({ valueHex: toArrayBuffer(digest) })] }),
            new pkijs.Attribute({ type: OID.signingCertificateV2, values: [signingCertificateV2] }),
          ],
        }),
      }),
    ],
    certificates: [signer.cert, ...signer.chain],
  });
  await signedData.sign(signer.privateKey, 0, 'SHA-256');
  const contentInfo = new pkijs.ContentInfo({ contentType: OID.signedData, content: signedData.toSchema(true) });
  return Buffer.from(contentInfo.toSchema().toBER(false));
}

export interface CmsCheck {
  valid: boolean;
  signer: pkijs.Certificate | null;
  certificates: pkijs.Certificate[];
}

/** Checks a detached CMS signature over `content`. Says nothing about who the signer is; the caller decides whom to trust. */
export async function verifyCms(der: Buffer, content: Buffer): Promise<CmsCheck> {
  try {
    const info = pkijs.ContentInfo.fromBER(toArrayBuffer(der));
    if (info.contentType !== OID.signedData) return { valid: false, signer: null, certificates: [] };
    const signedData = new pkijs.SignedData({ schema: info.content });
    const certificates = (signedData.certificates ?? []).filter((c): c is pkijs.Certificate => c instanceof pkijs.Certificate);
    const result = await signedData.verify({ signer: 0, data: toArrayBuffer(content), extendedMode: true, checkChain: false });
    return { valid: result.signatureVerified === true, signer: result.signerCertificate ?? null, certificates };
  } catch {
    return { valid: false, signer: null, certificates: [] };
  }
}
