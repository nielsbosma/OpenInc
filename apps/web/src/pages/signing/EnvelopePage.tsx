import { SIGNING_FIELD_LABELS, SIGNING_FIELD_TYPES, type SigningFieldType, updateEnvelopeInput } from '@openinc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bell, Download, FileText, Plus, Send, ShieldAlert, ShieldCheck, Trash2, X } from 'lucide-react';
import { type PointerEvent as ReactPointerEvent, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Field, PageHeader, Spinner, validate } from '@/components/common';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useCan, useFormat } from '@/lib/session';
import { type RouterOutputs, useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PdfPages, RECIPIENT_COLORS, shortHash, usePdf } from './pdf';
import { EnvelopeStatusBadge } from './SigningRoutes';

type Envelope = RouterOutputs['signing']['get'];
type Recipient = { id: string; name: string; email: string; role: 'signer' | 'cc'; order: number };
type PlacedField = {
  id: string;
  recipientId: string;
  type: SigningFieldType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  label: string;
};

const DEFAULT_SIZE: Record<SigningFieldType, [number, number]> = {
  signature: [0.26, 0.06],
  initials: [0.1, 0.05],
  date: [0.18, 0.03],
  name: [0.26, 0.03],
  text: [0.26, 0.03],
  checkbox: [0.03, 0.022],
};

const EVENT_LABELS: Record<string, string> = {
  sent: 'Sent',
  invited: 'Invited',
  reminded: 'Reminder Sent',
  code_sent: 'Code Sent',
  verified: 'Email Verified',
  signed: 'Signed',
  declined: 'Declined',
  voided: 'Voided',
  completed: 'Sealed',
};

