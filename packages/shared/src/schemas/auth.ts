import { z } from 'zod';
import { ROLES } from '../permissions.ts';
import { email, id, pagination, password, personName, secondFactorCode, totpCode } from './common.ts';

export const loginInput = z.object({
  email,
  password: z.string().min(1, 'Enter your password').max(200),
});

export const loginSecondFactorInput = z.object({
  challenge: z.string().min(1),
  code: secondFactorCode,
});

export const requestPasswordResetInput = z.object({ email });

export const resetPasswordInput = z.object({
  token: z.string().min(1),
  password,
});

export const updateProfileInput = z.object({ name: personName });

export const changePasswordInput = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: password,
});

export const changeEmailInput = z.object({
  email,
  currentPassword: z.string().min(1, 'Enter your current password'),
});

export const enableTotpInput = z.object({ code: totpCode });

export const disableTotpInput = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
});

export const regenerateRecoveryCodesInput = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
});

export const setAvatarInput = z.object({ fileId: id.nullable() });

export const revokeMcpClientInput = z.object({ clientId: z.string().min(1) });

export const roleSchema = z.enum(ROLES);

export const listUsersInput = pagination.extend({
  search: z.string().trim().max(200).optional(),
  includeInactive: z.boolean().default(false),
});

export const userIdInput = z.object({ userId: id });

export const updateUserInput = z.object({
  userId: id,
  name: personName.optional(),
  role: roleSchema.optional(),
  active: z.boolean().optional(),
});

export const createInviteInput = z.object({
  email,
  role: roleSchema.default('member'),
  name: personName.optional().describe('Pre-filled on the invite page; the person can change it'),
});

export const inviteIdInput = z.object({ inviteId: id });

export const inviteTokenInput = z.object({ token: z.string().min(1) });

export const acceptInviteInput = z.object({
  token: z.string().min(1),
  name: personName,
  password,
});
