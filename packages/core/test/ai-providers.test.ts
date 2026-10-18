import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listModels, litellmBaseUrl, testModel } from '../src/ai/model.ts';

/** A stand-in for LiteLLM's OpenAI-compatible API: /v1/models and /v1/chat/completions, key "sk-good". */
let server: Server;
let base = '';
const seen: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.headers.authorization !== 'Bearer sk-good') {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'Invalid key' } }));
      return;
    }
    if (req.url === '/v1/models') {
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ data: [{ id: 'team-fast' }, { id: 'claude-sonnet' }] }));
      return;
    }
    if (req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          id: 'c1',
          object: 'chat.completion',
          created: 1,
          model: 'team-fast',
          choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('LiteLLM', () => {
  it('adds /v1 to a root address', () => {
    expect(litellmBaseUrl('https://litellm.example.com/')).toBe('https://litellm.example.com/v1');
    expect(litellmBaseUrl('https://litellm.example.com/v1')).toBe('https://litellm.example.com/v1');
  });

  it('lists the models from the proxy', async () => {
    const result = await listModels({ provider: 'litellm', baseUrl: base, apiKey: 'sk-good' });
    expect(result).toEqual({ models: ['claude-sonnet', 'team-fast'], source: 'provider', error: null });
  });

  it('passes the connection test through the chat API', async () => {
    const result = await testModel({ provider: 'litellm', baseUrl: base, apiKey: 'sk-good', model: 'team-fast' });
    expect(result).toMatchObject({ ok: true, reply: 'OK' });
    expect(seen).toContain('POST /v1/chat/completions');
  });

  it('explains a refused key and an unreachable proxy', async () => {
    const refused = await testModel({ provider: 'litellm', baseUrl: base, apiKey: 'sk-bad', model: 'team-fast' });
    expect(refused).toMatchObject({ ok: false });
    expect(refused.ok ? '' : refused.error).toMatch(/refused the key/);
    const down = await listModels({ provider: 'litellm', baseUrl: 'http://127.0.0.1:1', apiKey: 'sk-good' });
    expect(down.source).toBe('built-in');
    expect(down.error).toMatch(/Could not reach/);
  });
});

describe('model lists', () => {
  it('offers the built-in list before a key is entered', async () => {
    expect(await listModels({ provider: 'anthropic', baseUrl: '', apiKey: '' })).toEqual({
      models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
      source: 'built-in',
      error: null,
    });
  });

  it('reads an OpenAI-style list and keeps only chat models', async () => {
    const result = await listModels({ provider: 'openai', baseUrl: `${base}/v1`, apiKey: 'sk-good' });
    expect(result.source).toBe('provider');
  });
});

describe('Opper and Berget AI', () => {
  const realFetch = globalThis.fetch;
  const calls: { url: string; auth: string | null }[] = [];
  const respond = (body: unknown) => {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
  };
  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it('lists only Opper chat models that can call tools, from its fixed address', async () => {
    respond({
      data: [
        { id: 'anthropic/claude-sonnet-4-6', opper: { type: 'llm', capabilities: ['text', 'tools'] } },
        { id: 'openai/text-embedding-3-small', opper: { type: 'embedding', capabilities: ['text'] } },
        { id: 'some/no-tools', opper: { type: 'llm', capabilities: ['text'] } },
      ],
    });
    const result = await listModels({ provider: 'opper', baseUrl: '', apiKey: 'op-key' });
    expect(result).toEqual({ models: ['anthropic/claude-sonnet-4-6'], source: 'provider', error: null });
    expect(calls.at(-1)).toEqual({ url: 'https://api.opper.ai/v3/compat/models', auth: 'Bearer op-key' });
  });

  it('needs a key before asking Opper', async () => {
    const result = await listModels({ provider: 'opper', baseUrl: '', apiKey: '' });
    expect(result.source).toBe('built-in');
  });

  it('lists only Berget AI text models', async () => {
    respond({
      data: [
        { id: 'moonshotai/Kimi-K3', model_type: 'text' },
        { id: 'intfloat/multilingual-e5-large', model_type: 'embedding' },
        { id: 'KBLab/kb-whisper-large', model_type: 'speech-to-text' },
      ],
    });
    const result = await listModels({ provider: 'berget', baseUrl: '', apiKey: 'bg-key' });
    expect(result).toEqual({ models: ['moonshotai/Kimi-K3'], source: 'provider', error: null });
    expect(calls.at(-1)).toEqual({ url: 'https://api.berget.ai/v1/models', auth: 'Bearer bg-key' });
  });
});
