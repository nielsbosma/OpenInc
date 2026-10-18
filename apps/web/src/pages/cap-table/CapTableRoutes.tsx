import { BarChart3 } from 'lucide-react';
import { NavLink, Outlet, Route, Routes } from 'react-router';
import { EmptyState, PageHeader } from '@/components/common';
import { useCan } from '@/lib/session';
import { cn } from '@/lib/utils';
import { ConvertiblesTab } from './ConvertiblesTab';
import { HistoryTab } from './HistoryTab';
import { OverviewTab } from './OverviewTab';
import { PlansTab } from './PlansTab';
import { ScenarioPage } from './ScenarioPage';
import { ScenariosTab } from './ScenariosTab';
import { SettingsTab } from './SettingsTab';
import { StakeholderPage } from './StakeholderPage';
import { ValuationsTab } from './ValuationsTab';

const TABS: { to: string; label: string; end?: boolean; permission?: 'captable.model' | 'captable.manage' }[] = [
  { to: '/cap-table', label: 'Overview', end: true },
  { to: '/cap-table/history', label: 'Ownership Over Time' },
  { to: '/cap-table/plans', label: 'Equity Plans' },
  { to: '/cap-table/convertibles', label: 'Convertibles' },
  { to: '/cap-table/valuations', label: 'Valuations' },
  { to: '/cap-table/scenarios', label: 'Scenarios', permission: 'captable.model' },
  { to: '/cap-table/settings', label: 'Settings', permission: 'captable.manage' },
];

function CapTableLayout() {
  const can = useCan();
  if (!can('captable.read'))
    return (
      <EmptyState icon={<BarChart3 />} title="No Access">
        Ask an Admin for access to the cap table.
      </EmptyState>
    );
  return (
    <>
      <PageHeader
        title="Cap Table"
        description="Fully diluted ownership from the share register, with equity plans, convertibles, valuations and scenarios."
      />
      <nav className="mb-5 flex gap-1 overflow-x-auto border-b">
        {TABS.filter((t) => !t.permission || can(t.permission)).map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                '-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground hover:text-foreground',
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

export function CapTableRoutes() {
  return (
    <Routes>
      <Route element={<CapTableLayout />}>
        <Route index element={<OverviewTab />} />
        <Route path="history" element={<HistoryTab />} />
        <Route path="plans" element={<PlansTab />} />
        <Route path="convertibles" element={<ConvertiblesTab />} />
        <Route path="valuations" element={<ValuationsTab />} />
        <Route path="scenarios" element={<ScenariosTab />} />
        <Route path="scenarios/:id" element={<ScenarioPage />} />
        <Route path="settings" element={<SettingsTab />} />
        <Route path="stakeholders/:id" element={<StakeholderPage />} />
      </Route>
    </Routes>
  );
}
