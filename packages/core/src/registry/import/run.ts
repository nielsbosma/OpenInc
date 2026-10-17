import { eq, files, holderVersions, isNull, registryImports } from '@openinc/db';
import type { ImportExtraction } from '@openinc/shared';
import type { LanguageModel } from 'ai';
import { describeAiError, getChatModel } from '../../ai/model.ts';
import type { Ctx } from '../../context.ts';
import { getObjectBuffer } from '../../lib/storage.ts';
import { getSettings } from '../../settings.ts';
import { committedRows, effectiveItems, type RegistryContext, requireRegistry } from '../store.ts';
import { extractWithAi } from './ai.ts';
import { type BuiltImport, buildImport } from './build.ts';
import { type ExtractedSource, extractFile } from './extract.ts';

export interface ImportResult {
  extraction: ImportExtraction;
  issues: BuiltImport['issues'];
  transactionCount: number;
  tokenized: number;
}

export async function today(): Promise<string> {
  const timeZone = (await getSettings('company'))?.timeZone ?? 'UTC';
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Runs the deterministic checks over an extraction, the model's or one a person edited. */
export async function checkExtraction(ctx: Ctx, registry: RegistryContext, extraction: ImportExtraction): Promise<BuiltImport> {
  const existing = await ctx.db
    .select({ holderId: holderVersions.holderId, name: holderVersions.name, nationalId: holderVersions.nationalId })
    .from(holderVersions)
    .where(isNull(holderVersions.validTo));
  return buildImport(extraction, registry.config, {
    existingHolders: existing,
    committed: effectiveItems(await committedRows(ctx)),
    today: await today(),
  });
}

/** The background job: read the file, ask the model, check what it returned. Never commits anything. */
export async function runImport(ctx: Ctx, importId: string, model?: LanguageModel): Promise<void> {
  const [row] = await ctx.db.select().from(registryImports).where(eq(registryImports.id, importId));
  if (row?.status !== 'extracting') return;
  try {
    const registry = await requireRegistry(ctx);
    const [file] = await ctx.db.select().from(files).where(eq(files.id, row.fileId));
    if (!file) throw new Error('The uploaded file is gone');
    const data = await getObjectBuffer(file.storageKey);
    const source: ExtractedSource = await extractFile(data, file.contentType, file.name);
    await ctx.db
      .update(registryImports)
      .set({ source: source as unknown as Record<string, unknown> })
      .where(eq(registryImports.id, importId));
    const ai = await getSettings('ai');
    const chosen = model ?? (await getChatModel());
    if (!chosen) throw new Error('No AI provider is set up. An Admin can add one in Settings → AI.');
    const canReadPdf = ai?.provider === 'anthropic' || ai?.provider === 'openai';
    if (source.scanned && !canReadPdf && !model)
      throw new Error(
        'This PDF is scanned and the configured AI provider cannot read PDF files. Use Anthropic or OpenAI, or upload a text PDF or spreadsheet.',
      );
    const { extraction, tokenized } = await extractWithAi({
      model: chosen,
      source,
      tokenize: registry.row.tokenizeImportIds,
      pdf: source.kind === 'pdf' ? data : undefined,
    }).catch((error) => {
      throw new Error(ai ? describeAiError(error, ai) : String(error));
    });
    const built = await checkExtraction(ctx, registry, extraction);
    const result: ImportResult = { extraction, issues: built.issues, transactionCount: built.transactions.length, tokenized };
    await ctx.db
      .update(registryImports)
      .set({ status: 'review', result: result as unknown as Record<string, unknown>, error: null })
      .where(eq(registryImports.id, importId));
  } catch (error) {
    await ctx.db
      .update(registryImports)
      .set({ status: 'failed', error: error instanceof Error ? error.message : String(error) })
      .where(eq(registryImports.id, importId));
  }
}
