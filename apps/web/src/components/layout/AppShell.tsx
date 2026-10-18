import { PanelLeftOpen, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Outlet } from 'react-router';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSession } from '@/lib/session';
import { useMediaQuery } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';
import { CommandPalette } from './CommandPalette';
import { isMac } from './keys';
import { Sidebar } from './Sidebar';

function usePerUserFlag(name: string, userId: string | undefined, fallback: boolean) {
  return useStoredFlag(`openinc-${name}:${userId ?? 'anonymous'}`, fallback);
}

function useStoredFlag(key: string, fallback: boolean) {
  const [value, setState] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? fallback : stored === '1';
    } catch {
      return fallback;
    }
  });
  const set = (next: boolean) => {
    setState(next);
    try {
      localStorage.setItem(key, next ? '1' : '0');
    } catch {}
  };
  return [value, set] as const;
}

/** Navigation on the left, content in the middle, the assistant on the right. No top bar: the two toggles float over the content. */
export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { user } = useSession();
  // From 1024px the sidebar and the assistant are docked columns; below that they are sheets over the content.
  const docked = useMediaQuery('(min-width: 1024px)');
  const [chatOpen, setChatOpen] = usePerUserFlag('chat-open', user?.id, false);
  const [collapsed, setCollapsed] = useStoredFlag('openinc-sidebar-collapsed', false);

  const toggleSidebar = () => (docked ? setCollapsed(!collapsed) : setDrawerOpen(!drawerOpen));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'b' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="flex h-svh overflow-hidden">
      {docked && (
        <aside
          className={cn(
            'shrink-0 overflow-hidden border-r border-sidebar-border transition-[width] duration-200 ease-out motion-reduce:transition-none',
            collapsed ? 'w-13' : 'w-60',
          )}
          data-collapsed={collapsed || undefined}
        >
          <div className="h-full w-60">
            <Sidebar
              collapsed={collapsed}
              onSearch={() => setPaletteOpen(true)}
              onClose={() => setCollapsed(true)}
              onExpand={() => setCollapsed(false)}
            />
          </div>
        </aside>
      )}
      {!docked && (
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent side="left" className="w-72 p-0 [&>button]:hidden">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Sidebar onNavigate={() => setDrawerOpen(false)} onSearch={() => setPaletteOpen(true)} onClose={() => setDrawerOpen(false)} />
          </SheetContent>
        </Sheet>
      )}

      <main className="relative min-w-0 flex-1 overflow-y-auto">
        {!docked && (
          <div className="absolute top-2.5 left-3 z-10">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={toggleSidebar} aria-label="Open Sidebar" className="text-muted-foreground">
                  <PanelLeftOpen />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open Sidebar ({isMac ? '⌘' : 'Ctrl'}+B)</TooltipContent>
            </Tooltip>
          </div>
        )}
        {!chatOpen && (
          <div className="absolute top-2.5 right-3 z-10">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setChatOpen(true)}
                  aria-label="Assistant"
                  data-testid="chat-toggle"
                  className="text-muted-foreground"
                >
                  <Sparkles />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Assistant</TooltipContent>
            </Tooltip>
          </div>
        )}
        <div
          className={cn(
            'mx-auto w-full max-w-6xl pt-3.5 pb-6',
            chatOpen ? 'pr-4 sm:pr-6 lg:pr-8' : 'pr-14 sm:pr-16',
            docked ? 'pl-4 sm:pl-6 lg:pl-8' : 'pl-14 sm:pl-16',
          )}
        >
          <Outlet />
        </div>
      </main>

      {chatOpen && docked && (
        <aside className="flex w-[380px] shrink-0 border-l xl:w-[420px]" aria-label="Assistant" data-testid="chat-panel">
          <ChatPanel onClose={() => setChatOpen(false)} />
        </aside>
      )}
      {!docked && (
        <Sheet open={chatOpen} onOpenChange={setChatOpen}>
          <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md [&>button]:hidden">
            <SheetTitle className="sr-only">Assistant</SheetTitle>
            <ChatPanel onClose={() => setChatOpen(false)} />
          </SheetContent>
        </Sheet>
      )}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onOpenChat={() => setChatOpen(true)}
        onToggleSidebar={toggleSidebar}
      />
    </div>
  );
}
