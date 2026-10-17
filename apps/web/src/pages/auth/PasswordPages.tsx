import { password as passwordSchema, requestPasswordResetInput } from '@openinc/shared';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Field, Spinner, validate } from '@/components/common';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTRPC } from '@/lib/trpc';
import { AuthLayout } from './AuthLayout';

export function ForgotPasswordPage() {
  const trpc = useTRPC();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string>();
  const request = useMutation(trpc.auth.requestPasswordReset.mutationOptions());

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const { data, errors } = validate(requestPasswordResetInput, { email });
    setError(errors?.email);
    if (data) request.mutate(data);
  };

  return (
    <AuthLayout title="Reset Your Password" description="We will email you a link to choose a new password.">
      {request.isSuccess ? (
        <div className="grid gap-4">
          <p>If an account exists for {email}, a link is on its way. It works for one hour.</p>
          <Link to="/login" className="text-primary hover:underline">
            Back to Sign In
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <Field label="Email" htmlFor="email" error={error}>
            <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          <Button type="submit" disabled={request.isPending}>
            {request.isPending && <Spinner className="text-primary-foreground" />} Send Link
          </Button>
          <Link to="/login" className="text-center text-muted-foreground hover:text-foreground">
            Back to Sign In
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const trpc = useTRPC();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const reset = useMutation(trpc.auth.resetPassword.mutationOptions({ meta: { silent: true }, onError: (e) => setError(e.message) }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    setError(undefined);
    reset.mutate({ token, password: parsed.data });
  };

  return (
    <AuthLayout title="Choose a New Password">
      {reset.isSuccess ? (
        <div className="grid gap-4">
          <p>Your password is changed. You were signed out everywhere else.</p>
          <Button asChild>
            <Link to="/login">Sign In</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-4" noValidate>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Field label="New Password" htmlFor="password" hint="At least 12 characters, with letters and digits.">
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </Field>
          <Button type="submit" disabled={reset.isPending || !token}>
            {reset.isPending && <Spinner className="text-primary-foreground" />} Save Password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
