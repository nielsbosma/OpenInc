import { createFirstAdminInput, type SystemStatus } from '@openinc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, Circle, Database, HardDrive, Loader2, XCircle } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { Field, Logo, Spinner, validate } from '@/components/common';
import { TwoFactorSetup } from '@/components/TwoFactorSetup';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useSession } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { AiForm, CompanyForm, EmailForm, ErrorTrackingForm } from '../admin/settings/forms';

const STEPS = [
  { key: 'install', title: 'Database' },
  { key: 'admin', title: 'Admin account' },
  { key: 'company', title: 'Company' },
  { key: 'email', title: 'Email' },
  { key: 'extras', title: 'Optional extras' },
] as const;

type Step = 'code' | 'install' | 'admin' | 'twoFactor' | 'company' | 'email' | 'extras' | 'errors';

const CODE_KEY = 'openinc-setup-code';
const STEP_KEY = 'openinc-setup-step';
const LATER_STEPS: Step[] = ['twoFactor', 'company', 'email', 'extras', 'errors'];

function rememberStep(step: Step) {
  try {
    if (LATER_STEPS.includes(step)) sessionStorage.setItem(STEP_KEY, step);
  } catch {}
}

/** Signing in re-renders the app around the wizard, so the step after the admin account is kept in sessionStorage. */
const storedStep = (): Step | null => {
  try {
    const s = sessionStorage.getItem(STEP_KEY) as Step | null;
    return s && LATER_STEPS.includes(s) ? s : null;
  } catch {
    return null;
  }
};
const storedCode = () => {
  try {
    return sessionStorage.getItem(CODE_KEY) ?? '';
  } catch {
    return '';
  }
};

function Stepper({ step }: { step: Step }) {
  const order: Step[] = ['install', 'admin', 'company', 'email', 'extras'];
  const position = (s: Step) => order.indexOf(s === 'code' ? 'install' : s === 'twoFactor' ? 'admin' : s === 'errors' ? 'extras' : s);
  const current = position(step);
  return (
    <ol className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
      {STEPS.map((s, i) => (
        <li
          key={s.key}
          className={cn('flex items-center gap-1.5', i === current ? 'font-medium text-foreground' : 'text-muted-foreground')}
        >
          {i < current ? (
            <CheckCircle2 className="size-3.5 text-success" />
          ) : (
            <Circle className={cn('size-3.5', i === current && 'text-primary')} />
          )}
          {s.title}
        </li>
      ))}
    </ol>
  );
}

function CodeStep({ onDone }: { onDone: (code: string) => void }) {
  const trpc = useTRPC();
  const [code, setCode] = useState('');
  const verify = useMutation(trpc.setup.verifyCode.mutationOptions({ meta: { silent: true } }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    verify.mutate(
      { code },
      {
        onSuccess: () => {
          try {
            sessionStorage.setItem(CODE_KEY, code);
          } catch {}
          onDone(code);
        },
      },
    );
  };
  return (
    <form onSubmit={submit} className="grid gap-4">
      <p className="text-muted-foreground">
        To prove this is your server, enter the setup code from the container log. On Sliplane it is under the service’s <b>Logs</b>.
        Locally, run <code className="font-mono text-xs">docker compose logs app</code>.
      </p>
      {verify.error && (
        <Alert variant="destructive">
          <AlertDescription>{verify.error.message}</AlertDescription>
        </Alert>
      )}
      <Field label="Setup code" htmlFor="setup-code">
        <Input
          id="setup-code"
          placeholder="XXXX-XXXX"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          className="w-44 font-mono tracking-widest uppercase"
          autoFocus
          autoComplete="off"
        />
      </Field>
      <Button type="submit" className="justify-self-start" disabled={verify.isPending || code.length < 8}>
        {verify.isPending && <Spinner className="text-primary-foreground" />} Continue
      </Button>
    </form>
  );
}

function CheckRow({ icon: Icon, label, ok, detail }: { icon: typeof Database; label: string; ok: boolean; detail: string }) {
  return (
    <li className="flex items-center gap-3 rounded-md border px-3 py-2.5">
      <Icon className="size-4 text-muted-foreground" />
      <div className="flex-1">
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
      {ok ? <Check className="size-4 text-success" /> : <XCircle className="size-4 text-destructive" />}
    </li>
  );
}

function InstallStep({ code, initial, onDone }: { code: string; initial: SystemStatus; onDone: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const install = useMutation(
    trpc.setup.install.mutationOptions({
      onSuccess: async (status) => {
        await queryClient.invalidateQueries({ queryKey: trpc.setup.status.queryKey() });
        if (status.phase === 'ready') onDone();
      },
    }),
  );
  const live = useQuery(trpc.setup.status.queryOptions(undefined, { refetchInterval: install.isPending ? 500 : false }));
  const status = live.data ?? initial;
  const progress = status.progress;
  const failed = status.phase === 'failed' || install.data?.phase === 'failed';
  const running = install.isPending || status.phase === 'installing';

  return (
    <div className="grid gap-4">
      <ul className="grid gap-2">
        <CheckRow icon={Database} label="Postgres" ok detail="Connected, with permission to create tables" />
        <CheckRow icon={HardDrive} label="S3 bucket" ok detail="Wrote, read back and deleted a test object" />
      </ul>
      {progress && (
        <div className="grid gap-2 rounded-md border p-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Applying migrations</span>
            <span className="font-mono">
              {progress.done}/{progress.total}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
          <ul className="grid gap-1 font-mono text-xs">
            {progress.steps.map((s) => (
              <li key={s.name} className="flex items-center gap-2">
                {s.status === 'done' && <Check className="size-3 text-success" />}
                {s.status === 'running' && <Loader2 className="size-3 animate-spin" />}
                {s.status === 'pending' && <Circle className="size-3 text-muted-foreground" />}
                {s.status === 'failed' && <XCircle className="size-3 text-destructive" />}
                {s.name}
              </li>
            ))}
          </ul>
        </div>
      )}
      {failed && (
        <Alert variant="destructive">
          <AlertDescription>{status.problems[0]?.message ?? 'The install failed.'}</AlertDescription>
        </Alert>
      )}
      <p className="text-muted-foreground">The database is empty. OpenInc will create its tables now; this takes a few seconds.</p>
      <Button className="justify-self-start" onClick={() => install.mutate({ code })} disabled={running}>
        {running && <Spinner className="text-primary-foreground" />} {failed ? 'Try again' : 'Install database'}
      </Button>
    </div>
  );
}

function AdminStep({ code, onDone }: { code: string; onDone: () => void }) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation(
    trpc.setup.createFirstAdmin.mutationOptions({
      // Signing in swaps the app around the wizard; the next step is stored first so the remounted wizard resumes there.
      onSuccess: async () => {
        rememberStep('twoFactor');
        navigate('/setup', { replace: true });
        await queryClient.invalidateQueries();
        onDone();
      },
    }),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const { data, errors } = validate(createFirstAdminInput, { ...values, code });
    setErrors(errors ?? {});
    if (data) create.mutate(data);
  };
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));
  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <p className="text-muted-foreground">This is the first Admin. You can invite the rest of the team afterwards.</p>
      <Field label="Your name" htmlFor="admin-name" error={errors.name}>
        <Input id="admin-name" autoComplete="name" value={values.name} onChange={set('name')} autoFocus />
      </Field>
      <Field label="Email" htmlFor="admin-email" error={errors.email}>
        <Input id="admin-email" type="email" autoComplete="username" value={values.email} onChange={set('email')} />
      </Field>
      <Field label="Password" htmlFor="admin-password" error={errors.password} hint="At least 12 characters, with letters and digits.">
        <Input id="admin-password" type="password" autoComplete="new-password" value={values.password} onChange={set('password')} />
      </Field>
      <Button type="submit" className="justify-self-start" disabled={create.isPending}>
        {create.isPending && <Spinner className="text-primary-foreground" />} Create account
      </Button>
    </form>
  );
}

