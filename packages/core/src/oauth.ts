import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, oauthClients, oauthCodes, oauthGrants, or } from '@openinc/db';
import { z } from 'zod';
import { audit } from './audit.ts';
import { loadActor } from './auth/sessions.ts';
import { type Actor, type Ctx, getDb } from './context.ts';
import { appUrl } from './env.ts';
import { badRequest, unauthorized } from './errors.ts';
import { randomToken, sha256, sign, verifySigned } from './lib/crypto.ts';
import { defineService } from './service.ts';

/**
 * OAuth 2.1 storage and policy for the remote MCP server. The MCP SDK speaks the protocol
 * (metadata, dynamic registration, PKCE checks); this file decides what is stored and who may connect.
 */

export const MCP_SCOPE = 'openinc';
const CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface OAuthClientInfo {
  client_id: string;
  client_name?: string;
  client_uri?: string;
  redirect_uris: string[];
  client_id_issued_at?: number;
  [key: string]: unknown;
}

export interface PendingAuthorization {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scopes: string[];
  resource?: string;
}

export interface IssuedTokens {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export async function getOAuthClient(clientId: string): Promise<OAuthClientInfo | undefined> {
  const [row] = await getDb().select().from(oauthClients).where(eq(oauthClients.clientId, clientId));
  return row ? (row.metadata as OAuthClientInfo) : undefined;
}

export async function registerOAuthClient(client: {
  redirect_uris: string[];
  client_id?: string;
  client_name?: string;
  client_id_issued_at?: number;
  [key: string]: unknown;
}): Promise<OAuthClientInfo> {
  const info: OAuthClientInfo = {
    ...client,
    redirect_uris: client.redirect_uris.map(String),
    client_id: client.client_id ?? randomUUID(),
    client_id_issued_at: client.client_id_issued_at ?? Math.floor(Date.now() / 1000),
  };
  await getDb()
    .insert(oauthClients)
    .values({
      clientId: info.client_id,
      name: (info.client_name ?? 'MCP client').slice(0, 120),
      redirectUris: info.redirect_uris,
      metadata: info,
    });
  return info;
}

/** The consent page gets a signed blob instead of a database row, so abandoned requests leave nothing behind. */
export function consentUrl(p: PendingAuthorization): string {
  return `${appUrl()}/oauth/consent?request=${encodeURIComponent(sign(p, 10 * 60))}`;
}

export function decodePendingAuthorization(token: string): PendingAuthorization {
  const p = verifySigned<PendingAuthorization>(token);
  if (!p) throw badRequest('This connection request has expired. Start connecting again from your MCP client.');
  return p;
}

function redirectWith(p: PendingAuthorization, params: Record<string, string>): string {
  const url = new URL(p.redirectUri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (p.state) url.searchParams.set('state', p.state);
  return url.toString();
}

export async function codeChallengeFor(clientId: string, code: string): Promise<string> {
  const [row] = await getDb()
    .select({ challenge: oauthCodes.codeChallenge })
    .from(oauthCodes)
    .where(and(eq(oauthCodes.id, sha256(code)), eq(oauthCodes.clientId, clientId), gt(oauthCodes.expiresAt, new Date())));
  if (!row) throw badRequest('Invalid authorization code');
  return row.challenge;
}

async function issueGrant(clientId: string, userId: string, scopes: string[], resource: string | null): Promise<IssuedTokens> {
  const access = randomToken();
  const refresh = randomToken();
  await getDb()
    .insert(oauthGrants)
    .values({
      id: randomUUID(),
      clientId,
      userId,
      scopes,
      resource,
      accessTokenHash: sha256(access),
      refreshTokenHash: sha256(refresh),
      accessExpiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000),
      refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    });
  return { access_token: access, token_type: 'bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: scopes.join(' ') };
}

export async function exchangeAuthorizationCode(clientId: string, code: string, redirectUri?: string): Promise<IssuedTokens> {
  const [row] = await getDb()
    .delete(oauthCodes)
    .where(and(eq(oauthCodes.id, sha256(code)), eq(oauthCodes.clientId, clientId)))
    .returning();
  if (!row || row.expiresAt < new Date()) throw badRequest('Invalid or expired authorization code');
  if (redirectUri && redirectUri !== row.redirectUri) throw badRequest('redirect_uri does not match');
  return issueGrant(clientId, row.userId, row.scopes, row.resource);
}

/** Refresh tokens rotate: every use replaces both tokens of the grant. */
export async function exchangeRefreshToken(clientId: string, refreshToken: string): Promise<IssuedTokens> {
  const db = getDb();
  const [grant] = await db
    .select()
    .from(oauthGrants)
    .where(and(eq(oauthGrants.refreshTokenHash, sha256(refreshToken)), eq(oauthGrants.clientId, clientId), isNull(oauthGrants.revokedAt)));
  if (!grant || grant.refreshExpiresAt < new Date()) throw badRequest('Invalid refresh token');
  if (!(await loadActor(db, grant.userId))) throw unauthorized('The account is deactivated');
  const access = randomToken();
  const refresh = randomToken();
  await db
    .update(oauthGrants)
    .set({
      accessTokenHash: sha256(access),
      refreshTokenHash: sha256(refresh),
      accessExpiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000),
      refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    })
    .where(eq(oauthGrants.id, grant.id));
  return { access_token: access, token_type: 'bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: grant.scopes.join(' ') };
}

export async function verifyAccessToken(
  token: string,
): Promise<{ actor: Actor; clientId: string; scopes: string[]; expiresAt: number; resource: string | null }> {
  const db = getDb();
  const [grant] = await db
    .select()
    .from(oauthGrants)
    .where(and(eq(oauthGrants.accessTokenHash, sha256(token)), isNull(oauthGrants.revokedAt), gt(oauthGrants.accessExpiresAt, new Date())));
  if (!grant) throw unauthorized('Invalid or expired token');
  const actor = await loadActor(db, grant.userId);
  if (!actor) throw unauthorized('The account is deactivated');
  if (!grant.lastUsedAt || Date.now() - grant.lastUsedAt.getTime() > 60_000) {
    await db.update(oauthGrants).set({ lastUsedAt: new Date() }).where(eq(oauthGrants.id, grant.id));
  }
  return {
    actor,
    clientId: grant.clientId,
    scopes: grant.scopes,
    expiresAt: Math.floor(grant.accessExpiresAt.getTime() / 1000),
    resource: grant.resource,
  };
}

export async function revokeToken(clientId: string, token: string): Promise<void> {
  const hash = sha256(token);
  await getDb()
    .update(oauthGrants)
    .set({ revokedAt: new Date() })
    .where(and(eq(oauthGrants.clientId, clientId), or(eq(oauthGrants.accessTokenHash, hash), eq(oauthGrants.refreshTokenHash, hash))));
}

async function approve(ctx: Ctx, p: PendingAuthorization): Promise<string> {
  const client = await getOAuthClient(p.clientId);
  if (!client?.redirect_uris.includes(p.redirectUri)) throw badRequest('Unknown client or redirect URI');
  const code = randomToken();
  await ctx.db.insert(oauthCodes).values({
    id: sha256(code),
    clientId: p.clientId,
    userId: ctx.actor!.userId,
    codeChallenge: p.codeChallenge,
    redirectUri: p.redirectUri,
    scopes: p.scopes.length ? p.scopes : [MCP_SCOPE],
    resource: p.resource ?? null,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  await audit(ctx, {
    action: 'oauth.approve',
    entityType: 'oauth_client',
    entityId: p.clientId,
    metadata: { clientName: client.client_name },
  });
  return redirectWith(p, { code });
}

const requestInput = z.object({ request: z.string().min(1) });

export const describeAuthorization = defineService({
  name: 'oauth.describe',
  description: 'Describe a pending MCP client connection request for the consent screen.',
  kind: 'query',
  access: 'authenticated',
  tool: false,
  input: requestInput,
  async handler(_ctx, input) {
    const p = decodePendingAuthorization(input.request);
    const client = await getOAuthClient(p.clientId);
    return {
      clientName: client?.client_name ?? 'Unknown client',
      clientUri: typeof client?.client_uri === 'string' ? client.client_uri : null,
      redirectHost: new URL(p.redirectUri).host,
    };
  },
});

export const approveAuthorization = defineService({
  name: 'oauth.approve',
  description: 'Allow an MCP client to act as you. Returns where to send the browser next.',
  kind: 'mutation',
  access: 'authenticated',
  tool: false,
  input: requestInput,
  handler: async (ctx, input) => ({ redirectUrl: await approve(ctx, decodePendingAuthorization(input.request)) }),
});

export const denyAuthorization = defineService({
  name: 'oauth.deny',
  description: 'Refuse an MCP client connection.',
  kind: 'mutation',
  access: 'authenticated',
  tool: false,
  input: requestInput,
  handler: async (_ctx, input) => ({
    redirectUrl: redirectWith(decodePendingAuthorization(input.request), {
      error: 'access_denied',
      error_description: 'The user refused access',
    }),
  }),
});
