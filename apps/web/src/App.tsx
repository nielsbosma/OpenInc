import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Spinner } from '@/components/common';
import { AppShell } from '@/components/layout/AppShell';
import { BUILT_MODULES, MODULES } from '@/components/layout/nav';
import { useErrorTracking } from '@/lib/error-tracking';
import { useSession } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { AccountPage } from '@/pages/account/AccountPage';
import { SettingsPage } from '@/pages/admin/settings/SettingsPage';
import { InvitePage } from '@/pages/auth/InvitePage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { ForgotPasswordPage, ResetPasswordPage } from '@/pages/auth/PasswordPages';
import { TwoFactorRequiredPage } from '@/pages/auth/TwoFactorRequiredPage';
import { ComingSoonPage } from '@/pages/ComingSoonPage';
import { ConsentPage } from '@/pages/ConsentPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { RegistryRoutes } from '@/pages/registry/RegistryRoutes';
import { SetupWizard } from '@/pages/setup/SetupWizard';
import { SystemStatusPage } from '@/pages/setup/SystemStatusPage';

function FullPageSpinner() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <Spinner className="size-6" />
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useSession();
  const trpc = useTRPC();
  const location = useLocation();
  const checklist = useQuery({ ...trpc.setup.checklist.queryOptions(), enabled: !!user && !user.mustEnableTwoFactor });
  if (isLoading) return <FullPageSpinner />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (user.mustEnableTwoFactor) return <TwoFactorRequiredPage />;
  if (user.permissions.includes('settings.manage') && checklist.data && !checklist.data.onboardingCompleted)
    return <Navigate to="/setup" replace />;
  return <>{children}</>;
}

export function App() {
  const trpc = useTRPC();
  const status = useQuery(
    trpc.setup.status.queryOptions(undefined, {
      refetchInterval: (q) => (q.state.data?.phase === 'ready' ? false : 2000),
      staleTime: 0,
    }),
  );
  useErrorTracking();

  if (status.isLoading) return <FullPageSpinner />;
  if (!status.data) return <SystemStatusPage status={null} />;
  const { phase, needsAdmin } = status.data;
  if (phase === 'needs-install' || phase === 'installing' || (phase === 'ready' && needsAdmin)) return <SetupWizard status={status.data} />;
  if (phase !== 'ready') return <SystemStatusPage status={status.data} />;

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/invite" element={<InvitePage />} />
      <Route path="/setup" element={<SetupWizard status={status.data} />} />
      <Route path="/oauth/consent" element={<ConsentPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        {MODULES.filter((m) => !BUILT_MODULES.has(m.path)).map((m) => (
          <Route key={m.path} path={m.path} element={<ComingSoonPage module={m} />} />
        ))}
        <Route path="/registry/*" element={<RegistryRoutes />} />
        <Route path="/account/:tab?" element={<AccountPage />} />
        <Route path="/admin/users" element={<Navigate to="/admin/settings/users" replace />} />
        <Route path="/admin/audit" element={<Navigate to="/admin/settings/audit-log" replace />} />
        <Route path="/admin/settings/:tab?" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
