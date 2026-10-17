import { type DbOrTx, eq, settings, sql } from '@openinc/db';
import { SETTINGS, type SettingsGroup, type SettingsValues, settingEnvName } from '@openinc/shared';
import pg from 'pg';
import { audit } from './audit.ts';
import { type Ctx, getDb } from './context.ts';
import { getEnv } from './env.ts';
import { badRequest } from './errors.ts';
import { decrypt, encrypt } from './lib/crypto.ts';

/**
 * Runtime settings live in Postgres, one row per group, validated by the same Zod schemas as the forms.
 * Secret fields are encrypted with APP_SECRET. Every process caches them and drops its cache when any
 * process saves (LISTEN/NOTIFY), so changes apply without a restart.
 */

const CHANNEL = 'openinc_settings';

interface Resolved {
  raw: Record<string, unknown>;
  secretsSet: Record<string, boolean>;
  locked: string[];
  updatedAt: Date | null;
}

const cache = new Map<SettingsGroup, Promise<Resolved>>();
const listeners = new Set<(group: SettingsGroup) => void>();

function fieldsOf(group: SettingsGroup): string[] {
  return Object.keys((SETTINGS[group].schema as unknown as { shape: Record<string, unknown> }).shape);
}

function secretFields(group: SettingsGroup): readonly string[] {
  return SETTINGS[group].secrets;
}

function envPins(group: SettingsGroup): Record<string, unknown> {
  const pins: Record<string, unknown> = {};
  for (const field of fieldsOf(group)) {
    const value = process.env[settingEnvName(group, field)];
    if (value === undefined) continue;
    pins[field] = value === 'true' ? true : value === 'false' ? false : value;
  }
  return pins;
}

async function load(group: SettingsGroup, db: DbOrTx = getDb()): Promise<Resolved> {
  const [row] = await db.select().from(settings).where(eq(settings.group, group));
  const raw: Record<string, unknown> = { ...(row?.values ?? {}) };
  const secretsSet: Record<string, boolean> = {};
  for (const field of secretFields(group)) {
    const sealed = row?.secrets[field];
    if (sealed) {
      try {
        raw[field] = decrypt(sealed);
      } catch {
        // Encrypted with a different APP_SECRET: treat as unset rather than failing every request.
        raw[field] = '';
      }
    }
    secretsSet[field] = !!raw[field];
  }
  const pins = envPins(group);
  Object.assign(raw, pins);
  for (const field of secretFields(group)) secretsSet[field] = !!raw[field];
  return { raw, secretsSet, locked: Object.keys(pins), updatedAt: row?.updatedAt ?? null };
}

function resolved(group: SettingsGroup): Promise<Resolved> {
  let entry = cache.get(group);
  if (!entry) {
    entry = load(group);
    entry.catch(() => cache.delete(group));
    cache.set(group, entry);
  }
  return entry;
}

/** The group's values, or null while it is not (completely) configured. */
export async function getSettings<G extends SettingsGroup>(group: G): Promise<SettingsValues<G> | null> {
  const { raw } = await resolved(group);
  if (Object.keys(raw).length === 0 && group !== 'security' && group !== 'system' && group !== 'onboarding') return null;
  const parsed = SETTINGS[group].schema.safeParse(raw);
  return parsed.success ? (parsed.data as SettingsValues<G>) : null;
}

/** Like getSettings, for groups whose defaults are a complete configuration. */
export async function getSettingsOrDefaults<G extends 'security' | 'system' | 'onboarding'>(group: G): Promise<SettingsValues<G>> {
  return ((await getSettings(group)) ?? SETTINGS[group].schema.parse({})) as SettingsValues<G>;
}

/** What the Admin settings form shows: values with secrets blanked, which secrets are set, and which fields an env var pins. */
export async function getSettingsView(group: SettingsGroup) {
  const { raw, secretsSet, locked, updatedAt } = await resolved(group);
  const values = { ...raw };
  for (const field of secretFields(group)) values[field] = '';
  const configured = (await getSettings(group)) !== null;
  return { values, secretsSet, locked, configured, updatedAt };
}

/**
 * Saves a group. Secret fields: undefined keeps the stored value, '' clears it. Fields pinned by an
 * env var cannot be changed here.
 */
/**
 * Saves a group. Secret fields: undefined keeps the stored value, '' clears it. Fields pinned by an
 * env var cannot be changed here. Runs in its own transaction (or the caller's) and drops the caches
 * once it is committed: NOTIFY is delivered on commit to every process, this one included.
 */
