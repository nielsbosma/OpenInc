import { TRANSACTION_LABELS, type TransactionType } from '@openinc/shared';
import { BookUser, ChevronDown, Plus } from 'lucide-react';
import { Link, NavLink, Outlet, Route, Routes, useNavigate } from 'react-router';
import { EmptyState, PageHeader, Spinner } from '@/components/common';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCan } from '@/lib/session';
import { cn } from '@/lib/utils';
import { ClassesTab } from './ClassesTab';
import { useRegistryStatus } from './common';
import { HolderPage } from './HolderPage';
import { ImportReview } from './ImportReview';
import { ImportTab } from './ImportTab';
import { RegisterTab } from './RegisterTab';
import { RegistrySettingsForm } from './RegistrySettingsForm';
import { TransactionPage } from './TransactionPage';
import { TransactionsTab } from './TransactionsTab';
import { TransactionWizard } from './wizard/TransactionWizard';

const TABS: { to: string; label: string; end?: boolean; permission?: 'registry.manage' | 'registry.draft' }[] = [
  { to: '/registry', label: 'Register', end: true },
  { to: '/registry/transactions', label: 'Transactions' },
  { to: '/registry/classes', label: 'Classes' },
  { to: '/registry/import', label: 'Import', permission: 'registry.draft' },
  { to: '/registry/settings', label: 'Settings', permission: 'registry.manage' },
];

const NEW_TYPES: { type: TransactionType; group: string }[] = [
  { type: 'transfer', group: 'Ownership' },
  { type: 'holder_change', group: 'Ownership' },
  { type: 'pledge', group: 'Ownership' },
  { type: 'pledge_release', group: 'Ownership' },
  { type: 'new_issue', group: 'Capital' },
  { type: 'registration', group: 'Capital' },
  { type: 'bonus_issue', group: 'Capital' },
  { type: 'split', group: 'Capital' },
  { type: 'reverse_split', group: 'Capital' },
];

export function NewTransactionMenu({ initialized }: { initialized: boolean }) {
  const navigate = useNavigate();
  if (!initialized)
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>
            <Plus /> Start the Register <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => navigate('/registry/new/incorporation')}>Incorporation (a New Company)</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate('/registry/new/opening_balance')}>
            Opening Balance (an Existing Register)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>
          <Plus /> New Transaction <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {['Ownership', 'Capital'].map((group, i) => (
          <div key={group}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{group}</DropdownMenuLabel>
            {NEW_TYPES.filter((t) => t.group === group).map((t) => (
              <DropdownMenuItem key={t.type} onSelect={() => navigate(`/registry/new/${t.type}`)}>
                {TRANSACTION_LABELS[t.type]}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RegistryLayout() {
  const can = useCan();
  const status = useRegistryStatus();
  if (status.isLoading) return <Spinner />;
  if (!status.data?.setUp) {
    return (
      <>
        <PageHeader title="Share Register" description="Who owns which shares at any date, and every transaction behind it." />
        {can('registry.manage') ? (
          <div className="max-w-3xl">
            <h2 className="mb-1 font-medium">Set Up the Share Register</h2>
            <p className="mb-4 text-muted-foreground">
              The country and legal form pick the rules the register follows. You can change the details later.
            </p>
            <RegistrySettingsForm />
          </div>
        ) : (
          <EmptyState icon={<BookUser />} title="Not Set Up Yet">
            An Admin sets up the share register first.
          </EmptyState>
        )}
      </>
    );
  }
  const pack = status.data.settings.rulePackInfo;
  return (
    <>
      <PageHeader
        title={pack.terms.registerLocal ? `Share Register (${pack.terms.registerLocal})` : 'Share Register'}
        description={`${pack.label} · ${status.data.settings.nationalNumber || 'no registration number'}`}
        actions={
          can('registry.draft') && (
            <NewTransactionMenu initialized={(status.data.counts.committed ?? 0) + (status.data.counts.reversed ?? 0) > 0} />
          )
        }
      />
      {!pack.countrySpecific && (
        <p className="-mt-3 mb-4 text-xs text-muted-foreground">
          Generic EU rule pack: the register checks its own consistency, but no country-specific rules.
        </p>
      )}
      {status.data.lastChainCheck && !status.data.lastChainCheck.ok && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>The Integrity Check Failed</AlertTitle>
          <AlertDescription>{status.data.lastChainCheck.message}. A committed transaction was changed outside the app.</AlertDescription>
        </Alert>
      )}
      <nav className="mb-5 flex gap-1 border-b">
        {TABS.filter((t) => !t.permission || can(t.permission)).map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                '-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground',
                isActive && 'border-primary text-foreground',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}

export function RegistryRoutes() {
  return (
    <Routes>
      <Route path="new/:type" element={<TransactionWizard />} />
      <Route path="transactions/:id/edit" element={<TransactionWizard />} />
      <Route element={<RegistryLayout />}>
        <Route index element={<RegisterTab />} />
        <Route path="transactions" element={<TransactionsTab />} />
        <Route path="transactions/:id" element={<TransactionPage />} />
        <Route path="holders/:id" element={<HolderPage />} />
        <Route path="classes" element={<ClassesTab />} />
        <Route path="import" element={<ImportTab />} />
        <Route path="import/:id" element={<ImportReview />} />
        <Route path="settings" element={<RegistrySettingsForm />} />
        <Route
          path="*"
          element={
            <EmptyState title="Not Found">
              <Link to="/registry" className="text-primary">
                Back to the Register
              </Link>
            </EmptyState>
          }
        />
      </Route>
    </Routes>
  );
}
