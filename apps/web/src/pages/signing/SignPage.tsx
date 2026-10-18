import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, Eraser, FileX, PenLine, ShieldCheck } from 'lucide-react';
import { type ReactNode, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { Field, Logo, Spinner } from '@/components/common';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useClientConfig } from '@/lib/session';
import { errorMessage, type RouterOutputs, useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PdfPages, shortHash, usePdf } from './pdf';

type View = RouterOutputs['signing']['view'];

const expired = (error: unknown) => (error as { data?: { code?: string } })?.data?.code === 'FORBIDDEN';

const storageKey = (token: string) => `openinc.signing.${token.slice(0, 16)}`;

function readAccess(token: string) {
  try {
    return sessionStorage.getItem(storageKey(token));
  } catch {
    return null;
  }
}

function writeAccess(token: string, access: string | null) {
  try {
    if (access) sessionStorage.setItem(storageKey(token), access);
    else sessionStorage.removeItem(storageKey(token));
  } catch {}
}

export function SignerLayout({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const config = useClientConfig();
  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = 'sv';
    return () => {
      document.documentElement.lang = previous;
    };
  }, []);
  return (
    <div className="min-h-svh bg-muted/40 px-4 py-8">
      <div className={cn('mx-auto grid gap-6', wide ? 'max-w-5xl' : 'max-w-lg')}>
        <div className="flex items-center justify-center gap-2.5">
          <Logo src={config?.logoUrl} name={config?.companyName} className="size-8" />
          <span className="text-base font-semibold">{config?.companyName ?? 'OpenInc'}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function Message({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <SignerLayout>
      <Card className="shadow-none">
        <CardHeader className="items-center text-center">
          <div className="mb-2 text-muted-foreground [&_svg]:size-8">{icon}</div>
          <CardTitle className="text-lg">{title}</CardTitle>
          {children && <CardDescription>{children}</CardDescription>}
        </CardHeader>
      </Card>
    </SignerLayout>
  );
}

export function SignPage() {
  const { token = '' } = useParams();
  const trpc = useTRPC();
  const [access, setAccess] = useState(() => readAccess(token));
  const describe = useQuery({ ...trpc.signing.describe.queryOptions({ token }), retry: false, meta: { silent: true } });

  const updateAccess = (next: string | null) => {
    writeAccess(token, next);
    setAccess(next);
  };

  if (describe.isLoading)
    return (
      <SignerLayout>
        <Spinner className="mx-auto my-12 size-6" />
      </SignerLayout>
    );
  if (!describe.data)
    return (
      <Message icon={<FileX />} title="Länken Fungerar Inte">
        {errorMessage(describe.error)}
      </Message>
    );

  const d = describe.data;
  if (d.state === 'voided')
    return (
      <Message icon={<FileX />} title="Dokumentet Har Dragits Tillbaka">
        {d.company} har dragit tillbaka ”{d.title}”. Du behöver inte göra något.
      </Message>
    );
  if (d.state === 'expired')
    return (
      <Message icon={<FileX />} title="Länken Har Gått Ut">
        Be {d.sender} att skicka dokumentet igen.
      </Message>
    );
  if (d.state === 'declined')
    return (
      <Message icon={<FileX />} title="Signeringen Har Avbrutits">
        ”{d.title}” har avböjts och kan inte längre signeras.
      </Message>
    );
  if (d.state === 'signed' || d.state === 'completed')
    return (
      <Message icon={<CheckCircle2 className="text-success" />} title="Du Har Signerat">
        {d.state === 'completed'
          ? `Alla har signerat ”${d.title}”. Det signerade dokumentet har skickats till dig via e-post.`
          : `Tack. Du får det signerade dokumentet via e-post när alla har signerat ”${d.title}”.`}
      </Message>
    );

  if (!access) return <VerifyEmail token={token} describe={d} onAccess={updateAccess} />;
  return <SignDocument token={token} access={access} onExpired={() => updateAccess(null)} onDone={() => describe.refetch()} />;
}

function VerifyEmail({
  token,
  describe,
  onAccess,
}: {
  token: string;
  describe: RouterOutputs['signing']['describe'];
  onAccess: (access: string) => void;
}) {
  const trpc = useTRPC();
  const [sent, setSent] = useState(!!describe.codeSentAt && Date.now() - new Date(describe.codeSentAt).getTime() < 10 * 60_000);
  const [code, setCode] = useState('');
  const request = useMutation(trpc.signing.requestCode.mutationOptions({ onSuccess: () => setSent(true) }));
  const verify = useMutation(trpc.signing.verifyCode.mutationOptions({ onSuccess: ({ access }) => onAccess(access) }));

  return (
    <SignerLayout>
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-lg">{describe.title}</CardTitle>
          <CardDescription>
            Hej {describe.name}. {describe.sender} på {describe.company} har bett dig att signera det här dokumentet.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {!sent ? (
            <>
              <p className="text-sm">
                För att vara säkra på att det är du skickar vi en engångskod till <span className="font-medium">{describe.email}</span>.
              </p>
              <Button disabled={request.isPending} onClick={() => request.mutate({ token })}>
                Skicka Kod
              </Button>
            </>
          ) : (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                verify.mutate({ token, code: code.trim() });
              }}
            >
              <Field
                label="Engångskod"
                htmlFor="signing-code"
                hint={`Vi har skickat en sexsiffrig kod till ${describe.email}. Den gäller i 10 minuter.`}
              >
                <Input
                  id="signing-code"
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className="font-mono text-lg tracking-[0.4em]"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
              </Field>
              <Button type="submit" disabled={code.length !== 6 || verify.isPending}>
                Öppna Dokumentet
              </Button>
              <Button
                type="button"
                variant="link"
                className="h-auto p-0"
                disabled={request.isPending}
                onClick={() => request.mutate({ token })}
              >
                Skicka en ny kod
              </Button>
            </form>
          )}
          {describe.expiresAt && (
            <p className="text-xs text-muted-foreground">
              Länken gäller till {new Intl.DateTimeFormat('sv-SE', { dateStyle: 'long' }).format(new Date(describe.expiresAt))}.
            </p>
          )}
        </CardContent>
      </Card>
    </SignerLayout>
  );
}

