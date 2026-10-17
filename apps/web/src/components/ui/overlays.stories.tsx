import type { Meta, StoryObj } from '@storybook/react-vite';
import { LayoutDashboard, Settings, UserPlus, Users } from 'lucide-react';
import { Button } from './button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './command';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { Input } from './input';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from './sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

const meta = { title: 'UI/Overlays' } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const DialogExample: Story = {
  name: 'Dialog',
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Invite someone</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite someone</DialogTitle>
          <DialogDescription>They get an email with a link to choose a password.</DialogDescription>
        </DialogHeader>
        <Input placeholder="name@example.com" />
        <DialogFooter>
          <Button>Send invitation</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const Menus: Story = {
  render: () => (
    <div className="flex gap-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">Menu</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Ada Admin</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Account</DropdownMenuItem>
          <DropdownMenuItem className="text-destructive">Deactivate</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline">Popover</Button>
        </PopoverTrigger>
        <PopoverContent>Notifications appear here.</PopoverContent>
      </Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline">Tooltip</Button>
        </TooltipTrigger>
        <TooltipContent>Opens the assistant</TooltipContent>
      </Tooltip>
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="outline">Sheet</Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Assistant</SheetTitle>
            <SheetDescription>The right-hand panel on small screens.</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    </div>
  ),
};

export const CommandList_: Story = {
  name: 'Command palette',
  render: () => (
    <Command className="max-w-md rounded-lg border">
      <CommandInput placeholder="Type a page or action…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Go to">
          <CommandItem>
            <LayoutDashboard /> Dashboard
          </CommandItem>
          <CommandItem>
            <Users /> Users
          </CommandItem>
          <CommandItem>
            <Settings /> Settings
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem>
            <UserPlus /> Invite someone
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
};
