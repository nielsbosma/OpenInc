import { type Ctx, createCtx, getEnv, PORTAL_SESSION_HOURS, resolveSession, SESSION_COOKIE, type Surface } from '@openinc/core';
import type { Request, Response } from 'express';

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

export function requestMeta(req: Request) {
  return { ip: req.ip, userAgent: req.get('user-agent') ?? undefined };
}

/** The service context for a browser request, signed in through the session cookie. */
export async function ctxFromRequest(req: Request, surface: Surface = 'web'): Promise<Ctx> {
  const ctx = createCtx({ surface, ...requestMeta(req) });
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return ctx;
  const session = await resolveSession(ctx.db, token);
  return session ? { ...ctx, actor: session.actor, sessionId: session.sessionId } : ctx;
}

function secureCookies(req: Request): boolean {
  const configured = getEnv().APP_URL;
  return configured ? configured.startsWith('https://') : req.secure;
}

export function setSessionCookie(req: Request, res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: secureCookies(req), path: '/', expires: expiresAt });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** A dataroom visitor's cookie: strict, since the portal never needs it on a request from another site. */
export function setPortalCookie(req: Request, res: Response, name: string, token: string) {
  res.cookie(name, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: secureCookies(req),
    path: '/',
    maxAge: PORTAL_SESSION_HOURS * 3600_000,
  });
}
