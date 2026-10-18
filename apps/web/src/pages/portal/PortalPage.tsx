import { formatBytes } from '@openinc/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Eye, FileText, Folder, Lock } from 'lucide-react';
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { Field, Logo, Spinner } from '@/components/common';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { errorMessage, type RouterOutputs, useTRPC } from '@/lib/trpc';

const PdfViewer = lazy(() => import('./PdfViewer').then((m) => ({ default: m.PdfViewer })));

type Gate = RouterOutputs['portal']['start'];
type Contents = RouterOutputs['portal']['room'];
type Item = Contents['items'][number];

const HEARTBEAT_SECONDS = 10;

/** The public page an outside visitor opens from a share link. No staff session, no sidebar. */
export function PortalPage() {
  const { token = '' } = useParams();
  const trpc = useTRPC();
  const [gate, setGate] = useState<Gate | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const start = useMutation(
    trpc.portal.start.mutationOptions({
      meta: { silent: true },
      onSuccess: setGate,
      onError: (e) => setFailure(errorMessage(e)),
    }),
  );
  const begin = start.mutate;
  useEffect(() => {
    begin({ token });
  }, [begin, token]);
  const restart = useCallback(() => {
    setGate(null);
    begin({ token });
  }, [begin, token]);

  if (failure)
    return (
      <Shell>
        <Card className="w-full max-w-sm shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Lock className="size-4" /> Not Available
            </CardTitle>
            <CardDescription>{failure}. Ask the person who sent it for a new link.</CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  if (!gate) return <Shell>{<Spinner className="size-6" />}</Shell>;
  if (gate.step === 'open') return <RoomView token={token} onEnded={restart} />;
  return (
    <Shell companyName={gate.companyName} logoUrl={gate.logoUrl}>
      <GateCard gate={gate} token={token} onNext={setGate} />
    </Shell>
  );
}

function Shell({ children, companyName, logoUrl }: { children: ReactNode; companyName?: string; logoUrl?: string | null }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted/40 px-4 py-10">
      {companyName && (
        <div className="mb-6 flex items-center gap-2.5">
          <Logo src={logoUrl} name={companyName} className="size-8" />
          <span className="text-base font-semibold">{companyName}</span>
        </div>
      )}
      {children}
      <p className="mt-8 max-w-sm text-center text-xs text-muted-foreground">
        {companyName ?? 'The company'} records which documents you open and how long you read them, to follow up with you.
      </p>
    </div>
  );
}

