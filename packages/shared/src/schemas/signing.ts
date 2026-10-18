import { z } from 'zod';
import { email, id, personName } from './common.ts';

export const SIGNING_FIELD_TYPES = ['signature', 'initials', 'date', 'name', 'text', 'checkbox'] as const;
export type SigningFieldType = (typeof SIGNING_FIELD_TYPES)[number];

export const SIGNING_FIELD_LABELS: Record<SigningFieldType, string> = {
  signature: 'Signature',
  initials: 'Initials',
  date: 'Date Signed',
  name: 'Full Name',
  text: 'Text',
  checkbox: 'Checkbox',
};

export const ENVELOPE_STATUSES = ['draft', 'sent', 'completed', 'declined', 'voided', 'expired'] as const;
export type EnvelopeStatus = (typeof ENVELOPE_STATUSES)[number];

export const ENVELOPE_STATUS_LABELS: Record<EnvelopeStatus, string> = {
  draft: 'Draft',
  sent: 'Waiting for Others',
  completed: 'Completed',
  declined: 'Declined',
  voided: 'Voided',
  expired: 'Expired',
};

export const RECIPIENT_ROLES = ['signer', 'cc'] as const;

/** The consent a signer gives by signing. Its version is recorded with every signature. */
export const SIGNING_CONSENT = {
  version: '2026-10-18',
  text: 'Jag har läst dokumentet och godkänner att signera det elektroniskt. Min elektroniska underskrift är lika bindande för mig som en underskrift på papper.',
};

const fraction = z.number().min(0).max(1);

export const envelopeIdInput = z.object({ envelopeId: id });

export const listEnvelopesInput = z.object({ status: z.enum(ENVELOPE_STATUSES).optional() });

export const createEnvelopeInput = z.object({ documentId: id });

export const signingRecipientInput = z.object({
  id,
  name: personName,
  email,
  role: z.enum(RECIPIENT_ROLES).default('signer'),
  order: z.number().int().min(1).max(50).default(1),
});

export const signingFieldInput = z
  .object({
    id,
    recipientId: id,
    type: z.enum(SIGNING_FIELD_TYPES),
    page: z.number().int().min(1),
    x: fraction,
    y: fraction,
    width: fraction.min(0.01),
    height: fraction.min(0.005),
    required: z.boolean().default(true),
    label: z.string().trim().max(80).default(''),
  })
  .refine((f) => f.x + f.width <= 1.0001 && f.y + f.height <= 1.0001, 'The field must be inside the page');

export const updateEnvelopeInput = z.object({
  envelopeId: id,
  title: z.string().trim().min(1, 'Enter a title').max(200),
  message: z.string().trim().max(2000).default(''),
  routing: z.enum(['parallel', 'sequential']).default('parallel'),
  recipients: z.array(signingRecipientInput).max(30),
  fields: z.array(signingFieldInput).max(500),
});

export const sendEnvelopeInput = z.object({
  envelopeId: id,
  expiresInDays: z.number().int().min(1).max(90).default(30),
});

export const voidEnvelopeInput = z.object({ envelopeId: id, reason: z.string().trim().min(1, 'Give a reason').max(500) });

export const signerTokenInput = z.object({ token: z.string().min(20).max(200) });

export const signerAccessInput = signerTokenInput.extend({ access: z.string().min(20).max(1000) });

export const verifySignerCodeInput = signerTokenInput.extend({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Ange den sexsiffriga koden'),
});

/** A drawn signature is a PNG data URL; everything else is text. */
export const signFieldValue = z.object({ fieldId: id, value: z.string().max(300_000) });

export const signEnvelopeInput = signerAccessInput.extend({
  values: z.array(signFieldValue).max(500),
  consent: z.literal(true, 'Bekräfta att du vill signera'),
});

export const declineEnvelopeInput = signerAccessInput.extend({
  reason: z.string().trim().min(1, 'Skriv varför du avböjer').max(500),
});
