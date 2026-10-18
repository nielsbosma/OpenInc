import { createContext, type ReactElement, useContext } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** Whether the docked sidebar is the narrow icon rail, and how to widen it again. */
export const RailContext = createContext<{ collapsed: boolean; expand: () => void }>({ collapsed: false, expand: () => {} });

export const useRail = () => useContext(RailContext);

/** Labels, badges and chevrons fade out in the rail; the row keeps its width so nothing wraps while it animates. */
export const railFade = (collapsed: boolean) =>
  cn('transition-opacity duration-200 motion-reduce:transition-none', collapsed && 'opacity-0');

/** In the rail a row shrinks to a square around its icon. */
export const railRow = (collapsed: boolean) =>
  cn('w-full transition-[width,background-color] duration-200 motion-reduce:transition-none', collapsed && 'w-9');

/** In the rail an icon has no label beside it, so it gets one on hover. */
export function RailTip({ label, children }: { label: string; children: ReactElement }) {
  const { collapsed } = useRail();
  if (!collapsed) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
