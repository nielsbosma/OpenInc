import { type ImportExtraction, importExtraction } from '@openinc/shared';
import { generateText, type LanguageModel, type ModelMessage, Output } from 'ai';
import { type ExtractedSource, promptText, restoreIds, tokenizeIds } from './extract.ts';

const INSTRUCTIONS = `You read a company's share register (shareholder list, cap table or aktiebok) and return it as structured data.

Rules:
- Only report what the document says. Never invent holders, numbers or dates. Use null or an empty string when something is not there.
- Every value gets a source: for spreadsheets the sheet name and cell (e.g. "B7"); for PDFs the page and line number as shown (p2 l14 → page 2, line 14). Point at the cell or line where the value itself stands.
- confidence is 0 to 1: how sure you are you read that row correctly.
- holders: one per distinct owner. ref is your own short id (h1, h2, ...), used by holdings and events. kind is person, company, estate (dödsbo) or joint.
- National ID numbers may appear as placeholders like [ID_3]. Copy the placeholder exactly as the nationalId.
- mode "snapshot" when the document lists who holds what on one date: fill holdings, one row per holder and class, with share numbers as written (e.g. "1-500, 701-800") or "".
- mode "history" when it lists transactions over time: fill events in date order. The first event is the incorporation: one event per founding holder with type incorporation and toRef. Issues of new shares: type new_issue with toRef. Transfers: type transfer with fromRef and toRef. Splits: type split with ratio. Anything else: type other with a description.
- Counts are whole numbers of shares as digits. shareCapital and prices are in normal currency units as written. Dates are YYYY-MM-DD.
- classes: each share class with its votes per share ("1" when only one class is mentioned and votes are not).
- notes: anything a person should check (unclear rows, totals that do not add up, pledges, restrictions mentioned).`;

export interface AiExtractOptions {
  model: LanguageModel;
  source: ExtractedSource;
  tokenize: boolean;
  /** The original PDF, sent along when its pages are scanned images and the model can read files. */
  pdf?: Buffer;
}

export async function extractWithAi(opts: AiExtractOptions): Promise<{ extraction: ImportExtraction; tokenized: number }> {
  const raw = promptText(opts.source);
  const { text, tokens } = opts.tokenize ? tokenizeIds(raw) : { text: raw, tokens: new Map<string, string>() };
  const content: Extract<ModelMessage, { role: 'user' }>['content'] = [{ type: 'text', text: `The document:\n\n${text}` }];
  if (opts.pdf && opts.source.scanned)
    content.push(
      { type: 'file', data: opts.pdf, mediaType: 'application/pdf' },
      { type: 'text', text: 'The PDF pages are scanned; read them from the attached file and point at page numbers, with line null.' },
    );
  const result = await generateText({
    model: opts.model,
    system: INSTRUCTIONS,
    messages: [{ role: 'user', content }],
    output: Output.object({ schema: importExtraction, name: 'share_register' }),
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(240_000),
  });
  return { extraction: restoreIds(result.output, tokens), tokenized: tokens.size };
}
