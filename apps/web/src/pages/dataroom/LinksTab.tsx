import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Download, Link2, MoreHorizontal, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, Field, Spinner } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { downloadCsv } from '@/lib/csv';
import { useCan, useClientConfig, useFormat } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { folderOptions, LinkStatusBadge, type Room, type RoomLink } from './common';

export function LinksTab({ room }: { room: Room }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const format = useFormat();
  const canManage = useCan()('dataroom.manage');
  const links = useQuery(trpc.dataroom.links.queryOptions({ roomId: room.id }));
  const [editing, setEditing] = useState<RoomLink | 'new' | null>(null);
  const [revoking, setRevoking] = useState<RoomLink | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.dataroom.pathKey() });
  const revoke = useMutation(trpc.dataroom.revokeLink.mutationOptions({ onSuccess: refresh }));

  if (links.isLoading) return <Spinner />;
  const rows = links.data ?? [];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {canManage && (
          <Button onClick={() => setEditing('new')}>
            <Plus /> New Link
          </Button>
        )}
        {rows.length > 0 && (
          <Button
            variant="outline"
            onClick={() =>
              downloadCsv(
                `${room.name} links.csv`,
                ['Label', 'Status', 'URL', 'Password', 'Expires On', 'Downloads', 'Watermark', 'Visitors', 'Failed Passwords', 'Last Used'],
                rows.map((l) => [
                  l.label,
                  l.status,
                  l.url,
                  l.hasPassword ? 'yes' : 'no',
                  l.expiresAt ? format.date(l.expiresAt) : '',
                  l.allowDownload ? 'yes' : 'no',
                  l.watermark ? 'yes' : 'no',
                  l.visitors,
                  l.failedPasswords,
                  l.lastUsedAt ? format.dateTime(l.lastUsedAt) : '',
                ]),
              )
            }
          >
            <Download /> Export CSV
          </Button>
        )}
        {room.status !== 'open' && rows.some((l) => l.status === 'active') && (
          <p className="text-sm text-muted-foreground">The room is not open, so these links do not work yet.</p>
        )}
      </div>
      {!rows.length ? (
        <EmptyState icon={<Link2 />} title="No Links Yet">
          Create one link per investor or advisor. Each has its own password, expiry and download rules, and its own statistics.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="hidden w-28 md:table-cell">Password</TableHead>
                <TableHead className="hidden w-32 md:table-cell">Expires On</TableHead>
                <TableHead className="hidden w-28 lg:table-cell">Downloads</TableHead>
                <TableHead className="hidden w-28 lg:table-cell">Watermark</TableHead>
                <TableHead className="hidden w-24 text-right sm:table-cell">Visitors</TableHead>
                <TableHead className="hidden w-44 md:table-cell">Last Used</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <div className="truncate font-medium">{l.label}</div>
                    {l.failedPasswords > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {l.failedPasswords} wrong {l.failedPasswords === 1 ? 'password' : 'passwords'}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <LinkStatusBadge status={l.status} />
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{l.hasPassword ? 'Yes' : 'None'}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {l.expiresAt ? format.date(l.expiresAt) : 'Never'}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{l.allowDownload ? 'Allowed' : 'Off'}</TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{l.watermark ? 'On' : 'Off'}</TableCell>
                  <TableCell className="hidden text-right font-mono text-xs sm:table-cell">{l.visitors}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {l.lastUsedAt ? format.dateTime(l.lastUsedAt) : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {l.status === 'active' && <CopyLink url={l.url} />}
                      {canManage && l.status !== 'revoked' && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${l.label}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setEditing(l)}>Edit</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive" onSelect={() => setRevoking(l)}>
                              Revoke
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <LinkSheet room={room} link={editing} onClose={() => setEditing(null)} onDone={refresh} />
      <Dialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke Link</DialogTitle>
            <DialogDescription>
              {revoking?.label} stops working at once and anyone inside through it is signed out. Its statistics are kept. This cannot be
              undone; create a new link to share again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoking(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (revoking) revoke.mutate({ linkId: revoking.id });
                setRevoking(null);
              }}
            >
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy Link'}
    </Button>
  );
}

const list = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** The local end of a picked day, so a link "expires on" the 20th works through the 20th. */
const endOfDay = (day: string) => new Date(`${day}T23:59:59`).toISOString();
const dayOf = (iso: Date | string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function LinkSheet({
  room,
  link,
  onClose,
  onDone,
}: {
  room: Room;
  link: RoomLink | 'new' | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const config = useClientConfig();
  const isNew = link === 'new';
  const existing = link && link !== 'new' ? link : null;
  const blank = {
    label: '',
    password: '',
    removePassword: false,
    emails: '',
    domains: '',
    requireEmail: true,
    verifyEmail: false,
    allowDownload: room.defaultAllowDownload,
    watermark: room.defaultWatermark,
    folderIds: [] as string[],
    expiresOn: '',
  };
  const [form, setForm] = useState(blank);
  const [shown, setShown] = useState<string | null>(null);
  const key = existing?.id ?? (isNew ? 'new' : null);
  if (key !== shown) {
    setShown(key);
    if (existing)
      setForm({
        label: existing.label,
        password: '',
        removePassword: false,
        emails: existing.allowedEmails.join('\n'),
        domains: existing.allowedDomains.join('\n'),
        requireEmail: existing.requireEmail,
        verifyEmail: existing.verifyEmail,
        allowDownload: existing.allowDownload,
        watermark: existing.watermark,
        folderIds: existing.folderIds ?? [],
        expiresOn: dayOf(existing.expiresAt),
      });
    else if (isNew) setForm(blank);
  }
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const done = (message: string) => () => {
    toast.success(message);
    onClose();
    onDone();
  };
  const create = useMutation(
    trpc.dataroom.createLink.mutationOptions({
      onSuccess: async (l) => {
        await navigator.clipboard?.writeText(l.url).catch(() => undefined);
        done('Link created and copied. Send the password separately.')();
      },
    }),
  );
  const update = useMutation(trpc.dataroom.updateLink.mutationOptions({ onSuccess: done('Link saved') }));
  const allowlist = list(form.emails).length + list(form.domains).length > 0;
  const needsEmail = form.requireEmail || allowlist || !!room.ndaText;
  const folders = folderOptions(room.folders).filter((f) => f.value);

  const submit = () => {
    const shared = {
      label: form.label,
      allowedEmails: list(form.emails),
      allowedDomains: list(form.domains),
      requireEmail: needsEmail,
      verifyEmail: needsEmail && form.verifyEmail,
      allowDownload: form.allowDownload,
      watermark: form.watermark,
      folderIds: form.folderIds.length ? form.folderIds : null,
      expiresAt: form.expiresOn ? endOfDay(form.expiresOn) : null,
    };
    if (existing)
      update.mutate({
        linkId: existing.id,
        ...shared,
        ...(form.removePassword ? { password: null } : form.password ? { password: form.password } : {}),
      });
    else create.mutate({ roomId: room.id, ...shared, password: form.password || null });
  };

  return (
    <Sheet open={!!link} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{existing ? 'Edit Link' : 'New Link'}</SheetTitle>
          <SheetDescription>
            {existing
              ? 'Changes apply to visitors already inside at their next click.'
              : 'One link per person or firm keeps the statistics apart.'}
          </SheetDescription>
        </SheetHeader>
        <form
          id="link-form"
          className="grid gap-5 px-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Label" htmlFor="link-label" hint="Who it is for. Visitors do not see it.">
            <Input id="link-label" value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="Northzone" autoFocus />
          </Field>
          <Field
            label="Password"
            htmlFor="link-password"
            hint={
              existing?.hasPassword
                ? 'Leave empty to keep the current password.'
                : 'At least 8 characters. Send it separately from the link, for example by text message.'
            }
          >
            <Input
              id="link-password"
              type="text"
              autoComplete="off"
              className="font-mono"
              value={form.password}
              disabled={form.removePassword}
              onChange={(e) => set('password', e.target.value)}
            />
          </Field>
          {existing?.hasPassword && (
            <ToggleRow label="Remove the Password" checked={form.removePassword} onChange={(v) => set('removePassword', v)}>
              Anyone with the link can open it.
            </ToggleRow>
          )}
          <Field label="Expires On" htmlFor="link-expires" hint="The link works through the end of this day. Leave empty for no expiry.">
            <Input
              id="link-expires"
              type="date"
              className="w-44"
              value={form.expiresOn}
              onChange={(e) => set('expiresOn', e.target.value)}
            />
          </Field>
          <ToggleRow
            label="Require Email"
            checked={needsEmail}
            disabled={allowlist || !!room.ndaText}
            onChange={(v) => set('requireEmail', v)}
          >
            {room.ndaText
              ? 'Always on: the room has an NDA, which someone has to accept.'
              : 'Visitors give their email first, so statistics show who they are.'}
          </ToggleRow>
          <ToggleRow
            label="Verify Email"
            checked={needsEmail && form.verifyEmail}
            disabled={!needsEmail}
            onChange={(v) => set('verifyEmail', v)}
          >
            Emails a 6-digit code the visitor must enter. Needs email set up in Settings.
          </ToggleRow>
          <Field label="Allowed Emails" htmlFor="link-emails" hint="One per line. Leave both empty to allow anyone with the link.">
            <Textarea
              id="link-emails"
              rows={2}
              value={form.emails}
              onChange={(e) => set('emails', e.target.value)}
              placeholder="pia@northzone.com"
            />
          </Field>
          <Field label="Allowed Domains" htmlFor="link-domains">
            <Textarea
              id="link-domains"
              rows={2}
              value={form.domains}
              onChange={(e) => set('domains', e.target.value)}
              placeholder="northzone.com"
            />
          </Field>
          <ToggleRow label="Allow Downloads" checked={form.allowDownload} onChange={(v) => set('allowDownload', v)}>
            Visitors can download files and the whole room as a zip. When off, they can still view PDFs and images.
          </ToggleRow>
          <ToggleRow label="Watermark" checked={form.watermark} onChange={(v) => set('watermark', v)}>
            Stamps the visitor's email, {config?.companyName ?? 'the company name'} and the date on every PDF page.
          </ToggleRow>
          {folders.length > 0 && (
            <Field label="Folders" hint="Leave all unticked to show the whole room.">
              <ul className="grid gap-1.5 rounded-md border p-2">
                {folders.map((f) => (
                  <li key={f.value}>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={form.folderIds.includes(f.value)}
                        onCheckedChange={(c) =>
                          set('folderIds', c === true ? [...form.folderIds, f.value] : form.folderIds.filter((x) => x !== f.value))
                        }
                      />
                      {f.label}
                    </label>
                  </li>
                ))}
              </ul>
            </Field>
          )}
        </form>
        <SheetFooter>
          <Button type="submit" form="link-form" disabled={!form.label.trim() || create.isPending || update.isPending}>
            {existing ? 'Save Link' : 'Create Link'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
  children,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <label className="flex items-start gap-3">
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} className="mt-0.5" />
      <span>
        <span className="block font-medium">{label}</span>
        {children && <span className="block text-sm text-muted-foreground">{children}</span>}
      </span>
    </label>
  );
}