async function downloadDocument(token: string, access: string, name: string) {
  const res = await fetch('/api/signing/document?download', { headers: { 'x-signing-token': token, 'x-signing-access': access } });
  if (!res.ok) throw new Error('Kunde inte ladda ner dokumentet');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function SignDocument({ token, access, onExpired, onDone }: { token: string; access: string; onExpired: () => void; onDone: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const view = useQuery({ ...trpc.signing.view.queryOptions({ token, access }), retry: false, meta: { silent: true } });
  const pdf = usePdf({ url: '/api/signing/document', headers: { 'x-signing-token': token, 'x-signing-access': access } });
  const [values, setValues] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<View['fields'][number] | null>(null);
  const [consent, setConsent] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [done, setDone] = useState<{ allSigned: boolean; statementHash: string } | null>(null);

  useEffect(() => {
    if (view.error && expired(view.error)) {
      toast.error('Sessionen har gått ut. Begär en ny kod.');
      onExpired();
    }
  }, [view.error, onExpired]);

  const sign = useMutation(
    trpc.signing.sign.mutationOptions({
      meta: { silent: true },
      onSuccess: (result) => {
        setDone(result);
        void queryClient.invalidateQueries({ queryKey: trpc.signing.describe.queryKey({ token }) });
      },
      onError: (error) => (expired(error) ? onExpired() : toast.error(errorMessage(error))),
    }),
  );

  if (done)
    return (
      <Message icon={<CheckCircle2 className="text-success" />} title="Tack, Du Har Signerat">
        {done.allSigned
          ? 'Alla har nu signerat. Du får det signerade dokumentet via e-post inom kort.'
          : 'Du får det signerade dokumentet via e-post när alla har signerat.'}
        <span className="mt-3 block font-mono text-xs">Kvitto {shortHash(done.statementHash)}</span>
      </Message>
    );
  if (view.isLoading)
    return (
      <SignerLayout>
        <Spinner className="mx-auto my-12 size-6" />
      </SignerLayout>
    );
  if (!view.data)
    return (
      <Message icon={<FileX />} title="Något Gick Fel">
        {errorMessage(view.error)}
      </Message>
    );

  const v = view.data;
  const fill = (fieldId: string, value: string) => setValues((all) => ({ ...all, [fieldId]: value }));
  const shown = (f: View['fields'][number]) => (f.type === 'date' ? v.today : f.type === 'name' ? v.name : (values[f.id] ?? ''));
  const unfilled = (f: View['fields'][number]) =>
    f.required &&
    f.type !== 'date' &&
    f.type !== 'name' &&
    (f.type === 'checkbox' ? values[f.id] !== 'true' : !(values[f.id] ?? '').trim());
  const missing = v.fields.filter(unfilled);

  return (
    <SignerLayout wide>
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-lg">{v.title}</CardTitle>
          <CardDescription>Från {v.company}. Läs igenom dokumentet och fyll i de markerade fälten.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {v.message && <p className="whitespace-pre-line rounded-md bg-muted px-3 py-2">{v.message}</p>}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
            <span>Signerar: {v.signers.map((s) => `${s.you ? `${s.name} (du)` : s.name}${s.signed ? ' ✓' : ''}`).join(', ')}</span>
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="size-3.5" /> Dokumentets SHA-256 <span className="font-mono">{shortHash(v.documentHash)}</span>
            </span>
          </div>
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadDocument(token, access, `${v.title}.pdf`).catch((e: Error) => toast.error(e.message))}
            >
              <Download /> Ladda Ner
            </Button>
          </div>
        </CardContent>
      </Card>

      <PdfPages
        doc={pdf.doc}
        error={pdf.error}
        maxWidth={960}
        overlay={(page) =>
          v.fields
            .filter((f) => f.page === page)
            .map((f) => {
              const value = shown(f);
              const style = { left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.width * 100}%`, height: `${f.height * 100}%` };
              const empty = unfilled(f);
              const box = cn(
                'absolute flex items-center rounded-sm border-2 text-left text-[11px] leading-tight',
                empty ? 'border-amber-500 bg-amber-400/20' : 'border-indigo-500/60 bg-indigo-500/5',
              );
              if (f.type === 'checkbox')
                return (
                  <label key={f.id} className={cn(box, 'justify-center')} style={style}>
                    <Checkbox
                      aria-label={f.label || 'Kryssruta'}
                      checked={values[f.id] === 'true'}
                      onCheckedChange={(c) => fill(f.id, c === true ? 'true' : 'false')}
                    />
                  </label>
                );
              if (f.type === 'text')
                return (
                  <input
                    key={f.id}
                    aria-label={f.label || 'Text'}
                    placeholder={f.label || 'Text'}
                    maxLength={500}
                    className={cn(box, 'px-1 text-black outline-none focus:ring-2 focus:ring-ring')}
                    style={style}
                    value={value}
                    onChange={(e) => fill(f.id, e.target.value)}
                  />
                );
              if (f.type === 'date' || f.type === 'name')
                return (
                  <div key={f.id} className={cn(box, 'px-1 text-black')} style={style} title="Fylls i automatiskt">
                    <span className="truncate">{value}</span>
                  </div>
                );
              return (
                <button
                  key={f.id}
                  type="button"
                  className={cn(box, 'justify-center px-1 text-black')}
                  style={style}
                  onClick={() => setEditing(f)}
                >
                  {!value ? (
                    <span className="inline-flex items-center gap-1 font-medium">
                      <PenLine className="size-3" /> {f.type === 'initials' ? 'Initialer' : 'Signera här'}
                    </span>
                  ) : value.startsWith('data:') ? (
                    <img src={value} alt="Din underskrift" className="size-full object-contain" />
                  ) : (
                    <span className="truncate font-serif text-base italic">{value}</span>
                  )}
                </button>
              );
            })
        }
      />

      <Card className="sticky bottom-4 shadow-sm">
        <CardContent className="grid gap-4 pt-6">
          <label className="flex items-start gap-3 text-sm">
            <Checkbox checked={consent} onCheckedChange={(c) => setConsent(c === true)} className="mt-0.5" />
            <span>{v.consent.text}</span>
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" onClick={() => setDeclining(true)}>
              Avböj
            </Button>
            <div className="flex items-center gap-3">
              {missing.length > 0 && (
                <span className="text-sm text-muted-foreground">
                  {missing.length === 1 ? '1 fält kvar att fylla i' : `${missing.length} fält kvar att fylla i`}
                </span>
              )}
              <Button
                disabled={!consent || missing.length > 0 || sign.isPending || !pdf.doc}
                onClick={() =>
                  sign.mutate({
                    token,
                    access,
                    consent: true,
                    values: Object.entries(values).map(([fieldId, value]) => ({ fieldId, value })),
                  })
                }
              >
                <PenLine /> Signera
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <SignatureDialog
        field={editing}
        name={v.name}
        onClose={() => setEditing(null)}
        onSave={(value) => {
          if (editing) fill(editing.id, value);
          setEditing(null);
        }}
      />
      <DeclineDialog
        open={declining}
        onOpenChange={setDeclining}
        token={token}
        access={access}
        onDeclined={() => {
          setDeclining(false);
          onDone();
        }}
      />
    </SignerLayout>
  );
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase())
    .join('');

function SignatureDialog({
  field,
  name,
  onClose,
  onSave,
}: {
  field: { type: string } | null;
  name: string;
  onClose: () => void;
  onSave: (value: string) => void;
}) {
  const initials = field?.type === 'initials';
  const [mode, setMode] = useState<'type' | 'draw'>('type');
  const [typed, setTyped] = useState('');
  const [drawn, setDrawn] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (field) {
      setTyped(initials ? initialsOf(name) : name);
      setDrawn(false);
    }
  }, [field, initials, name]);

  const point = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * e.currentTarget.width,
      y: ((e.clientY - rect.top) / rect.height) * e.currentTarget.height,
    };
  };
  const stroke = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return;
    const ctx = e.currentTarget.getContext('2d')!;
    const p = point(e);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    setDrawn(true);
  };
  const clear = () => {
    const c = canvas.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setDrawn(false);
  };

  return (
    <Dialog open={!!field} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initials ? 'Dina Initialer' : 'Din Underskrift'}</DialogTitle>
          <DialogDescription>Skriv med tangentbordet eller rita med musen eller fingret.</DialogDescription>
        </DialogHeader>
        <Tabs value={mode} onValueChange={(m) => setMode(m as 'type' | 'draw')}>
          <TabsList>
            <TabsTrigger value="type">Skriv</TabsTrigger>
            <TabsTrigger value="draw">Rita</TabsTrigger>
          </TabsList>
          <TabsContent value="type" className="grid gap-3">
            <Input aria-label={initials ? 'Initialer' : 'Namn'} maxLength={80} value={typed} onChange={(e) => setTyped(e.target.value)} />
            <div className="flex h-24 items-center justify-center rounded-md border bg-white px-4 font-serif text-3xl text-gray-900 italic">
              <span className="truncate">{typed}</span>
            </div>
          </TabsContent>
          <TabsContent value="draw" className="grid gap-2">
            <canvas
              ref={canvas}
              width={600}
              height={200}
              aria-label="Rita din underskrift"
              className="h-40 w-full touch-none rounded-md border bg-white"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                last.current = point(e);
              }}
              onPointerMove={stroke}
              onPointerUp={() => {
                last.current = null;
              }}
            />
            <Button variant="ghost" size="sm" className="justify-self-start" onClick={clear}>
              <Eraser /> Rensa
            </Button>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Avbryt
          </Button>
          <Button
            disabled={mode === 'type' ? !typed.trim() : !drawn}
            onClick={() => onSave(mode === 'type' ? typed.trim() : canvas.current!.toDataURL('image/png'))}
          >
            Använd
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeclineDialog({
  open,
  onOpenChange,
  token,
  access,
  onDeclined,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  access: string;
  onDeclined: () => void;
}) {
  const trpc = useTRPC();
  const [reason, setReason] = useState('');
  const decline = useMutation(trpc.signing.decline.mutationOptions({ onSuccess: onDeclined }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Avböj att Signera</DialogTitle>
          <DialogDescription>Avsändaren får ditt meddelande och ingen annan kan signera dokumentet efter det.</DialogDescription>
        </DialogHeader>
        <Field label="Anledning" htmlFor="decline-reason">
          <Textarea id="decline-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Alert>
          <AlertDescription>Det går inte att ångra.</AlertDescription>
        </Alert>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button
            variant="destructive"
            disabled={!reason.trim() || decline.isPending}
            onClick={() => decline.mutate({ token, access, reason: reason.trim() })}
          >
            Avböj
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
