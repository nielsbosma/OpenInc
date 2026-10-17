import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { SettingsValues } from '@openinc/shared';
import { generateText, type LanguageModel } from 'ai';
import { getSettings } from '../settings.ts';

type AiSettings = SettingsValues<'ai'>;

/** The provider, model and key come from Admin settings; there is no proxy in between. */
export function modelFor(settings: AiSettings): LanguageModel {
  const baseURL = settings.baseUrl || undefined;
  switch (settings.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: settings.apiKey, baseURL })(settings.model);
    case 'openai':
      return createOpenAI({ apiKey: settings.apiKey, baseURL })(settings.model);
    case 'openai-compatible':
      return createOpenAICompatible({ name: 'custom', baseURL: settings.baseUrl, apiKey: settings.apiKey || undefined }).chatModel(
        settings.model,
      );
  }
}

export async function getChatModel(): Promise<LanguageModel | null> {
  const settings = await getSettings('ai');
  return settings ? modelFor(settings) : null;
}

export async function isAiConfigured(): Promise<boolean> {
  return (await getSettings('ai')) !== null;
}

/** A tiny request that proves the key, model and URL work. */
export async function testModel(settings: AiSettings): Promise<{ ok: true; reply: string; ms: number } | { ok: false; error: string }> {
  const started = Date.now();
  try {
    const result = await generateText({
      model: modelFor(settings),
      prompt: 'Reply with the single word OK.',
      maxOutputTokens: 16,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(30_000),
    });
    return { ok: true, reply: result.text.trim().slice(0, 100), ms: Date.now() - started };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
