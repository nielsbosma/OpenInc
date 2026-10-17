import {
  AI_DEFAULT_MODELS,
  AI_PROVIDERS,
  type AiProvider,
  companySettings,
  type EditableGroup,
  EMAIL_SECURITY,
  errorTrackingSettings,
  settingEnvName,
} from '@openinc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Lock, Upload, XCircle } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Combobox } from '@/components/Combobox';
import { Field, Logo, Spinner, validate } from '@/components/common';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { browserDefaults, countryOptions, currencyOptions, timeZoneOptions } from '@/lib/locale-options';
import { useSession } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { uploadFile } from '@/lib/upload';

export interface FormProps {
  /** In the setup wizard: different button labels and a Skip button. */
  wizard?: boolean;
  onSaved?: () => void;
  onSkip?: () => void;
}

type Values = Record<string, unknown>;

function useSettingsGroup(group: EditableGroup) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const query = useQuery(trpc.settings.get.queryOptions({ group }));
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.settings.pathKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.system.clientConfig.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.setup.checklist.queryKey() }),
    ]);
  const update = useMutation(trpc.settings.update.mutationOptions({ onSuccess: invalidate }));
  const clear = useMutation(trpc.settings.clear.mutationOptions({ onSuccess: invalidate }));
  return { view: query.data, isLoading: query.isLoading, update, clear };
}

