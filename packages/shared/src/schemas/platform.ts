import { z } from 'zod';
import { email, id, pagination, password, personName } from './common.ts';

export const listAuditInput = pagination.extend({
  search: z.string().trim().max(200).optional().describe('Matches action, entity type, entity id or actor email'),
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(100).optional(),
  actorId: id.optional(),
  action: z.string().max(100).optional(),
  surface: z.enum(['web', 'mcp', 'ai', 'worker', 'system']).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

export const listNotificationsInput = pagination.extend({
  unreadOnly: z.boolean().default(false),
});

export const notificationIdInput = z.object({ notificationId: id });

export const FILE_KINDS = ['chat-attachment', 'avatar', 'logo', 'document'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const fileIdInput = z.object({ fileId: id });

export const chatThreadIdInput = z.object({ threadId: id });

export const helpUiInput = z.object({
  query: z.string().trim().max(200).optional().describe('What the user wants to do, e.g. "invite someone" or "two-factor". Leave out for the whole guide.'),
});

export const setupCodeInput = z.object({ code: z.string().trim().min(1, 'Enter the setup code').max(40) });

export const createFirstAdminInput = z.object({
  code: z.string().trim().min(1).max(40),
  name: personName,
  email,
  password,
});

export const runDemoJobInput = z.object({ seconds: z.number().int().min(0).max(60).default(3) });
