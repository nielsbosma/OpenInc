import { KeyRound, LogOut, Monitor, Moon, Sparkles, Sun, User, UserPlus } from 'lucide-react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { useCan, useClientConfig } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { ADMIN_NAV, MAIN_NAV } from './nav';
import { useLogout } from './UserMenu';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Cmd/Ctrl+K: jump to any page or run a common action. */
export function CommandPalette({
  open,
  onOpenChange,
  onOpenChat,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenChat: () => void;
}) {
  const navigate = useNavigate();
  const can = useCan();
  const config = useClientConfig();
  const { setTheme } = useTheme();
  const logout = useLogout();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const run = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Command palette" description="Jump to a page or run an action">
      <CommandInput placeholder="Type a page or action…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Go to">
          {MAIN_NAV.map((item) => (
            <CommandItem key={item.path} onSelect={run(() => navigate(item.path))}>
              <item.icon /> {item.title}
            </CommandItem>
          ))}
          {ADMIN_NAV.filter((i) => !i.permission || can(i.permission)).map((item) => (
            <CommandItem key={item.path} onSelect={run(() => navigate(item.path))}>
              <item.icon /> {item.title}
            </CommandItem>
          ))}
          <CommandItem onSelect={run(() => navigate('/account'))}>
            <User /> Account
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          {can('users.manage') && (
            <CommandItem onSelect={run(() => navigate('/admin/users?invite=1'))}>
              <UserPlus /> Invite someone
            </CommandItem>
          )}
          {config?.aiEnabled && (
            <CommandItem onSelect={run(onOpenChat)}>
              <Sparkles /> Ask the assistant
            </CommandItem>
          )}
          <CommandItem onSelect={run(() => navigate('/account/security'))}>
            <KeyRound /> Two-factor and password
          </CommandItem>
          <CommandItem onSelect={run(() => setTheme('light'))}>
            <Sun /> Light theme
          </CommandItem>
          <CommandItem onSelect={run(() => setTheme('dark'))}>
            <Moon /> Dark theme
          </CommandItem>
          <CommandItem onSelect={run(() => setTheme('system'))}>
            <Monitor /> System theme
          </CommandItem>
          <CommandItem onSelect={run(() => logout.mutate({}))}>
            <LogOut /> Sign out
            <CommandShortcut />
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
