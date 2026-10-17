import { Check, ChevronsUpDown } from 'lucide-react';
import type * as React from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface ComboboxOption {
  value: string;
  label: string;
  hint?: string;
}

/** A searchable picker for long lists (countries, currencies, time zones). */
export function Combobox({
  id,
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled,
  invalid,
  allowCustom,
  footer,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Offer whatever was typed as a value, e.g. a model id that is not in the list. */
  allowCustom?: boolean;
  footer?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = options.find((o) => o.value === value) ?? (value ? { value, label: value } : undefined);
  const custom = allowCustom && search.trim() && !options.some((o) => o.value === search.trim()) ? search.trim() : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          disabled={disabled}
          className="w-full justify-between px-3 font-normal"
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={allowCustom ? 'Search or type a custom value…' : 'Search…'} value={search} onValueChange={setSearch} />
          <CommandList>
            {!custom && <CommandEmpty>No match.</CommandEmpty>}
            {custom && (
              <CommandGroup>
                <CommandItem
                  value={`custom ${custom}`}
                  onSelect={() => {
                    onChange(custom);
                    setSearch('');
                    setOpen(false);
                  }}
                >
                  <Check className="size-4 opacity-0" />
                  <span className="truncate">
                    Use <span className="font-mono">{custom}</span>
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.value} ${o.hint ?? ''}`}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <Check className={cn('size-4', o.value === value ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{o.label}</span>
                  {o.hint && <span className="ml-auto text-xs text-muted-foreground">{o.hint}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {footer && <div className="border-t p-1">{footer}</div>}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
