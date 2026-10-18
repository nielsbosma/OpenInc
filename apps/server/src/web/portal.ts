import { getObjectStream, portalCookieName, portalFile, portalZip } from '@openinc/core';
import { type Request, type Response, Router } from 'express';
import { sendError } from './files.ts';
import { ctxFromRequest, readCookie } from './http-context.ts';

const TOKEN = /^[\w-]{20,100}$/;
const ID = /^[0-9a-f-]{36}$/;

/** What dataroom visitors download. Authorised by the visitor cookie of the link, never a staff session. */
export function portalRouter(): Router {
  const r = Router();

  const portalCtx = async (req: Request<{ token: string }>) => ({
    ...(await ctxFromRequest(req)),
    actor: null,
    portalSession: readCookie(req, portalCookieName(req.params.token)),
  });

  r.get('/:token/files/:itemId', async (req: Request<{ token: string; itemId: string }>, res: Response) => {
    try {
      if (!TOKEN.test(req.params.token) || !ID.test(req.params.itemId)) return res.status(404).json({ error: 'Not found' });
      const download = req.query.download !== undefined;
      const file = await portalFile(await portalCtx(req), req.params.token, req.params.itemId, download ? 'download' : 'view');
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Length', String(file.sizeBytes));
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`);
      if (file.body) return res.end(file.body);
      (await getObjectStream(file.storageKey)).pipe(res);
    } catch (error) {
      sendError(res, error);
    }
  });

  r.get('/:token/download.zip', async (req: Request<{ token: string }>, res: Response) => {
    try {
      if (!TOKEN.test(req.params.token)) return res.status(404).json({ error: 'Not found' });
      const zip = await portalZip(await portalCtx(req), req.params.token);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zip.filename)}`);
      await zip.write(res);
    } catch (error) {
      if (!res.headersSent) sendError(res, error);
      else res.destroy();
    }
  });

  return r;
}