const RECIPIENT_STATUS: Record<string, string> = {
  waiting: 'Not Yet Invited',
  sent: 'Invited',
  opened: 'Opened',
  signed: 'Signed',
  declined: 'Declined',
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function EnvelopePage() {
  const { envelopeId = '' } = useParams();
  const trpc = useTRPC();
  const envelope = useQuery(trpc.signing.get.queryOptions({ envelopeId }));
  if (envelope.isLoading) return <Spinner />;
  if (!envelope.data) return <p className="text-destructive">{envelope.error?.message ?? 'Envelope not found'}</p>;
  return envelope.data.status === 'draft' ? <EnvelopeEditor envelope={envelope.data} /> : <EnvelopeDetail envelope={envelope.data} />;
}

function BackLink() {
  return (
    <Link to="/documents/signing" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-3.5" /> Signing
    </Link>
  );
}

function EnvelopeEditor({ envelope }: { envelope: Envelope }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const can = useCan();
  const editable = can('signing.send');
  const [title, setTitle] = useState(envelope.title);
  const [message, setMessage] = useState(envelope.message);
  const [routing, setRouting] = useState(envelope.routing);
  const [recipients, setRecipients] = useState<Recipient[]>(
    envelope.recipients.map(({ id, name, email, role, order }) => ({ id, name, email, role, order })),
  );
  const [fields, setFields] = useState<PlacedField[]>(envelope.fields.map((f) => ({ ...f, type: f.type as SigningFieldType })));
  const [active, setActive] = useState<string | null>(envelope.recipients.find((r) => r.role === 'signer')?.id ?? null);
  const [tool, setTool] = useState<SigningFieldType | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const pdf = usePdf({ url: envelope.fileUrl });

  const color = (recipientId: string) => RECIPIENT_COLORS[recipients.findIndex((r) => r.id === recipientId) % RECIPIENT_COLORS.length]!;
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.signing.pathKey() });
  const update = useMutation(trpc.signing.update.mutationOptions());
  const send = useMutation(trpc.signing.send.mutationOptions());
  const remove = useMutation(trpc.signing.deleteDraft.mutationOptions({ onSuccess: () => navigate('/documents/signing') }));

  const save = async () => {
    const { data, errors } = validate(updateEnvelopeInput, { envelopeId: envelope.id, title, message, routing, recipients, fields });
    setErrors(errors ?? {});
    if (!data) {
      toast.error(Object.values(errors ?? {})[0] ?? 'Check the envelope');
      return false;
    }
    return update.mutateAsync(data).then(
      () => true,
      () => false,
    );
  };

  const place = (page: number, e: ReactPointerEvent<HTMLDivElement>) => {
    if (!tool || !active) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const [w, h] = DEFAULT_SIZE[tool];
    const field: PlacedField = {
      id: crypto.randomUUID(),
      recipientId: active,
      type: tool,
      page,
      x: clamp((e.clientX - rect.left) / rect.width - w / 2, 0, 1 - w),
      y: clamp((e.clientY - rect.top) / rect.height - h / 2, 0, 1 - h),
      width: w,
      height: h,
      required: tool !== 'checkbox',
      label: '',
    };
    setFields((all) => [...all, field]);
    setSelected(field.id);
    setTool(null);
  };

  /** Moves (or with `resize`, sizes) a field by dragging; positions stay fractions of the page. */
  const drag = (field: PlacedField, e: ReactPointerEvent<HTMLElement>, resize = false) => {
    if (!editable) return;
    e.stopPropagation();
    e.preventDefault();
    setSelected(field.id);
    const page = (e.currentTarget.closest('[data-page]') as HTMLElement).getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    const onMove = (m: PointerEvent) => {
      const dx = (m.clientX - start.x) / page.width;
      const dy = (m.clientY - start.y) / page.height;
      setFields((all) =>
        all.map((f) =>
          f.id !== field.id
            ? f
            : resize
              ? { ...f, width: clamp(field.width + dx, 0.02, 1 - f.x), height: clamp(field.height + dy, 0.012, 1 - f.y) }
              : { ...f, x: clamp(field.x + dx, 0, 1 - f.width), y: clamp(field.y + dy, 0, 1 - f.height) },
        ),
      );
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const signers = recipients.filter((r) => r.role === 'signer');
  const missing = signers.filter((s) => !fields.some((f) => f.recipientId === s.id && f.type === 'signature'));

  return (
    <div onKeyDown={(e) => e.key === 'Escape' && setTool(null)}>
      <BackLink />
      <PageHeader
        title={title || 'Untitled Envelope'}
        description={
          <>
            Draft from <span className="font-medium text-foreground">{envelope.fileName}</span>. Add signers, place their fields on the
            document, then send.
          </>
        }
        actions={
          editable && (
            <>
              <Button variant="ghost" onClick={() => remove.mutate({ envelopeId: envelope.id })} disabled={remove.isPending}>
                <Trash2 /> Delete Draft
              </Button>
              <Button
                variant="outline"
                disabled={update.isPending}
                onClick={async () => {
                  if (await save()) {
                    toast.success('Draft saved');
                    refresh();
                  }
                }}
              >
                Save Draft
              </Button>
              <Button disabled={update.isPending} onClick={async () => (await save()) && setSending(true)}>
                <Send /> Send
              </Button>
            </>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Title" htmlFor="env-title" error={errors.title}>
                <Input id="env-title" value={title} disabled={!editable} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="Message to Signers" htmlFor="env-message" hint="Shown in the email, in the language you write it.">
                <Textarea id="env-message" rows={3} value={message} disabled={!editable} onChange={(e) => setMessage(e.target.value)} />
              </Field>
              <Field label="Signing Order">
                <Select value={routing} onValueChange={(v) => setRouting(v as typeof routing)} disabled={!editable}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="parallel">Everyone at Once</SelectItem>
                    <SelectItem value="sequential">One After Another</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </CardContent>
          </Card>

          <RecipientsCard
            recipients={recipients}
            routing={routing}
            editable={editable}
            active={active}
            color={color}
            onActive={setActive}
            onChange={(next) => {
              setRecipients(next);
              setFields((all) => all.filter((f) => next.some((r) => r.id === f.recipientId && r.role === 'signer')));
              if (!next.some((r) => r.id === active)) setActive(next.find((r) => r.role === 'signer')?.id ?? null);
            }}
          />

          {editable && (
            <Card>
              <CardHeader>
                <CardTitle>Fields</CardTitle>
                <CardDescription>
                  {active
                    ? `Pick a field, then click on the document where ${recipients.find((r) => r.id === active)?.name} should fill it in.`
                    : 'Add a signer first.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2">
                {SIGNING_FIELD_TYPES.map((t) => (
                  <Button
                    key={t}
                    size="sm"
                    variant={tool === t ? 'default' : 'outline'}
                    disabled={!active}
                    onClick={() => setTool(tool === t ? null : t)}
                  >
                    {SIGNING_FIELD_LABELS[t]}
                  </Button>
                ))}
              </CardContent>
            </Card>
          )}

          {missing.length > 0 && signers.length > 0 && (
            <Alert>
              <AlertDescription>Place a signature field for {missing.map((m) => m.name).join(', ')}.</AlertDescription>
            </Alert>
          )}
        </div>

        <div className={cn('min-w-0', tool && '[&_[data-page]]:cursor-crosshair')}>
          <PdfPages
            doc={pdf.doc}
            error={pdf.error}
            overlay={(page) => (
              <div data-page={page} className="absolute inset-0" onPointerDown={(e) => (tool ? place(page, e) : setSelected(null))}>
                {fields
                  .filter((f) => f.page === page)
                  .map((f) => {
                    const owner = recipients.find((r) => r.id === f.recipientId);
                    return (
                      // biome-ignore lint/a11y/useSemanticElements: it holds its own buttons, which a <button> cannot
                      <div
                        key={f.id}
                        role="button"
                        tabIndex={0}
                        onPointerDown={(e) => drag(f, e)}
                        className={cn(
                          'group absolute flex touch-none select-none items-center overflow-visible rounded-sm border-2 px-1 text-[11px] leading-tight',
                          color(f.recipientId),
                          selected === f.id && 'ring-2 ring-ring ring-offset-1',
                        )}
                        style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.width * 100}%`, height: `${f.height * 100}%` }}
                      >
                        <span className="truncate">
                          {SIGNING_FIELD_LABELS[f.type]}
                          {f.type !== 'checkbox' && owner ? ` · ${owner.name}` : ''}
                          {f.required ? '' : ' (optional)'}
                        </span>
                        {editable && selected === f.id && (
                          <>
                            <div
                              className="absolute -top-8 left-0 z-10 flex items-center gap-2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm"
                              onPointerDown={(e) => e.stopPropagation()}
                            >
                              <label className="flex items-center gap-1.5">
                                <Checkbox
                                  checked={f.required}
                                  onCheckedChange={(v) =>
                                    setFields((all) => all.map((x) => (x.id === f.id ? { ...x, required: v === true } : x)))
                                  }
                                />
                                Required
                              </label>
                              <button
                                type="button"
                                aria-label="Remove Field"
                                className="text-muted-foreground hover:text-destructive"
                                onClick={() => setFields((all) => all.filter((x) => x.id !== f.id))}
                              >
                                <X className="size-3.5" />
                              </button>
                            </div>
                            <span
                              aria-hidden
                              onPointerDown={(e) => drag(f, e, true)}
                              className="absolute -right-1.5 -bottom-1.5 size-3 cursor-se-resize rounded-full border-2 border-background bg-foreground"
                            />
                          </>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          />
        </div>
      </div>

      <SendDialog
        open={sending}
        onOpenChange={setSending}
        signers={signers.length}
        pending={send.isPending}
        onSend={(expiresInDays) =>
          send.mutate(
            { envelopeId: envelope.id, expiresInDays },
            {
              onSuccess: () => {
                setSending(false);
                toast.success('Sent for signature');
                refresh();
              },
            },
          )
        }
      />
    </div>
  );
}

function RecipientsCard({
  recipients,
  routing,
  editable,
  active,
  color,
  onActive,
  onChange,
}: {
  recipients: Recipient[];
  routing: 'parallel' | 'sequential';
  editable: boolean;
  active: string | null;
  color: (id: string) => string;
  onActive: (id: string) => void;
  onChange: (next: Recipient[]) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'signer' | 'cc'>('signer');

  const add = () => {
    if (!name.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) {
      toast.error('Enter a name and a valid email address');
      return;
    }
    const order = Math.max(0, ...recipients.map((r) => r.order)) + (routing === 'sequential' ? 1 : 0) || 1;
    const next: Recipient = { id: crypto.randomUUID(), name: name.trim(), email: email.trim().toLowerCase(), role, order };
    onChange([...recipients, next]);
    if (role === 'signer') onActive(next.id);
    setName('');
    setEmail('');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recipients</CardTitle>
        <CardDescription>
          Signers get a personal link and an emailed code. Copies get the signed PDF when everyone has signed.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {recipients.map((r) => (
          <div
            key={r.id}
            className={cn(
              'flex items-center gap-2 rounded-md border p-2',
              r.role === 'signer' && 'cursor-pointer',
              active === r.id && 'border-primary',
            )}
            onClick={() => r.role === 'signer' && onActive(r.id)}
            onKeyDown={(e) => e.key === 'Enter' && r.role === 'signer' && onActive(r.id)}
          >
            <span className={cn('size-3 shrink-0 rounded-full border-2', r.role === 'signer' ? color(r.id) : 'border-muted-foreground')} />
            <div className="grid min-w-0 flex-1">
              <span className="truncate text-sm font-medium">{r.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {r.email} · {r.role === 'cc' ? 'Copy' : routing === 'sequential' ? `Signer ${r.order}` : 'Signer'}
              </span>
            </div>
            {editable && routing === 'sequential' && r.role === 'signer' && (
              <Input
                type="number"
                min={1}
                max={50}
                aria-label="Order"
                className="h-7 w-14 px-2"
                value={r.order}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) =>
                  onChange(recipients.map((x) => (x.id === r.id ? { ...x, order: clamp(Number(e.target.value) || 1, 1, 50) } : x)))
                }
              />
            )}
            {editable && (
              <button
                type="button"
                aria-label={`Remove ${r.name}`}
                className="text-muted-foreground hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(recipients.filter((x) => x.id !== r.id));
                }}
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        ))}
        {editable && (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
            <Input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
            <div className="flex gap-2">
              <Select value={role} onValueChange={(v) => setRole(v as 'signer' | 'cc')}>
                <SelectTrigger className="flex-1" aria-label="Role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="signer">Signer</SelectItem>
                  <SelectItem value="cc">Gets a Copy</SelectItem>
                </SelectContent>
              </Select>
              <Button type="submit" variant="outline">
                <Plus /> Add
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function SendDialog({
  open,
  onOpenChange,
  signers,
  pending,
  onSend,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signers: number;
  pending: boolean;
  onSend: (expiresInDays: number) => void;
}) {
  const [days, setDays] = useState('30');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send for Signature</DialogTitle>
          <DialogDescription>
            The document is frozen now: its SHA-256 hash is recorded, and every signer signs exactly that version. {signers}{' '}
            {signers === 1 ? 'signer gets' : 'signers get'} an email in Swedish with a personal link.
          </DialogDescription>
        </DialogHeader>
        <Field label="Links Expire After">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['7', '14', '30', '60', '90'].map((d) => (
                <SelectItem key={d} value={d}>
                  {d} days
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => onSend(Number(days))}>
            <Send /> Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EnvelopeDetail({ envelope }: { envelope: Envelope }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const format = useFormat();
  const can = useCan();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.signing.pathKey() });
  const remind = useMutation(
    trpc.signing.remind.mutationOptions({
      onSuccess: ({ reminded }) => {
        toast.success(reminded === 1 ? 'Reminded 1 signer' : `Reminded ${reminded} signers`);
        refresh();
      },
    }),
  );
  const voidIt = useMutation(
    trpc.signing.void.mutationOptions({
      onSuccess: () => {
        setVoiding(false);
        refresh();
      },
    }),
  );
  const names = useMemo(() => new Map(envelope.recipients.map((r) => [r.id, r.name])), [envelope.recipients]);
  const waiting = envelope.status === 'sent';

  const sealing = envelope.status === 'completed' && !envelope.sealed;
  useQuery({ ...trpc.signing.get.queryOptions({ envelopeId: envelope.id }), refetchInterval: waiting || sealing ? 15_000 : false });

  return (
    <>
      <BackLink />
      <PageHeader
        title={envelope.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <EnvelopeStatusBadge status={envelope.status} />
            {envelope.sentAt && (
              <span>
                Sent {format.dateTime(envelope.sentAt)}
                {envelope.sentBy ? ` by ${envelope.sentBy}` : ''}
              </span>
            )}
            {waiting && envelope.expiresAt && <span>· expires {format.date(envelope.expiresAt)}</span>}
          </span>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={envelope.fileUrl} target="_blank" rel="noreferrer">
                <FileText /> Original
              </a>
            </Button>
            {envelope.sealed && (
              <Button asChild>
                <a href={`${envelope.sealed.fileUrl}?download`}>
                  <Download /> Download Signed PDF
                </a>
              </Button>
            )}
            {waiting && can('signing.send') && (
              <>
                <Button variant="outline" disabled={remind.isPending} onClick={() => remind.mutate({ envelopeId: envelope.id })}>
                  <Bell /> Remind
                </Button>
                <Button variant="ghost" onClick={() => setVoiding(true)}>
                  Void
                </Button>
              </>
            )}
          </>
        }
      />

      {envelope.status === 'completed' && !envelope.sealed && (
        <Alert className="mb-4">
          <AlertDescription>Everyone has signed. The sealed PDF is being prepared.</AlertDescription>
        </Alert>
      )}
      {envelope.voidReason && (
        <Alert className="mb-4">
          <AlertDescription>Voided: {envelope.voidReason}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Recipients</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Signed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {envelope.recipients.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">{r.email}</TableCell>
                    <TableCell>{r.role === 'cc' ? 'Copy' : envelope.routing === 'sequential' ? `Signer ${r.order}` : 'Signer'}</TableCell>
                    <TableCell>
                      {r.role === 'cc' ? '—' : (RECIPIENT_STATUS[r.status] ?? r.status)}
                      {r.declineReason && <p className="text-xs text-muted-foreground">{r.declineReason}</p>}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {r.signedAt ? format.dateTime(r.signedAt) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Evidence Trail
              {envelope.chain.ok ? (
                <span className="inline-flex items-center gap-1 text-xs font-normal text-success">
                  <ShieldCheck className="size-3.5" /> Hash Chain Intact
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-normal text-destructive">
                  <ShieldAlert className="size-3.5" /> Hash Chain Broken at Event {envelope.chain.brokenAt}
                </span>
              )}
            </CardTitle>
            <CardDescription>
              Every step is recorded and linked to the one before by its SHA-256 hash, so a removed or changed event shows. Original
              document <span className="font-mono">{shortHash(envelope.documentHash)}</span>
              {envelope.sealed?.hash && (
                <>
                  , signed PDF <span className="font-mono">{shortHash(envelope.sealed.hash)}</span>
                </>
              )}
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead className="hidden md:table-cell">When</TableHead>
                  <TableHead className="hidden lg:table-cell">IP Address</TableHead>
                  <TableHead className="hidden lg:table-cell">Hash</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {envelope.events.map((e) => (
                  <TableRow key={e.seq}>
                    <TableCell className="font-mono text-xs">{e.seq}</TableCell>
                    <TableCell>{EVENT_LABELS[e.type] ?? e.type}</TableCell>
                    <TableCell className="text-muted-foreground">{e.recipientId ? names.get(e.recipientId) : '—'}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{format.dateTime(e.occurredAt)}</TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">{e.ip ?? '—'}</TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">{shortHash(e.hash)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={voiding} onOpenChange={setVoiding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void Envelope</DialogTitle>
            <DialogDescription>
              The signing links stop working and everyone already invited is told by email. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <Field label="Reason" htmlFor="void-reason" hint="Included in the email to signers.">
            <Input id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoiding(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!reason.trim() || voidIt.isPending}
              onClick={() => voidIt.mutate({ envelopeId: envelope.id, reason: reason.trim() })}
            >
              Void Envelope
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
