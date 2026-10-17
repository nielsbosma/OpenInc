import { loginInput, secondFactorCode } from '@openinc/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { Field, Spinner, validate } from '@/components/common';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSession } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { AuthLayout } from './AuthLayout';

function safeNext(next: string | null) {
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function LoginPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useSession();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();

  const done = async () => {
    await queryClient.invalidateQueries();
    navigate(next, { replace: true });
  };
  const login = useMutation(
    trpc.auth.login.mutationOptions({
      meta: { silent: true },
      onSuccess: (result) => (result.status === 'second_factor' ? setChallenge(result.challenge) : done()),
      onError: (e) => setError(e.message),
    }),
  );
  const second = useMutation(
    trpc.auth.loginSecondFactor.mutationOptions({ meta: { silent: true }, onSuccess: done, onError: (e) => setError(e.message) }),
  );

  if (user && !login.isPending) return <Navigate to={next} replace />;

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    const { data, errors } = validate(loginInput, { email, password });
    setErrors(errors ?? {});
    if (data) login.mutate(data);
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    const parsed = secondFactorCode.safeParse(code);
    if (!parsed.success) return setErrors({ code: parsed.error.issues[0]!.message });
    setErrors({});
    second.mutate({ challenge: challenge!, code: parsed.data });
  };

  if (challenge) {
    return (
      <AuthLayout
        title="Two-Factor Authentication"
        description="Enter the 6-digit code from your authenticator app, or one of your recovery codes."
      >
        <form onSubmit={submitCode} className="grid gap-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Field label="Code" htmlFor="code" error={errors.code}>
            <Input
              id="code"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="font-mono"
              autoFocus
            />
          </Field>
          <Button type="submit" disabled={second.isPending}>
            {second.isPending && <Spinner className="text-primary-foreground" />} Verify
          </Button>
          <Button type="button" variant="ghost" onClick={() => setChallenge(null)}>
            Back
          </Button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Sign In">
      <form onSubmit={submitPassword} className="grid gap-4" noValidate>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Field label="Email" htmlFor="email" error={errors.email}>
          <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" disabled={login.isPending}>
          {login.isPending && <Spinner className="text-primary-foreground" />} Sign In
        </Button>
        <Link to="/forgot-password" className="text-center text-muted-foreground hover:text-foreground">
          Forgot Your Password?
        </Link>
      </form>
    </AuthLayout>
  );
}
