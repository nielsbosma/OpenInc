import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router';
import { Spinner } from '@/components/common';
import { AppShell } from '@/components/layout/AppShell';
import { MODULE_PAGES } from '@/components/layout/nav';
import { useErrorTracking } from '@/lib/error-tracking';
import { useSession } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { SettingsPage } from '@/pages/admin/settings/SettingsPage';
import { InvitePage } from '@/pages/auth/InvitePage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { ForgotPasswordPage, ResetPasswordPage } from '@/pages/auth/PasswordPages';
import { TwoFactorRequiredPage } from '@/pages/auth/TwoFactorRequiredPage';
import { ComingSoonPage } from '@/pages/ComingSoonPage';
import { ConsentPage } from '@/pages/ConsentPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
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

/** Old addresses from before Settings held the account and admin pages; links in emails still use them. */
function LegacyRedirect({ to }: { to: (tab?: string) => string }) {
  const { tab } = useParams();
  return <Navigate to={to(tab)} replace />;
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
        {MODULE_PAGES.map((m) =>
          m.children?.length ? (
            <Route key={m.path} path={m.path} element={<Navigate to={m.children[0]!.path} replace />} />
          ) : (
            <Route key={m.path} path={m.path} element={<ComingSoonPage module={m} />} />
          ),
        )}
        <Route path="/settings/:tab?" element={<SettingsPage />} />
        <Route
          path="/account/:tab?"
          element={<LegacyRedirect to={(tab) => `/settings/account${tab && tab !== 'profile' ? `#${tab}` : ''}`} />}
        />
        <Route path="/admin/users" element={<Navigate to="/settings/users" replace />} />
        <Route path="/admin/audit" element={<Navigate to="/settings/audit-log" replace />} />
        <Route path="/admin/settings/:tab?" element={<LegacyRedirect to={(tab) => `/settings${tab ? `/${tab}` : ''}`} />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
