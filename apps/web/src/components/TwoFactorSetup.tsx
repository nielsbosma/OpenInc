import { totpCode } from '@openinc/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, ShieldCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { CopyButton, Field, Spinner } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTRPC } from '@/lib/trpc';

export function RecoveryCodes({ codes, onDone, doneLabel = 'I saved them' }: { codes: string[]; onDone?: () => void; doneLabel?: string }) {
  const text = codes.join('\n');
  const download = () => {
    const url = URL.createObjectURL(new Blob([`OpenInc recovery codes\n\n${text}\n`], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'openinc-recovery-codes.txt' });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground">
        Keep these somewhere safe. Each code signs you in once if you lose your phone. They will not be shown again.
      </p>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border bg-muted/40 p-4 font-mono text-sm" data-testid="recovery-codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={text} label="Copy codes" />
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <Download /> Download
        </Button>
        {onDone && (
          <Button type="button" size="sm" className="ml-auto" onClick={onDone}>
            {doneLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Scan a QR code, confirm one code, save the recovery codes. Used in onboarding, invites and Account → Security. */
export function TwoFactorSetup({ onDone, onSkip }: { onDone: () => void; onSkip?: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const begin = useMutation(trpc.account.beginTotpSetup.mutationOptions());
  const enable = useMutation(trpc.account.enableTotp.mutationOptions({ meta: { silent: true } }));
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = totpCode.safeParse(code);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setError(undefined);
    enable.mutate(
      { code: parsed.data },
      {
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: trpc.auth.session.queryKey() }),
        onError: (err) => setError(err.message),
      },
    );
  };

  if (enable.data) return <RecoveryCodes codes={enable.data.recoveryCodes} onDone={onDone} />;

  if (!begin.data) {
    return (
      <div className="grid gap-4">
        <div className="flex gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
          <p className="text-muted-foreground">
            Two-factor authentication asks for a code from an authenticator app (1Password, Google Authenticator, Authy…) when you sign in,
            so a leaked password is not enough.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => begin.mutate({})} disabled={begin.isPending}>
            {begin.isPending && <Spinner className="text-primary-foreground" />} Set up two-factor
          </Button>
          {onSkip && (
            <Button variant="ghost" onClick={onSkip}>
              Later
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <img
          src={begin.data.qrDataUrl}
          alt="QR code for the authenticator app"
          className="size-44 shrink-0 rounded-lg border bg-white p-1"
        />
        <div className="grid gap-2 text-muted-foreground">
          <p>1. Scan the QR code with your authenticator app.</p>
          <p>
            Can’t scan? Enter this key instead:
            <code className="mt-1 block font-mono text-xs break-all text-foreground" data-testid="totp-secret">
              {begin.data.secret}
            </code>
          </p>
          <p>2. Enter the 6-digit code the app shows.</p>
        </div>
      </div>
      <Field label="Code" htmlFor="totp-code" error={error}>
        <Input
          id="totp-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          className="w-36 font-mono tracking-widest"
          autoFocus
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={enable.isPending}>
          {enable.isPending && <Spinner className="text-primary-foreground" />} Turn on
        </Button>
        {onSkip && (
          <Button type="button" variant="ghost" onClick={onSkip}>
            Later
          </Button>
        )}
      </div>
    </form>
  );
}
