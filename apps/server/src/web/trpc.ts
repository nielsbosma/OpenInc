import { AppError, type Ctx, reportError, run, type ServiceDefinition } from '@openinc/core';
import { initTRPC, TRPCError } from '@trpc/server';
import type { Request, Response } from 'express';
import superjson from 'superjson';
import type { z } from 'zod';

export interface TrpcContext {
  app: Ctx;
  req: Request;
  res: Response;
}

const t = initTRPC.context<TrpcContext>().create({ transformer: superjson });

export const router = t.router;
export const procedure = t.procedure;

export async function call<I extends z.ZodType, O>(def: ServiceDefinition<I, O>, ctx: Ctx, input: z.output<I>): Promise<O> {
  try {
    return await run(def, ctx, input);
  } catch (error) {
    if (error instanceof AppError) throw new TRPCError({ code: error.code, message: error.message });
    reportError(error, { service: def.name });
    throw error;
  }
}

function resolver<I extends z.ZodType, O>(def: ServiceDefinition<I, O>) {
  return ({ ctx, input }: { ctx: TrpcContext; input: unknown }) => call(def, ctx.app, input as z.output<I>);
}

/** A `kind: 'query'` service as a tRPC query. The router is mostly a list of these and `mutation`. */
export function query<I extends z.ZodType, O>(def: ServiceDefinition<I, O>) {
  if (def.kind !== 'query') throw new Error(`${def.name} is a mutation`);
  return t.procedure.input(def.input).query(resolver(def));
}

export function mutation<I extends z.ZodType, O>(def: ServiceDefinition<I, O>) {
  if (def.kind !== 'mutation') throw new Error(`${def.name} is a query`);
  return t.procedure.input(def.input).mutation(resolver(def));
}
