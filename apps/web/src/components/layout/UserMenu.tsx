import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut, Monitor, Moon, Sun, User } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSession } from '@/lib/session';
import { type ThemeChoice, useTheme } from '@/lib/theme';
import { useTRPC } from '@/lib/trpc';

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export function UserAvatar({ name, url, className }: { name: string; url?: string | null; className?: string }) {
  return (
    <Avatar className={className}>
      {url && <AvatarImage src={url} alt="" />}
      <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

export function useLogout() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation(
    trpc.auth.logout.mutationOptions({
      onSuccess: () => {
        queryClient.clear();
        navigate('/login');
      },
    }),
  );
}

export function UserMenu() {
  const { user } = useSession();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const logout = useLogout();
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="User menu">
          <UserAvatar name={user.name} url={user.avatarUrl} className="size-7" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate font-medium">{user.name}</div>
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/account')}>
          <User /> Account
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemeChoice)}>
          <DropdownMenuRadioItem value="light">
            <Sun /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout.mutate({})}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
