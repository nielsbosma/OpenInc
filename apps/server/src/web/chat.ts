import {
  buildTools,
  type Ctx,
  can,
  getChatModel,
  getObjectBuffer,
  getReadableFile,
  reportError,
  saveChatThread,
  systemPrompt,
} from '@openinc/core';
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ctxFromRequest } from './http-context.ts';

const body = z.object({
  id: z.uuid(),
  messages: z.array(z.any()).min(1).max(200),
  page: z.string().max(300).optional(),
});

const FILE_URL = /^\/api\/files\/([0-9a-f-]{36})\/content$/;

/** Attachments are app URLs in the browser; the model needs their bytes, so they are inlined here, with the same read check as a download. */
async function inlineAttachments(ctx: Ctx, messages: UIMessage[]): Promise<UIMessage[]> {
  return Promise.all(
    messages.map(async (m) => ({
      ...m,
      parts: await Promise.all(
        m.parts.map(async (part) => {
          if (part.type !== 'file') return part;
          const match = FILE_URL.exec(part.url);
          if (!match) return part;
          const file = await getReadableFile(ctx, match[1]!);
          const data = await getObjectBuffer(file.storageKey);
          return { ...part, url: `data:${file.contentType};base64,${data.toString('base64')}` };
        }),
      ),
    })),
  );
}

function titleFrom(messages: UIMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  const text =
    first?.parts
      .flatMap((p) => (p.type === 'text' ? [p.text] : []))
      .join(' ')
      .trim() ?? '';
  return text.length > 60 ? `${text.slice(0, 57)}...` : text || 'New chat';
}

export async function chatHandler(req: Request, res: Response) {
  const ctx = await ctxFromRequest(req, 'ai');
  if (!ctx.actor) return res.status(401).json({ error: 'Sign in required' });
  if (ctx.actor.mustEnableTwoFactor) return res.status(403).json({ error: 'Set up two-factor authentication first' });
  if (!can(ctx, 'ai.chat')) return res.status(403).json({ error: 'You do not have access to the assistant' });
  const model = await getChatModel();
  if (!model)
    return res.status(409).json({ error: 'The assistant is not set up. An Admin can add an AI provider under Admin settings → AI.' });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });

  const { id, page } = parsed.data;
  const messages = parsed.data.messages as UIMessage[];
  const tools = buildTools(ctx);
  const result = streamText({
    model,
    system: await systemPrompt(ctx, page),
    messages: await convertToModelMessages(await inlineAttachments(ctx, messages), { tools }),
    tools,
    stopWhen: stepCountIs(12),
    onError: ({ error }) => reportError(error, { surface: 'ai-chat' }),
  });

  await result.pipeUIMessageStreamToResponse(res, {
    originalMessages: messages,
    onFinish: async ({ messages: all }) => {
      await saveChatThread(ctx, id, all, titleFrom(all)).catch((error) => reportError(error, { threadId: id }));
    },
    onError: (error) => (error instanceof Error ? error.message : 'The assistant failed'),
  });
}
