import { caCertificatePem, createCtx, signerDocument, verifySignedPdf } from '@openinc/core';
import { MAX_UPLOAD_BYTES } from '@openinc/shared';
import express, { type Request, type Response, Router } from 'express';
import { sendError } from './files.ts';
import { requestMeta } from './http-context.ts';

/** Public routes for signers and anyone checking a signed PDF. None of them use the session cookie. */
export function signingRouter(): Router {
  const r = Router();

  r.get('/document', async (req: Request, res: Response) => {
    try {
      const ctx = createCtx({ surface: 'web', ...requestMeta(req) });
      const doc = await signerDocument(ctx, req.get('x-signing-token') ?? '', req.get('x-signing-access') ?? '');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader(
        'Content-Disposition',
        `${req.query.download === undefined ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
      );
      res.end(doc.bytes);
    } catch (error) {
      sendError(res, error);
    }
  });

  r.post('/verify', express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }), async (req: Request, res: Response) => {
    try {
      const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!data.length) return res.status(400).json({ error: 'Välj en PDF-fil' });
      res.json(await verifySignedPdf(createCtx({ surface: 'web', ...requestMeta(req) }), data));
    } catch (error) {
      sendError(res, error);
    }
  });

  r.get('/ca.pem', async (_req: Request, res: Response) => {
    try {
      res.setHeader('Content-Type', 'application/x-pem-file');
      res.setHeader('Content-Disposition', 'attachment; filename="openinc-signing-ca.pem"');
      res.send(await caCertificatePem(createCtx({ surface: 'web' })));
    } catch (error) {
      sendError(res, error);
    }
  });

  return r;
}
