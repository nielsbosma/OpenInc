import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  compareVersions,
  DatabaseTooNewError,
  loadMigrations,
  type Migration,
  MigrationFailedError,
  migrate,
  planMigrations,
} from './migrator.ts';

const adminUrl = process.env.TEST_DATABASE_URL ?? 'postgres://openinc:openinc@localhost:5470/openinc_test';
const dbName = 'openinc_migrator_test';
const url = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

async function reachable() {
  const client = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

async function adminQuery(sql: string) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function withClient<T>(fn: (c: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

describe('compareVersions', () => {
  it('orders semver-ish versions', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBeGreaterThan(0);
    expect(compareVersions('v1.2.0', '1.2.0')).toBe(0);
    expect(['1.0.0', '0.9.1', '1.0.1'].sort(compareVersions)).toEqual(['0.9.1', '1.0.0', '1.0.1']);
  });
});

describe('loadMigrations', () => {
  it('reads the journal in order and splits statements', () => {
    const migrations = loadMigrations();
    expect(migrations[0]?.tag).toBe('0000_foundation');
    expect(migrations[0]?.statements.length).toBeGreaterThan(10);
  });
});

describe.runIf(await reachable())('migrate (database)', () => {
  beforeAll(async () => {
    await adminQuery(`drop database if exists ${dbName} with (force)`);
    await adminQuery(`create database ${dbName}`);
  });

  afterAll(async () => {
    await adminQuery(`drop database if exists ${dbName} with (force)`);
  });

  it('installs an empty database, then has nothing left to do', async () => {
    const events: string[] = [];
    const first = await migrate({ connectionString: url, appVersion: '1.0.0', onProgress: (e) => events.push(e.type) });
    expect(first.applied).toEqual(loadMigrations().map((m) => m.tag));
    expect(first.backupKey).toBeNull();
    expect(events).toContain('done');

    const second = await migrate({ connectionString: url, appVersion: '1.0.0' });
    expect(second.applied).toEqual([]);
  });

  it('takes a backup before upgrading an installed database', async () => {
    const extra: Migration = { idx: 99, tag: '0099_extra', hash: 'x', statements: ['create table extra_thing (id int)'] };
    let backups = 0;
    const result = await migrate({
      connectionString: url,
      appVersion: '1.1.0',
      migrations: [...loadMigrations(), extra],
      backup: async () => {
        backups++;
        return 'backups/test.dump';
      },
    });
    expect(result).toEqual({ applied: ['0099_extra'], backupKey: 'backups/test.dump' });
    expect(backups).toBe(1);
  });

  it('refuses to run an older image against a newer database', async () => {
    const error = await migrate({ connectionString: url, appVersion: '1.0.0' }).catch((e) => e);
    expect(error).toBeInstanceOf(DatabaseTooNewError);
    expect(error.requiredVersion).toBe('1.1.0');
  });

  it('rolls a failing migration back completely', async () => {
    const all = [...loadMigrations(), { idx: 99, tag: '0099_extra', hash: 'x', statements: [] }];
    const broken: Migration = {
      idx: 100,
      tag: '0100_broken',
      hash: 'y',
      statements: ['create table half_done (id int)', 'select * from nope'],
    };
    const error = await migrate({ connectionString: url, appVersion: '1.2.0', migrations: [...all, broken] }).catch((e) => e);
    expect(error).toBeInstanceOf(MigrationFailedError);
    const exists = await withClient((c) => c.query(`select to_regclass('public.half_done') as t`));
    expect(exists.rows[0].t).toBeNull();
    const plan = await withClient((c) => planMigrations(c, [...all, broken]));
    expect(plan.pending.map((m) => m.tag)).toEqual(['0100_broken']);
  });
});