function LockedHint({ group, field }: { group: EditableGroup; field: string }) {
  return (
    <span className="flex items-center gap-1">
      <Lock className="size-3" /> Set by the {settingEnvName(group, field)} environment variable
    </span>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 pt-2">{children}</div>;
}

function TestResult({ result }: { result: { ok: boolean; message: string } | null }) {
  if (!result) return null;
  return (
    <Alert variant={result.ok ? 'default' : 'destructive'}>
      {result.ok ? <CheckCircle2 className="text-success" /> : <XCircle />}
      <AlertDescription className="break-words">{result.message}</AlertDescription>
    </Alert>
  );
}

function FormShell({ isLoading, children, onSubmit }: { isLoading: boolean; children: ReactNode; onSubmit: (e: FormEvent) => void }) {
  if (isLoading) return <Spinner />;
  return (
    <form onSubmit={onSubmit} className="grid max-w-xl gap-4" noValidate>
      {children}
    </form>
  );
}

export function CompanyForm({ wizard, onSaved }: FormProps) {
  const { view, isLoading, update } = useSettingsGroup('company');
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (view) setValues({ name: '', registrationNumber: '', address: '', logoFileId: null, ...browserDefaults(), ...view.values });
  }, [view]);

  const set = (field: string) => (value: unknown) => setValues((v) => ({ ...v, [field]: value }));
  const locked = (field: string) => view?.locked.includes(field);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const { data, errors } = validate(companySettings, values);
    setErrors(errors ?? {});
    if (data)
      update.mutate(
        { group: 'company', values: data },
        { onSuccess: () => (onSaved ? onSaved() : toast.success('Company details saved')) },
      );
  };

  const onLogo = async (file: File) => {
    setUploading(true);
    try {
      const uploaded = await uploadFile(file, 'logo');
      set('logoFileId')(uploaded.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const logoId = values.logoFileId as string | null;
  return (
    <FormShell isLoading={isLoading} onSubmit={submit}>
      <Field label="Company name" htmlFor="company-name" error={errors.name}>
        <Input
          id="company-name"
          value={String(values.name ?? '')}
          onChange={(e) => set('name')(e.target.value)}
          disabled={locked('name')}
          autoFocus={wizard}
        />
      </Field>
      <Field label="Registration number" htmlFor="company-reg" error={errors.registrationNumber} hint="Organisation or company number">
        <Input
          id="company-reg"
          value={String(values.registrationNumber ?? '')}
          onChange={(e) => set('registrationNumber')(e.target.value)}
        />
      </Field>
      <Field label="Address" htmlFor="company-address" error={errors.address}>
        <Textarea id="company-address" rows={2} value={String(values.address ?? '')} onChange={(e) => set('address')(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Country" htmlFor="company-country" error={errors.country}>
          <Combobox
            id="company-country"
            value={String(values.country ?? '')}
            onChange={set('country')}
            options={countryOptions()}
            invalid={!!errors.country}
          />
        </Field>
        <Field label="Currency" htmlFor="company-currency" error={errors.currency} hint="Amounts are shown and stored in this currency">
          <Combobox id="company-currency" value={String(values.currency ?? '')} onChange={set('currency')} options={currencyOptions()} />
        </Field>
      </div>
      <Field label="Time zone" htmlFor="company-tz" error={errors.timeZone} hint="Dates and times are shown in this time zone">
        <Combobox id="company-tz" value={String(values.timeZone ?? '')} onChange={set('timeZone')} options={timeZoneOptions()} />
      </Field>
      <Field label="Logo" hint="PNG, JPEG, WebP or SVG. Shown in the sidebar and on the sign-in page.">
        <div className="flex items-center gap-3">
          <Logo src={logoId ? `/api/files/${logoId}/content` : null} className="size-10" />
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
            hidden
            onChange={(e) => e.target.files?.[0] && onLogo(e.target.files[0])}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={uploading}>
            {uploading ? <Spinner /> : <Upload />} Upload logo
          </Button>
          {logoId && (
            <Button type="button" variant="ghost" size="sm" onClick={() => set('logoFileId')(null)}>
              Remove
            </Button>
          )}
        </div>
      </Field>
      <Actions>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending && <Spinner className="text-primary-foreground" />} {wizard ? 'Continue' : 'Save'}
        </Button>
      </Actions>
    </FormShell>
  );
}

export function EmailForm({ wizard, onSaved, onSkip }: FormProps) {
  const trpc = useTRPC();
  const { user } = useSession();
  const { view, isLoading, update, clear } = useSettingsGroup('email');
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const test = useMutation(trpc.settings.testEmail.mutationOptions());

  useEffect(() => {
    if (view)
      setValues({ host: '', port: 587, security: 'starttls', username: '', fromAddress: '', fromName: '', ...view.values, password: '' });
  }, [view]);
  const set = (field: string) => (value: unknown) => setValues((v) => ({ ...v, [field]: value }));
  const locked = (field: string) => !!view?.locked.includes(field);
  const passwordSet = !!view?.secretsSet.password;

  const draft = () => {
    const out: Values = { ...values, port: Number(values.port) };
    if (out.password === '' && passwordSet) delete out.password;
    return out;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const d = draft();
    if (!d.host) return setErrors({ host: 'Enter the SMTP host' });
    if (!d.fromAddress) return setErrors({ fromAddress: 'Enter a sender address' });
    setErrors({});
    update.mutate(
      { group: 'email', values: d as never },
      { onSuccess: () => (onSaved ? onSaved() : toast.success('Email settings saved')) },
    );
  };

  const sendTest = () => {
    setResult(null);
    test.mutate(
      { settings: draft() as never },
      {
        onSuccess: (r) =>
          setResult(r.ok ? { ok: true, message: `Sent a test email to ${r.to}. Check the inbox.` } : { ok: false, message: r.error }),
      },
    );
  };

  return (
    <FormShell isLoading={isLoading} onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <Field
          label="SMTP host"
          htmlFor="smtp-host"
          error={errors.host}
          hint={locked('host') ? <LockedHint group="email" field="host" /> : undefined}
        >
          <Input
            id="smtp-host"
            placeholder="smtp.example.com"
            value={String(values.host ?? '')}
            onChange={(e) => set('host')(e.target.value)}
            disabled={locked('host')}
          />
        </Field>
        <Field label="Port" htmlFor="smtp-port">
          <Input
            id="smtp-port"
            inputMode="numeric"
            value={String(values.port ?? '')}
            onChange={(e) => set('port')(e.target.value)}
            disabled={locked('port')}
            className="font-mono"
          />
        </Field>
      </div>
      <Field label="Security" htmlFor="smtp-security" hint="STARTTLS for port 587, TLS for 465, none only for a local test server.">
        <Select value={String(values.security ?? 'starttls')} onValueChange={set('security')} disabled={locked('security')}>
          <SelectTrigger id="smtp-security" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EMAIL_SECURITY.map((s) => (
              <SelectItem key={s} value={s}>
                {{ starttls: 'STARTTLS', tls: 'TLS', none: 'None' }[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="User name" htmlFor="smtp-user">
          <Input
            id="smtp-user"
            autoComplete="off"
            value={String(values.username ?? '')}
            onChange={(e) => set('username')(e.target.value)}
            disabled={locked('username')}
          />
        </Field>
        <Field label="Password" htmlFor="smtp-password" hint={passwordSet ? 'Saved. Leave empty to keep it.' : undefined}>
          <Input
            id="smtp-password"
            type="password"
            autoComplete="new-password"
            placeholder={passwordSet ? '••••••••' : ''}
            value={String(values.password ?? '')}
            onChange={(e) => set('password')(e.target.value)}
            disabled={locked('password')}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Sender address" htmlFor="smtp-from" error={errors.fromAddress}>
          <Input
            id="smtp-from"
            type="email"
            placeholder="noreply@example.com"
            value={String(values.fromAddress ?? '')}
            onChange={(e) => set('fromAddress')(e.target.value)}
            disabled={locked('fromAddress')}
          />
        </Field>
        <Field label="Sender name" htmlFor="smtp-from-name" hint="Defaults to the company name">
          <Input
            id="smtp-from-name"
            value={String(values.fromName ?? '')}
            onChange={(e) => set('fromName')(e.target.value)}
            disabled={locked('fromName')}
          />
        </Field>
      </div>
      <TestResult result={result} />
      <Actions>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending && <Spinner className="text-primary-foreground" />} {wizard ? 'Save and continue' : 'Save'}
        </Button>
        <Button type="button" variant="outline" onClick={sendTest} disabled={test.isPending || !values.host}>
          {test.isPending && <Spinner />} Send test email{user ? ` to ${user.email}` : ''}
        </Button>
        {wizard && onSkip && (
          <Button type="button" variant="ghost" onClick={onSkip}>
            Skip for now
          </Button>
        )}
        {!wizard && view?.configured && (
          <Button type="button" variant="ghost" className="ml-auto text-destructive" onClick={() => clear.mutate({ group: 'email' })}>
            Remove
          </Button>
        )}
      </Actions>
    </FormShell>
  );
}

export function AiForm({ wizard, onSaved, onSkip }: FormProps) {
  const trpc = useTRPC();
  const { view, isLoading, update, clear } = useSettingsGroup('ai');
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const test = useMutation(trpc.settings.testAi.mutationOptions());

  useEffect(() => {
    if (view) setValues({ provider: 'anthropic', model: AI_DEFAULT_MODELS.anthropic, baseUrl: '', ...view.values, apiKey: '' });
  }, [view]);
  const set = (field: string) => (value: unknown) => setValues((v) => ({ ...v, [field]: value }));
  const locked = (field: string) => !!view?.locked.includes(field);
  const keySet = !!view?.secretsSet.apiKey;
  const provider = values.provider as AiProvider;

  const draft = () => {
    const out: Values = { ...values };
    if (out.apiKey === '' && keySet) delete out.apiKey;
    return out;
  };
  const check = () => {
    const d = draft();
    const e: Record<string, string> = {};
    if (!d.model) e.model = 'Enter a model name';
    if (provider === 'openai-compatible' && !d.baseUrl) e.baseUrl = 'Enter the base URL';
    if (provider !== 'openai-compatible' && !d.apiKey && !keySet) e.apiKey = 'Enter the API key';
    setErrors(e);
    return Object.keys(e).length ? null : d;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const d = check();
    if (d)
      update.mutate(
        { group: 'ai', values: d as never },
        { onSuccess: () => (onSaved ? onSaved() : toast.success('AI settings saved. The assistant is on.')) },
      );
  };
  const runTest = () => {
    const d = check();
    if (!d) return;
    setResult(null);
    test.mutate(
      { settings: d as never },
      {
        onSuccess: (r) =>
          setResult(r.ok ? { ok: true, message: `It works: the model answered in ${r.ms} ms.` } : { ok: false, message: r.error }),
      },
    );
  };

  return (
    <FormShell isLoading={isLoading} onSubmit={submit}>
      <Field label="Provider" htmlFor="ai-provider">
        <Select
          value={provider ?? 'anthropic'}
          onValueChange={(p) => setValues((v) => ({ ...v, provider: p, model: AI_DEFAULT_MODELS[p as AiProvider] || v.model }))}
          disabled={locked('provider')}
        >
          <SelectTrigger id="ai-provider" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AI_PROVIDERS.map((p) => (
              <SelectItem key={p} value={p}>
                {{ anthropic: 'Anthropic', openai: 'OpenAI', 'openai-compatible': 'OpenAI-compatible (custom URL)' }[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Model" htmlFor="ai-model" error={errors.model}>
        <Input
          id="ai-model"
          className="font-mono"
          value={String(values.model ?? '')}
          onChange={(e) => set('model')(e.target.value)}
          disabled={locked('model')}
        />
      </Field>
      <Field
        label="API key"
        htmlFor="ai-key"
        error={errors.apiKey}
        hint={
          locked('apiKey') ? (
            <LockedHint group="ai" field="apiKey" />
          ) : keySet ? (
            'Saved. Leave empty to keep it.'
          ) : (
            'Stored encrypted; never shown again.'
          )
        }
      >
        <Input
          id="ai-key"
          type="password"
          autoComplete="new-password"
          placeholder={keySet ? '••••••••' : ''}
          value={String(values.apiKey ?? '')}
          onChange={(e) => set('apiKey')(e.target.value)}
          disabled={locked('apiKey')}
        />
      </Field>
      {(provider === 'openai-compatible' || !!values.baseUrl) && (
        <Field label="Base URL" htmlFor="ai-url" error={errors.baseUrl} hint="For OpenAI-compatible servers, e.g. https://host/v1">
          <Input
            id="ai-url"
            className="font-mono"
            value={String(values.baseUrl ?? '')}
            onChange={(e) => set('baseUrl')(e.target.value)}
            disabled={locked('baseUrl')}
          />
        </Field>
      )}
      <TestResult result={result} />
      <Actions>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending && <Spinner className="text-primary-foreground" />} {wizard ? 'Save and continue' : 'Save'}
        </Button>
        <Button type="button" variant="outline" onClick={runTest} disabled={test.isPending}>
          {test.isPending && <Spinner />} Test connection
        </Button>
        {wizard && onSkip && (
          <Button type="button" variant="ghost" onClick={onSkip}>
            Skip for now
          </Button>
        )}
        {!wizard && view?.configured && (
          <Button type="button" variant="ghost" className="ml-auto text-destructive" onClick={() => clear.mutate({ group: 'ai' })}>
            Turn off
          </Button>
        )}
      </Actions>
    </FormShell>
  );
}

export function ErrorTrackingForm({ wizard, onSaved, onSkip }: FormProps) {
  const { view, isLoading, update, clear } = useSettingsGroup('errorTracking');
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (view) setValues({ dsn: '', environment: 'production', ...view.values });
  }, [view]);
  const set = (field: string) => (value: unknown) => setValues((v) => ({ ...v, [field]: value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const { data, errors } = validate(errorTrackingSettings, values);
    setErrors(errors ?? {});
    if (data)
      update.mutate(
        { group: 'errorTracking', values: data },
        { onSuccess: () => (onSaved ? onSaved() : toast.success('Error tracking saved')) },
      );
  };

  return (
    <FormShell isLoading={isLoading} onSubmit={submit}>
      <Field
        label="DSN"
        htmlFor="sentry-dsn"
        error={errors.dsn}
        hint="From Bugsink or Sentry. Server and browser errors are sent here. Leave empty to turn it off."
      >
        <Input
          id="sentry-dsn"
          className="font-mono"
          placeholder="https://key@errors.example.com/1"
          value={String(values.dsn ?? '')}
          onChange={(e) => set('dsn')(e.target.value)}
          disabled={view?.locked.includes('dsn')}
        />
      </Field>
      <Field label="Environment" htmlFor="sentry-env" error={errors.environment}>
        <Input id="sentry-env" value={String(values.environment ?? '')} onChange={(e) => set('environment')(e.target.value)} />
      </Field>
      <Actions>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending && <Spinner className="text-primary-foreground" />} {wizard ? 'Save and finish' : 'Save'}
        </Button>
        {wizard && onSkip && (
          <Button type="button" variant="ghost" onClick={onSkip}>
            Skip
          </Button>
        )}
        {!wizard && view?.configured && (
          <Button
            type="button"
            variant="ghost"
            className="ml-auto text-destructive"
            onClick={() => clear.mutate({ group: 'errorTracking' })}
          >
            Turn off
          </Button>
        )}
      </Actions>
    </FormShell>
  );
}
