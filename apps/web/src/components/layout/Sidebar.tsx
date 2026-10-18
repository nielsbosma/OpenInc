import { ChevronRight, PanelLeftClose, Search } from 'lucide-react';
import { useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { Logo } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useClientConfig } from '@/lib/session';
import { cn } from '@/lib/utils';
import { isMac } from './keys';
import { NotificationsNavItem } from './NotificationsNavItem';
import { BUILT_MODULES, MAIN_NAV, MODULES, type NavItem, SETTINGS_NAV } from './nav';
import { SetupChecklist } from './SetupChecklist';

const linkClass = (isActive: boolean) =>
  cn(
    'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground',
    isActive && 'bg-sidebar-accent text-sidebar-foreground',
  );

function SoonBadge() {
  return (
    <Badge variant="outline" className="ml-auto h-4 px-1.5 text-[10px] font-normal text-muted-foreground">
      Soon
    </Badge>
  );
}

function Item({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  return (
    <NavLink to={item.path} end={item.path === '/'} onClick={onNavigate} className={({ isActive }) => linkClass(isActive)}>
      <item.icon className="size-4 shrink-0 opacity-80" />
      <span className="truncate">{item.title}</span>
      {MODULES.includes(item) && !BUILT_MODULES.has(item.path) && <SoonBadge />}
    </NavLink>
  );
}

const groupKey = (path: string) => `openinc-nav-open:${path}`;

/** A module with sub-pages: the parent toggles the group, which opens by itself when one of its pages is active. */
function Group({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const active = pathname === item.path || pathname.startsWith(`${item.path}/`);
  const [open, setOpenState] = useState(() => {
    try {
      return localStorage.getItem(groupKey(item.path)) === '1';
    } catch {
      return false;
    }
  });
  const setOpen = (value: boolean) => {
    setOpenState(value);
    try {
      localStorage.setItem(groupKey(item.path), value ? '1' : '0');
    } catch {}
  };
  const expanded = open || active;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
        className={cn(linkClass(false), 'w-full', active && 'text-sidebar-foreground')}
      >
        <item.icon className="size-4 shrink-0 opacity-80" />
        <span className="truncate">{item.title}</span>
        <ChevronRight className={cn('size-3.5 shrink-0 opacity-60 transition-transform', expanded && 'rotate-90')} />
        <SoonBadge />
      </button>
      {expanded && (
        <div className="mt-0.5 ml-[18px] grid gap-0.5 border-l border-sidebar-border pl-2">
          {item.children!.map((child) => (
            <NavLink key={child.path} to={child.path} onClick={onNavigate} className={({ isActive }) => cn(linkClass(isActive), 'h-7')}>
              <span className="truncate">{child.title}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ onNavigate, onSearch, onClose }: { onNavigate?: () => void; onSearch: () => void; onClose: () => void }) {
  const config = useClientConfig();
  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-14 shrink-0 items-center gap-2.5 pr-2 pl-4">
        <Logo src={config?.logoUrl} name={config?.companyName} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold leading-tight">{config?.companyName ?? 'OpenInc'}</div>
          <div className="truncate font-mono text-[11px] leading-tight text-muted-foreground" data-testid="app-version">
            {config?.companyName ? 'OpenInc ' : ''}v{config?.version}
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close Sidebar" className="text-muted-foreground">
              <PanelLeftClose />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Close Sidebar ({isMac ? '⌘' : 'Ctrl'}+B)</TooltipContent>
        </Tooltip>
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
        {MAIN_NAV.map((item) =>
          item.children?.length ? (
            <Group key={item.path} item={item} onNavigate={onNavigate} />
          ) : (
            <Item key={item.path} item={item} onNavigate={onNavigate} />
          ),
        )}
      </nav>
      <SetupChecklist onNavigate={onNavigate} />
      <div className="grid gap-0.5 border-t border-sidebar-border px-2 py-2">
        <NotificationsNavItem />
        <Item item={SETTINGS_NAV} onNavigate={onNavigate} />
      </div>
    </div>
  );
}
