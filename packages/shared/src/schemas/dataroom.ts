import { z } from 'zod';
import { email, id } from './common.ts';

export const DATA_ROOM_STATUSES = ['draft', 'open', 'closed'] as const;
export type DataRoomStatus = (typeof DATA_ROOM_STATUSES)[number];

const roomName = z.string().trim().min(1, 'Enter a name').max(120);
const folderName = z
  .string()
  .trim()
  .min(1, 'Enter a name')
  .max(120)
  .refine((v) => !v.includes('/'), 'A folder name cannot contain /');
const dateTime = z.iso.datetime({ offset: true });
const domain = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => v.replace(/^@/, ''))
  .pipe(z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'Enter a domain like example.com'));

/** Shorter than a staff password: it is shared with an outside person, often by phone. */
export const linkPassword = z.string().min(8, 'Use at least 8 characters').max(200);

export const roomIdInput = z.object({ roomId: id });

export const createRoomInput = z.object({
  name: roomName,
  description: z.string().trim().max(1000).default(''),
  template: z.string().max(60).optional().describe('A key from dataroom.templates; leave out for an empty room'),
});

export const updateRoomInput = z.object({
  roomId: id,
  name: roomName.optional(),
  description: z.string().trim().max(1000).optional(),
  welcomeMessage: z.string().trim().max(4000).optional(),
  ndaText: z.string().trim().max(20000).nullable().optional().describe('Null or empty: visitors are not asked to accept an NDA'),
  closesAt: dateTime.nullable().optional().describe('After this time no link works'),
  defaultAllowDownload: z.boolean().optional(),
  defaultWatermark: z.boolean().optional(),
  alertOnFirstVisit: z.boolean().optional(),
  alertOnDownload: z.boolean().optional(),
  alertOnFailedPasswords: z.boolean().optional(),
});

export const createRoomFolderInput = z.object({ roomId: id, parentId: id.optional(), name: folderName });
export const renameRoomFolderInput = z.object({ folderId: id, name: folderName });
export const roomFolderIdInput = z.object({ folderId: id });

export const addRoomDocumentsInput = z.object({
  roomId: id,
  folderId: id.optional().describe("A folder in the room; leave out for the room's top level"),
  documentIds: z.array(id).min(1).max(500),
});

export const roomItemIdInput = z.object({ itemId: id });

export const moveRoomItemInput = z.object({
  itemId: id,
  folderId: id.nullable().describe("A folder in the same room; null for the room's top level"),
  position: z.number().int().min(0).optional().describe('Place in the folder, 0 first; leave out to put it last'),
});

const linkRules = {
  label: z.string().trim().min(1, 'Enter a label').max(120).describe('Who the link is for, e.g. the investor'),
  password: linkPassword.nullable().optional().describe('Null: the link opens without a password'),
  allowedEmails: z.array(email).max(200).default([]),
  allowedDomains: z.array(domain).max(50).default([]),
  requireEmail: z.boolean().default(true),
  verifyEmail: z.boolean().default(false).describe('Email a 6-digit code the visitor must enter; needs email set up'),
  allowDownload: z.boolean().optional().describe("Defaults to the room's setting"),
  watermark: z.boolean().optional().describe("Defaults to the room's setting"),
  folderIds: z.array(id).max(200).nullable().default(null).describe('Only these room folders; null for the whole room'),
  expiresAt: dateTime.nullable().default(null),
};

export const createLinkInput = z.object({ roomId: id, ...linkRules });

export const updateLinkInput = z.object({
  linkId: id,
  label: linkRules.label.optional(),
  password: linkPassword.nullable().optional().describe('Leave out to keep it, null to remove it'),
  allowedEmails: z.array(email).max(200).optional(),
  allowedDomains: z.array(domain).max(50).optional(),
  requireEmail: z.boolean().optional(),
  verifyEmail: z.boolean().optional(),
  allowDownload: z.boolean().optional(),
  watermark: z.boolean().optional(),
  folderIds: z.array(id).max(200).nullable().optional(),
  expiresAt: dateTime.nullable().optional(),
});

export const linkIdInput = z.object({ linkId: id });

export const roomVisitorInput = z.object({ roomId: id, visitorId: id });

export const roomStatsInput = z.object({
  roomId: id,
  from: dateTime.optional(),
  to: dateTime.optional(),
});

export const roomDocumentStatsInput = z.object({ roomId: id, documentId: id });

export const roomsForDocumentInput = z.object({ documentId: id });

export const roomActivityInput = z.object({
  roomId: id,
  limit: z.number().int().min(1).max(500).default(100),
});

// The visitor portal. `token` is the link's token from the URL.

const linkToken = z
  .string()
  .min(20)
  .max(100)
  .regex(/^[\w-]+$/);

export const portalInput = z.object({ token: linkToken });

export const portalIdentifyInput = z.object({
  token: linkToken,
  email,
  name: z.string().trim().max(120).default(''),
  company: z.string().trim().max(120).default(''),
});

export const portalVerifyInput = z.object({
  token: linkToken,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const portalUnlockInput = z.object({ token: linkToken, password: z.string().min(1, 'Enter the password').max(200) });

export const portalHeartbeatInput = z.object({
  token: linkToken,
  itemId: id,
  page: z.number().int().min(1).max(100000),
  pageCount: z.number().int().min(1).max(100000).optional(),
  seconds: z.number().min(0).max(60),
});
