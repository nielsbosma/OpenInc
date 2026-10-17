import type { Permission } from '@openinc/shared';
import { z } from 'zod';
import type { Ctx } from './context.ts';
import { badRequest, forbidden, unauthorized } from './errors.ts';

export type Access = Permission | 'authenticated' | 'public';

/**
 * One unit of business logic. tRPC, MCP, the AI chat and the worker all call services through
 * `run`/`invoke`, so validation, permission checks and transactions happen in exactly one place.
 */
export interface ServiceDefinition<TInput extends z.ZodType = z.ZodType, TOutput = unknown> {
  /** Dotted name, e.g. `users.update`. The MCP and AI tool name is this with dots as underscores. */
  name: string;
  /** Written for a model: what it does and when to use it. Becomes the MCP and AI tool description. */
  description: string;
  kind: 'query' | 'mutation';
  input: TInput;
  access: Access;
  /** Offer as an MCP and AI tool. Default: true unless public. Turn off for credentials and the caller's own session. */
  tool?: boolean;
  /** Mutations run in one transaction. Opt out when a failure must still persist writes (e.g. failed-login counters). */
  transaction?: boolean;
  /** Callable while the user still has to set up enforced two-factor (the setup itself, sign-out, who am I). */
  allowWithoutTwoFactor?: boolean;
  handler: (ctx: Ctx, input: z.output<TInput>) => Promise<TOutput>;
}

export type AnyService = ServiceDefinition<z.ZodType, unknown>;

export function defineService<TInput extends z.ZodType, TOutput>(
  def: ServiceDefinition<TInput, TOutput>,
): ServiceDefinition<TInput, TOutput> {
  return def;
}

export function isTool(def: Pick<AnyService, 'tool' | 'access'>): boolean {
  return def.tool ?? def.access !== 'public';
}

export function canAccess(def: Pick<AnyService, 'access'>, ctx: Ctx): boolean {
  if (def.access === 'public') return true;
  if (!ctx.actor) return false;
  if (def.access === 'authenticated') return true;
  return ctx.actor.permissions.has(def.access);
}

export function authorize(def: Pick<AnyService, 'access' | 'allowWithoutTwoFactor'>, ctx: Ctx): void {
  if (def.access === 'public') return;
  if (!ctx.actor) throw unauthorized();
  if (ctx.actor.mustEnableTwoFactor && !def.allowWithoutTwoFactor)
    throw forbidden('Set up two-factor authentication first. Your administrator requires it.');
  if (!canAccess(def, ctx)) throw forbidden();
}

/** Runs a service with input already validated against `def.input`. */
export async function run<TInput extends z.ZodType, TOutput>(
  def: ServiceDefinition<TInput, TOutput>,
  ctx: Ctx,
  input: z.output<TInput>,
): Promise<TOutput> {
  authorize(def, ctx);
  const inTransaction = 'rollback' in ctx.db;
  if (def.kind === 'mutation' && def.transaction !== false && !inTransaction) {
    return ctx.db.transaction((tx) => def.handler({ ...ctx, db: tx }, input));
  }
  return def.handler(ctx, input);
}

/** Validates raw input, then runs the service. */
export async function invoke<TInput extends z.ZodType, TOutput>(
  def: ServiceDefinition<TInput, TOutput>,
  ctx: Ctx,
  raw: unknown,
): Promise<TOutput> {
  const parsed = def.input.safeParse(raw ?? {});
  if (!parsed.success) throw badRequest(z.prettifyError(parsed.error));
  return run(def, ctx, parsed.data);
}

/** bigint to string and Date to ISO, for JSON surfaces (MCP, AI tools). */
export function toJsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)) ?? 'null');
}
