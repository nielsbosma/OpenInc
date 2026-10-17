import { helpUiInput } from '@openinc/shared';
import { type GuideEntry, uiGuide } from '../ai/ui-guide.ts';
import { type Ctx, can } from '../context.ts';
import { defineService } from '../service.ts';

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2)
    .map((w) => w.replace(/(es|s)$/, ''));

export function renderGuideEntry(ctx: Ctx, entry: GuideEntry): string {
  const lines = [`## ${entry.title}${entry.path ? ` (${entry.path})` : ''}`, `Where: ${entry.where}`, entry.summary];
  if (entry.permission && !can(ctx, entry.permission)) {
    lines.push(`This user cannot open it (needs "${entry.permission}"). An Admin can help.`);
    return lines.join('\n');
  }
  for (const t of entry.tasks) {
    const locked = t.permission && !can(ctx, t.permission) ? ` (needs "${t.permission}", which this user lacks)` : '';
    lines.push(`- ${t.task}${locked}: ${t.steps}`);
  }
  if (entry.services?.length) lines.push(`Tools that do the same: ${entry.services.map((s) => s.replace(/\./g, '_')).join(', ')}`);
  return lines.join('\n');
}

export function guideEntryForPath(path: string): GuideEntry | undefined {
  return uiGuide
    .filter((e) => e.path && (e.path === path || (e.path !== '/' && path.startsWith(`${e.path}/`))))
    .sort((a, b) => b.path!.length - a.path!.length)[0];
}

/** One line per screen the user can open: small enough to always be in the system prompt. */
export function guideIndex(ctx: Ctx): string {
  return uiGuide
    .filter((e) => !e.permission || can(ctx, e.permission))
    .map((e) => `- ${e.title}${e.path ? ` (${e.path})` : ''}: ${e.summary}`)
    .join('\n');
}

export function searchGuide(query: string | undefined): GuideEntry[] {
  const wanted = new Set(words(query ?? ''));
  if (wanted.size === 0) return uiGuide;
  const scored = uiGuide.map((entry) => {
    const haystack = new Set(words([entry.title, entry.summary, ...entry.tasks.map((t) => `${t.task} ${t.steps}`)].join(' ')));
    let score = 0;
    for (const w of wanted) if (haystack.has(w)) score++;
    return { entry, score };
  });
  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  return (hits.length ? hits.slice(0, 4) : scored).map((s) => s.entry);
}

export const helpUi = defineService({
  name: 'help.ui',
  description:
    'How to do something in the OpenInc web app: which page, menu, button and field, step by step, and which steps need a permission the user lacks. Use it for any "how do I" or "where is" question about the app.',
  kind: 'query',
  access: 'authenticated',
  input: helpUiInput,
  async handler(ctx, input) {
    return {
      guide: searchGuide(input.query)
        .map((e) => renderGuideEntry(ctx, e))
        .join('\n\n'),
    };
  },
});
