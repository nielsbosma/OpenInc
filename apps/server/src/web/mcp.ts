import { InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  AppError,
  allServices,
  appUrl,
  appVersion,
  type Ctx,
  canAccess,
  codeChallengeFor,
  consentUrl,
  createCtx,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  getOAuthClient,
  invoke,
  isTool,
  loadActor,
  MCP_SCOPE,
  registerOAuthClient,
  reportError,
  revokeToken,
  toJsonSafe,
  toolName,
  verifyAccessToken,
} from '@openinc/core';
import express, { type NextFunction, type Request, type RequestHandler, type Response, Router } from 'express';
import { z } from 'zod';

async function asGrantError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AppError) throw new InvalidGrantError(error.message);
    throw error;
  }
}

const provider: OAuthServerProvider = {
  clientsStore: {
    getClient: async (clientId) => (await getOAuthClient(clientId)) as OAuthClientInformationFull | undefined,
    registerClient: async (client) => (await registerOAuthClient(client as never)) as OAuthClientInformationFull,
  },
  async authorize(client, params, res) {
    res.redirect(
      consentUrl({
        clientId: client.client_id,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        state: params.state,
        scopes: params.scopes?.length ? params.scopes : [MCP_SCOPE],
        resource: params.resource?.toString(),
      }),
    );
  },
  challengeForAuthorizationCode: (client, code) => asGrantError(() => codeChallengeFor(client.client_id, code)),
  exchangeAuthorizationCode: (client, code, _verifier, redirectUri) =>
    asGrantError(() => exchangeAuthorizationCode(client.client_id, code, redirectUri)),
  exchangeRefreshToken: (client, refreshToken) => asGrantError(() => exchangeRefreshToken(client.client_id, refreshToken)),
  async verifyAccessToken(token) {
    try {
      const v = await verifyAccessToken(token);
      return {
        token,
        clientId: v.clientId,
        scopes: v.scopes,
        expiresAt: v.expiresAt,
        resource: v.resource ? new URL(v.resource) : undefined,
        extra: { userId: v.actor.userId },
      };
    } catch {
      throw new InvalidTokenError('Invalid or expired token');
    }
  },
  revokeToken: (client, request) => revokeToken(client.client_id, request.token),
};

/** One MCP tool per service the user may call: the same functions, permissions and audit as the UI. */
function buildServer(ctx: Ctx): Server {
  const server = new Server({ name: 'openinc', version: appVersion() }, { capabilities: { tools: {} } });
  const tools = allServices.filter((def) => isTool(def) && canAccess(def, ctx));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((def) => ({
      name: toolName(def),
      description: def.description,
      inputSchema: z.toJSONSchema(def.input, { io: 'input', unrepresentable: 'any' }) as { type: 'object'; [k: string]: unknown },
      annotations: { readOnlyHint: def.kind === 'query' },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const def = tools.find((d) => toolName(d) === request.params.name);
    if (!def) return { isError: true, content: [{ type: 'text', text: `Unknown tool ${request.params.name}` }] };
    try {
      const result = toJsonSafe(await invoke(def, ctx, request.params.arguments ?? {}));
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: { result } };
    } catch (error) {
      if (error instanceof AppError) return { isError: true, content: [{ type: 'text', text: error.message }] };
      reportError(error, { tool: def.name });
      return { isError: true, content: [{ type: 'text', text: 'The tool failed unexpectedly' }] };
    }
  });

  return server;
}

function buildRouter(): Router {
  const base = new URL(appUrl());
  const mcpUrl = new URL('/mcp', base);
  const r = Router();
  r.use(mcpAuthRouter({ provider, issuerUrl: base, resourceServerUrl: mcpUrl, scopesSupported: [MCP_SCOPE], resourceName: 'OpenInc' }));

  const auth = requireBearerAuth({ verifier: provider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl) });
  r.post('/mcp', express.json({ limit: '30mb' }), auth, async (req: Request, res: Response) => {
    const userId = req.auth?.extra?.userId as string | undefined;
    const ctx = createCtx({ surface: 'mcp', ip: req.ip, userAgent: req.get('user-agent') ?? undefined });
    const actor = userId ? await loadActor(ctx.db, userId) : null;
    if (!actor) return res.status(401).json({ error: 'invalid_token' });
    if (actor.mustEnableTwoFactor) return res.status(403).json({ error: 'Set up two-factor authentication in OpenInc first' });

    const server = buildServer({ ...ctx, actor });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const notAllowed = (_req: Request, res: Response) => res.status(405).set('Allow', 'POST').json({ error: 'Method not allowed' });
  r.get('/mcp', notAllowed);
  r.delete('/mcp', notAllowed);
  return r;
}

/**
 * Remote MCP over Streamable HTTP at /mcp with OAuth 2.1 (dynamic client registration, PKCE).
 * Built on first use because the issuer URL may come from the first request when APP_URL is unset.
 */
export function mcpRouter(): RequestHandler {
  let router: Router | undefined;
  return (req: Request, res: Response, next: NextFunction) => {
    router ??= buildRouter();
    router(req, res, next);
  };
}
