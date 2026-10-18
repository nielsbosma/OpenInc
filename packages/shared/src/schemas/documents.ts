import { z } from 'zod';
import { id } from './common.ts';

const folderName = z
  .string()
  .trim()
  .min(1, 'Enter a name')
  .max(120)
  .refine((v) => !v.includes('/'), 'A folder name cannot contain /');

const documentName = z.string().trim().min(1, 'Enter a name').max(255);

export const listDocumentsInput = z.object({ folderId: id.optional() });

export const searchDocumentsInput = z.object({
  query: z.string().trim().max(200).describe('Empty matches every document'),
  contentType: z.string().max(100).optional().describe('Only documents of this type, e.g. application/pdf'),
});

export const createFolderInput = z.object({
  parentId: id.optional(),
  name: folderName,
  description: z.string().trim().max(500).default(''),
});

export const renameFolderInput = z.object({ folderId: id, name: folderName });

export const folderIdInput = z.object({ folderId: id });

export const addDocumentInput = z.object({ fileId: id, folderId: id.optional() });

export const documentIdInput = z.object({ documentId: id });

export const renameDocumentInput = z.object({ documentId: id, name: documentName });

/** A null folder moves the document to the top level. */
export const moveDocumentInput = z.object({ documentId: id, folderId: id.nullable() });

export const downloadZipInput = z.object({ folderId: id.optional() });
