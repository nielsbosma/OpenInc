import type { AppRouter } from '@openinc/server/router';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import type { inferRouterOutputs } from '@trpc/server';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import { toast } from 'sonner';
import superjson from 'superjson';

export type RouterOutputs = inferRouterOutputs<AppRouter>;

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

export function errorMessage(error: unknown): string {
  if (error instanceof TRPCClientError) {
    const zod = error.data?.zodError as { fieldErrors?: Record<string, string[]> } | undefined;
    if (zod?.fieldErrors) return Object.values(zod.fieldErrors).flat()[0] ?? error.message;
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong';
}

function isUnauthorized(error: unknown) {
  return error instanceof TRPCClientError && error.data?.code === 'UNAUTHORIZED';
}

export function createQueryClient() {
  const client: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        retry: (count, error) => !(error instanceof TRPCClientError && error.data?.httpStatus < 500) && count < 2,
      },
    },
    queryCache: new QueryCache({
      onError: (error) => {
        if (isUnauthorized(error)) void client.invalidateQueries({ queryKey: [['auth', 'session']] });
      },
    }),
    mutationCache: new MutationCache({
      // Mutations that handle their own errors pass `meta: { silent: true }`.
      onError: (error, _vars, _ctx, mutation) => {
        if (!mutation.meta?.silent) toast.error(errorMessage(error));
      },
    }),
  });
  return client;
}

export function createTrpcClient() {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: '/api/trpc',
        transformer: superjson,
        fetch: (url, init) => fetch(url, { ...init, credentials: 'same-origin' }),
      }),
    ],
  });
}