function GateCard({ gate, token, onNext }: { gate: Gate; token: string; onNext: (g: Gate) => void }) {
  const trpc = useTRPC();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const options = {
    meta: { silent: true },
    onSuccess: (g: Gate) => {
      setError(null);
      onNext(g);
    },
    onError: (e: unknown) => setError(errorMessage(e)),
  };
  const identify = useMutation(trpc.portal.identify.mutationOptions(options));
  const verify = useMutation(trpc.portal.verify.mutationOptions(options));
  const unlock = useMutation(trpc.portal.unlock.mutationOptions(options));
  const accept = useMutation(trpc.portal.acceptNda.mutationOptions(options));
  const resend = useMutation(
    trpc.portal.resendCode.mutationOptions({
      meta: { silent: true },
      onSuccess: () => setSent(true),
      onError: (e) => setError(errorMessage(e)),
    }),
  );
  const pending = identify.isPending || verify.isPending || unlock.isPending || accept.isPending;

  const steps: Record<
    Exclude<Gate['step'], 'open'>,
    { title: string; description: string; body: ReactNode; submit: () => void; ready: boolean }
  > = {
    email: {
      title: 'Your Email',
      description: `To open ${gate.room.name}, tell us who you are.`,
      ready: !!email.trim(),
      submit: () => identify.mutate({ token, email, name, company }),
      body: (
        <>
          <Field label="Email" htmlFor="portal-email">
            <Input id="portal-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="portal-name">
              <Input id="portal-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Company" htmlFor="portal-company">
              <Input id="portal-company" autoComplete="organization" value={company} onChange={(e) => setCompany(e.target.value)} />
            </Field>
          </div>
        </>
      ),
    },
    code: {
      title: 'Verification Code',
      description: `We sent a 6-digit code to ${gate.email}. It works for 10 minutes.`,
      ready: /^\d{6}$/.test(code.trim()),
      submit: () => verify.mutate({ token, code }),
      body: (
        <>
          <Field label="Code" htmlFor="portal-code">
            <Input
              id="portal-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="font-mono tracking-widest"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
            />
          </Field>
          <Button
            type="button"
            variant="link"
            className="h-auto justify-self-start p-0"
            onClick={() => resend.mutate({ token })}
            disabled={resend.isPending}
          >
            {sent ? 'Sent Again' : 'Send a New Code'}
          </Button>
        </>
      ),
    },
    password: {
      title: 'Password',
      description: `${gate.room.name} is protected. Enter the password you were given.`,
      ready: !!password,
      submit: () => unlock.mutate({ token, password }),
      body: (
        <Field label="Password" htmlFor="portal-password">
          <Input
            id="portal-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </Field>
      ),
    },
    nda: {
      title: 'Confidentiality',
      description: 'Read and accept the terms before you continue.',
      ready: agreed,
      submit: () => accept.mutate({ token }),
      body: (
        <>
          <div className="max-h-64 overflow-y-auto rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap">{gate.room.ndaText}</div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={agreed} onCheckedChange={(c) => setAgreed(c === true)} className="mt-0.5" />I have read the terms above and
            agree to them.
          </label>
        </>
      ),
    },
  };
  const step = steps[gate.step as Exclude<Gate['step'], 'open'>];
  return (
    <Card className="w-full max-w-md shadow-none">
      <CardHeader>
        <CardTitle className="text-lg">{step.title}</CardTitle>
        <CardDescription>{step.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (step.ready) step.submit();
          }}
        >
          {step.body}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={!step.ready || pending}>
            {gate.step === 'nda' ? 'Accept and Continue' : 'Continue'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function RoomView({ token, onEnded }: { token: string; onEnded: () => void }) {
  const trpc = useTRPC();
  const room = useQuery(trpc.portal.room.queryOptions({ token }, { retry: false, refetchOnWindowFocus: true }));
  const [viewing, setViewing] = useState<Item | null>(null);
  const ended = room.error;
  useEffect(() => {
    if (ended) onEnded();
  }, [ended, onEnded]);

  if (!room.data) return <Shell>{<Spinner className="size-6" />}</Shell>;
  const r = room.data;
  if (viewing) return <Viewer token={token} room={r} item={viewing} onBack={() => setViewing(null)} />;

  const itemsIn = (folderId: string | null) => r.items.filter((i) => i.folderId === folderId);
  const foldersIn = (parentId: string | null) => r.folders.filter((f) => f.parentId === parentId);
  const renderItems = (folderId: string | null, depth: number) =>
    itemsIn(folderId).map((item) => (
      <li key={item.id} className="flex items-center gap-3 border-t px-4 py-2.5" style={{ paddingLeft: 16 + depth * 20 }}>
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        {item.viewable ? (
          <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => setViewing(item)}>
            {item.name}
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate">{item.name}</span>
        )}
        <span className="hidden shrink-0 font-mono text-xs text-muted-foreground sm:block">{formatBytes(item.sizeBytes)}</span>
        {item.viewable && (
          <Button variant="ghost" size="sm" onClick={() => setViewing(item)}>
            <Eye /> View
          </Button>
        )}
        {r.allowDownload && (
          <Button variant="ghost" size="icon-sm" asChild>
            <a href={`/api/portal/${token}/files/${item.id}?download`} aria-label={`Download ${item.name}`}>
              <Download />
            </a>
          </Button>
        )}
        {!item.viewable && !r.allowDownload && <span className="shrink-0 text-xs text-muted-foreground">Ask for a copy</span>}
      </li>
    ));
  const renderFolder = (f: Contents['folders'][number], depth: number): ReactNode => (
    <li key={f.id}>
      <div className="flex items-center gap-2 border-t bg-muted/30 px-4 py-2 font-medium" style={{ paddingLeft: 16 + depth * 20 }}>
        <Folder className="size-4 shrink-0 text-primary" /> {f.name}
      </div>
      <ul>
        {foldersIn(f.id).map((c) => renderFolder(c, depth + 1))}
        {renderItems(f.id, depth + 1)}
      </ul>
    </li>
  );

  return (
    <div className="min-h-svh bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <Logo src={r.logoUrl} name={r.companyName} className="size-7" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{r.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {r.companyName}
              {r.email && ` · ${r.email}`}
            </div>
          </div>
          {r.allowDownload && r.items.length > 0 && (
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/portal/${token}/download.zip`}>
                <Download /> Download All
              </a>
            </Button>
          )}
        </div>
      </header>
      <main className="mx-auto grid max-w-4xl gap-4 px-4 py-6">
        {r.welcomeMessage && <p className="whitespace-pre-wrap">{r.welcomeMessage}</p>}
        {r.items.length === 0 ? (
          <Alert>
            <AlertDescription>There are no documents here yet.</AlertDescription>
          </Alert>
        ) : (
          <ul className="overflow-hidden rounded-lg border bg-background [&>li:first-child>div]:border-t-0 [&>li:first-child]:border-t-0">
            {foldersIn(null).map((f) => renderFolder(f, 0))}
            {renderItems(null, 0)}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          {r.companyName} records which documents you open and how long you read them.
          {r.watermark && ' Documents carry a watermark with your email.'}
        </p>
      </main>
    </div>
  );
}

function Viewer({ token, room, item, onBack }: { token: string; room: Contents; item: Item; onBack: () => void }) {
  const trpc = useTRPC();
  const beat = useMutation(trpc.portal.heartbeat.mutationOptions({ meta: { silent: true } }));
  const [error, setError] = useState<string | null>(null);
  const current = useRef({ page: 1, pageCount: undefined as number | undefined });
  const last = useRef(Date.now());
  const send = beat.mutate;
  const url = `/api/portal/${token}/files/${item.id}`;

  useEffect(() => {
    last.current = Date.now();
    const flush = () => {
      const seconds = Math.min(60, (Date.now() - last.current) / 1000);
      last.current = Date.now();
      if (seconds >= 1) send({ token, itemId: item.id, page: current.current.page, pageCount: current.current.pageCount, seconds });
    };
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') flush();
      else last.current = Date.now();
    }, HEARTBEAT_SECONDS * 1000);
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
      else last.current = Date.now();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [send, token, item.id]);

  const onPage = useCallback(
    (page: number, pageCount: number) => {
      if (page !== current.current.page) {
        const seconds = Math.min(60, (Date.now() - last.current) / 1000);
        last.current = Date.now();
        if (seconds >= 1) send({ token, itemId: item.id, page: current.current.page, pageCount, seconds });
      }
      current.current = { page, pageCount };
    },
    [send, token, item.id],
  );
  const onError = useCallback((message: string) => setError(message), []);

  return (
    <div className="min-h-svh bg-muted/60">
      <header className="sticky top-0 z-10 border-b bg-background">
        <div className="mx-auto flex max-w-4xl items-center gap-2 px-4 py-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft /> Back to Room
          </Button>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</span>
          {room.allowDownload && (
            <Button variant="outline" size="sm" asChild>
              <a href={`${url}?download`}>
                <Download /> Download
              </a>
            </Button>
          )}
        </div>
      </header>
      <div className="relative mx-auto max-w-4xl select-none px-4" onContextMenu={(e) => !room.allowDownload && e.preventDefault()}>
        {error ? (
          <Alert variant="destructive" className="mt-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : item.contentType === 'application/pdf' ? (
          <Suspense fallback={<Spinner className="m-6 size-6" />}>
            <PdfViewer url={url} onPage={onPage} onError={onError} />
          </Suspense>
        ) : (
          <div className="relative py-4">
            <img src={url} alt={item.name} className="mx-auto max-w-full rounded-sm border bg-white" draggable={false} />
            {room.watermark && <Watermark text={room.watermark} />}
          </div>
        )}
      </div>
    </div>
  );
}

/** PDFs carry the watermark in the file itself; images get it drawn over them on screen. */
function Watermark({ text }: { text: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden">
      <div className="-rotate-30 text-2xl font-semibold whitespace-nowrap text-foreground/15">{text}</div>
    </div>
  );
}
