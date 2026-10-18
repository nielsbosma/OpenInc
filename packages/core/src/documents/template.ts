import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';

export interface TemplateFolder {
  name: string;
  description: string;
  documents: string[];
  folders: TemplateFolder[];
}

const folderSchema: z.ZodType<TemplateFolder, unknown> = z.lazy(() =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine((v) => !v.includes('/'), 'A folder name cannot contain /'),
    description: z.string().trim().default(''),
    documents: z.array(z.string().trim().min(1)).default([]),
    folders: z.array(folderSchema).default([]),
  }),
);

const templateSchema = z.object({ folders: z.array(folderSchema).min(1) }).superRefine((t, ctx) => {
  const walk = (folders: TemplateFolder[], at: string) => {
    const seen = new Set<string>();
    for (const f of folders) {
      if (seen.has(f.name.toLowerCase())) ctx.addIssue({ code: 'custom', message: `${at}${f.name} appears twice` });
      seen.add(f.name.toLowerCase());
      walk(f.folders, `${at}${f.name}/`);
    }
  };
  walk(t.folders, '');
});

export function parseFolderTemplate(source: string): TemplateFolder[] {
  const parsed = templateSchema.safeParse(parse(source));
  if (!parsed.success) throw new Error(`Invalid folder template: ${z.prettifyError(parsed.error)}`);
  return parsed.data.folders;
}

let cached: TemplateFolder[] | undefined;

/** The suggested structure in folder-template.yaml, read once per process. */
export function folderTemplate(): TemplateFolder[] {
  cached ??= parseFolderTemplate(readFileSync(new URL('./folder-template.yaml', import.meta.url), 'utf8'));
  return cached;
}

/** The template folder at a path of folder names, matched case-insensitively. */
export function templateFolderAt(path: string[]): TemplateFolder | undefined {
  let level = folderTemplate();
  let found: TemplateFolder | undefined;
  for (const name of path) {
    found = level.find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (!found) return undefined;
    level = found.folders;
  }
  return found;
}
