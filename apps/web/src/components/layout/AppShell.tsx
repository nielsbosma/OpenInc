import { Menu, Search, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Outlet } from 'react-router';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useClientConfig } from '@/lib/session';
import { cn } from '@/lib/utils';
import { CommandPalette, isMac } from './CommandPalette';
import { NotificationBell } from './NotificationBell';
import { Sidebar } from './Sidebar';
import { UserMenu } from './UserMenu';

const CHAT_KEY = 'openinc-chat-open';

/** Navigation on the left, content in the middle, the assistant on the right. */
export function AppShell() {
  const config = useClientConfig();
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [chatOpen, setChatOpenState] = useState(() => {
    try {
      return localStorage.getItem(CHAT_KEY) === '1';
    } catch {
      return false;
    }
  });
  const setChatOpen = (open: boolean) => {
    setChatOpenState(open);
    try {
      localStorage.setItem(CHAT_KEY, open ? '1' : '0');
    } catch {}
  };
  const aiEnabled = !!config?.aiEnabled;
  const showChat = aiEnabled && chatOpen;

  return (
    <div className="flex h-svh overflow-hidden">
      <aside className="hidden w-60 shrink-0 border-r border-sidebar-border lg:block">
        <Sidebar />
      </aside>
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-8 w-full max-w-72 items-center gap-2 rounded-md border bg-muted/40 px-2.5 text-muted-foreground transition-colors hover:bg-muted"
          >
            <Search className="size-4" />
            <span className="flex-1 text-left">Search or jump to…</span>
            <Kbd className="hidden sm:inline-flex">{isMac ? '⌘' : 'Ctrl'} K</Kbd>
          </button>
          <div className="ml-auto flex items-center gap-1">
            {aiEnabled && (
              <Button variant={chatOpen ? 'secondary' : 'ghost'} size="sm" onClick={() => setChatOpen(!chatOpen)} aria-pressed={chatOpen}>
                <Sparkles /> <span className="hidden sm:inline">Assistant</span>
              </Button>
            )}
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>

      {showChat && (
        <aside className={cn('hidden w-[400px] shrink-0 border-l xl:flex')}>
          <ChatPanel onClose={() => setChatOpen(false)} />
        </aside>
      )}
      {aiEnabled && (
        <Sheet open={chatOpen} onOpenChange={setChatOpen}>
          <SheetContent side="right" className="w-full p-0 sm:max-w-md xl:hidden">
            <SheetTitle className="sr-only">Assistant</SheetTitle>
            <ChatPanel onClose={() => setChatOpen(false)} />
          </SheetContent>
        </Sheet>
      )}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onOpenChat={() => setChatOpen(true)} />
    </div>
  );
}
