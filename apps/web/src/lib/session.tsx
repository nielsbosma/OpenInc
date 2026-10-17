import type { Permission } from '@openinc/shared';
import { formatDate, formatDateTime, formatMoney } from '@openinc/shared';
import { useQuery } from '@tanstack/react-query';
import { type RouterOutputs, useTRPC } from './trpc.ts';

export type SessionUser = NonNullable<RouterOutputs['auth']['session']>;

export function useSession() {
  const trpc = useTRPC();
  const query = useQuery(trpc.auth.session.queryOptions(undefined, { staleTime: 60_000 }));
  return { user: query.data ?? null, isLoading: query.isLoading };
}

/** Hides UI the user cannot use. The server checks every call again; this is only for display. */
export function useCan() {
  const { user } = useSession();
  return (permission: Permission) => !!user?.permissions.includes(permission);
}

export function useClientConfig() {
  const trpc = useTRPC();
  return useQuery(trpc.system.clientConfig.queryOptions(undefined, { staleTime: 60_000 })).data;
}

/** Formatting in the company's time zone and currency, picked during onboarding. */
export function useFormat() {
  const config = useClientConfig();
  const timeZone = config?.timeZone ?? undefined;
  return {
    dateTime: (value: Date | string) => formatDateTime(value, timeZone),
    date: (value: Date | string) => formatDate(value, timeZone),
    money: (minor: bigint) => formatMoney(minor, config?.currency ?? 'USD'),
  };
}
