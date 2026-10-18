import { captableExports } from '@openinc/core';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { sendError } from './files.ts';
import { ctxFromRequest } from './http-context.ts';

const query = z.object({
  format: z.enum(['pdf', 'xlsx', 'csv', 'json']).default('xlsx'),
  asOf: z.iso.date().optional(),
  view: z.enum(['fully_diluted', 'issued']).default('fully_diluted'),
  scenarioId: z.uuid().optional(),
});

/** Downloads: the cap table for a date, and a scenario with every step. */
export async function captableExportHandler(req: Request, res: Response) {
  try {
    const ctx = await ctxFromRequest(req);
    const q = query.safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: 'Invalid export options' });
    const { format, asOf, view, scenarioId } = q.data;
    let file: Awaited<ReturnType<typeof captableExports.captableExport>>;
    switch (String(req.params.kind)) {
      case 'table':
        file = await captableExports.captableExport(ctx, { asOf, view, format });
        break;
      case 'scenario':
        if (!scenarioId) return res.status(400).json({ error: 'scenarioId is required' });
        file = await captableExports.scenarioExport(ctx, { scenarioId, format: format === 'json' ? 'json' : 'xlsx' });
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
