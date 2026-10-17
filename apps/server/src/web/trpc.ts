import { AppError, type Ctx, run, type ServiceDefinition } from '@openinc/core';
import { initTRPC, TRPCError } from '@trpc/server';
import type { Request, Response } from 'express';
import superjson from 'superjson';
import type { z } from 'zod';

export interface TrpcContext {
  app: Ctx;
  req: Request;
  res: Response;
}

export const INTERNAL_ERROR_MESSAGE = 'Something went wrong. Try again, or check the logs.';

/**
 * Expected failures (AppError, validation) reach the browser as they are. Anything else is a bug: the
 * browser gets a generic message with the request id, and the full error goes to the log and Sentry.
 */
const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error, ctx }) {
    if (error.code !== 'INTERNAL_SERVER_ERROR') return { ...shape, data: { ...shape.data, stack: undefined } };
    const requestId = (ctx?.res.locals.requestId as string | undefined) ?? 'unknown';
    return {
      ...shape,
      message: `${INTERNAL_ERROR_MESSAGE} (reference ${requestId})`,
      data: { ...shape.data, stack: undefined, requestId },
    };
  },
});

export const router = t.router;
export const procedure = t.procedure;

export async function call<I extends z.ZodType, O>(def: ServiceDefinition<I, O>, ctx: Ctx, input: z.output<I>): Promise<O> {
  try {
    return await run(def, ctx, input);
  } catch (error) {
    if (error instanceof AppError) throw new TRPCError({ code: error.code, message: error.message });
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
