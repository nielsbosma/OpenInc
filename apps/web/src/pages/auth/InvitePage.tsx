import { acceptInviteInput } from '@openinc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Field, Spinner, validate } from '@/components/common';
import { TwoFactorSetup } from '@/components/TwoFactorSetup';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTRPC } from '@/lib/trpc';
import { AuthLayout } from './AuthLayout';

/** Invite email → choose a password → offer two-factor → dashboard. Nothing else. */
export function InvitePage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const invite = useQuery({ ...trpc.invites.describe.queryOptions({ token }), retry: false, enabled: !!token });
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState<'account' | 'twoFactor'>('account');
  const accept = useMutation(
    trpc.invites.accept.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries();
        setStep('twoFactor');
      },
    }),
  );

  useEffect(() => {
    if (invite.data?.name) setName((n) => n || invite.data.name);
  }, [invite.data]);

  const finish = () => navigate('/', { replace: true });

  if (step === 'twoFactor') {
    return (
      <AuthLayout title="Protect your account" description="One more step: turn on two-factor authentication." wide>
        <TwoFactorSetup onDone={finish} onSkip={finish} />
      </AuthLayout>
    );
  }

  if (!token || invite.isError) {
    return (
      <AuthLayout title="Invitation not valid">
        <div className="grid gap-4">
          <p className="text-muted-foreground">
            {invite.error?.message ?? 'This link is incomplete.'} Ask the person who invited you to send a new one.
          </p>
          <Link to="/login" className="text-primary hover:underline">
            Go to sign in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  if (!invite.data) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const { data, errors } = validate(acceptInviteInput, { token, name, password });
    setErrors(errors ?? {});
    if (data) accept.mutate(data);
  };

  return (
    <AuthLayout
      title={`Join ${invite.data.product}`}
      description={`You were invited as ${invite.data.roleLabel}. Choose your name and a password.`}
    >
      <form onSubmit={submit} className="grid gap-4" noValidate>
        {accept.error && (
          <Alert variant="destructive">
            <AlertDescription>{accept.error.message}</AlertDescription>
          </Alert>
        )}
        <Field label="Email" htmlFor="email">
          <Input id="email" value={invite.data.email} disabled />
        </Field>
        <Field label="Your name" htmlFor="name" error={errors.name}>
          <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password} hint="At least 12 characters, with letters and digits.">
          <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" disabled={accept.isPending}>
          {accept.isPending && <Spinner className="text-primary-foreground" />} Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
