import { ChevronRight, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { useState } from 'react';
import { NavLink, useLocation, useMatch, useNavigate } from 'react-router';
import { Logo } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useClientConfig } from '@/lib/session';
import { cn } from '@/lib/utils';
import { isMac } from './keys';
import { NotificationsNavItem } from './NotificationsNavItem';
import { BUILT_MODULES, MAIN_NAV, MODULES, type NavItem, SETTINGS_NAV } from './nav';
import { RailContext, RailTip, railFade, railRow, useRail } from './rail';
import { SetupChecklist } from './SetupChecklist';

const linkClass = (isActive: boolean) =>
  cn(
    'flex h-8 items-center gap-2.5 overflow-hidden whitespace-nowrap rounded-md px-2.5 text-[13px] font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground',
    isActive && 'bg-sidebar-accent text-sidebar-foreground',
  );

const shortcut = `${isMac ? '⌘' : 'Ctrl'}+B`;

function SoonBadge() {
  const { collapsed } = useRail();
  return (
    <Badge variant="outline" className={cn('ml-auto h-4 px-1.5 text-[10px] font-normal text-muted-foreground', railFade(collapsed))}>
      Soon
    </Badge>
  );
}

function Item({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const { collapsed } = useRail();
  // A string className, not NavLink's function form: the rail's tooltip trigger merges classes and drops functions.
  const active = !!useMatch({ path: item.path, end: item.path === '/' });
  return (
    <RailTip label={item.title}>
      <NavLink to={item.path} end={item.path === '/'} onClick={onNavigate} className={cn(linkClass(active), railRow(collapsed))}>
        <item.icon className="size-4 shrink-0 opacity-80" />
        <span className={cn('truncate', railFade(collapsed))}>{item.title}</span>
        {MODULES.includes(item) && !BUILT_MODULES.has(item.path) && <SoonBadge />}
      </NavLink>
    </RailTip>
  );
}

const groupKey = (path: string) => `openinc-nav-open:${path}`;
const isUnder = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`);

/** In the rail a group is one icon; its pages open in a menu beside it. */
function RailGroup({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const built = BUILT_MODULES.has(item.path);
  const go = (path: string) => {
    navigate(path);
    onNavigate?.();
  };
  return (
    <DropdownMenu>
      <RailTip label={item.title}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={item.title}
            className={cn(linkClass(isUnder(pathname, item.path)), railRow(true), 'data-[state=open]:bg-sidebar-accent')}
          >
            <item.icon className="size-4 shrink-0 opacity-80" />
          </button>
        </DropdownMenuTrigger>
      </RailTip>
      <DropdownMenuContent side="right" align="start" sideOffset={8} className="min-w-44">
        <DropdownMenuLabel>{item.title}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {built && <DropdownMenuItem onSelect={() => go(item.path)}>All {item.title}</DropdownMenuItem>}
        {item.children!.map((child) => (
          <DropdownMenuItem key={child.path} onSelect={() => go(child.path)} className={cn(isUnder(pathname, child.path) && 'bg-accent')}>
            {child.title}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A module with sub-pages: the parent toggles the group, which opens by itself when one of its pages is active.
 * A built parent is a page of its own, so its name links there and only the chevron toggles.
 */
function Group({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const { collapsed } = useRail();
  const { pathname } = useLocation();
  const active = isUnder(pathname, item.path);
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
  if (collapsed) return <RailGroup item={item} onNavigate={onNavigate} />;
  const expanded = open || active;
  const built = BUILT_MODULES.has(item.path);
  const onChild = item.children!.some((c) => isUnder(pathname, c.path));
  const chevron = <ChevronRight className={cn('size-3.5 shrink-0 opacity-60 transition-transform', expanded && 'rotate-90')} />;
  return (
    <div>
      {built ? (
        <div className="flex items-center gap-0.5">
          <NavLink
            to={item.path}
            onClick={() => {
              setOpen(true);
              onNavigate?.();
            }}
            className={cn(linkClass(active && !onChild), 'min-w-0 flex-1')}
          >
            <item.icon className="size-4 shrink-0 opacity-80" />
            <span className="truncate">{item.title}</span>
          </NavLink>
          <button
            type="button"
            onClick={() => setOpen(!expanded)}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Hide' : 'Show'} ${item.title} Pages`}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/75 hover:bg-sidebar-accent"
          >
            {chevron}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(!expanded)}
          aria-expanded={expanded}
          className={cn(linkClass(false), 'w-full', active && 'text-sidebar-foreground')}
        >
          <item.icon className="size-4 shrink-0 opacity-80" />
          <span className="truncate">{item.title}</span>
          {chevron}
          <SoonBadge />
        </button>
      )}
      {expanded && (
        <div className="mt-0.5 ml-[18px] grid gap-0.5 border-l border-sidebar-border pl-2">
          {item.children!.map((child) => (
            <NavLink key={child.path} to={child.path} onClick={onNavigate} className={({ isActive }) => cn(linkClass(isActive), 'h-7')}>
              <span className="truncate">{child.title}</span>
              {built && !BUILT_MODULES.has(child.path) && <SoonBadge />}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  const config = useClientConfig();
  const { collapsed, expand } = useRail();
  const logo = <Logo src={config?.logoUrl} name={config?.companyName} />;
  return (
    <div className="flex h-14 shrink-0 items-center gap-2.5 pr-2 pl-3">
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={expand}
              aria-label="Open Sidebar"
              className="group relative flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-sidebar-accent"
            >
              <span className="group-hover:opacity-0 group-focus-visible:opacity-0">{logo}</span>
              <PanelLeftOpen className="absolute size-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Open Sidebar ({shortcut})</TooltipContent>
        </Tooltip>
      ) : (
        logo
      )}
      <div className={cn('min-w-0 flex-1 whitespace-nowrap', railFade(collapsed))}>
        <div className="truncate text-sm font-semibold leading-tight">{config?.companyName ?? 'OpenInc'}</div>
        <div className="truncate font-mono text-[11px] leading-tight text-muted-foreground" data-testid="app-version">
          {config?.companyName ? 'OpenInc ' : ''}v{config?.version}
        </div>
      </div>
      {!collapsed && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close Sidebar" className="text-muted-foreground">
              <PanelLeftClose />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Close Sidebar ({shortcut})</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * The navigation. Docked, it collapses to an icon rail: the parent animates its width and lays this out at full width
 * underneath, so rows never reflow mid-animation.
 */
export function Sidebar({
  onNavigate,
  onSearch,
  onClose,
  collapsed = false,
  onExpand,
}: {
  onNavigate?: () => void;
  onSearch: () => void;
  onClose: () => void;
  collapsed?: boolean;
  onExpand?: () => void;
}) {
  return (
    <RailContext.Provider value={{ collapsed, expand: onExpand ?? (() => {}) }}>
      <div className="flex h-full flex-col bg-sidebar">
        <Header onClose={onClose} />
        <div className="px-2 pb-2">
          <RailTip label={`Search (${isMac ? '⌘' : 'Ctrl'}+K)`}>
            <button
              type="button"
              onClick={() => {
                onNavigate?.();
                onSearch();
              }}
              aria-label="Search"
              className={cn(
                'flex h-8 items-center gap-2 overflow-hidden whitespace-nowrap rounded-md border bg-background px-2.5 text-[13px] text-muted-foreground hover:bg-sidebar-accent',
                railRow(collapsed),
              )}
            >
              <Search className="size-4 shrink-0" />
              <span className={cn('flex-1 truncate text-left', railFade(collapsed))}>Search</span>
              <Kbd className={railFade(collapsed)}>{isMac ? '⌘' : 'Ctrl'} K</Kbd>
            </button>
          </RailTip>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto px-2 py-1" aria-label="Main">
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
    </RailContext.Provider>
  );
}
