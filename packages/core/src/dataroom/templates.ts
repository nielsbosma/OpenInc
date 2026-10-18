import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';

const templateSchema = z.object({
  templates: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z0-9-]+$/),
        name: z.string().trim().min(1),
        description: z.string().trim().default(''),
        folders: z.array(z.object({ name: z.string().trim().min(1).max(120), from: z.array(z.string().trim().min(1)).default([]) })),
      }),
    )
    .min(1),
});

export type RoomTemplate = z.output<typeof templateSchema>['templates'][number];

let cached: RoomTemplate[] | undefined;

/** The starting structures in room-templates.yaml, read once per process. */
export function roomTemplates(): RoomTemplate[] {
  cached ??= templateSchema.parse(parse(readFileSync(new URL('./room-templates.yaml', import.meta.url), 'utf8'))).templates;
  return cached;
}
