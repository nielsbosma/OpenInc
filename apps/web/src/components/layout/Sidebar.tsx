import { Search } from 'lucide-react';
import { NavLink } from 'react-router';
import { Logo } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Kbd } from '@/components/ui/kbd';
import { useCan, useClientConfig } from '@/lib/session';
import { cn } from '@/lib/utils';
import { isMac } from './keys';
import { BUILT_MODULES, MAIN_NAV, MODULES, type NavItem, SETTINGS_NAV, SETTINGS_PERMISSIONS } from './nav';
import { SetupChecklist } from './SetupChecklist';

function Item({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const soon = MODULES.includes(item) && !BUILT_MODULES.has(item.path);
  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground',
          isActive && 'bg-sidebar-accent text-sidebar-foreground',
        )
      }
    >
      <item.icon className="size-4 shrink-0 opacity-80" />
      <span className="truncate">{item.title}</span>
      {soon && (
        <Badge variant="outline" className="ml-auto h-4 px-1.5 text-[10px] font-normal text-muted-foreground">
          Soon
        </Badge>
      )}
    </NavLink>
  );
}

export function Sidebar({ onNavigate, onSearch }: { onNavigate?: () => void; onSearch: () => void }) {
  const can = useCan();
  const config = useClientConfig();
  const showSettings = SETTINGS_PERMISSIONS.some((p) => can(p));
  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <Logo src={config?.logoUrl} name={config?.companyName} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-tight">{config?.companyName ?? 'OpenInc'}</div>
          <div className="truncate font-mono text-[11px] leading-tight text-muted-foreground" data-testid="app-version">
            {config?.companyName ? 'OpenInc ' : ''}v{config?.version}
          </div>
        </div>
      </div>
      <div className="px-2 pb-2">
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            onSearch();
          }}
          className="flex h-8 w-full items-center gap-2 rounded-md border bg-background px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent"
        >
          <Search className="size-4 shrink-0" />
          <span className="flex-1 truncate text-left">Search</span>
          <Kbd>{isMac ? '⌘' : 'Ctrl'} K</Kbd>
        </button>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-1" aria-label="Main">
        {MAIN_NAV.map((item) => (
          <Item key={item.path} item={item} onNavigate={onNavigate} />
        ))}
      </nav>
      <SetupChecklist onNavigate={onNavigate} />
      {showSettings && (
        <div className="border-t border-sidebar-border px-2 py-2">
          <Item item={SETTINGS_NAV} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
}
