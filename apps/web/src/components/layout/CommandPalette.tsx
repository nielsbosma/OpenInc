import { KeyRound, ListChecks, LogOut, Moon, Sparkles, Sun, User, UserPlus } from 'lucide-react';
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
} from '@/components/ui/command';
import { useCan } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { MAIN_NAV, SETTINGS_SECTIONS } from './nav';
import { useChecklist } from './SetupChecklist';
import { useLogout } from './UserMenu';

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
  const { theme, toggle } = useTheme();
  const logout = useLogout();
  const checklist = useChecklist();

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
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Command Palette" description="Jump to a page or run an action">
      <CommandInput placeholder="Type a page or action…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Go To">
          {MAIN_NAV.map((item) => (
            <CommandItem key={item.path} onSelect={run(() => navigate(item.path))}>
              <item.icon /> {item.title}
            </CommandItem>
          ))}
          {SETTINGS_SECTIONS.filter((s) => !s.permission || can(s.permission)).map((s) => (
            <CommandItem key={s.path} value={`Settings ${s.title}`} onSelect={run(() => navigate(s.path))}>
              <s.icon /> {s.title === 'Users' || s.title === 'Audit Log' ? s.title : `Settings: ${s.title}`}
            </CommandItem>
          ))}
          <CommandItem onSelect={run(() => navigate('/account'))}>
            <User /> Account
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          {can('users.manage') && (
            <CommandItem onSelect={run(() => navigate('/admin/settings/users?invite=1'))}>
              <UserPlus /> Invite Someone
            </CommandItem>
          )}
          <CommandItem onSelect={run(onOpenChat)}>
            <Sparkles /> Open Assistant
          </CommandItem>
          {can('settings.manage') && checklist.data?.dismissed && !checklist.data.complete && (
            <CommandItem onSelect={run(checklist.show)}>
              <ListChecks /> Show Setup Checklist
            </CommandItem>
          )}
          <CommandItem onSelect={run(() => navigate('/account/security'))}>
            <KeyRound /> Two-Factor and Password
          </CommandItem>
          <CommandItem onSelect={run(toggle)}>
            {theme === 'dark' ? <Sun /> : <Moon />} {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          </CommandItem>
          <CommandItem onSelect={run(() => logout.mutate({}))}>
            <LogOut /> Sign Out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
