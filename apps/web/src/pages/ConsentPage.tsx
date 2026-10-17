import { useMutation, useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { Navigate, useLocation, useSearchParams } from 'react-router';
import { Spinner } from '@/components/common';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { AuthLayout } from './auth/AuthLayout';

/** An MCP client (e.g. Claude Desktop) asks to act as the signed-in user. */
export function ConsentPage() {
  const trpc = useTRPC();
  const location = useLocation();
  const { user, isLoading } = useSession();
  const [params] = useSearchParams();
  const request = params.get('request') ?? '';
  const describe = useQuery({ ...trpc.oauth.describe.queryOptions({ request }), enabled: !!user, retry: false });
  const go = (r: { redirectUrl: string }) => window.location.assign(r.redirectUrl);
  const approve = useMutation(trpc.oauth.approve.mutationOptions({ onSuccess: go }));
  const deny = useMutation(trpc.oauth.deny.mutationOptions({ onSuccess: go }));

  if (isLoading) return null;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;

  return (
    <AuthLayout title="Connect an MCP client">
      {describe.isLoading && <Spinner />}
      {describe.error && (
        <Alert variant="destructive">
          <AlertDescription>{describe.error.message}</AlertDescription>
        </Alert>
      )}
      {describe.data && (
        <div className="grid gap-4">
          <p>
            <b>{describe.data.clientName}</b> wants to use OpenInc as <b>{user.name}</b> ({user.email}).
          </p>
          <div className="flex gap-2 rounded-md border bg-muted/40 p-3 text-muted-foreground">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              It can do everything you can do in the app, with your permissions, and every change is in the audit log. It sends you back to{' '}
              <span className="font-mono text-foreground">{describe.data.redirectHost}</span>. You can disconnect it any time under Account
              → MCP.
            </span>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => approve.mutate({ request })} disabled={approve.isPending || deny.isPending}>
              Allow
            </Button>
            <Button variant="outline" onClick={() => deny.mutate({ request })} disabled={approve.isPending || deny.isPending}>
              Deny
            </Button>
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
