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
  const key = `openinc-${name}:${userId ?? 'anonymous'}`;
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
  const [sidebarOpen, setSidebarOpen] = usePerUserFlag('sidebar-open', user?.id, true);
  const showSidebar = docked && sidebarOpen;

  const toggleSidebar = () => (docked ? setSidebarOpen(!sidebarOpen) : setDrawerOpen(!drawerOpen));
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
      {showSidebar && (
        <aside className="w-60 shrink-0 border-r border-sidebar-border">
          <Sidebar onSearch={() => setPaletteOpen(true)} onClose={() => setSidebarOpen(false)} />
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
        {!showSidebar && (
          <div className="absolute top-4 left-2 z-10 sm:left-3">
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
        <div className="absolute top-4 right-2 z-10 sm:right-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={chatOpen ? 'secondary' : 'ghost'}
                size="icon"
                onClick={() => setChatOpen(!chatOpen)}
                aria-pressed={chatOpen}
                aria-label="Assistant"
                data-testid="chat-toggle"
                className={cn(!chatOpen && 'text-muted-foreground')}
              >
                <Sparkles />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Assistant</TooltipContent>
          </Tooltip>
        </div>
        <div
          className={cn('mx-auto w-full max-w-6xl py-6 pr-14 sm:pr-16 lg:pr-16', showSidebar ? 'pl-4 sm:pl-6 lg:pl-8' : 'pl-14 sm:pl-16')}
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
