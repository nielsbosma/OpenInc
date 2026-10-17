import { type ToolSet, tool } from 'ai';
import type { Ctx } from '../context.ts';
import { AppError } from '../errors.ts';
import { allServices, toolName } from '../registry.ts';
import { canAccess, isTool, run, toJsonSafe } from '../service.ts';
import { guideEntryForPath, guideIndex, renderGuideEntry } from '../services/help.ts';
import { getSettings } from '../settings.ts';

/** The assistant can do what the signed-in user can do in the UI: one tool per service they may call. */
export function buildTools(ctx: Ctx): ToolSet {
  const tools: ToolSet = {};
  for (const def of allServices) {
    if (!isTool(def) || !canAccess(def, ctx)) continue;
    tools[toolName(def)] = tool({
      description: def.description,
      inputSchema: def.input,
      execute: async (input: unknown) => {
        try {
          return toJsonSafe(await run(def, ctx, input));
        } catch (error) {
          if (error instanceof AppError) return { error: error.message, code: error.code };
          throw error;
        }
      },
    });
  }
  return tools;
}

/** `page` is the path the user has open, so "how do I do this here" has context. */
export async function systemPrompt(ctx: Ctx, page?: string): Promise<string> {
  const actor = ctx.actor!;
  const company = await getSettings('company');
  const timeZone = company?.timeZone ?? 'UTC';
  const now = new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'full', timeStyle: 'short' }).format(new Date());
  const current = page ? guideEntryForPath(page) : undefined;
  return [
    `You are the assistant inside OpenInc, the company tool${company ? ` of ${company.name}` : ''}: shareholder registry, cap table, signing, dataroom and fundraising.`,
    `You are helping ${actor.name} <${actor.email}>, role ${actor.role}. It is ${now} (${timeZone}).`,
    'Use the tools to read and change data. They act as this user with exactly their permissions, and every change is audited.',
    'Before changing or deleting anything, say what you will do and ask for confirmation, unless the user asked for exactly that change.',
    `Money in tool data is in integer minor units of ${company?.currency ?? 'the company currency'} (e.g. cents). Show amounts in normal units.`,
    'Be brief: short paragraphs, lists and tables. Never invent data a tool did not return.',
    '',
    'For questions about how to do something in the app, call help_ui and use the exact labels it gives. Never describe screens it does not mention. If a task needs a permission the user lacks, say an Admin can help. If a tool can do it for them, offer that.',
    'Screens this user can open:',
    guideIndex(ctx),
    ...(page ? ['', `The user has ${page} open.`, ...(current ? [renderGuideEntry(ctx, current)] : [])] : []),
  ].join('\n');
}
