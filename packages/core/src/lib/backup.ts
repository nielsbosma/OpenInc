import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { getEnv } from '../env.ts';
import { deleteObject, listObjects, uploadStream } from './storage.ts';

export const BACKUP_PREFIX = 'backups/';
const KEEP = 5;

export class BackupUnavailableError extends Error {}

/**
 * Streams `pg_dump --format=custom` into the bucket and keeps the newest five. Restore with
 * `pg_restore --clean --if-exists -d <DATABASE_URL> <file>`.
 */
export async function backupDatabase(reason: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const key = `${BACKUP_PREFIX}openinc-${stamp}-${reason.replace(/[^a-z0-9.-]+/gi, '_')}.dump`;
  const out = new PassThrough();
  const child = spawn('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', `--dbname=${getEnv().DATABASE_URL}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdout.pipe(out);

  const exited = new Promise<void>((resolve, reject) => {
    child.on('error', (error: NodeJS.ErrnoException) =>
      reject(error.code === 'ENOENT' ? new BackupUnavailableError('pg_dump is not installed in this environment') : error),
    );
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`pg_dump exited with ${code}: ${stderr.trim().slice(0, 500)}`)),
    );
  });
  exited.catch((error) => out.destroy(error));

  await Promise.all([uploadStream(key, out, 'application/octet-stream'), exited]);
  await pruneBackups();
  return key;
}

export async function listBackups() {
  const objects = await listObjects(BACKUP_PREFIX);
  return objects.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}

async function pruneBackups(): Promise<void> {
  const backups = await listBackups();
  for (const old of backups.slice(KEEP)) await deleteObject(old.key);
}
