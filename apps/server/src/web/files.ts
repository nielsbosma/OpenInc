import { AppError, companyLogo, getObjectStream, getReadableFile, HTTP_STATUS, reportError, storeFile } from '@openinc/core';
import { FILE_KINDS, type FileKind, MAX_UPLOAD_BYTES } from '@openinc/shared';
import express, { type Request, type Response, Router } from 'express';
import { ctxFromRequest } from './http-context.ts';

export function sendError(res: Response, error: unknown) {
  if (error instanceof AppError) return res.status(HTTP_STATUS[error.code]).json({ error: error.message });
  reportError(error);
  return res.status(500).json({ error: 'Something went wrong' });
}

async function sendFile(
  req: Request,
  res: Response,
  file: { storageKey: string; contentType: string; sizeBytes: number; name: string },
  cache: string,
) {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Length', String(file.sizeBytes));
  res.setHeader('Cache-Control', cache);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // SVGs can carry scripts; never render them inline from our origin.
  const inline = /^(image\/(png|jpe?g|gif|webp)|application\/pdf|text\/plain)$/.test(file.contentType) && req.query.download === undefined;
  if (file.contentType === 'image/svg+xml') res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  (await getObjectStream(file.storageKey)).pipe(res);
}

/**
 * Uploads are raw bodies, not multipart: the browser sends the File itself, with its name in
 * X-File-Name and its type in Content-Type.
 */
export function filesRouter(): Router {
  const r = Router();

  r.post('/', express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }), async (req: Request, res: Response) => {
    try {
      const ctx = await ctxFromRequest(req);
      const kind = String(req.query.kind ?? '') as FileKind;
      if (!FILE_KINDS.includes(kind)) return res.status(400).json({ error: 'Unknown file kind' });
      const name = decodeURIComponent(req.get('x-file-name') ?? 'upload');
      const contentType = (req.get('content-type') ?? 'application/octet-stream').split(';')[0]!.trim();
      const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      res.status(201).json(await storeFile(ctx, { name, contentType, kind, data }));
    } catch (error) {
      sendError(res, error);
    }
  });

  r.get('/:id/content', async (req: Request<{ id: string }>, res: Response) => {
    try {
      if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return res.status(404).json({ error: 'File not found' });
      const ctx = await ctxFromRequest(req);
      await sendFile(req, res, await getReadableFile(ctx, req.params.id), 'private, max-age=300');
    } catch (error) {
      sendError(res, error);
    }
  });

  return r;
}

export async function logoHandler(req: Request, res: Response) {
  try {
    const logo = await companyLogo();
    if (!logo) return res.status(404).end();
    await sendFile(req, res, logo, 'public, max-age=300');
  } catch (error) {
    sendError(res, error);
  }
}
