import { changeEmailInput, changePasswordInput, formatRelative, updateProfileInput } from '@openinc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { CopyButton, EmptyState, Field, PageHeader, Spinner, validate } from '@/components/common';
import { UserAvatar } from '@/components/layout/UserMenu';
import { RecoveryCodes, TwoFactorSetup } from '@/components/TwoFactorSetup';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { uploadFile } from '@/lib/upload';

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function useRefreshSession() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: trpc.auth.session.queryKey() });
}

function ProfileTab() {
  const trpc = useTRPC();
  const { user } = useSession();
  const refresh = useRefreshSession();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const updateProfile = useMutation(
    trpc.account.updateProfile.mutationOptions({
      onSuccess: () => {
        refresh();
        toast.success('Name saved');
      },
    }),
  );
  const changeEmail = useMutation(
    trpc.account.changeEmail.mutationOptions({
      onSuccess: () => {
        refresh();
        setEmail('');
        setEmailPassword('');
        toast.success('Email changed');
      },
    }),
  );
  const setAvatar = useMutation(trpc.account.setAvatar.mutationOptions({ onSuccess: () => refresh() }));
  useEffect(() => setName(user?.name ?? ''), [user?.name]);
  if (!user) return null;

  const onAvatar = async (file: File) => {
    setUploading(true);
    try {
      const uploaded = await uploadFile(file, 'avatar');
      setAvatar.mutate({ fileId: uploaded.id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="grid gap-6">
      <Section title="Profile">
        <form
          className="grid max-w-md gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const { data, errors } = validate(updateProfileInput, { name });
            setErrors(errors ?? {});
            if (data) updateProfile.mutate(data);
          }}
        >
          <div className="flex items-center gap-4">
            <UserAvatar name={user.name} url={user.avatarUrl} className="size-14" />
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => e.target.files?.[0] && onAvatar(e.target.files[0])}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={uploading}>
              {uploading ? <Spinner /> : <Upload />} Upload image
            </Button>
            {user.avatarUrl && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setAvatar.mutate({ fileId: null })}>
                Remove
              </Button>
            )}
          </div>
          <Field label="Name" htmlFor="profile-name" error={errors.name}>
            <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Button type="submit" className="justify-self-start" disabled={updateProfile.isPending}>
            Save
          </Button>
        </form>
      </Section>
      <Section title="Email" description={`You sign in with ${user.email}.`}>
        <form
          className="grid max-w-md gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const { data, errors } = validate(changeEmailInput, { email, currentPassword: emailPassword });
            setErrors(errors ?? {});
            if (data) changeEmail.mutate(data);
          }}
        >
          <Field label="New email" htmlFor="new-email" error={errors.email}>
            <Input id="new-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Current password" htmlFor="email-password" error={errors.currentPassword}>
            <Input
              id="email-password"
              type="password"
              autoComplete="current-password"
              value={emailPassword}
              onChange={(e) => setEmailPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="outline" className="justify-self-start" disabled={changeEmail.isPending}>
            Change email
          </Button>
        </form>
      </Section>
    </div>
  );
}

