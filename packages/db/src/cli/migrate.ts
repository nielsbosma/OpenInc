import { readFileSync } from 'node:fs';
import { migrate } from '../migrator.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const { version } = JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')) as { version: string };
const result = await migrate({ connectionString: url, appVersion: version, onProgress: (e) => e.type === 'done' && console.log(`applied ${e.tag}`) });
console.log(result.applied.length ? `${result.applied.length} migration(s) applied` : 'database is up to date');