const TITLES: Record<Step, { title: string; description?: string }> = {
  code: { title: 'Welcome to OpenInc', description: 'Let’s set up your install. It takes about five minutes.' },
  install: { title: 'Install the database', description: 'OpenInc checked your database and bucket.' },
  admin: { title: 'Create your admin account' },
  twoFactor: { title: 'Turn on two-factor authentication', description: 'Recommended for every Admin account.' },
  company: { title: 'Your company', description: 'Used across the app. You can change it later in Admin settings.' },
  email: { title: 'Email', description: 'For invitations, password resets and notifications. You can skip this and set it up later.' },
  extras: { title: 'AI assistant', description: 'Optional. With a provider set, an assistant can answer questions and do things for you.' },
  errors: { title: 'Error tracking', description: 'Optional. Send errors to Bugsink or Sentry.' },
};

export function SetupWizard({ status }: { status: SystemStatus }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useSession();
  const [code, setCode] = useState(storedCode);
  const [step, setStepState] = useState<Step>(() => {
    if (status.phase !== 'ready') return storedCode() ? 'install' : 'code';
    if (status.needsAdmin) return storedCode() ? 'admin' : 'code';
    return storedStep() ?? 'company';
  });
  const setStep = (next: Step) => {
    rememberStep(next);
    setStepState(next);
  };
  const complete = useMutation(
    trpc.setup.complete.mutationOptions({
      onSuccess: async () => {
        try {
          sessionStorage.removeItem(CODE_KEY);
          sessionStorage.removeItem(STEP_KEY);
        } catch {}
        queryClient.removeQueries({ queryKey: trpc.setup.checklist.queryKey() });
        await queryClient.invalidateQueries();
        navigate('/', { replace: true });
      },
    }),
  );

  if (step === 'company' && !status.needsAdmin && !user) {
    navigate('/login?next=/setup', { replace: true });
    return null;
  }

  const t = TITLES[step];
  return (
    <div className="flex min-h-svh flex-col items-center bg-muted/40 px-4 py-10 sm:py-16">
      <div className="mb-6 flex items-center gap-2.5">
        <Logo className="size-8" />
        <span className="text-base font-semibold">OpenInc setup</span>
      </div>
      <div className="w-full max-w-2xl">
        <div className="mb-4">
          <Stepper step={step} />
        </div>
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-lg">{t.title}</CardTitle>
            {t.description && <CardDescription>{t.description}</CardDescription>}
          </CardHeader>
          <CardContent>
            {step === 'code' && (
              <CodeStep
                onDone={(c) => {
                  setCode(c);
                  setStep(status.phase === 'ready' ? 'admin' : 'install');
                }}
              />
            )}
            {step === 'install' && <InstallStep code={code} initial={status} onDone={() => setStep('admin')} />}
            {step === 'admin' && <AdminStep code={code} onDone={() => setStep('twoFactor')} />}
            {step === 'twoFactor' && <TwoFactorSetup onDone={() => setStep('company')} onSkip={() => setStep('company')} />}
            {step === 'company' && <CompanyForm wizard onSaved={() => setStep('email')} />}
            {step === 'email' && <EmailForm wizard onSaved={() => setStep('extras')} onSkip={() => setStep('extras')} />}
            {step === 'extras' && <AiForm wizard onSaved={() => setStep('errors')} onSkip={() => setStep('errors')} />}
            {step === 'errors' && <ErrorTrackingForm wizard onSaved={() => complete.mutate({})} onSkip={() => complete.mutate({})} />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
