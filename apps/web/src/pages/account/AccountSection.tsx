import { changeEmailInput, changePasswordInput, formatRelative, updateProfileInput } from '@openinc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { toast } from 'sonner';
import { CopyButton, EmptyState, Field, Spinner, validate } from '@/components/common';
import { UserAvatar } from '@/components/layout/user';
import { SettingsCard, settingsLayout } from '@/components/settings-layout';
import { RecoveryCodes, TwoFactorSetup } from '@/components/TwoFactorSetup';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { useTRPC } from '@/lib/trpc';
import { uploadFile } from '@/lib/upload';
import { McpClientGuides } from './McpClientGuides';

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
    <div className={settingsLayout.stack}>
      <SettingsCard title="Profile">
        <form
          className={settingsLayout.narrowForm}
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
              {uploading ? <Spinner /> : <Upload />} Upload Image
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
      </SettingsCard>
      <SettingsCard title="Email" description={`You sign in with ${user.email}.`}>
        <form
          className={settingsLayout.narrowForm}
          onSubmit={(e) => {
            e.preventDefault();
            const { data, errors } = validate(changeEmailInput, { email, currentPassword: emailPassword });
            setErrors(errors ?? {});
            if (data) changeEmail.mutate(data);
          }}
        >
          <Field label="New Email" htmlFor="new-email" error={errors.email}>
            <Input id="new-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Current Password" htmlFor="email-password" error={errors.currentPassword}>
            <Input
              id="email-password"
              type="password"
              autoComplete="current-password"
              value={emailPassword}
              onChange={(e) => setEmailPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="outline" className="justify-self-start" disabled={changeEmail.isPending}>
            Change Email
          </Button>
        </form>
      </SettingsCard>
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
    <div className={settingsLayout.stack}>
      <SettingsCard
        title="Two-Factor Authentication"
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
              New Recovery Codes
            </Button>
            <Button variant="ghost" className="text-destructive" onClick={() => setConfirm('disable')}>
              Turn Off
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
          <Button onClick={() => setSetupOpen(true)}>Set Up Two-Factor</Button>
        )}
      </SettingsCard>
      <SettingsCard title="Password">
        <form onSubmit={submitPassword} className={settingsLayout.narrowForm} noValidate>
          <Field label="Current Password" htmlFor="current-password" error={errors.currentPassword}>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field
            label="New Password"
            htmlFor="new-password"
            error={errors.newPassword}
            hint="At least 12 characters, with letters and digits."
          >
            <Input id="new-password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Button type="submit" className="justify-self-start" disabled={changePassword.isPending}>
            Change Password
          </Button>
        </form>
      </SettingsCard>
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
            <DialogTitle>{confirm === 'disable' ? 'Turn Off Two-Factor?' : 'Replace Your Recovery Codes?'}</DialogTitle>
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
              {confirm === 'disable' ? 'Turn Off' : 'Replace Codes'}
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
    <div className={settingsLayout.stack}>
      <SettingsCard
        title="Connect an AI Client"
        description="Everything you can do here, an MCP client can do for you: with your permissions, and every change in the audit log."
      >
        <div className="grid gap-4">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs" data-testid="mcp-url">
              {url}
            </code>
            <CopyButton value={url} label="Copy URL" />
          </div>
          <McpClientGuides url={url} name={connection.data?.name ?? 'OpenInc'} />
          <p className="text-xs text-muted-foreground">
            Other clients that support remote MCP with OAuth (Streamable HTTP) connect the same way. Sign-in always happens in the browser,
            and only HTTPS addresses work outside your own computer. Every connected client appears below; disconnect it here at any time.
          </p>
        </div>
      </SettingsCard>
      <SettingsCard title="Connected Clients">
        {!clients.data?.length ? (
          <EmptyState title="No Clients Connected" />
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
      </SettingsCard>
    </div>
  );
}

function AppearanceCard() {
  const { theme, toggle } = useTheme();
  return (
    <SettingsCard title="Appearance">
      <label className="flex items-center gap-3">
        <Switch checked={theme === 'dark'} onCheckedChange={toggle} />
        <span className="font-medium">Dark Mode</span>
      </label>
    </SettingsCard>
  );
}

/** Settings → Account: everything about the signed-in person. #security and #mcp jump to those parts. */
export function AccountSection() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [hash]);
  return (
    <div className={settingsLayout.stack}>
      <ProfileTab />
      <AppearanceCard />
      <div id="security" className="scroll-mt-6">
        <SecurityTab />
      </div>
      <div id="mcp" className="scroll-mt-6">
        <McpTab />
      </div>
    </div>
  );
}