export async function saveSettings<G extends SettingsGroup>(
  ctx: Ctx,
  group: G,
  input: Record<string, unknown>,
): Promise<SettingsValues<G>> {
  const value = await withTransaction(ctx, async (tx) => {
    const current = await load(group, tx.db);
    const pinned = current.locked.filter((f) => input[f] !== undefined && JSON.stringify(input[f]) !== JSON.stringify(current.raw[f]));
    if (pinned.length)
      throw badRequest(`Set by environment variable, change it there: ${pinned.map((f) => settingEnvName(group, f)).join(', ')}`);

    const merged: Record<string, unknown> = { ...input };
    for (const field of secretFields(group)) if (merged[field] === undefined) merged[field] = current.raw[field] ?? '';
    const parsed = SETTINGS[group].schema.safeParse(merged);
    if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    const value = parsed.data as Record<string, unknown>;

    const values: Record<string, unknown> = {};
    const secrets: Record<string, string> = {};
    for (const [field, v] of Object.entries(value)) {
      if (current.locked.includes(field)) continue;
      if (secretFields(group).includes(field)) {
        if (typeof v === 'string' && v !== '') secrets[field] = encrypt(v);
      } else {
        values[field] = v;
      }
    }

    const updatedBy = tx.actor?.userId ?? null;
    await tx.db
      .insert(settings)
      .values({ group, values, secrets, updatedBy })
      .onConflictDoUpdate({ target: settings.group, set: { values, secrets, updatedBy, updatedAt: new Date() } });

    const before = { ...current.raw };
    const after = { ...value };
    const secretChanges: { field: string; change: string }[] = [];
    for (const field of secretFields(group)) {
      const was = current.raw[field] || '';
      const now = after[field] || '';
      if (was !== now) secretChanges.push({ field, change: now === '' ? 'cleared' : was === '' ? 'set' : 'changed' });
      delete before[field];
      delete after[field];
    }
    await audit(tx, { action: 'settings.update', entityType: 'settings', entityId: group, before, after, metadata: { secretChanges } });
    await tx.db.execute(sql`select pg_notify(${CHANNEL}, ${group})`);
    return value;
  });
  invalidateSettings(group);
  return value as SettingsValues<G>;
}

async function withTransaction<T>(ctx: Ctx, fn: (tx: Ctx) => Promise<T>): Promise<T> {
  if ('rollback' in ctx.db) return fn(ctx);
  return ctx.db.transaction((db) => fn({ ...ctx, db }));
}

/** Removes a group entirely, e.g. to turn AI off. */
export async function clearSettings(ctx: Ctx, group: SettingsGroup): Promise<void> {
  await withTransaction(ctx, async (tx) => {
    const current = await load(group, tx.db);
    await tx.db.delete(settings).where(eq(settings.group, group));
    const before = { ...current.raw };
    for (const field of secretFields(group)) delete before[field];
    await audit(tx, { action: 'settings.clear', entityType: 'settings', entityId: group, before });
    await tx.db.execute(sql`select pg_notify(${CHANNEL}, ${group})`);
  });
  invalidateSettings(group);
}

export function invalidateSettings(group?: SettingsGroup): void {
  if (group) cache.delete(group);
  else cache.clear();
  for (const listener of listeners) {
    try {
      listener(group ?? ('*' as SettingsGroup));
    } catch (error) {
      console.error('[settings] listener failed', error);
    }
  }
}

/** Called after any group changes, in this process or another one. `group` is '*' when everything was reloaded. */
export function onSettingsChange(listener: (group: SettingsGroup) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let listenClient: pg.Client | undefined;
let stopped = false;

/** Keeps a connection LISTENing so saves made by other containers reach this one. Reconnects on failure. */
export async function startSettingsListener(): Promise<void> {
  stopped = false;
  const connect = async () => {
    const client = new pg.Client({ connectionString: getEnv().DATABASE_URL, application_name: 'openinc-settings' });
    client.on('notification', (msg) => {
      cache.delete(msg.payload as SettingsGroup);
      invalidateSettings(msg.payload as SettingsGroup);
    });
    client.on('error', () => {
      if (stopped) return;
      listenClient = undefined;
      setTimeout(() => void connect().catch(() => {}), 5000);
    });
    await client.connect();
    await client.query(`listen ${CHANNEL}`);
    listenClient = client;
    invalidateSettings();
  };
  await connect();
}

export async function stopSettingsListener(): Promise<void> {
  stopped = true;
  await listenClient?.end().catch(() => {});
  listenClient = undefined;
}
