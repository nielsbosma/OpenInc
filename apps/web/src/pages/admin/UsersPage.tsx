import { createInviteInput, formatRelative, ROLE_INFO, ROLES, type Role } from '@openinc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, ShieldCheck, UserPlus } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Field, Spinner, validate } from '@/components/common';
import { UserAvatar } from '@/components/layout/user';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCan, useSession } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const overview = useQuery(trpc.settings.overview.queryOptions());
  const create = useMutation(
    trpc.invites.create.mutationOptions({
      onSuccess: (invite) => {
        void queryClient.invalidateQueries({ queryKey: trpc.invites.pathKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.setup.checklist.queryKey() });
        toast.success(`Invitation sent to ${invite.email}`);
        setEmail('');
        onOpenChange(false);
      },
    }),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const { data, errors } = validate(createInviteInput, { email, role });
    setErrors(errors ?? {});
    if (data) create.mutate(data);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Invite Someone</DialogTitle>
            <DialogDescription>They get an email with a link to choose a password. The link works for 7 days.</DialogDescription>
          </DialogHeader>
          {overview.data && !overview.data.email && (
            <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
              Email is not set up yet, so the invitation cannot be delivered. Set it up under Admin settings → Email.
            </p>
          )}
          <Field label="Email" htmlFor="invite-email" error={errors.email}>
            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          <Field label="Role" htmlFor="invite-role" hint={ROLE_INFO[role].description}>
            <Select value={role} onValueChange={(r) => setRole(r as Role)}>
              <SelectTrigger id="invite-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_INFO[r].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Spinner className="text-primary-foreground" />} Send Invitation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Settings → Users. */
export function UsersSection() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const can = useCan();
  const { user: me } = useSession();
  const manage = can('users.manage');
  const [params, setParams] = useSearchParams();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const users = useQuery(trpc.users.list.queryOptions({ search: search || undefined, includeInactive, limit: 200 }));
  const invites = useQuery(trpc.invites.list.queryOptions());
  const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.users.pathKey() });
  const update = useMutation(
    trpc.users.update.mutationOptions({
      onSuccess: () => {
        invalidate();
        toast.success('Saved');
      },
    }),
  );
  const resetTwoFactor = useMutation(
    trpc.users.resetTwoFactor.mutationOptions({
      onSuccess: () => {
        invalidate();
        toast.success('Two-factor reset');
      },
    }),
  );
  const sendReset = useMutation(
    trpc.users.sendPasswordReset.mutationOptions({ onSuccess: () => toast.success('Password reset email sent') }),
  );
  const invalidateInvites = () => queryClient.invalidateQueries({ queryKey: trpc.invites.pathKey() });
  const resend = useMutation(
    trpc.invites.resend.mutationOptions({
      onSuccess: () => {
        invalidateInvites();
        toast.success('Invitation sent again');
      },
    }),
  );
  const revoke = useMutation(
    trpc.invites.revoke.mutationOptions({
      onSuccess: () => {
        invalidateInvites();
        toast.success('Invitation revoked');
      },
    }),
  );

  useEffect(() => {
    if (params.get('invite') && manage) {
      setInviteOpen(true);
      setParams({}, { replace: true });
    }
  }, [params, manage, setParams]);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <label className="flex items-center gap-2 text-muted-foreground">
          <Switch checked={includeInactive} onCheckedChange={setIncludeInactive} /> Show Deactivated
        </label>
        {manage && (
          <Button className="ml-auto" onClick={() => setInviteOpen(true)}>
            <UserPlus /> Invite
          </Button>
        )}
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="hidden md:table-cell">Two-Factor</TableHead>
              <TableHead className="hidden md:table-cell">Last Sign-In</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.data?.items.map((u) => (
              <TableRow key={u.id} className={u.active ? '' : 'opacity-50'}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <UserAvatar name={u.name} url={u.avatarFileId ? `/api/files/${u.avatarFileId}/content` : null} className="size-7" />
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {u.name} {u.id === me?.id && <span className="font-normal text-muted-foreground">(you)</span>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>{ROLE_INFO[u.role].label}</Badge>
                  {!u.active && (
                    <Badge variant="outline" className="ml-1">
                      Deactivated
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {u.twoFactorEnabled ? (
                    <ShieldCheck className="size-4 text-success" aria-label="On" />
                  ) : (
                    <span className="text-muted-foreground">Off</span>
                  )}
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {u.lastLoginAt ? formatRelative(u.lastLoginAt) : 'Never'}
                </TableCell>
                <TableCell>
                  {manage && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${u.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>Change Role</DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            <DropdownMenuRadioGroup value={u.role} onValueChange={(r) => update.mutate({ userId: u.id, role: r as Role })}>
                              {ROLES.map((r) => (
                                <DropdownMenuRadioItem key={r} value={r}>
                                  {ROLE_INFO[r].label}
                                </DropdownMenuRadioItem>
                              ))}
                            </DropdownMenuRadioGroup>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuItem onSelect={() => sendReset.mutate({ userId: u.id })} disabled={!u.active}>
                          Send Password Reset
                        </DropdownMenuItem>
                        {u.twoFactorEnabled && (
                          <DropdownMenuItem onSelect={() => resetTwoFactor.mutate({ userId: u.id })}>Reset Two-Factor</DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className={u.active ? 'text-destructive' : ''}
                          disabled={u.id === me?.id}
                          onSelect={() => update.mutate({ userId: u.id, active: !u.active })}
                        >
                          {u.active ? 'Deactivate' : 'Reactivate'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {users.isLoading && (
          <div className="p-6">
            <Spinner />
          </div>
        )}
      </div>

      {!!invites.data?.length && (
        <section className="mt-8">
          <h2 className="mb-3 font-medium">Pending Invitations</h2>
          <ul className="divide-y rounded-lg border">
            {invites.data.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{i.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {ROLE_INFO[i.role].label} · invited by {i.invitedBy ?? 'someone'} {formatRelative(i.createdAt)} · expires{' '}
                    {formatRelative(i.expiresAt)}
                  </div>
                </div>
                {manage && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => resend.mutate({ inviteId: i.id })}>
                      Resend
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => revoke.mutate({ inviteId: i.id })}>
                      Revoke
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </>
  );
}
