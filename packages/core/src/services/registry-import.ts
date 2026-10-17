import { and, desc, eq, files, isNull, registryImports, registryTransactions, users } from '@openinc/db';
import { empty, IMPORT_TYPES, importIdInput, startImportInput, updateImportInput } from '@openinc/shared';
import { audit } from '../audit.ts';
import type { Ctx } from '../context.ts';
import { badRequest, conflict, notFound, preconditionFailed } from '../errors.ts';
import { enqueue } from '../jobs.ts';
import { checkExtraction, type ImportResult } from '../registry/import/run.ts';
import { holderNames, requireRegistry } from '../registry/store.ts';
import { summarize } from '../registry/summary.ts';
import { defineService } from '../service.ts';
import { getSettings } from '../settings.ts';

async function loadImport(ctx: Ctx, importId: string) {
  const [row] = await ctx.db.select().from(registryImports).where(eq(registryImports.id, importId));
  if (!row) throw notFound('Import');
  return row;
}

export const startImport = defineService({
  name: 'registry.startImport',
  description:
    'Start an AI import of an uploaded share register (XLSX, XLS, CSV or PDF). The configured AI provider reads it in the background; the result waits for review and is never committed automatically.',
  kind: 'mutation',
  access: 'registry.draft',
  input: startImportInput,
  async handler(ctx, input) {
    await requireRegistry(ctx);
    if (!(await getSettings('ai'))) throw preconditionFailed('No AI provider is set up. An Admin can add one in Settings → AI.');
    const [file] = await ctx.db
      .select()
      .from(files)
      .where(and(eq(files.id, input.fileId), isNull(files.deletedAt)));
    if (file?.kind !== 'registry-import') throw notFound('Uploaded file');
    if (!IMPORT_TYPES.test(file.name)) throw badRequest('Upload an XLSX, XLS, CSV or PDF file');
    const [row] = await ctx.db.insert(registryImports).values({ fileId: file.id, createdBy: ctx.actor!.userId }).returning();
    await enqueue('registry.import', { importId: row!.id });
    await audit(ctx, { action: 'registry.import_start', entityType: 'registry_import', entityId: row!.id, after: { file: file.name } });
    return { id: row!.id, status: row!.status };
  },
});

export const listImports = defineService({
  name: 'registry.listImports',
  description:
    'Recent AI imports of share registers with their status: extracting, review, committed (drafts created), failed or discarded.',
  kind: 'query',
  access: 'registry.draft',
  input: empty,
  async handler(ctx) {
    return ctx.db
      .select({
        id: registryImports.id,
        status: registryImports.status,
        error: registryImports.error,
        fileName: files.name,
        createdBy: users.name,
        createdAt: registryImports.createdAt,
      })
      .from(registryImports)
      .leftJoin(files, eq(files.id, registryImports.fileId))
      .leftJoin(users, eq(users.id, registryImports.createdBy))
      .orderBy(desc(registryImports.createdAt))
      .limit(50);
  },
});

export const getImport = defineService({
  name: 'registry.getImport',
  description:
    'One AI import: what the model extracted (company facts, classes, holders, holdings or history, each with its source cell or page and line, and a confidence), the problems the checks found, and the source file as rows or pages.',
  kind: 'query',
  access: 'registry.draft',
  input: importIdInput,
  async handler(ctx, input) {
    const row = await loadImport(ctx, input.importId);
    const [file] = await ctx.db.select({ name: files.name, contentType: files.contentType }).from(files).where(eq(files.id, row.fileId));
    return {
      id: row.id,
      status: row.status,
      error: row.error,
      file: { id: row.fileId, name: file?.name ?? '', contentType: file?.contentType ?? '', url: `/api/files/${row.fileId}/content` },
      source: row.source as {
        kind: 'sheet' | 'pdf';
        sheets: { name: string; rows: string[][] }[];
        pages: string[][];
        scanned: boolean;
        encoding?: string;
        delimiter?: string;
      } | null,
      result: row.result as unknown as ImportResult | null,
      draftTxIds: row.draftTxIds,
      createdAt: row.createdAt,
    };
  },
});

export const updateImport = defineService({
  name: 'registry.updateImport',
  description: 'Save corrections to an AI import under review and run the checks again.',
  kind: 'mutation',
  access: 'registry.draft',
  input: updateImportInput,
  async handler(ctx, input) {
    const row = await loadImport(ctx, input.importId);
    if (row.status !== 'review') throw conflict('Only imports under review can change');
    const registry = await requireRegistry(ctx);
    const built = await checkExtraction(ctx, registry, input.extraction);
    const before = row.result as unknown as ImportResult;
    const result: ImportResult = {
      extraction: input.extraction,
      issues: built.issues,
      transactionCount: built.transactions.length,
      tokenized: before?.tokenized ?? 0,
    };
    await ctx.db
      .update(registryImports)
      .set({ result: result as unknown as Record<string, unknown> })
      .where(eq(registryImports.id, row.id));
    await audit(ctx, { action: 'registry.import_update', entityType: 'registry_import', entityId: row.id });
    return result;
  },
});

export const createImportDrafts = defineService({
  name: 'registry.createImportDrafts',
  description:
    'Turn a reviewed AI import into draft transactions: one opening balance, or the history in order. They are drafts; a person commits them like any other transaction.',
  kind: 'mutation',
  access: 'registry.draft',
  input: importIdInput,
  async handler(ctx, input) {
    const row = await loadImport(ctx, input.importId);
    if (row.status !== 'review') throw conflict('This import is not waiting for review');
    const registry = await requireRegistry(ctx);
    const result = row.result as unknown as ImportResult;
    const built = await checkExtraction(ctx, registry, result.extraction);
    const errors = built.issues.filter((i) => i.severity === 'error');
    if (errors.length) throw preconditionFailed(`Fix these first: ${errors.map((e) => e.message).join('; ')}`);
    const names = await holderNames(ctx, []);
    for (const h of built.transactions.flatMap((t) => t.holders)) names.set(h.holderId, h.name);
    const ids: string[] = [];
    for (const tx of built.transactions) {
      const [draft] = await ctx.db
        .insert(registryTransactions)
        .values({
          type: tx.type,
          decisionDate: tx.decisionDate,
          effectiveDate: tx.effectiveDate,
          registrationDate: tx.registrationDate,
          note: tx.note,
          payload: JSON.parse(JSON.stringify(tx)),
          summary: summarize(tx, names),
          status: 'draft',
          createdBy: ctx.actor!.userId,
        })
        .returning({ id: registryTransactions.id });
      ids.push(draft!.id);
    }
    await ctx.db.update(registryImports).set({ status: 'committed', draftTxIds: ids }).where(eq(registryImports.id, row.id));
    await audit(ctx, { action: 'registry.import_drafts', entityType: 'registry_import', entityId: row.id, after: { drafts: ids } });
    return { draftTxIds: ids };
  },
});

export const discardImport = defineService({
  name: 'registry.discardImport',
  description: 'Throw away an AI import that is no longer needed. Drafts it already created stay until deleted.',
  kind: 'mutation',
  access: 'registry.draft',
  input: importIdInput,
  async handler(ctx, input) {
    const row = await loadImport(ctx, input.importId);
    await ctx.db.update(registryImports).set({ status: 'discarded' }).where(eq(registryImports.id, row.id));
    await audit(ctx, {
      action: 'registry.import_discard',
      entityType: 'registry_import',
      entityId: row.id,
      before: { status: row.status },
    });
    return { ok: true };
  },
});
