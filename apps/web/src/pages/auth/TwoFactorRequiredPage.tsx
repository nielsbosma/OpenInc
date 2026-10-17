import { useQueryClient } from '@tanstack/react-query';
import { useLogout } from '@/components/layout/UserMenu';
import { TwoFactorSetup } from '@/components/TwoFactorSetup';
import { Button } from '@/components/ui/button';
import { AuthLayout } from './AuthLayout';

/** Shown instead of the app while an Admin requires two-factor and this user has not set it up. */
export function TwoFactorRequiredPage() {
  const queryClient = useQueryClient();
  const logout = useLogout();
  return (
    <AuthLayout
      title="Two-factor authentication is required"
      description="Your administrator requires it for every account. It takes a minute."
      wide
    >
      <div className="grid gap-6">
        <TwoFactorSetup onDone={() => void queryClient.invalidateQueries()} />
        <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => logout.mutate({})}>
          Sign out
        </Button>
      </div>
    </AuthLayout>
  );
}
