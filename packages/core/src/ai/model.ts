import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { AI_CURATED_MODELS, type AiProvider, type SettingsValues } from '@openinc/shared';
import { generateText, type LanguageModel } from 'ai';
import { getSettings } from '../settings.ts';

type AiSettings = SettingsValues<'ai'>;
export type AiConnection = Pick<AiSettings, 'provider' | 'apiKey' | 'baseUrl'>;

/** LiteLLM is usually given as its root address; its OpenAI-compatible API lives under /v1. */
export function litellmBaseUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, '');
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

function apiBase(c: AiConnection): string {
  switch (c.provider) {
    case 'anthropic':
      return (c.baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    case 'openai':
      return (c.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    case 'opper':
      return 'https://api.opper.ai/v3/compat';
    case 'berget':
      return 'https://api.berget.ai/v1';
    case 'litellm':
      return litellmBaseUrl(c.baseUrl);
    case 'openai-compatible':
      return c.baseUrl.replace(/\/+$/, '');
  }
}

/**
 * The provider, model and key come from Admin settings. LiteLLM is a proxy the Admin runs; OpenInc only points at it.
 * Opper and Berget AI speak the OpenAI chat API at fixed addresses.
 */
export function modelFor(settings: AiSettings): LanguageModel {
  switch (settings.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: settings.apiKey, baseURL: settings.baseUrl || undefined })(settings.model);
    case 'openai':
      return createOpenAI({ apiKey: settings.apiKey, baseURL: settings.baseUrl || undefined })(settings.model);
    case 'opper':
    case 'berget':
    case 'litellm':
    case 'openai-compatible':
      return createOpenAICompatible({
        name: settings.provider,
        baseURL: apiBase(settings),
        apiKey: settings.apiKey || undefined,
      }).chatModel(settings.model);
  }
}

export async function getChatModel(): Promise<LanguageModel | null> {
  const settings = await getSettings('ai');
  return settings ? modelFor(settings) : null;
}

export async function isAiConfigured(): Promise<boolean> {
  return (await getSettings('ai')) !== null;
}

/** Turns provider and network failures into a sentence an Admin can act on. */
export function describeAiError(error: unknown, c: AiConnection): string {
  const e = error as { statusCode?: number; status?: number; message?: string; cause?: { code?: string } };
  const status = e.statusCode ?? e.status;
  const where = c.provider === 'litellm' || c.provider === 'openai-compatible' ? ` at ${apiBase(c)}` : '';
  if (status === 401 || status === 403) return `The provider refused the key${where} (HTTP ${status}). Check the key.`;
  if (status === 404) return `Not found${where} (HTTP 404). Check the base URL and the model name.`;
  if (status === 429) return 'The provider is rate limiting or out of credit (HTTP 429).';
  const code = e.cause?.code;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || /fetch failed|ECONNREFUSED|ENOTFOUND/.test(e.message ?? '')) {
    return `Could not reach the provider${where}. Check the URL and that the service is running.`;
  }
  return e.message ?? String(error);
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
    return { ok: false, error: describeAiError(error, settings) };
  }
}

interface ListedModel {
  id?: string;
  model_name?: string;
  /** Opper: embeddings share the list, and only some models can call tools. */
  opper?: { type?: string; capabilities?: string[] };
  /** Berget AI: the list includes embedding, rerank and speech models. */
  model_type?: string;
}

/** The assistant needs chat models that can call tools; Opper and Berget AI list other kinds too. */
const isChatModel = (provider: AiProvider) => (m: ListedModel) => {
  if (provider === 'opper') return (m.opper?.type ?? 'llm') === 'llm' && (!m.opper?.capabilities || m.opper.capabilities.includes('tools'));
  if (provider === 'berget') return (m.model_type ?? 'text') === 'text';
  return true;
};

/**
 * The models the provider offers, fetched server-side so the key never reaches the browser. Without a
 * key (or when the call fails) the short built-in list for the provider is returned instead.
 */
export async function listModels(c: AiConnection): Promise<{ models: string[]; source: 'provider' | 'built-in'; error: string | null }> {
  const builtIn = { models: AI_CURATED_MODELS[c.provider as AiProvider], source: 'built-in' as const };
  const needsKey = c.provider === 'anthropic' || c.provider === 'openai' || c.provider === 'opper';
  if ((needsKey && !c.apiKey) || ((c.provider === 'litellm' || c.provider === 'openai-compatible') && !c.baseUrl)) {
    return { ...builtIn, error: null };
  }
  const headers: Record<string, string> =
    c.provider === 'anthropic'
      ? { 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01' }
      : c.apiKey
        ? { authorization: `Bearer ${c.apiKey}` }
        : {};
  try {
    const res = await fetch(`${apiBase(c)}/models${c.provider === 'anthropic' ? '?limit=100' : ''}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ...builtIn, error: describeAiError({ status: res.status, message: `HTTP ${res.status}` }, c) };
    const body = (await res.json()) as { data?: ListedModel[] };
    const chat = (body.data ?? []).filter(isChatModel(c.provider));
    const ids = [...new Set(chat.map((m) => m.id ?? m.model_name).filter((id): id is string => !!id))];
    const relevant =
      c.provider === 'openai'
        ? ids.filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/(audio|realtime|transcribe|tts|image|search)/.test(id))
        : ids;
    return { models: relevant.sort(), source: 'provider', error: null };
  } catch (error) {
    return { ...builtIn, error: describeAiError(error, c) };
  }
}
