import { createServer } from 'node:http';
import {
  boot,
  closeDb,
  getSystemStatus,
  initErrorTracking,
  loadDevEnv,
  onReady,
  readEnv,
  setupCode,
  startSettingsListener,
  stopJobs,
  stopSettingsListener,
} from '@openinc/core';
import { createApp, listen } from './web/app.ts';
import { startWorker, stopWorker } from './worker/index.ts';

loadDevEnv(new URL('../../../', import.meta.url));

/**
 * One image, one process by default: the web app and the job worker together. ROLE=web or
 * ROLE=worker runs only one of them, to scale them separately.
 */
const { env, problems } = readEnv();
const role = env?.ROLE ?? 'all';
const port = env?.PORT ?? Number(process.env.PORT ?? 3000);
const runsWeb = role !== 'worker';
const runsWorker = role !== 'web';

if (problems.length) {
  console.error(
    `[openinc] configuration problems:\n${problems.map((p) => `  - ${p.message}${p.hint ? `\n    ${p.hint}` : ''}`).join('\n')}`,
  );
}

if (runsWeb) {
  const server = await listen(createApp(), port);
  console.log(`[openinc] ${getSystemStatus().version} listening on :${port} (role ${role})`);
  process.on('SIGTERM', () => server.close());
} else {
  // Hosts health-check every service over HTTP, so a worker-only container still answers /api/health.
  createServer((_req, res) => {
    const status = getSystemStatus();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, role, phase: status.phase }));
  }).listen(port);
  console.log(`[openinc] ${getSystemStatus().version} worker, health on :${port}`);
}

onReady(async () => {
  await startSettingsListener();
  await initErrorTracking(runsWeb ? 'web' : 'worker');
  if (runsWorker) await startWorker();
  const status = getSystemStatus();
  if (status.needsAdmin && runsWeb) printSetupCode();
});

let printed = false;
function printSetupCode() {
  if (printed) return;
  printed = true;
  const line = '─'.repeat(54);
  console.log(
    `\n${line}\n  OpenInc is waiting to be set up.\n  Open the app in your browser and enter this setup code:\n\n      ${setupCode()}\n\n${line}\n`,
  );
}

await boot({ migrate: true });
if (getSystemStatus().phase === 'needs-install' && runsWeb) printSetupCode();

async function shutdown() {
  await stopWorker().catch(() => {});
  await stopJobs().catch(() => {});
  await stopSettingsListener().catch(() => {});
  await closeDb().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
