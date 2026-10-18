import { registryExports } from '@openinc/core';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { sendError } from './files.ts';
import { ctxFromRequest } from './http-context.ts';

const query = z.object({
  format: z.enum(['pdf', 'xlsx', 'csv', 'json']).default('pdf'),
  lang: z.enum(['en', 'sv']).default('en'),
  asOf: z.iso.date().optional(),
  holderId: z.uuid().optional(),
  transactionId: z.uuid().optional(),
});

/** Downloads: the register for a date, the full history, a holder's extract, a settlement note, the JSON export. */
export async function registryExportHandler(req: Request, res: Response) {
  try {
    const ctx = await ctxFromRequest(req);
    const q = query.safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: 'Invalid export options' });
    const { format, lang, asOf, holderId, transactionId } = q.data;
    const pick = (f: string) => (f === 'json' ? 'pdf' : (f as 'pdf' | 'xlsx' | 'csv'));
    let file: registryExports.ExportFile;
    switch (String(req.params.kind)) {
      case 'register':
        file = await registryExports.registerExport(ctx, { asOf, format: pick(format), lang });
        break;
      case 'history':
        file = await registryExports.historyExport(ctx, { format: pick(format), lang });
        break;
      case 'holder':
        if (!holderId) return res.status(400).json({ error: 'holderId is required' });
        file = await registryExports.holderExtract(ctx, { holderId, asOf, lang });
        break;
      case 'settlement-note':
        if (!transactionId) return res.status(400).json({ error: 'transactionId is required' });
        file = await registryExports.settlementNote(ctx, { transactionId, lang });
        break;
      case 'full':
        file = await registryExports.fullJsonExport(ctx);
        break;
      default:
        return res.status(404).json({ error: 'Unknown export' });
    }
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'no-store');
    const inline = file.contentType === 'application/pdf' && req.query.download === undefined;
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${file.filename}"`);
    res.send(file.body);
  } catch (error) {
    sendError(res, error);
  }
}
