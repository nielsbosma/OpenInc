import { z } from 'zod';

export const id = z.uuid();

export const empty = z.object({});

export const pagination = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export const email = z.email('Enter a valid email address').trim().toLowerCase().max(254);

export const password = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(200)
  .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), 'Use both letters and digits');

export const personName = z.string().trim().min(1, 'Enter a name').max(120);

export const totpCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code');

/** A TOTP code or a recovery code (xxxxx-xxxxx). */
export const secondFactorCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(\d{6}|[a-z0-9]{5}-[a-z0-9]{5})$/, 'Enter the 6-digit code or a recovery code');
