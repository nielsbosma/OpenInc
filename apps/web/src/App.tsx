import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router';
import { Spinner } from '@/components/common';
import { AppShell } from '@/components/layout/AppShell';
import { BUILT_MODULES, MODULE_PAGES } from '@/components/layout/nav';
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
import { CapTableRoutes } from '@/pages/cap-table/CapTableRoutes';
import { DashboardPage } from '@/pages/DashboardPage';
import { DataroomsPage } from '@/pages/dataroom/DataroomsPage';
import { RoomPage } from '@/pages/dataroom/RoomPage';
import { DocumentsPage } from '@/pages/documents/DocumentsPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { PortalPage } from '@/pages/portal/PortalPage';
import { RegistryRoutes } from '@/pages/registry/RegistryRoutes';
import { SetupWizard } from '@/pages/setup/SetupWizard';
import { SystemStatusPage } from '@/pages/setup/SystemStatusPage';

// pdf.js is large, so the signing pages load on first use.
const SignPage = lazy(() => import('@/pages/signing/SignPage').then((m) => ({ default: m.SignPage })));
const SigningRoutes = lazy(() => import('@/pages/signing/SigningRoutes').then((m) => ({ default: m.SigningRoutes })));
const VerifyPage = lazy(() => import('@/pages/signing/VerifyPage').then((m) => ({ default: m.VerifyPage })));

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
      <Route path="/r/:token" element={<PortalPage />} />
      <Route
        path="/sign/:token"
        element={
          <Suspense fallback={<FullPageSpinner />}>
            <SignPage />
          </Suspense>
        }
      />
      <Route
        path="/verify"
        element={
          <Suspense fallback={<FullPageSpinner />}>
            <VerifyPage />
          </Suspense>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        {MODULE_PAGES.filter((m) => !BUILT_MODULES.has(m.path)).map((m) =>
          m.children?.length ? (
            <Route key={m.path} path={m.path} element={<Navigate to={m.children[0]!.path} replace />} />
          ) : (
            <Route key={m.path} path={m.path} element={<ComingSoonPage module={m} />} />
          ),
        )}
        <Route path="/registry/*" element={<RegistryRoutes />} />
        <Route path="/cap-table/*" element={<CapTableRoutes />} />
        <Route path="/documents/dataroom" element={<DataroomsPage />} />
        <Route path="/documents/dataroom/:roomId" element={<RoomPage />} />
        <Route
          path="/documents/signing/*"
          element={
            <Suspense fallback={<Spinner />}>
              <SigningRoutes />
            </Suspense>
          }
        />
        <Route path="/documents/:folderId?" element={<DocumentsPage />} />
        <Route path="/signing" element={<Navigate to="/documents/signing" replace />} />
        <Route path="/dataroom" element={<Navigate to="/documents/dataroom" replace />} />
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
