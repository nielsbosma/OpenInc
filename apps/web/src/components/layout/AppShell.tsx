import { Menu, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Outlet } from 'react-router';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSession } from '@/lib/session';
import { useMediaQuery } from '@/lib/use-media-query';
import { CommandPalette } from './CommandPalette';
import { NotificationBell } from './NotificationBell';
import { Sidebar } from './Sidebar';
import { UserMenu } from './UserMenu';

const chatKey = (userId: string | undefined) => `openinc-chat-open:${userId ?? 'anonymous'}`;

function storedChatOpen(userId: string | undefined) {
  try {
    return localStorage.getItem(chatKey(userId)) === '1';
  } catch {
    return false;
  }
}

/** Navigation on the left, content in the middle, the assistant on the right. */
export function AppShell() {
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { user } = useSession();
  // From 1024px the assistant is a docked column beside the content; below that it is a sheet over it.
  const docked = useMediaQuery('(min-width: 1024px)');
  const [chatOpen, setChatOpenState] = useState(() => storedChatOpen(user?.id));
  const setChatOpen = (open: boolean) => {
    setChatOpenState(open);
    try {
      localStorage.setItem(chatKey(user?.id), open ? '1' : '0');
    } catch {}
  };

  return (
    <div className="flex h-svh overflow-hidden">
      <aside className="hidden w-60 shrink-0 border-r border-sidebar-border lg:block">
        <Sidebar onSearch={() => setPaletteOpen(true)} />
      </aside>
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar onNavigate={() => setNavOpen(false)} onSearch={() => setPaletteOpen(true)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-1 border-b px-2 sm:px-3">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open Navigation">
            <Menu />
          </Button>
          <div className="ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={chatOpen ? 'secondary' : 'ghost'}
                  size="icon"
                  onClick={() => setChatOpen(!chatOpen)}
                  aria-pressed={chatOpen}
                  aria-label="Assistant"
                  data-testid="chat-toggle"
                >
                  <Sparkles />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Assistant</TooltipContent>
            </Tooltip>
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
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onOpenChat={() => setChatOpen(true)} />
    </div>
  );
}
