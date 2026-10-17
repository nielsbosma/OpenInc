import { NavLink } from 'react-router';
import { Logo } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { useCan, useClientConfig } from '@/lib/session';
import { cn } from '@/lib/utils';
import { ADMIN_NAV, MAIN_NAV, MODULES, type NavItem } from './nav';

function Item({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const soon = MODULES.includes(item);
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

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const can = useCan();
  const config = useClientConfig();
  const admin = ADMIN_NAV.filter((i) => !i.permission || can(i.permission));
  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <Logo src={config?.logoUrl} name={config?.companyName} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-tight">{config?.companyName ?? 'OpenInc'}</div>
          {config?.companyName && <div className="text-[11px] leading-tight text-muted-foreground">OpenInc</div>}
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2" aria-label="Main">
        {MAIN_NAV.map((item) => (
          <Item key={item.path} item={item} onNavigate={onNavigate} />
        ))}
        {admin.length > 0 && (
          <>
            <div className="mt-auto px-2.5 pt-6 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Manage</div>
            {admin.map((item) => (
              <Item key={item.path} item={item} onNavigate={onNavigate} />
            ))}
          </>
        )}
      </nav>
      <div className="px-4 py-3 font-mono text-[11px] text-muted-foreground">v{config?.version}</div>
    </div>
  );
}
