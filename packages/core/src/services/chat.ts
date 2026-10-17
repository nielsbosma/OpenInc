import { and, chatThreads, desc, eq } from '@openinc/db';
import { chatThreadIdInput, empty } from '@openinc/shared';
import type { Ctx } from '../context.ts';
import { notFound } from '../errors.ts';
import { defineService } from '../service.ts';

export const listChatThreads = defineService({
  name: 'chat.threads',
  description: "List the signed-in user's AI chat threads.",
  kind: 'query',
  access: 'ai.chat',
  tool: false,
  input: empty,
  async handler(ctx) {
    return ctx.db
      .select({ id: chatThreads.id, title: chatThreads.title, updatedAt: chatThreads.updatedAt })
      .from(chatThreads)
      .where(eq(chatThreads.userId, ctx.actor!.userId))
      .orderBy(desc(chatThreads.updatedAt))
      .limit(50);
  },
});

export const getChatThread = defineService({
  name: 'chat.thread',
  description: 'One AI chat thread with its messages.',
  kind: 'query',
  access: 'ai.chat',
  tool: false,
  input: chatThreadIdInput,
  async handler(ctx, input) {
    const [thread] = await ctx.db
      .select()
      .from(chatThreads)
      .where(and(eq(chatThreads.id, input.threadId), eq(chatThreads.userId, ctx.actor!.userId)));
    if (!thread) throw notFound('Chat');
    return thread;
  },
});

export const deleteChatThread = defineService({
  name: 'chat.deleteThread',
  description: 'Delete an AI chat thread.',
  kind: 'mutation',
  access: 'ai.chat',
  tool: false,
  input: chatThreadIdInput,
  async handler(ctx, input) {
    await ctx.db.delete(chatThreads).where(and(eq(chatThreads.id, input.threadId), eq(chatThreads.userId, ctx.actor!.userId)));
    return { ok: true };
  },
});

export async function saveChatThread(ctx: Ctx, threadId: string, messages: unknown[], title: string) {
  const [existing] = await ctx.db.select({ userId: chatThreads.userId }).from(chatThreads).where(eq(chatThreads.id, threadId));
  if (existing && existing.userId !== ctx.actor!.userId) throw notFound('Chat');
  if (existing) await ctx.db.update(chatThreads).set({ messages }).where(eq(chatThreads.id, threadId));
  else await ctx.db.insert(chatThreads).values({ id: threadId, userId: ctx.actor!.userId, messages, title });
}
