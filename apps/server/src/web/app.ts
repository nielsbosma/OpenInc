import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, type Ctx, getSystemStatus, isReady, readEnv, rememberRequestOrigin, reportError } from '@openinc/core';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import express, { type NextFunction, type Request, type Response } from 'express';
import { captableExportHandler } from './captable-exports.ts';
import { chatHandler } from './chat.ts';
import { backupHandler, filesRouter, logoHandler } from './files.ts';
import { ctxFromRequest } from './http-context.ts';
import { mcpRouter } from './mcp.ts';
import { registryExportHandler } from './registry-exports.ts';
import { appRouter } from './router.ts';
import { INTERNAL_ERROR_MESSAGE } from './trpc.ts';

const webDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../../web/dist');

/** Before the database is ready only the wizard's calls work; everything else answers 503 with the phase. */
const OPEN_BEFORE_READY = /^(setup\.(status|verifyCode|install|createFirstAdmin)|system\.clientConfig)$/;

function anonymousCtx(): Ctx {
  return { db: undefined as unknown as Ctx['db'], actor: null, surface: 'web' };
}

async function trpcContext(req: Request): Promise<Ctx> {
  if (!readEnv().env) return anonymousCtx();
  if (!isReady()) return { ...(await ctxFromRequest(req).catch(() => anonymousCtx())), actor: null };
  return ctxFromRequest(req);
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use((req, res, next) => {
    res.locals.requestId = randomUUID().slice(0, 8);
    res.setHeader('X-Request-Id', res.locals.requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (!readEnv().env?.APP_URL && req.get('host')) rememberRequestOrigin(`${req.protocol}://${req.get('host')}`);
    next();
  });

  // Liveness: the process answers, even while it waits for setup. Hosts must not restart it for that.
  app.get('/api/health', (_req, res) => {
    const status = getSystemStatus();
    res.json({ ok: true, phase: status.phase, version: status.version });
  });

  // Readiness: the database is installed and up to date.
  app.get('/api/ready', (_req, res) => {
    const status = getSystemStatus();
    res.status(status.phase === 'ready' ? 200 : 503).json({ ready: status.phase === 'ready', phase: status.phase });
  });

  app.post('/api/system/retry', (_req, res) => {
    void boot({ migrate: true });
    res.json({ ok: true });
  });

  // Cookie-authenticated writes must come from our own origin.
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origin = req.get('origin');
    if (!origin) return next();
    const expected = readEnv().env?.APP_URL ?? `${req.protocol}://${req.get('host')}`;
    if (new URL(origin).host !== new URL(expected).host) return res.status(403).json({ error: 'Cross-origin request refused' });
    next();
  });

  app.use('/api/trpc', (req, res, next) => {
    if (isReady()) return next();
    const procedures = decodeURIComponent(req.path.replace(/^\//, '')).split(',');
    if (procedures.every((p) => OPEN_BEFORE_READY.test(p))) return next();
    res.status(503).json({ error: 'OpenInc is not ready yet', phase: getSystemStatus().phase });
  });

  app.use(
    '/api/trpc',
    express.json({ limit: '2mb' }),
    createExpressMiddleware({
      router: appRouter,
      createContext: async ({ req, res }) => ({ app: await trpcContext(req), req, res }),
      onError: ({ error, path, ctx }) => {
        if (error.code === 'INTERNAL_SERVER_ERROR') reportError(error.cause ?? error, { path, requestId: ctx?.res.locals.requestId });
      },
    }),
  );

  const requireReady = (_req: Request, res: Response, next: NextFunction) =>
    isReady() ? next() : res.status(503).json({ error: 'OpenInc is not ready yet', phase: getSystemStatus().phase });

  app.post('/api/chat', requireReady, express.json({ limit: '40mb' }), (req, res, next) => {
    chatHandler(req, res).catch(next);
  });
  app.use('/api/files', requireReady, filesRouter());
  app.get('/api/backups/:name', requireReady, (req, res, next) => {
    backupHandler(req, res).catch(next);
  });
  app.get('/api/captable/export/:kind', requireReady, (req, res, next) => {
    captableExportHandler(req, res).catch(next);
  });
  app.get('/api/registry/export/:kind', requireReady, (req, res, next) => {
    registryExportHandler(req, res).catch(next);
  });
  app.get('/api/public/logo', requireReady, (req, res, next) => {
    logoHandler(req, res).catch(next);
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  const mcp = mcpRouter();
  app.use((req, res, next) => (isReady() && readEnv().env ? mcp(req, res, next) : next()));

  if (existsSync(webDist)) {
    app.use('/assets', express.static(resolve(webDist, 'assets'), { immutable: true, maxAge: '1y' }));
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    const indexHtml = readFileSync(resolve(webDist, 'index.html'), 'utf8');
    app.get(/^(?!\/(api|mcp)(\/|$)).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.type('html').send(indexHtml);
    });
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    reportError(error, { requestId: res.locals.requestId });
    if (!res.headersSent) res.status(500).json({ error: `${INTERNAL_ERROR_MESSAGE} (reference ${res.locals.requestId})` });
  });

  return app;
}

export function listen(app: ReturnType<typeof createApp>, port: number) {
  return new Promise<ReturnType<typeof app.listen>>((resolveListen) => {
    const server = app.listen(port, () => resolveListen(server));
  });
}