function SecurityTab() {
  const trpc = useTRPC();
  const { user } = useSession();
  const refresh = useRefreshSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [setupOpen, setSetupOpen] = useState(false);
  const [confirm, setConfirm] = useState<'disable' | 'codes' | null>(null);
  const [confirmPassword, setConfirmPassword] = useState('');
  const changePassword = useMutation(
    trpc.account.changePassword.mutationOptions({
      onSuccess: () => {
        setCurrent('');
        setNext('');
        toast.success('Password changed. Your other sessions were signed out.');
      },
    }),
  );
  const disable = useMutation(
    trpc.account.disableTotp.mutationOptions({
      onSuccess: () => {
        refresh();
        setConfirm(null);
        toast.success('Two-factor is off');
      },
    }),
  );
  const regenerate = useMutation(
    trpc.account.regenerateRecoveryCodes.mutationOptions({
      onSuccess: () => {
        refresh();
        setConfirm(null);
      },
    }),
  );
  if (!user) return null;

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    const { data, errors } = validate(changePasswordInput, { currentPassword: current, newPassword: next });
    setErrors(errors ?? {});
    if (data) changePassword.mutate(data);
  };

  return (
    <div className="grid gap-6">
      <Section
        title="Two-factor authentication"
        description={
          user.totpEnabled ? (
            <span className="flex items-center gap-2">
              <Badge className="bg-success/15 text-success">On</Badge> {user.recoveryCodesLeft} recovery codes left
            </span>
          ) : (
            'Off. Turn it on so a leaked password is not enough to sign in.'
          )
        }
      >
        {regenerate.data ? (
          <RecoveryCodes codes={regenerate.data.recoveryCodes} onDone={() => regenerate.reset()} doneLabel="Done" />
        ) : user.totpEnabled ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setConfirm('codes')}>
              New recovery codes
            </Button>
            <Button variant="ghost" className="text-destructive" onClick={() => setConfirm('disable')}>
              Turn off
            </Button>
          </div>
        ) : setupOpen ? (
          <TwoFactorSetup
            onDone={() => {
              setSetupOpen(false);
              refresh();
            }}
            onSkip={() => setSetupOpen(false)}
          />
        ) : (
          <Button onClick={() => setSetupOpen(true)}>Set up two-factor</Button>
        )}
      </Section>
      <Section title="Password">
        <form onSubmit={submitPassword} className="grid max-w-md gap-4" noValidate>
          <Field label="Current password" htmlFor="current-password" error={errors.currentPassword}>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field
            label="New password"
            htmlFor="new-password"
            error={errors.newPassword}
            hint="At least 12 characters, with letters and digits."
          >
            <Input id="new-password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Button type="submit" className="justify-self-start" disabled={changePassword.isPending}>
            Change password
          </Button>
        </form>
      </Section>
      <Dialog
        open={!!confirm}
        onOpenChange={(o) => {
          if (!o) {
            setConfirm(null);
            setConfirmPassword('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === 'disable' ? 'Turn off two-factor?' : 'Replace your recovery codes?'}</DialogTitle>
            <DialogDescription>
              {confirm === 'disable' ? 'Signing in will only need your password.' : 'Your old codes stop working.'} Enter your password to
              confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            autoComplete="current-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant={confirm === 'disable' ? 'destructive' : 'default'}
              disabled={!confirmPassword || disable.isPending || regenerate.isPending}
              onClick={() => (confirm === 'disable' ? disable : regenerate).mutate({ currentPassword: confirmPassword })}
            >
              {confirm === 'disable' ? 'Turn off' : 'Replace codes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function McpTab() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const connection = useQuery(trpc.account.mcpConnection.queryOptions());
  const clients = useQuery(trpc.account.listMcpClients.queryOptions());
  const revoke = useMutation(
    trpc.account.revokeMcpClient.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.account.listMcpClients.queryKey() }),
    }),
  );
  const url = connection.data?.url ?? '';
  return (
    <div className="grid gap-6">
      <Section
        title="Connect Claude or another MCP client"
        description="Everything you can do here, an MCP client can do for you: with your permissions, and every change in the audit log."
      >
        <div className="grid gap-4">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs" data-testid="mcp-url">
              {url}
            </code>
            <CopyButton value={url} label="Copy URL" />
          </div>
          <ol className="grid list-decimal gap-2 pl-5 text-muted-foreground">
            <li>
              In Claude Desktop or claude.ai, open <b className="text-foreground">Settings → Connectors</b> and choose{' '}
              <b className="text-foreground">Add custom connector</b>.
            </li>
            <li>
              Give it a name (e.g. <span className="text-foreground">{connection.data?.name ?? 'OpenInc'}</span>) and paste the URL above.
            </li>
            <li>Click Connect. A browser window opens: sign in here (with two-factor if it is on) and click Allow.</li>
            <li>The client appears below. Disconnect it here at any time; its access stops at once.</li>
          </ol>
          <p className="text-xs text-muted-foreground">
            Other clients that support remote MCP with OAuth (Streamable HTTP) connect the same way. Only HTTPS addresses work outside your
            own computer.
          </p>
        </div>
      </Section>
      <Section title="Connected clients">
        {!clients.data?.length ? (
          <EmptyState title="No clients connected" />
        ) : (
          <ul className="divide-y rounded-lg border">
            {clients.data.map((c) => (
              <li key={c.clientId} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Connected {formatRelative(c.connectedAt)}
                    {c.lastUsedAt && ` · last used ${formatRelative(c.lastUsedAt)}`}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => revoke.mutate({ clientId: c.clientId })}>
                  Disconnect
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

const TABS = { profile: 'Profile', security: 'Security', mcp: 'MCP' } as const;
type Tab = keyof typeof TABS;

export function AccountPage() {
  const { tab = 'profile' } = useParams();
  const navigate = useNavigate();
  const current = (tab in TABS ? tab : 'profile') as Tab;
  return (
    <>
      <PageHeader title="Account" />
      <Tabs value={current} onValueChange={(t) => navigate(`/account/${t}`)} className="mb-6">
        <TabsList>
          {Object.entries(TABS).map(([key, label]) => (
            <TabsTrigger key={key} value={key}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {current === 'profile' && <ProfileTab />}
      {current === 'security' && <SecurityTab />}
      {current === 'mcp' && <McpTab />}
    </>
  );
}
